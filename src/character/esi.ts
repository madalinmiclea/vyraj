import { accessToken, hasScope } from './sso';
import { ESI, esiFetch, esiPages } from '../services/esiClient';
import { loadJson, saveJson } from '../storage';
import { loadStoredCharacters, type StoredCharacter, type SkillState } from './characters';
import type { Attributes } from './training';

async function esi<T>(characterId: number, path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(characterId);
  const res = await esiFetch(`${ESI}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`ESI ${path}: ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

interface EsiSkills {
  skills: { skill_id: number; active_skill_level: number; trained_skill_level: number; skillpoints_in_skill: number }[];
  total_sp: number;
  unallocated_sp?: number;
}

interface EsiQueueEntry {
  skill_id: number;
  finished_level: number;
  finish_date?: string;
  queue_position: number;
}

export interface EsiFitting {
  fitting_id: number;
  name: string;
  description: string;
  ship_type_id: number;
  items: { type_id: number; flag: string; quantity: number }[];
}

export async function importCharacter(characterId: number, characterName: string): Promise<StoredCharacter> {
  const [skills, attributes, implants, queue] = await Promise.all([
    esi<EsiSkills>(characterId, `/characters/${characterId}/skills/`),
    esi<Attributes & { bonus_remaps?: number; accrued_remap_cooldown_date?: string; last_remap_date?: string }>(characterId, `/characters/${characterId}/attributes/`),
    esi<number[]>(characterId, `/characters/${characterId}/implants/`),
    esi<EsiQueueEntry[]>(characterId, `/characters/${characterId}/skillqueue/`).catch(() => []),
  ]);
  const map: Record<string, SkillState> = {};
  for (const s of skills.skills) map[s.skill_id] = { level: s.active_skill_level, sp: s.skillpoints_in_skill };
  return {
    id: `esi-${characterId}`,
    name: characterName,
    kind: 'esi',
    characterId,
    skills: map,
    attributes: {
      charisma: attributes.charisma,
      intelligence: attributes.intelligence,
      memory: attributes.memory,
      perception: attributes.perception,
      willpower: attributes.willpower,
    },
    implants,
    queue: queue
      .sort((a, b) => a.queue_position - b.queue_position)
      .map((q) => ({ skillId: q.skill_id, level: q.finished_level, finish: q.finish_date })),
    totalSp: skills.total_sp,
    unallocatedSp: skills.unallocated_sp,
    remap: { bonus: attributes.bonus_remaps ?? 0, next: attributes.accrued_remap_cooldown_date, last: attributes.last_remap_date },
    updated: new Date().toISOString(),
  };
}

export function listFittings(characterId: number): Promise<EsiFitting[]> {
  return esi<EsiFitting[]>(characterId, `/characters/${characterId}/fittings/`);
}

export function saveFitting(characterId: number, fitting: Omit<EsiFitting, 'fitting_id'>): Promise<{ fitting_id: number }> {
  return esi(characterId, `/characters/${characterId}/fittings/`, { method: 'POST', body: JSON.stringify(fitting) });
}

export interface EsiAsset {
  item_id: number;
  type_id: number;
  location_id: number;
  location_flag: string;
  location_type: string;
  quantity: number;
  is_singleton: boolean;
  is_blueprint_copy?: boolean;
}

export async function listAssets(characterId: number): Promise<EsiAsset[]> {
  const token = await accessToken(characterId);
  return esiPages<EsiAsset>((page) => `${ESI}/characters/${characterId}/assets/?page=${page}`, { headers: { Authorization: `Bearer ${token}` } });
}

export function currentShip(characterId: number): Promise<{ ship_item_id: number; ship_type_id: number; ship_name: string }> {
  return esi(characterId, `/characters/${characterId}/ship/`);
}

export async function assetNames(characterId: number, itemIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (let i = 0; i < itemIds.length; i += 1000) {
    const list = await esi<{ item_id: number; name: string }[]>(characterId, `/characters/${characterId}/assets/names/`, { method: 'POST', body: JSON.stringify(itemIds.slice(i, i + 1000)) });
    for (const x of list) out.set(x.item_id, x.name);
  }
  return out;
}

export const STRUCTURES_KEY = 'eve-fit:structure-names';
const structureMisses = new Set<number>();

async function namesBatch(ids: number[], out: Map<number, string>): Promise<void> {
  const res = await esiFetch(`${ESI}/universe/names/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids) });
  if (res.ok) {
    for (const x of (await res.json()) as { id: number; name: string }[]) out.set(x.id, x.name);
    return;
  }
  if (res.status === 404 && ids.length > 1) {
    const mid = Math.ceil(ids.length / 2);
    await namesBatch(ids.slice(0, mid), out);
    await namesBatch(ids.slice(mid), out);
  }
}

export async function universeNames(ids: number[], characterId?: number): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unique = [...new Set(ids)];
  const known = unique.filter((id) => (id > 0 && id < 100_000_000) || (id >= 2_100_000_000 && id < 2_200_000_000));
  for (let i = 0; i < known.length; i += 1000) await namesBatch(known.slice(i, i + 1000), out);
  const structures = unique.filter((id) => id >= 1e12);
  if (!structures.length) return out;
  const cache = loadJson<Record<string, string>>(STRUCTURES_KEY, {});
  const readers = [...new Set([characterId, ...loadStoredCharacters().map((c) => c.characterId)])]
    .filter((id): id is number => !!id && hasScope(id, 'esi-universe.read_structures.v1'));
  let changed = false;
  for (const id of structures) {
    if (!cache[id] && !structureMisses.has(id) && readers.length) {
      for (const reader of readers) {
        try {
          cache[id] = (await esi<{ name: string }>(reader, `/universe/structures/${id}/`)).name;
          changed = true;
          break;
        } catch {
          continue;
        }
      }
      if (!cache[id]) structureMisses.add(id);
    }
    if (cache[id]) out.set(id, cache[id]);
  }
  if (changed) saveJson(STRUCTURES_KEY, cache);
  return out;
}

export const portraitUrl = (characterId: number, size = 128) => `https://images.evetech.net/characters/${characterId}/portrait?size=${size}`;

export interface EsiType {
  type_id: number;
  name: string;
  description?: string;
  group_id: number;
  market_group_id?: number;
  volume?: number;
  packaged_volume?: number;
  capacity?: number;
  published?: boolean;
}

const typeCache = new Map<number, Promise<EsiType | null>>();
const groupCache = new Map<number, Promise<{ name: string; category_id: number } | null>>();
const categoryCache = new Map<number, Promise<{ name: string } | null>>();

function publicGet<T>(cache: Map<number, Promise<T | null>>, id: number, path: string): Promise<T | null> {
  let hit = cache.get(id);
  if (!hit) {
    hit = esiFetch(`${ESI}${path}`)
      .then((res) => (res.ok ? (res.json() as Promise<T>) : null))
      .catch(() => null);
    hit.then((v) => { if (!v) cache.delete(id); });
    cache.set(id, hit);
  }
  return hit;
}

export const typeInfo = (id: number) => publicGet<EsiType>(typeCache, id, `/universe/types/${id}/`);
export const groupInfo = (id: number) => publicGet<{ name: string; category_id: number }>(groupCache, id, `/universe/groups/${id}/`);
export const categoryInfo = (id: number) => publicGet<{ name: string }>(categoryCache, id, `/universe/categories/${id}/`);

export interface DynamicItem {
  source_type_id: number;
  mutator_type_id: number;
  dogma_attributes: { attribute_id: number; value: number }[];
}

export async function dynamicItem(typeId: number, itemId: number): Promise<DynamicItem> {
  const res = await esiFetch(`${ESI}/dogma/dynamic/items/${typeId}/${itemId}/`);
  if (!res.ok) throw new Error(`ESI dynamic item: ${res.status}`);
  return res.json() as Promise<DynamicItem>;
}

export interface WalletEntry {
  id: number;
  date: string;
  ref_type: string;
  amount?: number;
  balance?: number;
  description: string;
  reason?: string;
  context_id?: number;
  context_id_type?: string;
}

export async function walletJournal(characterId: number, maxPages = 10): Promise<WalletEntry[]> {
  const token = await accessToken(characterId);
  return esiPages<WalletEntry>((page) => `${ESI}/characters/${characterId}/wallet/journal/?page=${page}`, { headers: { Authorization: `Bearer ${token}` } }, maxPages);
}

export function walletBalance(characterId: number): Promise<number> {
  return esi(characterId, `/characters/${characterId}/wallet/`);
}

export function loyaltyPoints(characterId: number): Promise<{ corporation_id: number; loyalty_points: number }[]> {
  return esi(characterId, `/characters/${characterId}/loyalty/points/`);
}

export interface WalletTransaction {
  transaction_id: number;
  type_id: number;
  is_buy: boolean;
  date: string;
  quantity: number;
  unit_price: number;
}

export function walletTransactions(characterId: number): Promise<WalletTransaction[]> {
  return esi(characterId, `/characters/${characterId}/wallet/transactions/`);
}

export function characterLocation(characterId: number): Promise<{ solar_system_id: number; station_id?: number; structure_id?: number }> {
  return esi(characterId, `/characters/${characterId}/location/`);
}

export function characterOnline(characterId: number): Promise<{ online: boolean; last_login?: string; last_logout?: string }> {
  return esi(characterId, `/characters/${characterId}/online/`);
}
