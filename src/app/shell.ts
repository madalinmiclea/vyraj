import { icon, logo } from '../ui/icons';
import { windowTitle, searchField, esc, lore } from '../ui/components';
import { FITTING_CATEGORIES } from '../views/fitting';
import type { ViewId } from './views';
import { viewHref } from './route';
import { getActiveCharacterId, storedActiveCharacter } from '../character/characters';
import { portraitUrl } from '../character/esi';
import { tx, lang, type Lang } from '../i18n';
import { theme, type Theme } from '../theme';
import { isDemo } from '../demo/demo';

export const MOBILE_MAIN: string[] = ['home', 'market', 'fitting', 'character'];
export const SIDE_VIEWS = ['doctrines', 'character', 'wallet', 'orders', 'skins', 'recon', 'navigation', 'pi', 'industry', 'mining', 'missions', 'cosmos', 'operations', 'mail', 'notifications'] as const;
export type SideView = (typeof SIDE_VIEWS)[number];
export const SDE_VIEWS = ['fitting', ...SIDE_VIEWS] as const;

const FLAG: Record<Lang, string> = {
  ro: '<svg class="flag" viewBox="0 0 3 2" aria-hidden="true"><path fill="#002b7f" d="M0 0h1v2H0z"/><path fill="#fcd116" d="M1 0h1v2H1z"/><path fill="#ce1126" d="M2 0h1v2H2z"/></svg>',
  en: '<svg class="flag" viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><clipPath id="flagGbCross"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath><path fill="#012169" d="M0 0h60v30H0z"/><path stroke="#fff" stroke-width="6" d="m0 0 60 30m0-30L0 30"/><path stroke="#c8102e" stroke-width="4" clip-path="url(#flagGbCross)" d="m0 0 60 30m0-30L0 30"/><path stroke="#fff" stroke-width="10" d="M30 0v30M0 15h60"/><path stroke="#c8102e" stroke-width="6" d="M30 0v30M0 15h60"/></svg>',
};
const LANG_NAME: Record<Lang, string> = { ro: 'Română', en: 'English' };
export const VIEWS: { id: ViewId; label: string; short: string; icon: string; categories: string[] | null; lore: string; clade: string; order: number }[] = [
  { id: 'home', label: tx('Start'), short: tx('Start'), icon: 'home', categories: null, lore: 'Prag', clade: 'Rod', order: 0 },
  { id: 'market', label: tx('Piață'), short: tx('Piață'), icon: 'market', categories: null, lore: 'Conduit', clade: 'Veles', order: 6 },
  { id: 'intel', label: tx('Intel Jita'), short: tx('Intel Jita'), icon: 'intel', categories: null, lore: 'Discourse', clade: 'Veles', order: 7 },
  { id: 'recon', label: tx('Intel PvP'), short: 'PvP', icon: 'recon', categories: null, lore: 'Cladistic Recon', clade: 'Perun', order: 3 },
  { id: 'navigation', label: tx('Navigație'), short: tx('Navigație'), icon: 'jump', categories: null, lore: 'Krai Passage', clade: 'Perun', order: 4 },
  { id: 'fitting', label: tx('Fitting'), short: tx('Fitting'), icon: 'fitting', categories: FITTING_CATEGORIES, lore: 'Proving', clade: 'Svarog', order: 10 },
  { id: 'character', label: tx('Caracter'), short: tx('Caracter'), icon: 'character', categories: null, lore: 'Narodnya', clade: 'Perun', order: 2 },
  { id: 'industry', label: tx('Industrie'), short: tx('Industrie'), icon: 'industry', categories: null, lore: 'Matterweave', clade: 'Mokosh', order: 16 },
  { id: 'wallet', label: tx('Portofel'), short: tx('Portofel'), icon: 'isk', categories: null, lore: 'Tithe', clade: 'Veles', order: 8 },
  { id: 'mining', label: tx('Minerit'), short: tx('Minerit'), icon: 'mining', categories: null, lore: 'Rudnik', clade: 'Mokosh', order: 15 },
  { id: 'orders', label: tx('Ordine de piață'), short: tx('Ordine'), icon: 'orders', categories: null, lore: 'Torg', clade: 'Veles', order: 8 },
  { id: 'doctrines', label: tx('Doctrine'), short: tx('Doctrine'), icon: 'doctrine', categories: null, lore: 'Druzhina', clade: 'Svarog', order: 11 },
  { id: 'skins', label: tx('SKIN-uri'), short: tx('SKIN-uri'), icon: 'skin', categories: null, lore: 'Raiment', clade: 'Svarog', order: 11 },
  { id: 'pi', label: tx('Interacțiune planetară'), short: 'PI', icon: 'planet', categories: null, lore: 'Rootweave', clade: 'Mokosh', order: 17 },
  { id: 'missions', label: tx('Misiuni'), short: tx('Misiuni'), icon: 'hunt', categories: null, lore: 'Lov', clade: 'Morana', order: 13 },
  { id: 'cosmos', label: 'COSMOS', short: 'COSMOS', icon: 'cosmos', categories: null, lore: 'Zvezdy', clade: 'Morana', order: 13 },
  { id: 'operations', label: 'PvE', short: 'PvE', icon: 'target', categories: null, lore: 'Pohod', clade: 'Morana', order: 13 },
  { id: 'mail', label: tx('Mail'), short: tx('Mail'), icon: 'mail', categories: null, lore: 'Vest', clade: 'Perun', order: 2 },
  { id: 'notifications', label: tx('Notificări'), short: tx('Alerte'), icon: 'bell', categories: null, lore: 'Glas', clade: 'Perun', order: 2 },
  { id: 'about', label: tx('Credite'), short: tx('Credite'), icon: 'credits', categories: null, lore: 'Letopis', clade: 'Rod', order: 19 },
];

export const portrait = (id?: number) => (id ? `<img src="${portraitUrl(id, 64)}" alt="" />` : `<span class="char-placeholder">${icon('character')}</span>`);
export const viewEl = (id: ViewId) => document.getElementById('view-' + id)!;
export const sidePane = (id: SideView) => document.getElementById('pane-' + id)!;

export function mountShell() {
  const earlyChar = storedActiveCharacter();
  const earlyId = getActiveCharacterId();
  const earlyName = earlyChar?.name ?? (earlyId === 'all0' ? tx('Toate la 0') : tx('Toate la V'));
  const earlyLabel = earlyChar ? tx('Caracter') : tx('Skill-uri');

  if (window.top !== window.self) {
    document.body.innerHTML = `<p style="padding:24px"><a href="${esc(location.href)}" target="_top" rel="noopener">Vyraj</a></p>`;
    throw new Error('framed');
  }

  document.querySelector('#app')!.innerHTML = `
  <a class="skip-link" href="#mainContent" data-skip-main>${tx('Sari la conținut')}</a>
  <div class="shell">
    <header class="topbar">
      <button class="side-toggle" id="sideToggle" aria-label="${tx('Meniu')}">${icon('menu')}</button>
      <button class="brand" id="brandHome" aria-label="${tx('Start')}" title="${tx('Reîncarcă aplicația cu ultima versiune')}">${logo}<span>Vyraj</span></button>
      <div class="topbar-title" id="topbarTitle"></div>
      <div class="topbar-spacer"></div>
      <div class="topbar-stat optional"><span class="label">${tx('Jucători online')}</span><span class="value" id="onlinePlayers">—</span></div>
      <div class="topbar-stat optional"><span class="label">ESI</span><span class="value esi-health" id="esiHealth"><i class="dot"></i><span>—</span></span></div>
      <div class="topbar-stat"><span class="label">${tx('Ora EVE')}</span><span class="value" id="eveClock">--:--</span></div>
      <div class="char-switch" id="charSwitch">
        <button class="char-switch-btn" id="charSwitchBtn" aria-haspopup="true"><span class="char-switch-avatar" id="charAvatar">${portrait(earlyChar?.characterId)}</span><span class="topbar-stat"><span class="label" id="topCharacterLabel">${earlyLabel}</span><span class="value accent" id="topCharacter">${esc(earlyName)}</span></span>${icon('chevron', 'chev')}</button>
        <div class="char-menu" id="charMenu" hidden></div>
      </div>
      <button class="btn ghost sm sso-btn" id="ssoBtn" data-tip="${tx('Permisiuni EVE')}" aria-label="${tx('Permisiuni EVE')}">${icon('login')}<span>SSO</span></button>
      <div class="lang-switch theme-switch" role="group" aria-label="${tx('Temă')}">${([['light', 'sun', tx('Luminos')], ['dark', 'moon', tx('Întunecat')], ['vyraj', 'trinity', 'Vyraj']] as [Theme, string, string][]).map(([t, ic, label]) => `<button class="${t === theme ? 'active' : ''}" data-theme-set="${t}" aria-pressed="${t === theme}" data-tip="${label}" aria-label="${label}">${icon(ic)}</button>`).join('')}</div>
      <div class="lang-switch" role="group" aria-label="${tx('Limbă')}">${(['ro', 'en'] as Lang[]).map((l) => `<button class="${l === lang ? 'active' : ''}" data-lang="${l}" aria-pressed="${l === lang}" title="${LANG_NAME[l]}" aria-label="${LANG_NAME[l]}">${FLAG[l]}</button>`).join('')}</div>
    </header>

    <nav class="neocom">
      ${([['Perun', 1], ['Veles', 5], ['Svarog', 9], ['Morana', 12], ['Mokosh', 14], ['Rod', 18]] as [string, number][]).map(([c, o]) => `<div class="clade-sep" style="--vy-order:${o}">${c}</div>`).join('')}
      ${VIEWS.map((v) => `<a class="neocom-btn ${MOBILE_MAIN.includes(v.id) ? 'nc-main' : ''} ${v.short === v.label ? 'tip-same' : ''}" href="${viewHref(v.id)}" data-view="${v.id}" aria-label="${v.label}" data-tip="${v.label}" data-tip-vy="${v.lore}" style="--vy-order:${v.order}">${icon(v.icon)}<span class="nc-label">${v.short}</span></a>`).join('')}
      <button class="neocom-btn neocom-more" id="neocomMore" aria-haspopup="true" aria-label="${tx('Mai mult')}">${icon('menu')}<span class="nc-label">${tx('Mai mult')}</span></button>
      <div class="app-version" title="${tx('Versiune')} ${__APP_VERSION__} · © 2026 Vyraj · PolyForm Strict 1.0.0">v${__APP_VERSION__}</div>
    </nav>
    <div class="neocom-sheet" id="neocomSheet" hidden>
      ${[...VIEWS].sort((a, b) => a.order - b.order).map((v) => `<a class="sheet-btn" href="${viewHref(v.id)}" data-view="${v.id}">${icon(v.icon)}<span>${lore(v.label, v.lore)}</span></a>`).join('')}
      <button class="sheet-btn sheet-install" id="sheetInstall" hidden>${icon('download')}<span>${tx('Instalează aplicația')}</span></button>
    </div>

    <aside class="sidebar">
      <div class="side-pane active" id="pane-items">
        <div class="sidebar-head">
          ${windowTitle(tx('Browser iteme'))}
          ${searchField({ id: 'treeFilter', placeholder: matchMedia('(pointer: coarse)').matches ? tx('Filtrează') : tx('Filtrează · click dreapta = Info') })}
        </div>
        <div class="sidebar-body" id="treeView"></div>
      </div>
      ${SIDE_VIEWS.map((id) => `<div class="side-pane" id="pane-${id}"></div>`).join('')}
      <div class="side-resizer" id="sideResizer" title="${tx('Trage ca să lărgești meniul · dublu click pentru lățimea inițială')}"></div>
    </aside>

    <div class="side-scrim" id="sideScrim"></div>

    <main class="main" id="mainContent" tabindex="-1">
      ${isDemo() ? `<div class="demo-bar" role="status"><span class="demo-bar-ico">${icon('alert')}</span><span><b>${tx('Mod demo')}</b><span class="demo-bar-text"> · ${tx('Un pilot fictiv cu date inventate, ca să vezi tot ce face Vyraj fără login. Nimic nu ajunge în EVE.')}</span></span><button class="btn sm" data-demo-exit>${icon('close')}${tx('Ieși din demo')}</button></div>` : ''}
      <nav class="subnav" id="subnav" hidden></nav>
      ${VIEWS.map((v) => `<div class="view" id="view-${v.id}"></div>`).join('')}
    </main>
  </div>
`;
}
