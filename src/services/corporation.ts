import { accessToken, hasScope } from '../character/sso';
import { ESI, esiFetch, esiPages } from './esiClient';
import { characterPublic } from './operations';
import { isDemo } from '../storage';

export const CORP_SCOPES = {
  roles: 'esi-characters.read_corporation_roles.v1',
  divisions: 'esi-corporations.read_divisions.v1',
  wallets: 'esi-wallet.read_corporation_wallets.v1',
  contracts: 'esi-contracts.read_corporation_contracts.v1',
};

export const WALLET_ROLES = ['Director', 'Accountant', 'Junior_Accountant'];

export async function authedJson<T>(characterId: number, path: string): Promise<T> {
  const token = await accessToken(characterId);
  const res = await esiFetch(`${ESI}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`ESI ${path.split('?')[0]}: ${res.status}`);
  return (await res.json()) as T;
}

export async function authedPages<T>(characterId: number, path: string, maxPages = 5): Promise<T[]> {
  const token = await accessToken(characterId);
  return esiPages<T>((page) => `${ESI}${path}${path.includes('?') ? '&' : '?'}page=${page}`, { headers: { Authorization: `Bearer ${token}` } }, maxPages);
}

const NPC_CORP_MAX = 2_000_000;
export const DEMO_CORP = 98_000_001;

export async function corporationOf(characterId: number): Promise<number | null> {
  if (isDemo()) return DEMO_CORP;
  const info = await characterPublic(characterId);
  return info?.corporation_id ?? null;
}

export const isPlayerCorp = (corporationId: number | null | undefined) => !!corporationId && corporationId > NPC_CORP_MAX;

const roleCache = new Map<number, Promise<string[]>>();

export function corporationRoles(characterId: number): Promise<string[]> {
  if (!hasScope(characterId, CORP_SCOPES.roles)) return Promise.resolve([]);
  let hit = roleCache.get(characterId);
  if (!hit) {
    hit = authedJson<{ roles?: string[] }>(characterId, `/characters/${characterId}/roles/`).then((r) => r.roles ?? []).catch(() => []);
    roleCache.set(characterId, hit);
  }
  return hit;
}

export const canReadCorpWallet = (roles: string[]) => roles.some((r) => WALLET_ROLES.includes(r));
