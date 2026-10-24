import { accessToken } from './sso';
import { esiFetch } from '../services/esiClient';
import type { StoredCharacter, SkillState } from './characters';
import type { Attributes } from './training';

const ESI = 'https://esi.evetech.net/latest';

async function esi<T>(characterId: number, path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(characterId);
  const res = await esiFetch(`${ESI}${path}${path.includes('?') ? '&' : '?'}datasource=tranquility`, {
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
    esi<Attributes>(characterId, `/characters/${characterId}/attributes/`),
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
  const url = (page: number) => `${ESI}/characters/${characterId}/assets/?datasource=tranquility&page=${page}`;
  const get = async (page: number) => {
    const res = await esiFetch(url(page), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`ESI assets: ${res.status} ${await res.text()}`);
    return res;
  };
  const first = await get(1);
  const pages = Number(first.headers.get('x-pages')) || 1;
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => get(i + 2).then((r) => r.json() as Promise<EsiAsset[]>)));
  return [...((await first.json()) as EsiAsset[]), ...rest.flat()];
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

export async function universeNames(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const known = ids.filter((id) => id < 100_000_000);
  for (let i = 0; i < known.length; i += 1000) {
    const res = await esiFetch(`${ESI}/universe/names/?datasource=tranquility`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(known.slice(i, i + 1000)) });
    if (!res.ok) continue;
    for (const x of (await res.json()) as { id: number; name: string }[]) out.set(x.id, x.name);
  }
  return out;
}

export const portraitUrl = (characterId: number, size = 128) => `https://images.evetech.net/characters/${characterId}/portrait?size=${size}`;

export interface DynamicItem {
  source_type_id: number;
  mutator_type_id: number;
  dogma_attributes: { attribute_id: number; value: number }[];
}

export async function dynamicItem(typeId: number, itemId: number): Promise<DynamicItem> {
  const res = await esiFetch(`${ESI}/dogma/dynamic/items/${typeId}/${itemId}/?datasource=tranquility`);
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
}

export async function walletJournal(characterId: number, maxPages = 10): Promise<WalletEntry[]> {
  const token = await accessToken(characterId);
  const get = async (page: number) => {
    const res = await esiFetch(`${ESI}/characters/${characterId}/wallet/journal/?datasource=tranquility&page=${page}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`ESI wallet: ${res.status} ${await res.text()}`);
    return res;
  };
  const first = await get(1);
  const pages = Math.min(maxPages, Number(first.headers.get('x-pages')) || 1);
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => get(i + 2).then((r) => r.json() as Promise<WalletEntry[]>)));
  return [...((await first.json()) as WalletEntry[]), ...rest.flat()];
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
}

export function walletTransactions(characterId: number): Promise<WalletTransaction[]> {
  return esi(characterId, `/characters/${characterId}/wallet/transactions/`);
}
