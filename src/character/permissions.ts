import { hasScope, hasTokens, grantedScopes, startLogin, BASE_SCOPES } from './sso';
import { loadStoredCharacters } from './characters';
import { button, esc } from '../ui/components';
import { icon } from '../ui/icons';
import { tx } from '../i18n';

export type PermId = 'fittings' | 'assets' | 'location' | 'wallet' | 'loyalty' | 'orders' | 'planets' | 'industry';

export interface Permission { id: PermId; label: string; why: string; scopes: string[] }

export const PERMISSIONS: Permission[] = [
  { id: 'fittings', label: tx('Fituri din joc'), why: tx('Încarcă fiturile salvate în joc și trimite un fit din Vyraj în joc, doar când apeși butonul.'), scopes: ['esi-fittings.read_fittings.v1', 'esi-fittings.write_fittings.v1'] },
  { id: 'assets', label: tx('Bunuri și nave'), why: tx('Citește itemele tale ca să refacă fiturile navelor pe care le ai, să le evalueze și să-ți sincronizeze colecția de SKIN-uri.'), scopes: ['esi-assets.read_assets.v1', 'esi-location.read_ship_type.v1', 'esi-universe.read_structures.v1'] },
  { id: 'location', label: tx('Locație și status'), why: tx('Arată unde e fiecare caracter, cu ce navă zboară și dacă e online, în panoul Toate caracterele.'), scopes: ['esi-location.read_location.v1', 'esi-location.read_online.v1', 'esi-location.read_ship_type.v1', 'esi-universe.read_structures.v1'] },
  { id: 'wallet', label: tx('Portofel'), why: tx('Citește soldul, jurnalul și tranzacțiile, pentru Portofel și ISK/oră.'), scopes: ['esi-wallet.read_character_wallet.v1'] },
  { id: 'loyalty', label: tx('Puncte de loialitate'), why: tx('Citește LP-urile tale, ca Magazinul LP să arate ofertele pentru punctele pe care le ai.'), scopes: ['esi-characters.read_loyalty.v1'] },
  { id: 'orders', label: tx('Ordine de piață'), why: tx('Citește ordinele active și istoricul lor, pentru alertele de outbid și undercut. Nu poate plasa sau modifica ordine.'), scopes: ['esi-markets.read_character_orders.v1', 'esi-universe.read_structures.v1'] },
  { id: 'planets', label: tx('Colonii planetare'), why: tx('Citește coloniile, extractoarele și depozitele pentru Interacțiune planetară. Nu schimbă nimic în colonii.'), scopes: ['esi-planets.manage_planets.v1'] },
  { id: 'industry', label: tx('Blueprint-uri și joburi'), why: tx('Citește blueprint-urile și joburile de industrie, ca să calculezi cu ME și TE reale.'), scopes: ['esi-characters.read_blueprints.v1', 'esi-industry.read_character_jobs.v1'] },
];

export const permission = (id: PermId) => PERMISSIONS.find((p) => p.id === id)!;

export function hasPermission(characterId: number, id: PermId): boolean {
  return permission(id).scopes.filter((s) => !s.startsWith('esi-universe')).every((s) => hasScope(characterId, s));
}

export function requestPermission(ids: PermId[], characterId?: number | null, returnTo?: string): Promise<void> {
  const keep = characterId && hasTokens(characterId) ? grantedScopes(characterId) : [];
  const scopes = [...new Set([...BASE_SCOPES, ...keep, ...ids.flatMap((id) => permission(id).scopes)])];
  return startLogin(scopes, returnTo);
}

export function permissionGate(id: PermId, characterId: number, name?: string): string {
  const p = permission(id);
  const who = name ?? loadStoredCharacters().find((c) => c.characterId === characterId)?.name ?? '';
  return `<div class="perm-gate">
    <span class="perm-gate-ico">${icon('login')}</span>
    <div class="perm-gate-text">
      <b>${esc(tx('Permisiune necesară: {perm}', { perm: p.label }))}</b>
      <p>${esc(p.why)}</p>
      <p class="dim small">${esc(tx('Te trimitem la pagina oficială EVE. Alege acolo caracterul {name} și aprobă; permisiunile pe care le-ai dat deja rămân.', { name: who }))}</p>
    </div>
    ${button(tx('Permite'), { iconName: 'login', cls: 'sm', attrs: `data-grant="${id}" data-grant-char="${characterId}"` })}
  </div>`;
}

export function permissionButtons(id: PermId, characters: { characterId: number; name: string }[]): string {
  const p = permission(id);
  return `<div class="perm-gate">
    <span class="perm-gate-ico">${icon('login')}</span>
    <div class="perm-gate-text">
      <b>${esc(tx('Permisiune necesară: {perm}', { perm: p.label }))}</b>
      <p>${esc(p.why)}</p>
    </div>
    <div class="perm-gate-actions">${characters.map((c) => button(c.name, { iconName: 'login', cls: 'sm ghost', attrs: `data-grant="${id}" data-grant-char="${c.characterId}"` })).join('')}</div>
  </div>`;
}
