import { ESI, esiFetch } from './esiClient';
import { loadJson, saveJson } from '../storage';
import type { Sde } from '../data/sde';
import { tx } from '../i18n';

const ZKB = 'https://zkillboard.com/api';

const SYSTEMS_KEY = 'eve-recon:systems';
const PILOTS_KEY = 'eve-recon:pilots';
const PILOT_TTL = 6 * 3600 * 1000;
const MAX_PILOTS_CACHED = 2000;

export type RouteFlag = 'shortest' | 'secure' | 'insecure';

const ROUTE_PREFERENCE: Record<RouteFlag, string> = { shortest: 'Shorter', secure: 'Safer', insecure: 'LessSecure' };

export interface SystemInfo { id: number; name: string; sec: number }
export interface SystemActivity { ship: number; pod: number; npc: number; jumps: number }

export interface KillSummary {
  id: number;
  time: number;
  systemId: number;
  victimShip: number;
  victimAlliance?: number;
  victimCorp?: number;
  value: number;
  attackers: number;
  players: number;
  npcAttackers: number;
  attackerIds: number[];
  attackerShips: number[];
  weapons: number[];
  attackerAlliances: number[];
  topShip?: number;
  shipList: { id: number; n: number }[];
  location?: number;
  npc: boolean;
  solo: boolean;
}

export interface SystemIntel { kills: KillSummary[]; total: number; camp: boolean; campers: number; smartbomb: boolean }

export interface PilotStats {
  kills: number;
  losses: number;
  solo: number;
  danger: number;
  gang: number;
  iskKilled: number;
  recent: number;
  topShips: { id: number; kills: number }[];
  at: number;
}

export interface Pilot {
  id: number;
  name: string;
  corpId?: number;
  allianceId?: number;
  stats?: PilotStats | null;
  failed?: boolean;
}

export interface DscanRow { typeId: number; name: string; typeName: string; distance: string; km: number | null }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function esiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await esiFetch(`${ESI}${path}`, init);
  if (!res.ok) throw new Error(`ESI ${path.split('?')[0]}: ${res.status}`);
  return (await res.json()) as T;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const chunks = <T>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

let zkbChain: Promise<unknown> = Promise.resolve();
const ZKB_SPACING = 700;

function zkbJson<T>(path: string): Promise<T> {
  const run = zkbChain.then(async () => {
    let res = await fetch(`${ZKB}${path}`, { headers: { Accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) {
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 3000);
      res = await fetch(`${ZKB}${path}`, { headers: { Accept: 'application/json' } });
    }
    if (!res.ok) throw new Error(`zKillboard: ${res.status}`);
    return (await res.json()) as T;
  });
  zkbChain = run.catch(() => undefined).then(() => sleep(ZKB_SPACING));
  return run;
}

export async function resolveIds(names: string[]): Promise<{ characters: { id: number; name: string }[]; systems: { id: number; name: string }[] }> {
  const out = { characters: [] as { id: number; name: string }[], systems: [] as { id: number; name: string }[] };
  for (const part of chunks([...new Set(names)], 500)) {
    const r = await esiJson<{ characters?: { id: number; name: string }[]; systems?: { id: number; name: string }[] }>('/universe/ids/', post(part));
    out.characters.push(...(r.characters ?? []));
    out.systems.push(...(r.systems ?? []));
  }
  return out;
}

const nameCache = new Map<number, string>();

export async function resolveNames(ids: number[]): Promise<Map<number, string>> {
  const missing = [...new Set(ids)].filter((id) => id && !nameCache.has(id));
  for (const part of chunks(missing, 1000)) {
    try {
      const r = await esiJson<{ id: number; name: string }[]>('/universe/names/', post(part));
      for (const x of r) nameCache.set(x.id, x.name);
    } catch {
      for (const id of part) {
        try {
          const r = await esiJson<{ id: number; name: string }[]>('/universe/names/', post([id]));
          for (const x of r) nameCache.set(x.id, x.name);
        } catch {
          const t = await esiJson<{ name: string }>(`/universe/types/${id}/`).catch(() => null);
          nameCache.set(id, t?.name ?? String(id));
        }
      }
    }
  }
  return nameCache;
}

export const cachedName = (id?: number) => (id ? nameCache.get(id) ?? '' : '');

let systems = loadJson<Record<number, [string, number]>>(SYSTEMS_KEY, {});

export async function systemInfo(ids: number[]): Promise<Map<number, SystemInfo>> {
  const missing = ids.filter((id) => !systems[id]);
  if (missing.length) {
    const got = await Promise.all(missing.map((id) => esiJson<{ name: string; security_status: number }>(`/universe/systems/${id}/`).then((s) => [id, s] as const)));
    systems = { ...loadJson<Record<number, [string, number]>>(SYSTEMS_KEY, {}), ...systems };
    for (const [id, s] of got) systems[id] = [s.name, s.security_status];
    saveJson(SYSTEMS_KEY, systems);
  }
  return new Map(ids.map((id) => [id, { id, name: systems[id][0], sec: systems[id][1] }]));
}

export async function findSystem(name: string): Promise<SystemInfo> {
  const q = name.trim();
  const known = Object.entries(systems).find(([, [n]]) => n.toLowerCase() === q.toLowerCase());
  if (known) return { id: Number(known[0]), name: known[1][0], sec: known[1][1] };
  const { systems: found } = await resolveIds([q]);
  if (!found.length) throw new Error(tx('Sistemul „{name}” nu există.', { name: q }));
  return (await systemInfo([found[0].id])).get(found[0].id)!;
}

export interface RouteConnection { from: number; to: number }

export async function route(origin: number, destination: number, flag: RouteFlag, { avoid = [], connections = [] }: { avoid?: number[]; connections?: RouteConnection[] } = {}): Promise<number[]> {
  const body: Record<string, unknown> = { preference: ROUTE_PREFERENCE[flag] };
  const skip = avoid.filter((id) => id !== origin && id !== destination).slice(0, 1000);
  if (skip.length) body.avoid_systems = [...new Set(skip)];
  if (connections.length) body.connections = connections.slice(0, 1000);
  const res = await esiFetch(`${ESI}/route/${origin}/${destination}`, post(body));
  if (res.status === 404) throw new Error(tx('Nu există rută prin stargate-uri între aceste sisteme (wormhole sau sistem izolat).'));
  if (!res.ok) throw new Error(`ESI /route: ${res.status}`);
  return ((await res.json()) as { route: number[] }).route;
}

let activity: { at: number; map: Map<number, SystemActivity> } | null = null;

export const isDangerous = (a: SystemActivity | undefined) => !!a && (a.ship + a.pod * 1.5 >= 8 || a.pod >= 3);

export type SovClaim = { kind: 'alliance' | 'faction'; id: number; capital?: boolean } | null;

interface EsiSovSystem {
  solar_system_id: number;
  claim: { faction?: { faction_id: number }; alliance?: { alliance_id: number; is_capital_system?: boolean }; unclaimed?: boolean };
}

let sov: { at: number; map: Map<number, SovClaim> } | null = null;

export async function sovereignty(): Promise<Map<number, SovClaim>> {
  if (sov && Date.now() - sov.at < 30 * 60 * 1000) return sov.map;
  const r = await esiJson<{ solar_systems: EsiSovSystem[] }>('/sovereignty/systems');
  const map = new Map<number, SovClaim>();
  for (const x of r.solar_systems) {
    const c = x.claim;
    map.set(x.solar_system_id, c.alliance ? { kind: 'alliance', id: c.alliance.alliance_id, capital: !!c.alliance.is_capital_system } : c.faction ? { kind: 'faction', id: c.faction.faction_id } : null);
  }
  sov = { at: Date.now(), map };
  return map;
}

export interface RaidableSkyhook { planetId: number; systemId: number; start: number; end: number }

let skyhooks: { at: number; list: RaidableSkyhook[] } | null = null;

export async function raidableSkyhooks(force = false): Promise<{ at: number; list: RaidableSkyhook[] }> {
  if (!force && skyhooks && Date.now() - skyhooks.at < 5 * 60 * 1000) return skyhooks;
  const r = await esiJson<{ skyhooks: { planet_id: number; solar_system_id: number; theft_vulnerability: { start: string; end: string } }[] }>('/skyhooks/raidable');
  skyhooks = { at: Date.now(), list: r.skyhooks.map((x) => ({ planetId: x.planet_id, systemId: x.solar_system_id, start: Date.parse(x.theft_vulnerability.start), end: Date.parse(x.theft_vulnerability.end) })) };
  return skyhooks;
}

export async function systemActivity(): Promise<{ at: number; map: Map<number, SystemActivity> }> {
  if (activity && Date.now() - activity.at < 5 * 60 * 1000) return activity;
  const [kills, jumps] = await Promise.all([
    esiJson<{ system_id: number; ship_kills: number; pod_kills: number; npc_kills: number }[]>('/universe/system_kills/'),
    esiJson<{ system_id: number; ship_jumps: number }[]>('/universe/system_jumps/').catch(() => []),
  ]);
  const map = new Map<number, SystemActivity>();
  for (const k of kills) map.set(k.system_id, { ship: k.ship_kills, pod: k.pod_kills, npc: k.npc_kills, jumps: 0 });
  for (const j of jumps) {
    const a = map.get(j.system_id);
    if (a) a.jumps = j.ship_jumps; else map.set(j.system_id, { ship: 0, pod: 0, npc: 0, jumps: j.ship_jumps });
  }
  activity = { at: Date.now(), map };
  return activity;
}

const killCache = new Map<number, KillSummary>();
const CAPSULES = new Set([670, 33328]);

export const isCapsule = (typeId: number) => CAPSULES.has(typeId);
export const isGateLocation = (location?: number) => !!location && location >= 50_000_000 && location < 60_000_000;

export interface EsiKillmail {
  killmail_time: string;
  solar_system_id: number;
  victim: { ship_type_id: number; character_id?: number; alliance_id?: number; corporation_id?: number };
  attackers: { character_id?: number; ship_type_id?: number; alliance_id?: number; corporation_id?: number; final_blow?: boolean; weapon_type_id?: number }[];
}

export interface ZkbMeta { hash: string; totalValue: number; npc: boolean; solo: boolean; locationID?: number }

export function summarizeKill(id: number, km: EsiKillmail, zkb: ZkbMeta): KillSummary {
  const pilots = km.attackers.filter((a) => a.character_id);
  const main = pilots.length ? pilots : km.attackers;
  const ships = km.attackers.map((a) => a.ship_type_id).filter((x): x is number => !!x);
  const counts = new Map<number, number>();
  for (const a of main) if (a.ship_type_id) counts.set(a.ship_type_id, (counts.get(a.ship_type_id) ?? 0) + (a.final_blow ? 1.5 : 1));
  return {
    id,
    time: Date.parse(km.killmail_time),
    systemId: km.solar_system_id,
    victimShip: km.victim.ship_type_id,
    victimAlliance: km.victim.alliance_id,
    victimCorp: km.victim.corporation_id,
    value: zkb.totalValue,
    attackers: km.attackers.length,
    players: pilots.length,
    npcAttackers: km.attackers.length - pilots.length,
    attackerIds: km.attackers.map((a) => a.character_id).filter((x): x is number => !!x),
    attackerShips: ships,
    weapons: [...new Set(km.attackers.map((a) => a.weapon_type_id).filter((x): x is number => !!x))],
    attackerAlliances: [...new Set(main.map((a) => a.alliance_id).filter((x): x is number => !!x))],
    topShip: [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
    shipList: [...main.reduce((m, a) => (a.ship_type_id ? m.set(a.ship_type_id, (m.get(a.ship_type_id) ?? 0) + 1) : m), new Map<number, number>())]
      .sort((a, b) => b[1] - a[1] || (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0)).map(([x, n]) => ({ id: x, n })),
    location: zkb.locationID,
    npc: zkb.npc,
    solo: zkb.solo,
  };
}

export function analyzeKills(kills: KillSummary[], isSmartbomb: (typeId: number) => boolean): { camp: boolean; campers: number; smartbomb: boolean } {
  const player = kills.filter((k) => !k.npc);
  const seen = new Map<number, number>();
  for (const k of player) for (const id of new Set(k.attackerIds)) seen.set(id, (seen.get(id) ?? 0) + 1);
  const repeat = [...seen.values()].filter((n) => n >= 2).length;
  const gang = player.filter((k) => k.players >= 2);
  const gangSeen = new Map<number, number>();
  for (const k of gang) for (const id of new Set(k.attackerIds)) gangSeen.set(id, (gangSeen.get(id) ?? 0) + 1);
  const gangRepeat = [...gangSeen.values()].filter((n) => n >= 2).length;
  const victims = gang.filter((k) => !CAPSULES.has(k.victimShip)).length;
  const perSpot = new Map<number, number>();
  for (const k of gang) if (isGateLocation(k.location)) perSpot.set(k.location!, (perSpot.get(k.location!) ?? 0) + 1);
  const sameSpot = Math.max(0, ...perSpot.values()) >= 3 && gangRepeat > 0;
  const bombed = player.filter((k) => CAPSULES.has(k.victimShip) && (k.weapons.some(isSmartbomb) || isGateLocation(k.location)));
  const smartbomb = repeat > 0 && bombed.length >= 3;
  const camp = (gang.length >= 2 && gangRepeat > 0 && victims >= 1) || sameSpot || smartbomb;
  return { camp, campers: repeat, smartbomb };
}

export async function recentKills(systemId: number, isSmartbomb: (typeId: number) => boolean, limit = 50): Promise<SystemIntel> {
  const list = await zkbJson<{ killmail_id: number; zkb: ZkbMeta }[]>(`/kills/systemID/${systemId}/pastSeconds/3600/`);
  const all = Array.isArray(list) ? list : [];
  const picked = all.slice(0, limit);
  const kills = await Promise.all(picked.map(async (k) => {
    const hit = killCache.get(k.killmail_id);
    if (hit?.shipList) return hit;
    const km = await esiJson<EsiKillmail>(`/killmails/${k.killmail_id}/${k.zkb.hash}/`);
    const summary = summarizeKill(k.killmail_id, km, k.zkb);
    killCache.set(k.killmail_id, summary);
    return summary;
  }));
  kills.sort((a, b) => b.time - a.time);
  return { kills, total: all.length, ...analyzeKills(kills, isSmartbomb) };
}

let pilotCache = loadJson<Record<number, PilotStats | null>>(PILOTS_KEY, {});

function savePilots() {
  const entries = Object.entries(pilotCache);
  if (entries.length > MAX_PILOTS_CACHED) {
    entries.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0));
    pilotCache = Object.fromEntries(entries.slice(0, MAX_PILOTS_CACHED));
  }
  saveJson(PILOTS_KEY, pilotCache);
}

interface ZkbStats {
  shipsDestroyed?: number;
  shipsLost?: number;
  soloKills?: number;
  dangerRatio?: number;
  gangRatio?: number;
  iskDestroyed?: number;
  activepvp?: { kills?: { count?: number } };
  topLists?: { type: string; values: { shipTypeID?: number; kills?: number }[] }[];
}

export function cachedPilot(id: number): PilotStats | null | undefined {
  const s = pilotCache[id];
  if (s === undefined) return undefined;
  if (s && Date.now() - s.at > PILOT_TTL) return undefined;
  return s;
}

export async function pilotStats(id: number): Promise<PilotStats | null> {
  const hit = cachedPilot(id);
  if (hit !== undefined) return hit;
  const z = await zkbJson<ZkbStats | null>(`/stats/characterID/${id}/`);
  const ships = z?.topLists?.find((t) => t.type === 'shipType')?.values ?? [];
  const stats: PilotStats | null = z && (z.shipsDestroyed || z.shipsLost) ? {
    kills: z.shipsDestroyed ?? 0,
    losses: z.shipsLost ?? 0,
    solo: z.soloKills ?? 0,
    danger: z.dangerRatio ?? 0,
    gang: z.gangRatio ?? 0,
    iskKilled: z.iskDestroyed ?? 0,
    recent: z.activepvp?.kills?.count ?? 0,
    topShips: ships.filter((s) => s.shipTypeID).slice(0, 3).map((s) => ({ id: s.shipTypeID!, kills: s.kills ?? 0 })),
    at: Date.now(),
  } : null;
  pilotCache[id] = stats ?? ({ kills: 0, losses: 0, solo: 0, danger: 0, gang: 0, iskKilled: 0, recent: 0, topShips: [], at: Date.now() });
  savePilots();
  return pilotCache[id];
}

export async function affiliations(ids: number[]): Promise<Map<number, { corpId: number; allianceId?: number }>> {
  const out = new Map<number, { corpId: number; allianceId?: number }>();
  for (const part of chunks(ids, 1000)) {
    const r = await esiJson<{ character_id: number; corporation_id: number; alliance_id?: number }[]>('/characters/affiliation/', post(part));
    for (const a of r) out.set(a.character_id, { corpId: a.corporation_id, allianceId: a.alliance_id });
  }
  return out;
}

export function threat(s?: PilotStats | null): 0 | 1 | 2 | 3 {
  if (!s || s.kills === 0) return 0;
  if (s.recent >= 5 || (s.danger >= 70 && s.kills >= 100)) return 3;
  if (s.recent >= 1 || (s.danger >= 50 && s.kills >= 20)) return 2;
  return 1;
}

export function parsePaste(text: string): { kind: 'dscan'; rows: DscanRow[] } | { kind: 'local'; names: string[] } | { kind: 'empty' } {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  if (!lines.length) return { kind: 'empty' };
  const tabbed = lines.filter((l) => /^\d+\t/.test(l));
  if (tabbed.length >= lines.length / 2) {
    const rows = tabbed.map((l) => {
      const [id, name = '', typeName = '', distance = '-'] = l.split('\t');
      return { typeId: Number(id), name: name.trim(), typeName: typeName.trim(), distance: distance.trim(), km: toKm(distance) };
    });
    return { kind: 'dscan', rows };
  }
  const names = [...new Set(lines.map((l) => l.split('\t')[0].trim()).filter((n) => n.length >= 3 && n.length <= 37 && /^[\p{L}\p{N} .'_-]+$/u.test(n)))];
  return names.length ? { kind: 'local', names } : { kind: 'empty' };
}

function toKm(d: string): number | null {
  const m = d.replace(/[\s ]/g, '').match(/^([\d.,]+)(m|km|AU)$/i);
  if (!m) return null;
  const unit = m[2].toLowerCase();
  const v = unit === 'au' ? Number(m[1].replace(',', '.')) : Number(m[1].replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
  if (!Number.isFinite(v)) return null;
  return unit === 'm' ? v / 1000 : unit === 'km' ? v : v * 149_597_870.7;
}

const NON_COMBAT = /Mining Barge|Exhumer|Industrial|Freighter|Hauler|Transport|Shuttle|Capsule|Expedition|Command Ship.*Industrial/i;
const PER_HARDPOINT: Record<number, number> = { 1: 30, 2: 60, 3: 120, 4: 1500 };

export interface DpsEstimate { dps: number; weapons: number; perWeapon: number; bonus: number; drones: number; bandwidth: number }

export function estimateDps(sde: Sde, typeId: number): DpsEstimate | null {
  const t = sde.types.get(typeId);
  if (!t || t.categoryId !== 6 || NON_COMBAT.test(t.groupName)) return null;
  const attr = (name: string) => (sde.hasAttr(name) ? sde.baseAttr(typeId, sde.attrId(name)) : 0);
  const weapons = attr('turretSlotsLeft') + attr('launcherSlotsLeft');
  const size = Math.round(attr('rigSize')) || 1;
  const perWeapon = PER_HARDPOINT[size] ?? 30;
  const bonus = weapons >= 3 ? 1.25 : 1;
  const bandwidth = Math.min(attr('droneBandwidth'), 125);
  const drones = Math.round(bandwidth * (bandwidth <= 50 ? 4 : 2.8));
  const dps = Math.round(weapons * perWeapon * bonus + drones);
  return dps > 0 ? { dps, weapons, perWeapon, bonus, drones, bandwidth } : null;
}

export function displaySec(sec: number): number {
  if (sec > 0 && sec < 0.05) return 0.1;
  return Math.round(sec * 10) / 10;
}

export function secClass(sec: number): string {
  const s = displaySec(sec);
  return s >= 0.5 ? 'sec-hi' : s > 0 ? 'sec-lo' : 'sec-null';
}

export interface SovCampaign { id: number; systemId: number; constellationId: number; type: string; defenderId?: number; defenderScore: number; attackersScore: number; start: number; structureId: number }

let campaignCache: { at: number; list: SovCampaign[] } | null = null;

export async function sovCampaigns(): Promise<SovCampaign[]> {
  if (campaignCache && Date.now() - campaignCache.at < 5 * 60 * 1000) return campaignCache.list;
  const r = await esiJson<{ campaign_id: number; solar_system_id: number; constellation_id: number; event_type: string; defender_id?: number; defender_score?: number; attackers_score?: number; start_time: string; structure_id: number }[]>('/sovereignty/campaigns');
  const list = r.map((c) => ({ id: c.campaign_id, systemId: c.solar_system_id, constellationId: c.constellation_id, type: c.event_type, defenderId: c.defender_id, defenderScore: c.defender_score ?? 0, attackersScore: c.attackers_score ?? 0, start: Date.parse(c.start_time), structureId: c.structure_id }));
  campaignCache = { at: Date.now(), list };
  return list;
}
