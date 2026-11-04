import { hasScope } from '../character/sso';
import { rosterCharacters } from '../character/roster';
import { ESI, esiFetch } from './esiClient';
import { authedJson, authedPages, corporationOf, corporationRoles, isPlayerCorp } from './corporation';

export const LEDGER_SCOPE = 'esi-industry.read_character_mining.v1';
export const MOON_SCOPE = 'esi-industry.read_corporation_mining.v1';
export const MOON_ROLES = ['Director', 'Station_Manager'];

export interface LedgerRow { date: string; quantity: number; solar_system_id: number; type_id: number }
export interface OwnedLedgerRow extends LedgerRow { ownerId: number; ownerName: string }

export interface Extraction {
  chunk_arrival_time: string;
  extraction_start_time: string;
  moon_id: number;
  natural_decay_time: string;
  structure_id: number;
}

export interface OwnedExtraction extends Extraction { corporationId: number; readerId: number }

export const ledgerCharacters = () => rosterCharacters().filter((c) => c.characterId != null && hasScope(c.characterId, LEDGER_SCOPE));
export const moonCharacters = () => rosterCharacters().filter((c) => c.characterId != null && hasScope(c.characterId, MOON_SCOPE));

const CACHE_MS = 10 * 60 * 1000;
let ledgerCache: { at: number; rows: OwnedLedgerRow[]; errors: string[] } | null = null;
let moonCache: { at: number; rows: OwnedExtraction[]; errors: string[]; noRole: string[] } | null = null;

export async function loadLedger(force = false) {
  if (!force && ledgerCache && Date.now() - ledgerCache.at < CACHE_MS) return ledgerCache;
  const rows: OwnedLedgerRow[] = [];
  const errors: string[] = [];
  await Promise.all(ledgerCharacters().map(async (c) => {
    try {
      const list = await authedPages<LedgerRow>(c.characterId!, `/characters/${c.characterId}/mining/`, 10);
      for (const r of list) rows.push({ ...r, ownerId: c.characterId!, ownerName: c.name });
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`);
    }
  }));
  ledgerCache = { at: Date.now(), rows, errors };
  return ledgerCache;
}

export async function loadExtractions(force = false) {
  if (!force && moonCache && Date.now() - moonCache.at < CACHE_MS) return moonCache;
  const rows: OwnedExtraction[] = [];
  const errors: string[] = [];
  const noRole: string[] = [];
  const seen = new Set<number>();
  for (const c of moonCharacters()) {
    const id = c.characterId!;
    const corp = await corporationOf(id).catch(() => null);
    if (!isPlayerCorp(corp) || seen.has(corp!)) continue;
    const roles = await corporationRoles(id);
    if (!roles.some((r) => MOON_ROLES.includes(r))) { noRole.push(c.name); continue; }
    try {
      const list = await authedPages<Extraction>(id, `/corporation/${corp}/mining/extractions/`, 5);
      seen.add(corp!);
      for (const r of list) rows.push({ ...r, corporationId: corp!, readerId: id });
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`);
    }
  }
  moonCache = { at: Date.now(), rows, errors, noRole };
  return moonCache;
}

export const corpName = (corporationId: number, characterId: number) => authedJson<{ name: string }>(characterId, `/corporations/${corporationId}/`).then((c) => c.name).catch(() => String(corporationId));

const moonNames = new Map<number, Promise<string>>();

export function moonName(id: number): Promise<string> {
  let hit = moonNames.get(id);
  if (!hit) {
    hit = esiFetch(`${ESI}/universe/moons/${id}/`).then((r) => (r.ok ? r.json() : null)).then((m: { name?: string } | null) => m?.name ?? String(id)).catch(() => String(id));
    moonNames.set(id, hit);
  }
  return hit;
}
