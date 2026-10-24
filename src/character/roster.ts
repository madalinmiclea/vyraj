import { accessToken, hasScope, hasTokens, SCOPES } from './sso';
import { esiFetch } from '../services/esiClient';
import { resolveNames, systemInfo, type SystemInfo } from '../services/recon';
import { loadStoredCharacters, type StoredCharacter } from './characters';
import { spPerMinute, withImplants } from './training';
import { loadJson, saveJson } from '../storage';
import type { Sde } from '../data/sde';

const ESI = 'https://esi.evetech.net/latest';
const ROSTER_KEY = 'eve-fit:roster';
const ACCOUNTS_KEY = 'eve-fit:roster-accounts';
const STRUCTURES_KEY = 'eve-fit:structure-names';
export const ROSTER_TTL = 5 * 60 * 1000;

export type CloneState = 'omega' | 'alpha' | 'unknown';

export interface RosterQueueEntry {
  skillId: number;
  level: number;
  start?: string;
  finish?: string;
  startSp?: number;
  endSp?: number;
  levelStartSp?: number;
}

export interface RosterEntry {
  id: string;
  characterId: number;
  fetched: number;
  online?: boolean;
  lastLogin?: string;
  systemId?: number;
  stationId?: number;
  structureId?: number;
  shipTypeId?: number;
  shipName?: string;
  queue: RosterQueueEntry[];
  clone: CloneState;
  totalSp?: number;
  wallet?: number;
  missing: string[];
  error?: string;
}

export interface AccountSettings {
  chars: Record<string, string>;
  omega: Record<string, string>;
}

export const loadRoster = () => loadJson<Record<string, RosterEntry>>(ROSTER_KEY, {});

export const saveRoster = (r: Record<string, RosterEntry>) => saveJson(ROSTER_KEY, r);

export const loadAccounts = () => loadJson<AccountSettings>(ACCOUNTS_KEY, { chars: {}, omega: {} });

export function saveAccounts(a: AccountSettings) {
  saveJson(ACCOUNTS_KEY, a);
}

export const accountKey = (a: AccountSettings, id: string) => a.chars[id] || id;

export function omegaUntil(a: AccountSettings, id: string): string | undefined {
  return a.omega[accountKey(a, id)];
}

export function setAccount(id: string, account: string, omega: string) {
  const a = loadAccounts();
  const name = account.trim();
  if (name) a.chars[id] = name; else delete a.chars[id];
  const key = accountKey(a, id);
  if (omega) a.omega[key] = omega; else delete a.omega[key];
  saveAccounts(a);
}

export const rosterCharacters = (): StoredCharacter[] => loadStoredCharacters().filter((c) => c.kind === 'esi' && c.characterId != null);

export const missingScopes = (characterId: number) => SCOPES.filter((s) => !hasScope(characterId, s));

async function authed<T>(characterId: number, path: string): Promise<T> {
  const token = await accessToken(characterId);
  const res = await esiFetch(`${ESI}${path}?datasource=tranquility`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`ESI ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

interface EsiQueue {
  skill_id: number;
  finished_level: number;
  queue_position: number;
  start_date?: string;
  finish_date?: string;
  training_start_sp?: number;
  level_end_sp?: number;
  level_start_sp?: number;
}

interface EsiSkills {
  skills: { active_skill_level: number; trained_skill_level: number }[];
  total_sp: number;
}

function detectClone(sde: Sde, c: StoredCharacter, skills: EsiSkills | null, queue: RosterQueueEntry[]): CloneState {
  if (skills?.skills.some((s) => s.active_skill_level < s.trained_skill_level)) return 'alpha';
  const now = Date.now();
  const cur = queue.find((q) => q.start && q.finish && q.startSp != null && q.endSp != null && new Date(q.finish).getTime() > now);
  if (cur) {
    const minutes = (new Date(cur.finish!).getTime() - new Date(cur.start!).getTime()) / 60000;
    const actual = (cur.endSp! - cur.startSp!) / minutes;
    const expected = spPerMinute(sde, cur.skillId, withImplants(sde, c.attributes, c.implants));
    if (minutes > 0 && expected > 0) {
      const ratio = actual / expected;
      if (ratio < 0.7) return 'alpha';
      if (ratio > 0.8) return 'omega';
    }
  }
  return 'unknown';
}

export async function fetchRosterEntry(sde: Sde, c: StoredCharacter): Promise<RosterEntry> {
  const id = c.characterId!;
  const base: RosterEntry = { id: c.id, characterId: id, fetched: Date.now(), queue: [], clone: 'unknown', missing: [] };
  if (!hasTokens(id)) return { ...base, error: 'logged-out' };
  base.missing = missingScopes(id);
  const can = (scope: string) => hasScope(id, scope);
  const opt = <T>(scope: string, path: string) => (can(scope) ? authed<T>(id, path).catch(() => null) : Promise.resolve(null));
  const [location, online, ship, queue, skills, wallet] = await Promise.all([
    opt<{ solar_system_id: number; station_id?: number; structure_id?: number }>('esi-location.read_location.v1', `/characters/${id}/location/`),
    opt<{ online: boolean; last_login?: string }>('esi-location.read_online.v1', `/characters/${id}/online/`),
    opt<{ ship_type_id: number; ship_name: string }>('esi-location.read_ship_type.v1', `/characters/${id}/ship/`),
    opt<EsiQueue[]>('esi-skills.read_skillqueue.v1', `/characters/${id}/skillqueue/`),
    opt<EsiSkills>('esi-skills.read_skills.v1', `/characters/${id}/skills/`),
    opt<number>('esi-wallet.read_character_wallet.v1', `/characters/${id}/wallet/`),
  ]);
  const q = (queue ?? [])
    .sort((a, b) => a.queue_position - b.queue_position)
    .map((x) => ({ skillId: x.skill_id, level: x.finished_level, start: x.start_date, finish: x.finish_date, startSp: x.training_start_sp, endSp: x.level_end_sp, levelStartSp: x.level_start_sp }))
    .filter((x) => !x.finish || new Date(x.finish).getTime() > Date.now());
  return {
    ...base,
    online: online?.online,
    lastLogin: online?.last_login,
    systemId: location?.solar_system_id,
    stationId: location?.station_id,
    structureId: location?.structure_id,
    shipTypeId: ship?.ship_type_id,
    shipName: ship?.ship_name,
    queue: q,
    clone: detectClone(sde, c, skills, q),
    totalSp: skills?.total_sp ?? c.totalSp,
    wallet: wallet ?? undefined,
    error: [location, online, ship, queue, skills, wallet].every((x) => x == null) ? 'failed' : undefined,
  };
}

export async function refreshRoster(sde: Sde, onEntry?: (e: RosterEntry) => void): Promise<Record<string, RosterEntry>> {
  const chars = rosterCharacters();
  const out: Record<string, RosterEntry> = {};
  await Promise.all(chars.map(async (c) => {
    try {
      out[c.id] = await fetchRosterEntry(sde, c);
    } catch {
      out[c.id] = { id: c.id, characterId: c.characterId!, fetched: Date.now(), queue: [], clone: 'unknown', missing: [], error: 'failed' };
    }
    onEntry?.(out[c.id]);
  }));
  saveRoster(out);
  return out;
}

export interface Places {
  systems: Map<number, SystemInfo>;
  names: Map<number, string>;
}

let structureNames = loadJson<Record<number, string>>(STRUCTURES_KEY, {});

export async function resolvePlaces(entries: RosterEntry[]): Promise<Places> {
  const systemIds = [...new Set(entries.map((e) => e.systemId).filter((x): x is number => x != null))];
  const stationIds = [...new Set(entries.map((e) => e.stationId).filter((x): x is number => x != null))];
  const [systems, stations] = await Promise.all([
    systemIds.length ? systemInfo(systemIds).catch(() => new Map<number, SystemInfo>()) : new Map<number, SystemInfo>(),
    stationIds.length ? resolveNames(stationIds).catch(() => new Map<number, string>()) : new Map<number, string>(),
  ]);
  const names = new Map<number, string>();
  for (const id of stationIds) if (stations.get(id)) names.set(id, stations.get(id)!);
  const pending = entries.filter((e) => e.structureId != null && !structureNames[e.structureId]);
  const seen = new Set<number>();
  for (const e of pending) {
    if (seen.has(e.structureId!) || !hasScope(e.characterId, 'esi-universe.read_structures.v1')) continue;
    seen.add(e.structureId!);
    try {
      const s = await authed<{ name: string }>(e.characterId, `/universe/structures/${e.structureId}/`);
      structureNames = { ...structureNames, [e.structureId!]: s.name };
    } catch {
      continue;
    }
  }
  if (seen.size) saveJson(STRUCTURES_KEY, structureNames);
  for (const e of entries) if (e.structureId != null && structureNames[e.structureId]) names.set(e.structureId, structureNames[e.structureId]);
  return { systems, names };
}
