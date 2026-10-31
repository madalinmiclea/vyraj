import { ESI, esiFetch } from './esiClient';
import { loadJson, saveJson } from '../storage';
import { POCHVEN_REGION, type NavMap } from './navigation';

export type IncState = 'established' | 'mobilizing' | 'withdrawing';
export type Role = 'staging' | 'hq' | 'assault' | 'vanguard';
export type Space = 'high' | 'low' | 'null' | 'pochven';
export type SiteKind = 'staging' | 'vanguard' | 'assault' | 'hq' | 'mothership';

export interface Incursion {
  constellationId: number;
  factionId: number;
  boss: boolean;
  systems: number[];
  influence: number;
  staging: number;
  state: IncState;
}

interface EsiIncursion {
  constellation_id: number;
  faction_id: number;
  has_boss: boolean;
  infested_solar_systems: number[];
  influence: number;
  staging_solar_system_id: number;
  state: IncState;
}

let cache: { at: number; list: Incursion[] } | null = null;

export async function incursions(force = false): Promise<{ at: number; list: Incursion[] }> {
  if (!force && cache && Date.now() - cache.at < 5 * 60 * 1000) return cache;
  const res = await esiFetch(`${ESI}/incursions`);
  if (!res.ok) throw new Error(`ESI /incursions: ${res.status}`);
  const raw = (await res.json()) as EsiIncursion[];
  cache = {
    at: Date.now(),
    list: raw.map((x) => ({ constellationId: x.constellation_id, factionId: x.faction_id, boss: x.has_boss, systems: x.infested_solar_systems, influence: x.influence, staging: x.staging_solar_system_id, state: x.state })),
  };
  return cache;
}

export const sanshaInfluence = (inc: Incursion) => Math.max(0, Math.min(1, 1 - inc.influence));

export function spaceOf(map: NavMap, systemId: number): Space {
  const s = map.systems.get(systemId);
  if (!s) return 'null';
  if (s.regionId === POCHVEN_REGION) return 'pochven';
  return s.sec >= 0.45 ? 'high' : s.sec > 0 ? 'low' : 'null';
}

const GROWTH: ('v' | 'a')[] = ['v', 'a', 'v', 'v', 'a', 'v', 'a', 'v', 'v'];

export function assaultCount(rest: number): number {
  return GROWTH.slice(0, Math.max(0, rest)).filter((x) => x === 'a').length;
}

export function layout(map: NavMap, inc: Incursion): Map<number, Role> {
  const out = new Map<number, Role>([[inc.staging, 'staging']]);
  const others = inc.systems.filter((id) => id !== inc.staging);
  if (!others.length) return out;
  const fromStaging = map.distances([inc.staging], 40);
  const far = (id: number) => fromStaging.get(id) ?? 99;
  const degree = (id: number) => map.gates.get(id)?.length ?? 0;
  const hq = [...others].sort((a, b) => far(b) - far(a) || degree(b) - degree(a) || a - b)[0];
  out.set(hq, 'hq');
  const rest = others.filter((id) => id !== hq);
  const fromHq = map.distances([hq], 40);
  const near = (id: number) => fromHq.get(id) ?? 99;
  const ranked = [...rest].sort((a, b) => near(a) - near(b) || far(b) - far(a) || a - b);
  const n = assaultCount(rest.length);
  ranked.forEach((id, i) => out.set(id, i < n ? 'assault' : 'vanguard'));
  return out;
}

export function safeDistances(map: NavMap, from: number, max = 80): Map<number, number> {
  const dist = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let d = 1; d <= max && frontier.length; d++) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const n of map.gates.get(id) ?? []) {
        if (dist.has(n)) continue;
        const s = map.systems.get(n);
        if (!s || s.sec < 0.45) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

export const EFFECTS: Record<'vanguard' | 'assault' | 'hq', number> = { vanguard: 10, assault: 25, hq: 50 };

export interface SiteInfo { kind: SiteKind; names: string[]; fleet: string; fleetLowNull: string; minutes: [number, number]; perSystem: number }

export const SITES: SiteInfo[] = [
  { kind: 'staging', names: ['Distress Beacon', 'Forward Reconnaissance Outpost', 'Nation Industrial Proxy', 'Propaganda Cluster'], fleet: '3–5', fleetLowNull: '3–5', minutes: [15, 20], perSystem: 5 },
  { kind: 'vanguard', names: ['Nation Commander Outpost', 'Nation Mining Colony', 'Override Transfer Array'], fleet: '10–12', fleetLowNull: '10–15', minutes: [5, 10], perSystem: 7 },
  { kind: 'assault', names: ['Nation Commander Stronghold', 'Nation Consolidation Network', 'Overwhelmed Civilian Facility'], fleet: '20–21', fleetLowNull: '20–30', minutes: [10, 20], perSystem: 5 },
  { kind: 'hq', names: ['Nation Rebirth Facility', 'True Creations Research Center', 'True Power Provisional Headquarters'], fleet: '40', fleetLowNull: '40–60', minutes: [10, 20], perSystem: 5 },
  { kind: 'mothership', names: ['The Kundalini Manifest', 'Uroborus'], fleet: '40–80', fleetLowNull: '40–120', minutes: [15, 25], perSystem: 1 },
];

export interface PayTier { upTo: number; isk: number; lp: number }

export const PAYOUTS: Record<'high' | 'lownull', Partial<Record<SiteKind, { min: number; tiers: PayTier[] }>>> = {
  high: {
    staging: { min: 1, tiers: [{ upTo: 5, isk: 3_500_000, lp: 400 }] },
    vanguard: { min: 5, tiers: [{ upTo: 10, isk: 10_395_000, lp: 1_400 }, { upTo: 11, isk: 9_615_375, lp: 1_295 }, { upTo: 12, isk: 8_783_775, lp: 1_183 }, { upTo: 13, isk: 7_900_200, lp: 1_064 }] },
    assault: { min: 5, tiers: [{ upTo: 20, isk: 18_200_000, lp: 3_500 }, { upTo: 21, isk: 16_835_000, lp: 3_238 }, { upTo: 22, isk: 15_379_000, lp: 2_958 }] },
    hq: { min: 20, tiers: [{ upTo: 40, isk: 31_500_000, lp: 7_000 }] },
    mothership: { min: 40, tiers: [{ upTo: 80, isk: 63_000_000, lp: 14_000 }] },
  },
  lownull: {
    staging: { min: 1, tiers: [{ upTo: 5, isk: 3_500_000, lp: 400 }] },
    vanguard: { min: 5, tiers: [{ upTo: 15, isk: 15_000_000, lp: 2_000 }, { upTo: 16, isk: 13_875_000, lp: 1_850 }, { upTo: 17, isk: 12_674_000, lp: 1_690 }] },
    assault: { min: 5, tiers: [{ upTo: 30, isk: 26_000_000, lp: 5_000 }] },
    hq: { min: 20, tiers: [{ upTo: 60, isk: 45_000_000, lp: 10_000 }, { upTo: 61, isk: 41_625_000, lp: 9_250 }] },
    mothership: { min: 40, tiers: [{ upTo: 120, isk: 90_000_000, lp: 20_000 }] },
  },
};

export function payout(band: 'high' | 'lownull', kind: SiteKind, pilots: number): PayTier | null {
  const p = PAYOUTS[band][kind];
  if (!p || pilots < p.min) return null;
  return p.tiers.find((t) => pilots <= t.upTo) ?? null;
}

export interface Observed { c: number; first: number; fresh: boolean; last: number; state: IncState; since: number | null; boss: boolean; bossAt: number | null; influence: number; staging: number; space: Space }
export type EventKind = 'new' | 'state' | 'boss' | 'end';
export interface IncEvent { t: number; c: number; kind: EventKind; state?: IncState; staging: number; space: Space }
export interface IncLog { started?: number; active: Observed[]; ended: (Observed & { end: number })[]; events: IncEvent[] }

const LOG_KEY = 'eve-ops:incursions-log';
const KEEP = 30 * 86_400_000;

export const loadLog = (): IncLog => loadJson<IncLog>(LOG_KEY, { active: [], ended: [], events: [] });
export const saveLog = (log: IncLog) => saveJson(LOG_KEY, log);

export function track(map: NavMap, list: Incursion[], now = Date.now()): IncLog {
  const log = loadLog();
  const first = !log.started;
  log.started ??= now;
  const prev = new Map(log.active.map((o) => [o.c, o]));
  const active: Observed[] = [];
  const push = (e: IncEvent) => log.events.push(e);
  for (const inc of list) {
    const space = spaceOf(map, inc.staging);
    const o = prev.get(inc.constellationId);
    if (!o) {
      active.push({ c: inc.constellationId, first: now, fresh: !first, last: now, state: inc.state, since: first ? null : now, boss: inc.boss, bossAt: inc.boss && !first ? now : null, influence: inc.influence, staging: inc.staging, space });
      if (!first) push({ t: now, c: inc.constellationId, kind: 'new', state: inc.state, staging: inc.staging, space });
      continue;
    }
    prev.delete(inc.constellationId);
    if (o.state !== inc.state) { push({ t: now, c: o.c, kind: 'state', state: inc.state, staging: inc.staging, space }); o.state = inc.state; o.since = now; }
    if (inc.boss && !o.boss) { push({ t: now, c: o.c, kind: 'boss', staging: inc.staging, space }); o.bossAt = now; }
    o.boss = inc.boss;
    o.influence = inc.influence;
    o.last = now;
    active.push(o);
  }
  for (const o of prev.values()) {
    log.ended.push({ ...o, end: now });
    push({ t: now, c: o.c, kind: 'end', state: o.state, staging: o.staging, space: o.space });
  }
  log.active = active;
  log.ended = log.ended.filter((o) => now - o.end < KEEP).slice(-60);
  log.events = log.events.filter((e) => now - e.t < KEEP).slice(-300);
  saveLog(log);
  return log;
}

const H = 3_600_000;

export function latestEnd(o: Observed): number | null {
  if (o.state === 'withdrawing' && o.since) return o.since + 24 * H;
  if (o.state === 'mobilizing' && o.since) return o.since + 72 * H;
  if (o.fresh) return o.first + 8 * 24 * H;
  return null;
}

export function respawnWindow(log: IncLog, space: Space): { from: number; to: number; end: number } | null {
  const band = (s: Space) => (s === 'pochven' ? 'null' : s);
  const ended = log.ended.filter((o) => band(o.space) === band(space)).sort((a, b) => b.end - a.end)[0];
  if (!ended) return null;
  const same = log.active.filter((o) => band(o.space) === band(space));
  if (same.length >= (band(space) === 'null' ? 3 : 1) || same.some((o) => o.fresh && o.first > ended.end)) return null;
  return { from: ended.end + 12 * H, to: ended.end + 36 * H, end: ended.end };
}

export interface PaySession { start: number; end: number; isk: number; n: number; perHour: number | null }

export function payoutSessions(entries: { date: string; ref_type: string; amount?: number }[], gap = 30 * 60 * 1000): PaySession[] {
  const rows = entries
    .filter((e) => e.ref_type === 'corporate_reward_payout' && (e.amount ?? 0) > 0)
    .map((e) => ({ t: Date.parse(e.date), isk: e.amount ?? 0 }))
    .sort((a, b) => a.t - b.t);
  const out: PaySession[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && r.t - last.end <= gap) { last.end = r.t; last.isk += r.isk; last.n++; }
    else out.push({ start: r.t, end: r.t, isk: r.isk, n: 1, perHour: null });
  }
  for (const s of out) {
    if (s.n < 2) continue;
    const step = (s.end - s.start) / (s.n - 1);
    s.perHour = s.isk / ((s.end - s.start + step) / H);
  }
  return out.reverse();
}
