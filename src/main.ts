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
import { startAlertWatcher } from './services/alerts';
import { startOrderWatcher } from './services/orders';
import { loadSde, type Sde } from './data/sde';
import { AppContext } from './app/context';
import { handleCallback, hasTokens, startLogin, getSettings, SESSION_EXPIRED_EVENT, type TokenSet } from './character/sso';
import { loadStoredCharacters } from './character/characters';
import { portraitUrl } from './character/esi';
import { fetchListedTypes } from './services/market';
import { showItemInfo } from './ui/itemInfo';
import { loadJson, saveJson, onStorageError } from './storage';
import { tx, lang, setLang, type Lang } from './i18n';
import { theme, setTheme, type Theme } from './theme';
import { initSelects } from './ui/select';
import { readSharedFit } from './io/shareLink';

type ViewId = 'orders' | 'market' | 'intel' | 'recon' | 'navigation' | 'fitting' | 'character' | 'tools' | 'skins' | 'pi' | 'industry' | 'mining';

const MOBILE_MAIN: string[] = ['market', 'fitting', 'tools', 'character'];
const SIDE_VIEWS = ['character', 'tools', 'orders', 'skins', 'recon', 'navigation', 'pi', 'industry', 'mining'] as const;
type SideView = (typeof SIDE_VIEWS)[number];

const VIEWS: { id: ViewId; label: string; icon: string; categories: string[] | null; lore: string; clade: string; order: number }[] = [
  { id: 'market', label: 'Market', icon: 'market', categories: null, lore: 'Conduit', clade: 'Veles', order: 2 },
  { id: 'intel', label: tx('Intel Jita'), icon: 'intel', categories: null, lore: 'Discourse', clade: 'Veles', order: 3 },
  { id: 'recon', label: tx('Intel PvP'), icon: 'recon', categories: null, lore: 'Cladistic Recon', clade: 'Perun', order: 10 },
  { id: 'navigation', label: tx('Navigație'), icon: 'jump', categories: null, lore: 'Krai Passage', clade: 'Perun', order: 11 },
  { id: 'fitting', label: 'Fitting', icon: 'fitting', categories: FITTING_CATEGORIES, lore: 'Proving', clade: 'Svarog', order: 6 },
  { id: 'character', label: tx('Caracter'), icon: 'character', categories: null, lore: 'Narodnya', clade: 'Perun', order: 9 },
  { id: 'industry', label: tx('Industrie'), icon: 'industry', categories: null, lore: 'Matterweave', clade: 'Mokosh', order: 14 },
  { id: 'tools', label: tx('Unelte ISK'), icon: 'isk', categories: null, lore: 'Tithe', clade: 'Veles', order: 4 },
  { id: 'mining', label: tx('Mining'), icon: 'mining', categories: null, lore: 'Rudnik', clade: 'Mokosh', order: 13 },
  { id: 'orders', label: tx('Ordine market'), icon: 'orders', categories: null, lore: 'Torg', clade: 'Veles', order: 4 },
  { id: 'skins', label: tx('SKIN-uri'), icon: 'skin', categories: null, lore: 'Raiment', clade: 'Svarog', order: 7 },
  { id: 'pi', label: 'Planetary Interaction', icon: 'planet', categories: null, lore: 'Rootweave', clade: 'Mokosh', order: 15 },
];

document.querySelector('#app')!.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <button class="side-toggle" id="sideToggle" aria-label="${tx('Meniu')}">${icon('menu')}</button>
      <div class="brand">${logo}<span>Vyraj</span></div>
      <div class="topbar-title" id="topbarTitle"></div>
      <div class="topbar-spacer"></div>
      <div class="topbar-stat optional"><span class="label">${tx('Iteme')}</span><span class="value" id="itemCount">—</span></div>
      <div class="topbar-stat"><span class="label">EVE Time</span><span class="value" id="eveClock">--:--</span></div>
      <div class="char-switch" id="charSwitch">
        <button class="char-switch-btn" id="charSwitchBtn" aria-haspopup="true"><span class="char-switch-avatar" id="charAvatar"></span><span class="topbar-stat"><span class="label">${tx('Caracter')}</span><span class="value accent" id="topCharacter">—</span></span>${icon('chevron', 'chev')}</button>
        <div class="char-menu" id="charMenu" hidden></div>
      </div>
      <div class="lang-switch theme-switch" role="group" aria-label="${tx('Temă')}">${([['light', 'sun', 'Light'], ['dark', 'moon', 'Dark'], ['vyraj', 'trinity', 'Vyraj']] as [Theme, string, string][]).map(([t, ic, label]) => `<button class="${t === theme ? 'active' : ''}" data-theme-set="${t}" aria-pressed="${t === theme}" data-tip="${label}" aria-label="${label}">${icon(ic)}</button>`).join('')}</div>
      <div class="lang-switch" role="group" aria-label="${tx('Limbă')}">${(['ro', 'en'] as Lang[]).map((l) => `<button class="${l === lang ? 'active' : ''}" data-lang="${l}" aria-pressed="${l === lang}">${l.toUpperCase()}</button>`).join('')}</div>
    </header>

    <nav class="neocom">
      ${([['Veles', 1], ['Svarog', 5], ['Perun', 8], ['Mokosh', 12]] as [string, number][]).map(([c, o]) => `<div class="clade-sep" style="--vy-order:${o}">${c}</div>`).join('')}
      ${VIEWS.map((v) => `<button class="neocom-btn ${MOBILE_MAIN.includes(v.id) ? 'nc-main' : ''}" data-view="${v.id}" data-tip="${v.label}" data-tip-vy="${v.lore}" style="--vy-order:${v.order}">${icon(v.icon)}</button>`).join('')}
      <button class="neocom-btn neocom-more" id="neocomMore" aria-haspopup="true" aria-label="${tx('Mai mult')}">${icon('menu')}</button>
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
      ${VIEWS.map((v) => `<div class="view" id="view-${v.id}"></div>`).join('')}
    </main>
  </div>
`;

const viewEl = (id: ViewId) => document.getElementById('view-' + id)!;
const sidePane = (id: SideView) => document.getElementById('pane-' + id)!;
const treeFilter = document.querySelector<HTMLInputElement>('#treeFilter')!;
initSelects();
onStorageError(() => toast(tx('Spațiul de stocare al browserului e plin, ultima modificare nu s-a salvat. Șterge fit-uri vechi sau datele site-ului.')));

const market = createMarketView(viewEl('market'), {
  onType: (q) => { treeFilter.value = q; browser.filter(q); },
});

const intel = createIntelView(viewEl('intel'), null, {
  onOpen: (name, typeId) => { switchView('market'); market.show(name, typeId); },
});

market.setFees(() => intel.fees());

let fitting: FittingView | null = null;
for (const id of ['fitting', 'character', 'tools', 'orders', 'skins', 'recon', 'navigation', 'pi', 'industry', 'mining'] as const) viewEl(id).innerHTML = loader(tx('Încărcăm datele de fitting (SDE)'));

let activeView: ViewId = 'market';
let infoHandler: ((typeId: number) => void) | null = null;
const browser = createItemBrowser(document.getElementById('treeView')!, {
  onSelect: (name, typeId) => {
    if (activeView === 'fitting') fitting?.selectItem(name, typeId);
    else { if (activeView !== 'market') switchView('market'); market.show(name, typeId); }
  },
  onInfo: (typeId) => infoHandler?.(typeId),
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
  document.getElementById('itemCount')!.textContent = formatInt(items.length);
}).catch((err) => {
  document.getElementById('treeView')!.innerHTML = alertBox((err as Error).message);
  throw err;
});

const VIEW_KEY = 'eve-fit:ui:view';

function switchView(id: ViewId) {
  activeView = id;
  saveJson(VIEW_KEY, id);
  const v = VIEWS.find((x) => x.id === id)!;
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + id));
  const pane = (SIDE_VIEWS as readonly string[]).includes(id) ? id : 'items';
  document.querySelectorAll('.side-pane').forEach((el) => el.classList.toggle('active', el.id === 'pane-' + pane));
  document.querySelectorAll<HTMLElement>('.neocom-btn[data-view], .sheet-btn').forEach((el) => el.classList.toggle('active', el.dataset.view === id));
  document.getElementById('neocomMore')!.classList.toggle('active', !MOBILE_MAIN.includes(id));
  document.getElementById('neocomSheet')!.hidden = true;
  document.getElementById('topbarTitle')!.innerHTML = `${lore(tx('Modul activ'), `${v.clade} Clade`)} · <b>${lore(v.label, v.lore)}</b>`;
  browser.setCategories(v.categories);
  if (id !== 'fitting') { browser.setScope(null); fitting?.clearSlot(); }
  setSide(false);
}

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

async function start() {
  let login: TokenSet | null = null;
  let loginError = '';
  try { login = await handleCallback(); } catch (err) { loginError = (err as Error).message; }
  const saved = loadJson<ViewId>(VIEW_KEY, 'market');
  switchView(login || loginError ? 'character' : VIEWS.some((v) => v.id === saved) ? saved : 'market');

  let sde: Sde;
  try {
    [sde] = await Promise.all([loadSde(), itemsReady]);
  } catch (err) {
    const msg = alertBox((err as Error).message);
    for (const id of ['fitting', 'character', 'tools', 'orders', 'skins', 'recon', 'navigation', 'pi', 'industry', 'mining'] as const) viewEl(id).innerHTML = panel({ body: msg });
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
  const ctx = new AppContext(sde);
  const topCharacter = document.getElementById('topCharacter')!;
  const avatar = document.getElementById('charAvatar')!;
  const portrait = (id?: number) => (id ? `<img src="${portraitUrl(id, 64)}" alt="" />` : '<span class="char-placeholder"></span>');
  const renderCharMenu = () => {
    const stored = loadStoredCharacters();
    const active = ctx.character;
    const anyLogged = stored.some((c) => c.characterId != null && hasTokens(c.characterId));
    charMenu.innerHTML = `${stored.map((c) => `<button class="char-menu-item ${c.id === active.id ? 'active' : ''}" data-switch="${esc(c.id)}">${portrait(c.characterId)}
        <span class="side-who"><span>${esc(c.name)}</span><small>${c.totalSp ? formatInt(c.totalSp) + ' SP' : tx('{n} skill-uri', { n: Object.keys(c.skills).length })}</small></span></button>`).join('')}
      ${['all5', 'all0'].map((id) => `<button class="char-menu-item ${active.id === id ? 'active' : ''}" data-switch="${id}">${portrait()}<span class="side-who"><span>${id === 'all5' ? 'All 5' : 'All 0'}</span><small>${tx('caracter teoretic')}</small></span></button>`).join('')}
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
  market.setInfo(infoHandler);
  mount(['fitting'], () => { fitting = createFittingView(viewEl('fitting'), ctx, (scope) => { browser.setScope(scope); if (scope) setSide(true); }); });
  let character: ReturnType<typeof createCharacterView> | null = null;
  mount(['character'], () => {
    viewEl('character').innerHTML = '<div id="charHead"></div><div class="char-layout"><div class="char-main"><div id="charTop" class="stack"></div><div id="charRoster"></div><div id="charSkills"></div></div><aside id="charAside" class="stack char-aside"></aside></div>';
    character = createCharacterView(document.getElementById('charTop')!, ctx, document.getElementById('charHead')!, document.getElementById('charAside')!);
    createSkillsView(document.getElementById('charSkills')!, ctx, sidePane('character'));
    createRosterView(document.getElementById('charRoster')!, ctx);
  });
  mount(['tools'], () => createToolsView(viewEl('tools'), ctx, sidePane('tools')));
  mount(['orders'], () => createOrdersView(viewEl('orders'), ctx, sidePane('orders'), { onOpen: (name, typeId) => { switchView('market'); market.show(name, typeId); } }));
  mount(['skins'], () => createSkinsView(viewEl('skins'), ctx, sidePane('skins')));
  mount(['recon'], () => createReconView(viewEl('recon'), ctx, sidePane('recon')));
  mount(['navigation'], () => createNavigationView(viewEl('navigation'), ctx, sidePane('navigation')));
  mount(['mining'], () => createMiningView(viewEl('mining'), ctx, sidePane('mining')));
  mount(['industry'], () => createIndustryView(viewEl('industry'), ctx, sidePane('industry')));
  mount(['pi'], () => createPiView(viewEl('pi'), sidePane('pi')));
  intel.setContext(ctx);
  const openShared = () => readSharedFit(sde).then((f) => {
    if (!f || !fitting) return;
    switchView('fitting');
    fitting.load(f);
    toast(tx('Fit deschis din link: {name}', { name: f.name }));
  }).catch(() => toast(tx('Linkul de fit nu e valid sau e incomplet.')));
  openShared();
  window.addEventListener('hashchange', openShared);

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
