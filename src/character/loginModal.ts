import { PERMISSIONS, hasPermission, permission, requestPermission, scopeList, type PermId } from './permissions';
import { BASE_SCOPES, hasTokens } from './sso';
import { badge, button, esc, openModal, closeModal, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { tx } from '../i18n';

interface PermGroup { id: string; icon: string; title: string; text: string; perms: PermId[] }

export const PERM_GROUPS: PermGroup[] = [
  { id: 'ships', icon: 'fitting', title: tx('Nave și fituri'), text: tx('Fiturile din joc, bunurile și navele tale, unde ești și ce zbori, colecția de SKIN-uri.'), perms: ['fittings', 'assets', 'location', 'skinr'] },
  { id: 'trade', icon: 'market', title: tx('ISK și comerț'), text: tx('Portofelul, ordinele de piață, contractele și punctele de loialitate.'), perms: ['wallet', 'orders', 'contracts', 'loyalty'] },
  { id: 'industry', icon: 'industry', title: tx('Industrie și activități'), text: tx('Blueprint-uri și joburi, colonii planetare, joburi freelance, campanii și Mercenary Dens.'), perms: ['industry', 'planets', 'freelance', 'campaigns', 'mercenary'] },
  { id: 'social', icon: 'mail', title: tx('Mail și corporație'), text: tx('Mailurile EVE, notificările din joc, rolurile tale în corporație, contractele și walleturile corporației.'), perms: ['mail', 'notifications', 'corporation'] },
];

export function openPermissionsModal(characterId?: number | null, returnTo?: string) {
  const known = characterId && hasTokens(characterId) ? characterId : null;
  const granted = (g: PermGroup) => !!known && g.perms.every((p) => hasPermission(known, p));
  const groups = PERM_GROUPS.map((g) => {
    const done = granted(g);
    const scopes = g.perms.flatMap((p) => permission(p).scopes);
    return `<label class="perm-group ${done ? 'done' : ''}">
      <input type="checkbox" data-perm-group="${g.id}" ${done ? 'checked disabled' : ''} />
      <span class="perm-group-ico">${icon(g.icon)}</span>
      <span class="perm-group-text">
        <span class="perm-group-head"><b>${esc(g.title)}</b>${done ? badge(tx('Aprobată'), 'ok', true) : ''}</span>
        <span class="dim small">${esc(g.text)}</span>
        <span class="perm-group-chips">${g.perms.map((p) => `<span class="chip">${esc(permission(p).label)}</span>`).join('')}</span>
        ${scopeList(scopes)}
      </span>
    </label>`;
  }).join('');
  const el = openModal(tx('Permisiuni EVE'), `<div class="perm-modal">
    <p class="dim">${esc(tx('Alege ce poate citi Vyraj din contul tău EVE. Poți porni doar cu login-ul și aprobi restul când deschizi un ecran care are nevoie, sau accepți tot acum și nu te mai întrebăm nimic.'))}</p>
    <div class="perm-group base">
      <span class="perm-group-ico">${icon('login')}</span>
      <span class="perm-group-text">
        <span class="perm-group-head"><b>${esc(tx('Login'))}</b>${badge(tx('Mereu inclus'), '', true)}</span>
        <span class="dim small">${esc(tx('Skill-urile, coada de antrenament și implanturile, pentru fitting și planul de skill-uri.'))}</span>
        ${scopeList(BASE_SCOPES)}
      </span>
    </div>
    <div class="perm-groups">${groups}</div>
    <p class="dim small">${esc(tx('Te trimitem la pagina oficială EVE, unde alegi caracterul și aprobi. Vyraj nu vede parola ta și poți revoca oricând permisiunile din pagina EVE de aplicații.'))}</p>
    <div class="perm-modal-actions">
      ${known ? button(tx('Anulează'), { cls: 'ghost', attrs: 'data-close' }) : button(tx('Doar login-ul'), { cls: 'ghost', attrs: 'data-perm-go="base"' })}
      ${button(tx('Continuă cu selecția'), { cls: 'ghost', attrs: 'data-perm-go="pick" disabled' })}
      ${button(tx('Acceptă toate'), { iconName: 'login', attrs: 'data-perm-go="all"' })}
    </div>
  </div>`, { wide: true });
  const pick = el.querySelector<HTMLButtonElement>('[data-perm-go="pick"]')!;
  const selected = () => [...el.querySelectorAll<HTMLInputElement>('[data-perm-group]:checked:not(:disabled)')]
    .flatMap((i) => PERM_GROUPS.find((g) => g.id === i.dataset.permGroup)!.perms);
  el.addEventListener('change', () => { pick.disabled = !selected().length; });
  el.addEventListener('click', (e) => {
    const go = (e.target as HTMLElement).closest<HTMLElement>('[data-perm-go]')?.dataset.permGo;
    if (!go) return;
    const ids = go === 'all' ? PERMISSIONS.map((p) => p.id) : go === 'pick' ? selected() : [];
    closeModal();
    requestPermission(ids, known, returnTo).catch((err) => toast((err as Error).message));
  });
}
