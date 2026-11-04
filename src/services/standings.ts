import { hasScope } from '../character/sso';
import { authedPages } from './corporation';
import { characterPublic } from './operations';

export const CONTACT_SCOPES = { character: 'esi-characters.read_contacts.v1', corporation: 'esi-corporations.read_contacts.v1', alliance: 'esi-alliances.read_contacts.v1' };

interface Contact { contact_id: number; contact_type: string; standing: number }

export interface Standings { at: number; byId: Map<number, number>; allianceId?: number; corporationId?: number }

const cache = new Map<number, Standings>();

export const canReadStandings = (characterId: number) => hasScope(characterId, CONTACT_SCOPES.character);

export async function loadStandings(characterId: number, force = false): Promise<Standings> {
  const hit = cache.get(characterId);
  if (!force && hit && Date.now() - hit.at < 15 * 60 * 1000) return hit;
  const info = await characterPublic(characterId);
  const corporationId = info?.corporation_id;
  const allianceId = info?.alliance_id;
  const read = (scope: string, path: string) => (hasScope(characterId, scope) ? authedPages<Contact>(characterId, path, 5).catch(() => [] as Contact[]) : Promise.resolve([] as Contact[]));
  const [alliance, corporation, personal] = await Promise.all([
    allianceId ? read(CONTACT_SCOPES.alliance, `/alliances/${allianceId}/contacts/`) : Promise.resolve([] as Contact[]),
    corporationId ? read(CONTACT_SCOPES.corporation, `/corporations/${corporationId}/contacts/`) : Promise.resolve([] as Contact[]),
    read(CONTACT_SCOPES.character, `/characters/${characterId}/contacts/`),
  ]);
  const byId = new Map<number, number>();
  for (const list of [alliance, corporation, personal]) for (const c of list) byId.set(c.contact_id, c.standing);
  const out = { at: Date.now(), byId, allianceId, corporationId };
  cache.set(characterId, out);
  return out;
}
