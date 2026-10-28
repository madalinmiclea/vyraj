import './style.css';
import { marketGroups, loadItems } from './data/items';
import { icon, logo } from './ui/icons';
import { windowTitle, searchField, formatInt, loader, alertBox, panel, esc, lore, toast, closeModal } from './ui/components';
import { createItemBrowser } from './ui/sidebar';
import { createMarketView } from './views/market';
import { createFittingView, FITTING_CATEGORIES, type FittingView } from './views/fitting';
import { createCharacterView } from './views/character';
import { createSkillsView } from './views/skills';
import { createRosterView } from './views/roster';
import { createToolsView } from './views/tools';
import { createOrdersView } from './views/orders';
import { createIntelView } from './views/intel';
import { createReconView } from './views/recon';
import { createNavigationView } from './views/navigation';
import { createMiningView } from './views/mining';
import { createIndustryView } from './views/industry';
import { createSkinsView } from './views/skins';
import { createPiView } from './views/pi';
import { createAboutView } from './views/about';
import { createHomeView } from './views/home';
import { createDoctrinesView, type DoctrinesView } from './views/doctrines';
import { readSharedDoctrine, hasSharedDoctrine } from './fitting/doctrines';
import { requestPermission, type PermId } from './character/permissions';
import { createMissionsView, type MissionsView } from './views/missions';
import { startAlertWatcher } from './services/alerts';
import { trackView } from './services/analytics';
import { startOrderWatcher } from './services/orders';
import { loadSde, type Sde } from './data/sde';
import { AppContext } from './app/context';
import { handleCallback, hasTokens, startLogin, getSettings, SESSION_EXPIRED_EVENT, type TokenSet } from './character/sso';
import { loadStoredCharacters } from './character/characters';
import { portraitUrl } from './character/esi';
import { fetchListedTypes } from './services/market';
import { showItemInfo, hasItemInfo } from './ui/itemInfo';
import { loadJson, saveJson, onStorageError } from './storage';
import { tx, lang, setLang, type Lang } from './i18n';
import { theme, setTheme, type Theme } from './theme';
import { initSelects } from './ui/select';
import { initNumberSpin } from './ui/numberSpin';
import { initSuggest } from './ui/suggest';
import { initTooltips } from './ui/tooltip';
import { initDatePicker } from './ui/datepicker';
import { readSharedFit } from './io/shareLink';
import { downloadBackup, pickBackup } from './io/backup';
import { esiFetch } from './services/esiClient';

type ViewId = 'home' | 'doctrines' | 'orders' | 'market' | 'intel' | 'recon' | 'navigation' | 'fitting' | 'character' | 'tools' | 'skins' | 'pi' | 'industry' | 'mining' | 'missions' | 'about';

const MOBILE_MAIN: string[] = ['home', 'market', 'fitting', 'character'];
const SIDE_VIEWS = ['doctrines', 'character', 'tools', 'orders', 'skins', 'recon', 'navigation', 'pi', 'industry', 'mining', 'missions'] as const;
type SideView = (typeof SIDE_VIEWS)[number];

const FLAG: Record<Lang, string> = {
  ro: '<svg class="flag" viewBox="0 0 3 2" aria-hidden="true"><path fill="#002b7f" d="M0 0h1v2H0z"/><path fill="#fcd116" d="M1 0h1v2H1z"/><path fill="#ce1126" d="M2 0h1v2H2z"/></svg>',
  en: '<svg class="flag" viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><clipPath id="flagGbCross"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath><path fill="#012169" d="M0 0h60v30H0z"/><path stroke="#fff" stroke-width="6" d="m0 0 60 30m0-30L0 30"/><path stroke="#c8102e" stroke-width="4" clip-path="url(#flagGbCross)" d="m0 0 60 30m0-30L0 30"/><path stroke="#fff" stroke-width="10" d="M30 0v30M0 15h60"/><path stroke="#c8102e" stroke-width="6" d="M30 0v30M0 15h60"/></svg>',
};
const LANG_NAME: Record<Lang, string> = { ro: 'Română', en: 'English' };
const VIEWS: { id: ViewId; label: string; short: string; icon: string; categories: string[] | null; lore: string; clade: string; order: number }[] = [
  { id: 'home', label: tx('Start'), short: tx('Start'), icon: 'home', categories: null, lore: 'Prag', clade: 'Rod', order: 0 },
  { id: 'market', label: tx('Piață'), short: tx('Piață'), icon: 'market', categories: null, lore: 'Conduit', clade: 'Veles', order: 2 },
  { id: 'intel', label: tx('Intel Jita'), short: tx('Intel'), icon: 'intel', categories: null, lore: 'Discourse', clade: 'Veles', order: 3 },
  { id: 'recon', label: tx('Intel PvP'), short: 'PvP', icon: 'recon', categories: null, lore: 'Cladistic Recon', clade: 'Perun', order: 10 },
  { id: 'navigation', label: tx('Navigație'), short: tx('Navigație'), icon: 'jump', categories: null, lore: 'Krai Passage', clade: 'Perun', order: 11 },
  { id: 'fitting', label: tx('Fitting'), short: tx('Fitting'), icon: 'fitting', categories: FITTING_CATEGORIES, lore: 'Proving', clade: 'Svarog', order: 6 },
  { id: 'character', label: tx('Caracter'), short: tx('Caracter'), icon: 'character', categories: null, lore: 'Narodnya', clade: 'Perun', order: 9 },
  { id: 'industry', label: tx('Industrie'), short: tx('Industrie'), icon: 'industry', categories: null, lore: 'Matterweave', clade: 'Mokosh', order: 14 },
  { id: 'tools', label: tx('Unelte ISK'), short: 'ISK', icon: 'isk', categories: null, lore: 'Tithe', clade: 'Veles', order: 4 },
  { id: 'mining', label: tx('Minerit'), short: tx('Minerit'), icon: 'mining', categories: null, lore: 'Rudnik', clade: 'Mokosh', order: 13 },
  { id: 'orders', label: tx('Ordine de piață'), short: tx('Ordine'), icon: 'orders', categories: null, lore: 'Torg', clade: 'Veles', order: 4 },
  { id: 'doctrines', label: tx('Doctrine'), short: tx('Doctrine'), icon: 'doctrine', categories: null, lore: 'Druzhina', clade: 'Svarog', order: 7 },
  { id: 'skins', label: tx('SKIN-uri'), short: 'SKIN', icon: 'skin', categories: null, lore: 'Raiment', clade: 'Svarog', order: 7 },
  { id: 'pi', label: tx('Interacțiune planetară'), short: 'PI', icon: 'planet', categories: null, lore: 'Rootweave', clade: 'Mokosh', order: 15 },
  { id: 'missions', label: tx('Misiuni'), short: tx('Misiuni'), icon: 'hunt', categories: null, lore: 'Lov', clade: 'Morana', order: 17 },
  { id: 'about', label: tx('Credite'), short: tx('Credite'), icon: 'credits', categories: null, lore: 'Letopis', clade: 'Rod', order: 19 },
];

document.querySelector('#app')!.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <button class="side-toggle" id="sideToggle" aria-label="${tx('Meniu')}">${icon('menu')}</button>
      <button class="brand" id="brandHome" aria-label="${tx('Start')}">${logo}<span>Vyraj</span></button>
      <div class="topbar-title" id="topbarTitle"></div>
      <div class="topbar-spacer"></div>
      <div class="topbar-stat optional"><span class="label">${tx('Jucători online')}</span><span class="value" id="onlinePlayers">—</span></div>
      <div class="topbar-stat"><span class="label">${tx('Ora EVE')}</span><span class="value" id="eveClock">--:--</span></div>
      <div class="char-switch" id="charSwitch">
        <button class="char-switch-btn" id="charSwitchBtn" aria-haspopup="true"><span class="char-switch-avatar" id="charAvatar"></span><span class="topbar-stat"><span class="label">${tx('Caracter')}</span><span class="value accent" id="topCharacter">—</span></span>${icon('chevron', 'chev')}</button>
        <div class="char-menu" id="charMenu" hidden></div>
      </div>
      <div class="lang-switch theme-switch" role="group" aria-label="${tx('Temă')}">${([['light', 'sun', tx('Luminos')], ['dark', 'moon', tx('Întunecat')], ['vyraj', 'trinity', 'Vyraj']] as [Theme, string, string][]).map(([t, ic, label]) => `<button class="${t === theme ? 'active' : ''}" data-theme-set="${t}" aria-pressed="${t === theme}" data-tip="${label}" aria-label="${label}">${icon(ic)}</button>`).join('')}</div>
      <div class="lang-switch" role="group" aria-label="${tx('Limbă')}">${(['ro', 'en'] as Lang[]).map((l) => `<button class="${l === lang ? 'active' : ''}" data-lang="${l}" aria-pressed="${l === lang}" title="${LANG_NAME[l]}" aria-label="${LANG_NAME[l]}">${FLAG[l]}</button>`).join('')}</div>
    </header>

    <nav class="neocom">
      ${([['Veles', 1], ['Svarog', 5], ['Perun', 8], ['Mokosh', 12], ['Morana', 16], ['Rod', 18]] as [string, number][]).map(([c, o]) => `<div class="clade-sep" style="--vy-order:${o}">${c}</div>`).join('')}
      ${VIEWS.map((v) => `<button class="neocom-btn ${MOBILE_MAIN.includes(v.id) ? 'nc-main' : ''} ${v.short === v.label ? 'tip-same' : ''}" data-view="${v.id}" aria-label="${v.label}" data-tip="${v.label}" data-tip-vy="${v.lore}" style="--vy-order:${v.order}">${icon(v.icon)}<span class="nc-label">${v.short}</span></button>`).join('')}
      <button class="neocom-btn neocom-more" id="neocomMore" aria-haspopup="true" aria-label="${tx('Mai mult')}">${icon('menu')}<span class="nc-label">${tx('Mai mult')}</span></button>
    </nav>
    <div class="neocom-sheet" id="neocomSheet" hidden>
      ${[...VIEWS].sort((a, b) => a.order - b.order).map((v) => `<button class="sheet-btn" data-view="${v.id}">${icon(v.icon)}<span>${lore(v.label, v.lore)}</span></button>`).join('')}
    </div>

    <aside class="sidebar">
      <div class="side-pane active" id="pane-items">
        <div class="sidebar-head">
          ${windowTitle(tx('Browser iteme'))}
          ${searchField({ id: 'treeFilter', placeholder: tx('Filtrează · click dreapta = Info') })}
        </div>
        <div class="sidebar-body" id="treeView"></div>
      </div>
      ${SIDE_VIEWS.map((id) => `<div class="side-pane" id="pane-${id}"></div>`).join('')}
      <div class="side-resizer" id="sideResizer" title="${tx('Trage ca să lărgești meniul · dublu click pentru lățimea inițială')}"></div>
    </aside>

    <div class="side-scrim" id="sideScrim"></div>

    <main class="main">
      <nav class="subnav" id="subnav" hidden></nav>
      ${VIEWS.map((v) => `<div class="view" id="view-${v.id}"></div>`).join('')}
    </main>
  </div>
`;

const viewEl = (id: ViewId) => document.getElementById('view-' + id)!;
const sidePane = (id: SideView) => document.getElementById('pane-' + id)!;
createAboutView(viewEl('about'));
const treeFilter = document.querySelector<HTMLInputElement>('#treeFilter')!;
initSelects();
initNumberSpin();
initSuggest();
initTooltips();
initDatePicker();
onStorageError(() => toast(tx('Spațiul de stocare al browserului e plin, ultima modificare nu s-a salvat. Șterge fit-uri vechi sau datele site-ului.')));

const market = createMarketView(viewEl('market'), {
  onType: (q) => { treeFilter.value = q; browser.filter(q); },
});

const intel = createIntelView(viewEl('intel'), null, {
  onOpen: (name, typeId) => { switchView('market'); market.show(name, typeId); },
});

market.setFees(() => intel.fees());

let fitting: FittingView | null = null;
let missions: MissionsView | null = null;
let doctrines: DoctrinesView | null = null;
for (const id of ['fitting', 'doctrines', 'character', 'tools', 'orders', 'skins', 'recon', 'navigation', 'pi', 'industry', 'mining', 'missions'] as const) viewEl(id).innerHTML = loader(tx('Încărcăm datele de fitting (SDE)'));

let activeView: ViewId = 'market';
let infoHandler: ((typeId: number) => void) | null = null;
let infoAvailable: ((typeId: number) => boolean) | null = null;
const browser = createItemBrowser(document.getElementById('treeView')!, {
  onSelect: (name, typeId) => {
    if (activeView === 'fitting') fitting?.selectItem(name, typeId);
    else { if (activeView !== 'market') switchView('market'); market.show(name, typeId); }
  },
  onInfo: (typeId) => infoHandler?.(typeId),
  hasInfo: (typeId) => !infoAvailable || infoAvailable(typeId),
  onScopeClear: () => fitting?.clearSlot(),
});
treeFilter.addEventListener('input', () => browser.filter(treeFilter.value));

const shell = document.querySelector<HTMLElement>('.shell')!;
const mobile = matchMedia('(max-width: 760px)');
const SIDEBAR_KEY = 'eve-fit:ui:sidebar-scale';
const rootStyle = document.documentElement.style;
const setSidebarScale = (scale: number) => {
  const v = Math.min(2, Math.max(1, scale || 1));
  rootStyle.setProperty('--sidebar-scale', v.toFixed(3));
  return v;
};
setSidebarScale(loadJson<number>(SIDEBAR_KEY, 1));
const resizer = document.getElementById('sideResizer')!;
resizer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  resizer.setPointerCapture(e.pointerId);
  const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-base')) || 320;
  const startX = e.clientX;
  const startW = (resizer.parentElement as HTMLElement).getBoundingClientRect().width;
  let scale = startW / base;
  shell.classList.add('resizing');
  const move = (ev: PointerEvent) => { scale = setSidebarScale((startW + ev.clientX - startX) / base); };
  const up = () => {
    shell.classList.remove('resizing');
    resizer.removeEventListener('pointermove', move);
    resizer.removeEventListener('pointerup', up);
    resizer.removeEventListener('pointercancel', up);
    saveJson(SIDEBAR_KEY, scale);
  };
  resizer.addEventListener('pointermove', move);
  resizer.addEventListener('pointerup', up);
  resizer.addEventListener('pointercancel', up);
});
resizer.addEventListener('dblclick', () => saveJson(SIDEBAR_KEY, setSidebarScale(1)));
const setSide = (open: boolean) => shell.classList.toggle('side-open', open && mobile.matches);
document.getElementById('sideToggle')!.addEventListener('click', () => setSide(!shell.classList.contains('side-open')));
document.getElementById('sideScrim')!.addEventListener('click', () => setSide(false));
document.querySelector('.sidebar')!.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.tree-item, .side-link, .tree-scope-clear')) setSide(false);
});
mobile.addEventListener('change', () => setSide(false));

document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement) e.target.style.visibility = 'hidden';
}, true);

const itemsReady = loadItems().then((items) => {
  browser.setData(items, marketGroups);
  market.itemsLoaded();
}).catch((err) => {
  document.getElementById('treeView')!.innerHTML = alertBox((err as Error).message);
  throw err;
});

const VIEW_KEY = 'eve-fit:ui:view';

const lazyMounts = new Map<ViewId, () => void>();
function runLazy(id: ViewId) {
  const fn = lazyMounts.get(id);
  if (!fn) return;
  lazyMounts.delete(id);
  fn();
}

const SHARE_HASH = /^#(fit|doctrine)=/;
const hashView = (): ViewId | null => {
  const id = location.hash.match(/^#\/([a-z]+)/)?.[1];
  return id && VIEWS.some((v) => v.id === id) ? id as ViewId : null;
};

function switchView(id: ViewId, push = true) {
  activeView = id;
  if (!SHARE_HASH.test(location.hash) && location.hash !== `#/${id}`) history[push ? 'pushState' : 'replaceState'](null, '', `${location.pathname}${location.search}#/${id}`);
  saveJson(VIEW_KEY, id);
  const v = VIEWS.find((x) => x.id === id)!;
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + id));
  const pane = (SIDE_VIEWS as readonly string[]).includes(id) ? id : 'items';
  document.querySelectorAll('.side-pane').forEach((el) => el.classList.toggle('active', el.id === 'pane-' + pane));
  document.querySelectorAll<HTMLElement>('.neocom-btn[data-view], .sheet-btn').forEach((el) => el.classList.toggle('active', el.dataset.view === id));
  document.getElementById('neocomMore')!.classList.toggle('active', !MOBILE_MAIN.includes(id));
  shell.classList.toggle('no-sidebar', id === 'about' || id === 'home');
  document.getElementById('neocomSheet')!.hidden = true;
  document.getElementById('topbarTitle')!.innerHTML = `${lore(tx('Modul activ'), `${v.clade} Clade`)} · <b>${lore(v.label, v.lore)}</b>`;
  browser.setCategories(v.categories);
  if (id !== 'fitting') { browser.setScope(null); fitting?.clearSlot(); }
  runLazy(id);
  if (id === 'missions') missions?.show();
  setSide(false);
  syncSubnav();
  trackView(id);
}

const subnav = document.getElementById('subnav')!;
let subLinks: HTMLElement[] = [];
function syncSubnav() {
  const pane = document.querySelector<HTMLElement>('.side-pane.active');
  subLinks = pane ? [...pane.querySelectorAll<HTMLElement>('.side-nav:not(.skill-tree) > .side-link')] : [];
  subnav.hidden = subLinks.length < 2;
  subnav.innerHTML = subLinks.map((l, i) => {
    const c = l.cloneNode(true) as HTMLElement;
    c.querySelectorAll('.count, .ord-count, img, svg').forEach((x) => x.remove());
    return `<button class="subnav-btn ${l.classList.contains('active') ? 'active' : ''}" data-sub="${i}">${esc(c.textContent?.trim() ?? '')}</button>`;
  }).join('');
  subnav.querySelector('.subnav-btn.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
subnav.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sub]');
  if (b) subLinks[Number(b.dataset.sub)]?.click();
});
const subObserver = new MutationObserver(() => syncSubnav());
document.querySelectorAll('.side-pane').forEach((p) => subObserver.observe(p, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }));

const home = createHomeView(viewEl('home'), {
  tiles: VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon })),
  go: (id) => switchView(id as ViewId),
  openFit: (f) => { switchView('fitting'); fitting?.load(f); },
  login: () => {
    if (!getSettings().clientId) { switchView('character'); toast(tx('Pune întâi Client ID-ul')); return; }
    startLogin().catch((err) => toast((err as Error).message));
  },
});
document.getElementById('brandHome')!.addEventListener('click', () => switchView('home'));
window.addEventListener('popstate', () => {
  const id = hashView();
  if (id && id !== activeView) switchView(id, false);
});

document.addEventListener('click', (e) => {
  const g = (e.target as HTMLElement).closest<HTMLElement>('[data-grant]');
  if (!g) return;
  if (!getSettings().clientId) { switchView('character'); toast(tx('Pune întâi Client ID-ul')); return; }
  closeModal();
  requestPermission(g.dataset.grant!.split(',') as PermId[], Number(g.dataset.grantChar) || null, activeView).catch((err) => toast((err as Error).message));
});

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-backup-dl]')) downloadBackup();
  else if (t.closest('[data-backup-up]')) pickBackup();
});

document.getElementById('neocomMore')!.addEventListener('click', (e) => {
  e.stopPropagation();
  const sheet = document.getElementById('neocomSheet')!;
  sheet.hidden = !sheet.hidden;
});
document.getElementById('neocomSheet')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sheet-btn[data-view]');
  if (btn) switchView(btn.dataset.view as ViewId);
});
document.addEventListener('click', (e) => {
  const sheet = document.getElementById('neocomSheet')!;
  if (!sheet.hidden && !sheet.contains(e.target as Node)) sheet.hidden = true;
});

document.querySelector('.neocom')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.neocom-btn[data-view]');
  if (btn && !btn.disabled) switchView(btn.dataset.view as ViewId);
});

document.querySelector('.theme-switch')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-theme-set]');
  if (!btn) return;
  setTheme(btn.dataset.themeSet as Theme);
  document.querySelectorAll<HTMLButtonElement>('[data-theme-set]').forEach((b) => {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
});

document.querySelector('.lang-switch:not(.theme-switch)')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-lang]');
  if (btn) setLang(btn.dataset.lang as Lang);
});

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName ?? '';
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
    e.preventDefault();
    if (activeView === 'market') market.focus(); else treeFilter.focus();
  }
  if (e.key === 'Escape') { closeModal(); closeCharMenu(); }
});

const charSwitch = document.getElementById('charSwitch')!;
const charMenu = document.getElementById('charMenu')!;
function closeCharMenu() {
  charMenu.hidden = true;
  charSwitch.classList.remove('open');
}
document.addEventListener('click', (e) => {
  if (!charSwitch.contains(e.target as Node)) closeCharMenu();
});

const clock = document.getElementById('eveClock')!;
const tick = () => { clock.textContent = new Date().toISOString().slice(11, 16); };
tick();
setInterval(tick, 10_000);

const online = document.getElementById('onlinePlayers')!;
const pollStatus = async () => {
  try {
    const res = await esiFetch('https://esi.evetech.net/latest/status/');
    if (!res.ok) throw new Error();
    const status = await res.json() as { players: number; vip?: boolean };
    online.textContent = status.vip ? 'VIP' : formatInt(status.players);
  } catch {
    online.textContent = '—';
  }
};
pollStatus();
setInterval(pollStatus, 60_000);

async function start() {
  let login: (TokenSet & { returnTo?: string }) | null = null;
  let loginError = '';
  try { login = await handleCallback(); } catch (err) { loginError = (err as Error).message; }
  const saved = loadJson<ViewId>(VIEW_KEY, 'home');
  const back = login?.returnTo && VIEWS.some((v) => v.id === login?.returnTo) ? login.returnTo as ViewId : null;
  switchView(back ?? (login || loginError ? 'character' : hashView() ?? (VIEWS.some((v) => v.id === saved) ? saved : 'home')), false);

  let sde: Sde;
  try {
    [sde] = await Promise.all([loadSde(), itemsReady]);
  } catch (err) {
    const msg = alertBox((err as Error).message);
    for (const id of ['fitting', 'doctrines', 'character', 'tools', 'orders', 'skins', 'recon', 'navigation', 'pi', 'industry', 'mining', 'missions'] as const) viewEl(id).innerHTML = panel({ body: msg });
    return;
  }
  const mount = (ids: ViewId[], fn: () => void) => {
    try {
      fn();
    } catch (err) {
      const msg = alertBox((err as Error).message);
      for (const id of ids) viewEl(id).innerHTML = panel({ body: msg });
    }
  };
  const later = (id: ViewId, ids: ViewId[], fn: () => void) => lazyMounts.set(id, () => mount(ids, fn));
  const ctx = new AppContext(sde);
  home.setContext(ctx);
  const topCharacter = document.getElementById('topCharacter')!;
  const avatar = document.getElementById('charAvatar')!;
  const portrait = (id?: number) => (id ? `<img src="${portraitUrl(id, 64)}" alt="" />` : `<span class="char-placeholder">${icon('character')}</span>`);
  const renderCharMenu = () => {
    const stored = loadStoredCharacters();
    const active = ctx.character;
    const anyLogged = stored.some((c) => c.characterId != null && hasTokens(c.characterId));
    charMenu.innerHTML = `${stored.map((c) => `<button class="char-menu-item ${c.id === active.id ? 'active' : ''}" data-switch="${esc(c.id)}">${portrait(c.characterId)}
        <span class="side-who"><span>${esc(c.name)}</span><small>${c.totalSp ? formatInt(c.totalSp) + ' SP' : tx('{n} skill-uri', { n: Object.keys(c.skills).length })}</small></span></button>`).join('')}
      ${['all5', 'all0'].map((id) => `<button class="char-menu-item ${active.id === id ? 'active' : ''}" data-switch="${id}">${portrait()}<span class="side-who"><span>${id === 'all5' ? tx('Toate la V') : tx('Toate la 0')}</span><small>${id === 'all5' ? tx('teoretic, toate skill-urile la nivel V') : tx('teoretic, fără niciun skill')}</small></span></button>`).join('')}
      <div class="char-menu-sep"></div>
      <button class="char-menu-item login" data-char-login>${icon('login')}<span>${anyLogged ? tx('Adaugă caracter') : tx('Login cu EVE')}</span></button>`;
  };
  const showCharacter = () => {
    topCharacter.textContent = ctx.character.name;
    avatar.innerHTML = portrait(ctx.character.characterId);
    renderCharMenu();
  };
  ctx.onCharacterChange(showCharacter);
  showCharacter();
  document.getElementById('charSwitchBtn')!.addEventListener('click', () => {
    renderCharMenu();
    charMenu.hidden = !charMenu.hidden;
    charSwitch.classList.toggle('open', !charMenu.hidden);
  });
  charMenu.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const sw = t.closest<HTMLElement>('[data-switch]');
    if (sw) { closeCharMenu(); ctx.setCharacter(sw.dataset.switch!); return; }
    if (t.closest('[data-char-login]')) {
      closeCharMenu();
      if (!getSettings().clientId) { switchView('character'); toast(tx('Pune întâi Client ID-ul')); return; }
      startLogin().catch((err) => toast((err as Error).message));
    }
  });
  window.addEventListener(SESSION_EXPIRED_EVENT, (e) => {
    const id = (e as CustomEvent<number>).detail;
    const c = loadStoredCharacters().find((x) => x.characterId === id);
    toast(tx('Sesiunea EVE pentru {name} a expirat sau a fost revocată. Fă din nou login din meniul de caractere.', { name: c?.name ?? String(id) }));
    ctx.reloadCharacters();
  });

  infoHandler = (typeId) => showItemInfo(ctx, typeId);
  infoAvailable = (typeId) => hasItemInfo(ctx.sde, typeId);
  market.setInfo(infoHandler, infoAvailable);
  mount(['fitting'], () => { fitting = createFittingView(viewEl('fitting'), ctx, (scope) => { browser.setScope(scope); if (scope) setSide(true); }); });
  let character: ReturnType<typeof createCharacterView> | null = null;
  mount(['character'], () => {
    viewEl('character').innerHTML = '<div id="charHead"></div><div class="char-layout"><div class="char-main"><div id="charTop" class="stack"></div><div id="charRoster"></div><div id="charSkills"></div></div><aside id="charAside" class="stack char-aside"></aside></div>';
    character = createCharacterView(document.getElementById('charTop')!, ctx, document.getElementById('charHead')!, document.getElementById('charAside')!);
    createSkillsView(document.getElementById('charSkills')!, ctx, sidePane('character'));
    createRosterView(document.getElementById('charRoster')!, ctx);
  });
  mount(['doctrines'], () => { doctrines = createDoctrinesView(viewEl('doctrines'), ctx, sidePane('doctrines'), { openFit: (f) => { switchView('fitting'); fitting?.load(f); }, currentFit: () => fitting?.current() ?? null }); });
  mount(['tools'], () => createToolsView(viewEl('tools'), ctx, sidePane('tools')));
  mount(['orders'], () => createOrdersView(viewEl('orders'), ctx, sidePane('orders'), { onOpen: (name, typeId) => { switchView('market'); market.show(name, typeId); } }));
  mount(['skins'], () => createSkinsView(viewEl('skins'), ctx, sidePane('skins')));
  mount(['recon'], () => createReconView(viewEl('recon'), ctx, sidePane('recon')));
  later('navigation', ['navigation'], () => createNavigationView(viewEl('navigation'), ctx, sidePane('navigation')));
  later('mining', ['mining'], () => createMiningView(viewEl('mining'), ctx, sidePane('mining')));
  later('industry', ['industry'], () => createIndustryView(viewEl('industry'), ctx, sidePane('industry')));
  later('pi', ['pi'], () => createPiView(viewEl('pi'), sidePane('pi')));
  later('missions', ['missions'], () => { missions = createMissionsView(viewEl('missions'), ctx, sidePane('missions'), { onTank: (site, faction) => { if (!fitting) return; switchView('fitting'); fitting.setNpc(site, faction); } }); if (activeView === 'missions') missions.show(); });
  intel.setContext(ctx);
  runLazy(activeView);
  const openShared = () => readSharedFit(sde).then((f) => {
    if (!f || !fitting) return;
    switchView('fitting');
    fitting.load(f);
    toast(tx('Fit deschis din link: {name}', { name: f.name }));
  }).catch(() => toast(tx('Linkul de fit nu e valid sau e incomplet.')));
  const openDoctrine = () => {
    if (!hasSharedDoctrine()) return;
    readSharedDoctrine(sde).then((d) => {
      if (!d || !doctrines) return;
      switchView('doctrines');
      return doctrines.importShared(d);
    }).catch(() => toast(tx('Linkul de doctrină nu e valid sau e incomplet.')));
  };
  openShared();
  openDoctrine();
  window.addEventListener('hashchange', () => { openShared(); openDoctrine(); });

  const view = character as ReturnType<typeof createCharacterView> | null;
  if (view && login) await view.imported(login.characterId, login.characterName);
  if (view && loginError) view.showError(loginError);
}

start();
startAlertWatcher();
itemsReady.then(startOrderWatcher).catch(() => {});

const refreshListed = () => fetchListedTypes().then((ids) => browser.setListed(ids)).catch(() => {  });
refreshListed();
setInterval(refreshListed, 60 * 60 * 1000);
