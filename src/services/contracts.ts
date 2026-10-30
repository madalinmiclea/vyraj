import { hasScope } from '../character/sso';
import { rosterCharacters } from '../character/roster';
import { authedJson, authedPages, corporationOf, isPlayerCorp, CORP_SCOPES } from './corporation';

export const CONTRACTS_SCOPE = 'esi-contracts.read_character_contracts.v1';

export type ContractType = 'unknown' | 'item_exchange' | 'auction' | 'courier' | 'loan';
export type ContractStatus = 'outstanding' | 'in_progress' | 'finished_issuer' | 'finished_contractor' | 'finished' | 'cancelled' | 'rejected' | 'failed' | 'deleted' | 'reversed';

export interface Contract {
  contract_id: number;
  type: ContractType;
  status: ContractStatus;
  availability: 'public' | 'personal' | 'corporation' | 'alliance';
  issuer_id: number;
  issuer_corporation_id: number;
  assignee_id: number;
  acceptor_id: number;
  title?: string;
  for_corporation: boolean;
  date_issued: string;
  date_expired: string;
  date_accepted?: string;
  date_completed?: string;
  days_to_complete?: number;
  start_location_id?: number;
  end_location_id?: number;
  price?: number;
  reward?: number;
  collateral?: number;
  buyout?: number;
  volume?: number;
}

export interface ContractItem {
  record_id: number;
  type_id: number;
  quantity: number;
  is_included: boolean;
  is_singleton: boolean;
  raw_quantity?: number;
}

export interface ContractBid {
  bid_id: number;
  bidder_id: number;
  amount: number;
  date_issued: string;
}

export interface OwnedContract extends Contract {
  ownerId: number;
  ownerName: string;
  corporationId?: number;
}

export const isActive = (c: Contract) => c.status === 'outstanding' || c.status === 'in_progress';

export function dueAt(c: Contract): number | null {
  if (!isActive(c)) return null;
  if (c.type === 'courier' && c.status === 'in_progress' && c.date_accepted && c.days_to_complete) return Date.parse(c.date_accepted) + c.days_to_complete * 86_400_000;
  return Date.parse(c.date_expired);
}

export const contractCharacters = () => rosterCharacters().filter((c) => c.characterId != null && hasScope(c.characterId, CONTRACTS_SCOPE));
export const corpContractCharacters = () => rosterCharacters().filter((c) => c.characterId != null && hasScope(c.characterId, CORP_SCOPES.contracts));

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: Contract[] }>();

async function cached(key: string, load: () => Promise<Contract[]>, force: boolean) {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function characterContracts(characterId: number, force = false): Promise<Contract[]> {
  return cached(`c${characterId}`, () => authedPages<Contract>(characterId, `/characters/${characterId}/contracts/`, 5), force);
}

export async function corporationContracts(characterId: number, force = false): Promise<{ corporationId: number; list: Contract[] } | null> {
  const corporationId = await corporationOf(characterId);
  if (!isPlayerCorp(corporationId)) return null;
  const list = await cached(`k${corporationId}`, () => authedPages<Contract>(characterId, `/corporations/${corporationId}/contracts/`, 5), force);
  return { corporationId: corporationId!, list };
}

export interface ContractsScan {
  at: number;
  personal: OwnedContract[];
  corporation: OwnedContract[];
  errors: string[];
}

let last: ContractsScan | null = null;
export const lastContracts = () => last;

export async function scanContracts(force = false): Promise<ContractsScan> {
  const errors: string[] = [];
  const personal = new Map<number, OwnedContract>();
  const corporation = new Map<number, OwnedContract>();
  await Promise.all(contractCharacters().map(async (c) => {
    try {
      for (const x of await characterContracts(c.characterId!, force)) if (!personal.has(x.contract_id)) personal.set(x.contract_id, { ...x, ownerId: c.characterId!, ownerName: c.name });
    } catch (err) { errors.push(`${c.name}: ${(err as Error).message}`); }
  }));
  const seenCorp = new Set<number>();
  for (const c of corpContractCharacters()) {
    const corpId = await corporationOf(c.characterId!).catch(() => null);
    if (!corpId || seenCorp.has(corpId)) continue;
    try {
      const r = await corporationContracts(c.characterId!, force);
      if (!r) continue;
      seenCorp.add(corpId);
      for (const x of r.list) if (!corporation.has(x.contract_id)) corporation.set(x.contract_id, { ...x, ownerId: c.characterId!, ownerName: c.name, corporationId: r.corporationId });
    } catch (err) { errors.push(`${c.name}: ${(err as Error).message}`); }
  }
  last = { at: Date.now(), personal: [...personal.values()], corporation: [...corporation.values()], errors };
  return last;
}

const itemCache = new Map<string, Promise<ContractItem[]>>();
const bidCache = new Map<string, Promise<ContractBid[]>>();

const basePath = (c: OwnedContract) => (c.corporationId ? `/corporations/${c.corporationId}` : `/characters/${c.ownerId}`);

export function contractItems(c: OwnedContract): Promise<ContractItem[]> {
  const key = `${c.corporationId ?? 'c'}:${c.contract_id}`;
  let hit = itemCache.get(key);
  if (!hit) {
    hit = authedJson<ContractItem[]>(c.ownerId, `${basePath(c)}/contracts/${c.contract_id}/items/`).catch((err) => { itemCache.delete(key); throw err; });
    itemCache.set(key, hit);
  }
  return hit;
}

export function contractBids(c: OwnedContract): Promise<ContractBid[]> {
  const key = `${c.corporationId ?? 'c'}:${c.contract_id}`;
  let hit = bidCache.get(key);
  if (!hit) {
    hit = authedJson<ContractBid[]>(c.ownerId, `${basePath(c)}/contracts/${c.contract_id}/bids/`).catch((err) => { bidCache.delete(key); throw err; });
    bidCache.set(key, hit);
  }
  return hit;
}
