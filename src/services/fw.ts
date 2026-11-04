import { ESI, esiFetch } from './esiClient';
import { resolveNames } from './recon';

export type FwState = 'captured' | 'contested' | 'uncontested' | 'vulnerable';

export interface FwSystem {
  contested: FwState;
  occupier_faction_id: number;
  owner_faction_id: number;
  solar_system_id: number;
  victory_points: number;
  victory_points_threshold: number;
}

interface Triple { last_week: number; total: number; yesterday: number }

export interface FwStats { faction_id: number; kills: Triple; pilots: number; systems_controlled: number; victory_points: Triple }

interface Board<K extends string> { active_total: ({ amount: number } & Record<K, number>)[]; last_week: ({ amount: number } & Record<K, number>)[]; yesterday: ({ amount: number } & Record<K, number>)[] }
export interface Leaderboard<K extends string> { kills: Board<K>; victory_points: Board<K> }

export interface FwData {
  at: number;
  systems: FwSystem[];
  stats: FwStats[];
  wars: { against_id: number; faction_id: number }[];
  characters: Leaderboard<'character_id'>;
  corporations: Leaderboard<'corporation_id'>;
  names: Map<number, string>;
}

export const WARZONES: { id: string; sides: [number, number] }[] = [
  { id: 'cg', sides: [500001, 500004] },
  { id: 'am', sides: [500003, 500002] },
];

const CACHE_MS = 5 * 60 * 1000;
let cache: FwData | null = null;

async function get<T>(path: string): Promise<T> {
  const res = await esiFetch(`${ESI}${path}`);
  if (!res.ok) throw new Error(`ESI ${path}: ${res.status}`);
  return (await res.json()) as T;
}

export async function loadFw(force = false): Promise<FwData> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache;
  const [systems, stats, wars, characters, corporations] = await Promise.all([
    get<FwSystem[]>('/fw/systems/'),
    get<FwStats[]>('/fw/stats/'),
    get<{ against_id: number; faction_id: number }[]>('/fw/wars/'),
    get<Leaderboard<'character_id'>>('/fw/leaderboards/characters/'),
    get<Leaderboard<'corporation_id'>>('/fw/leaderboards/corporations/'),
  ]);
  const ids = new Set<number>(stats.map((s) => s.faction_id));
  for (const board of [characters, corporations] as Leaderboard<string>[]) {
    for (const kind of [board.kills, board.victory_points]) {
      for (const list of [kind.last_week, kind.yesterday, kind.active_total]) {
        for (const r of list.slice(0, 10)) ids.add((r as Record<string, number>).character_id ?? (r as Record<string, number>).corporation_id);
      }
    }
  }
  const names = await resolveNames([...ids].filter(Boolean)).catch(() => new Map<number, string>());
  cache = { at: Date.now(), systems, stats, wars, characters, corporations, names };
  return cache;
}
