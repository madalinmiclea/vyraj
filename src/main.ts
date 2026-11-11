import './style.css';
import { marketGroups, loadItems } from './data/items';
import { loader, alertBox, panel, lore, toast, closeModal, confirmDialog } from './ui/components';
import { createItemBrowser } from './ui/sidebar';
import { createMarketView } from './views/market';
import { createFittingView, type FittingView } from './views/fitting';
import { createCharacterView } from './views/character';
import { createSkillsView } from './views/skills';
import { createRosterView } from './views/roster';
import { createWalletView } from './views/walletView';
import { createOrdersView } from './views/orders';
import type { NotificationsView } from './views/notifications';
import { startNearbyWatcher } from './services/nearbyKills';
import { createIntelView } from './views/intel';
import { createReconView } from './views/recon';
import { startVisitTracker } from './services/visited';
import { createSkinsView } from './views/skins';
import { createAboutView } from './views/about';
import { createHomeView } from './views/home';
import { createDoctrinesView, type DoctrinesView } from './views/doctrines';
import { readSharedDoctrine, hasSharedDoctrine } from './fitting/doctrines';
import { requestPermission, type PermId } from './character/permissions';
import { openPermissionsModal } from './character/loginModal';
import { showLogoutFlash } from './character/logout';
import type { CosmosView } from './views/cosmos';
import { startAlertWatcher } from './services/alerts';
import { startNotifyWatcher } from './services/notify';
import { startOrderWatcher } from './services/orders';
import { loadSde, type Sde } from './data/sde';
import { AppContext } from './app/context';
import type { ViewId } from './app/views';
import { hasSharedLink, linkView, migrateLegacyHash, pathSegment, sharedCode, viewHref } from './app/route';
import { handleCallback, hasTokens, getSettings, SESSION_EXPIRED_EVENT, SCOPES_CHANGED_EVENT, type TokenSet } from './character/sso';
import { loadStoredCharacters, upsertStoredCharacter } from './character/characters';
import { importCharacter } from './character/esi';
import { fetchListedTypes } from './services/market';
import { showItemInfo, hasItemInfo } from './ui/itemInfo';
import { loadJson, saveJson, onStorageError } from './storage';
import { tx, lang } from './i18n';
import { initSelects } from './ui/select';
import { initNumberSpin } from './ui/numberSpin';
import { initSuggest } from './ui/suggest';
import { initTooltips } from './ui/tooltip';
import { initDatePicker } from './ui/datepicker';
import { readSharedFit } from './io/shareLink';
import { resolveShortLink } from './io/shortLink';
import { downloadBackup, pickBackup } from './io/backup';
import { isDemo, startDemo, exitDemo } from './demo/demo';
import { registerServiceWorker } from './services/pwa';
import { MOBILE_MAIN, SIDE_VIEWS, SDE_VIEWS, VIEWS, mountShell, viewEl, sidePane } from './app/shell';
import { initSidePanel } from './app/sidePanel';
import { initSubnav } from './app/subnav';
import { initNeocom } from './app/neocom';
import { initSwitches, initStatus, initNotifyBadge } from './app/topbar';
import { createCharMenu } from './app/charMenu';

mountShell();

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
let cosmos: CosmosView | null = null;
let doctrines: DoctrinesView | null = null;
let notifications: NotificationsView | null = null;
for (const id of SDE_VIEWS) viewEl(id).innerHTML = loader(tx('Încărcăm datele de fitting (SDE)'));

let activeView: ViewId = 'market';
let infoHandler: ((typeId: number) => void) | null = null;
let infoAvailable: ((typeId: number) => boolean) | null = null;
const browser = createItemBrowser(document.getElementById('treeView')!, {
  onSelect: (name, typeId) => {
    if (activeView === 'fitting') fitting?.selectItem(name, typeId);
    else { if (activeView !== 'market') switchView('market'); market.show(name, typeId); }
  },
  onInfo: (typeId) => (infoHandler ? infoHandler(typeId) : toast(tx('Datele de fitting încă se încarcă'))),
  onScopeClear: () => fitting?.clearSlot(),
});
treeFilter.addEventListener('input', () => browser.filter(treeFilter.value));

const shell = document.querySelector<HTMLElement>('.shell')!;
const setSide = initSidePanel(shell);

document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement) e.target.style.visibility = 'hidden';
}, true);

const RELOAD_KEY = 'vyraj:chunk-reload';
const STALE_AFTER = 30 * 60 * 1000;
window.addEventListener('vite:preloadError', (e) => {
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { return; }
  if (Date.now() - last < 30_000) return;
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { return; }
  e.preventDefault();
  location.reload();
});

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

const VIEW_ALIAS: Record<string, ViewId> = { tools: 'wallet' };
const asView = (raw: string | null): ViewId | null => {
  const id = raw ? VIEW_ALIAS[raw] ?? raw : raw;
  return id && VIEWS.some((v) => v.id === id) ? id as ViewId : null;
};
migrateLegacyHash();
const pathView = (): ViewId | null => asView(pathSegment());

function switchView(id: ViewId, push = true) {
  activeView = id;
  const target = viewHref(id);
  const onTarget = location.pathname === target || (id !== 'home' && location.pathname.startsWith(`${target}/`));
  if (!hasSharedLink() && (!onTarget || location.search || location.hash)) history[push ? 'pushState' : 'replaceState'](null, '', target);
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
  document.title = id === 'home' ? (lang === 'ro' ? 'Vyraj · unelte pentru EVE Online' : 'Vyraj · tools for EVE Online') : `${v.label} · Vyraj`;
  browser.setCategories(v.categories);
  if (id !== 'fitting') { browser.setScope(null); fitting?.clearSlot(); }
  runLazy(id);
  if (id === 'cosmos') cosmos?.show(); else cosmos?.hide();
  document.querySelector('.main')?.scrollTo({ top: 0 });
  if (id === 'notifications') notifications?.show('history');
  setSide(false);
  syncSubnav();
}

const syncSubnav = initSubnav();

const openLogin = (characterId: number | null = null) => {
  if (!getSettings().clientId) { switchView('character'); toast(tx('Pune întâi Client ID-ul')); return; }
  openPermissionsModal(characterId, activeView);
};

const home = createHomeView(viewEl('home'), {
  tiles: VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon })),
  go: (id) => switchView(id as ViewId),
  openFit: (f) => { switchView('fitting'); fitting?.load(f); },
  login: () => openLogin(),
});
async function hardRefresh() {
  const base = import.meta.env.BASE_URL;
  await Promise.allSettled([
    navigator.serviceWorker?.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister()))),
    'caches' in window ? caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))) : null,
    fetch(location.pathname, { cache: 'reload' }),
    fetch(`${base}index.html`, { cache: 'reload' }),
    fetch(`${base}data/manifest.json`, { cache: 'reload' }),
  ]);
  saveJson(VIEW_KEY, 'home');
  history.replaceState(null, '', viewHref('home'));
  location.reload();
}
document.getElementById('brandHome')!.addEventListener('click', () => { hardRefresh(); });
window.addEventListener('popstate', () => {
  if (migrateLegacyHash() && hasSharedLink()) return;
  const id = location.pathname === viewHref('home') ? 'home' : pathView();
  if (id && id !== activeView) switchView(id, false);
});

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
  const id = asView(linkView(a.getAttribute('href')!));
  if (!id) return;
  e.preventDefault();
  if (id !== activeView) switchView(id);
});

document.addEventListener('click', (e) => {
  const g = (e.target as HTMLElement).closest<HTMLElement>('[data-grant]');
  if (!g) return;
  if (!getSettings().clientId) { switchView('character'); toast(tx('Pune întâi Client ID-ul')); return; }
  closeModal();
  requestPermission(g.dataset.grant!.split(',') as PermId[], Number(g.dataset.grantChar) || null, activeView).catch((err) => toast((err as Error).message));
});

let demoBusy = false;
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-demo-start]') && !demoBusy) {
    demoBusy = true;
    toast(tx('Pregătesc pilotul demo...'));
    startDemo().then(() => { saveJson(VIEW_KEY, 'home'); history.replaceState(null, '', viewHref('home')); location.reload(); }).catch((err) => { demoBusy = false; toast((err as Error).message); });
    return;
  }
  if (t.closest('[data-demo-exit]')) {
    confirmDialog(tx('Ieși din demo? Fiturile și tot ce ai schimbat în demo se pierd.'), { ok: tx('Ieși din demo'), danger: true }).then((ok) => {
      if (!ok) return;
      exitDemo();
      saveJson(VIEW_KEY, 'home');
      history.replaceState(null, '', viewHref('home'));
      location.reload();
    });
    return;
  }
  if (t.closest('[data-skip-main]')) {
    e.preventDefault();
    const target = document.querySelector<HTMLElement>('.view.active h1') ?? document.getElementById('mainContent');
    if (target && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target?.focus();
    return;
  }
  if (t.closest('[data-login-open]')) { openLogin(); return; }
  if (t.closest('[data-backup-dl]')) downloadBackup();
  else if (t.closest('[data-backup-up]')) pickBackup();
});

initNeocom(switchView);
initSwitches();

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName ?? '';
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
    e.preventDefault();
    if (activeView === 'market') market.focus(); else treeFilter.focus();
  }
  if (e.key === 'Escape') { closeModal(); charMenu.close(); }
});

const charMenu = createCharMenu(openLogin);
initStatus();

async function start() {
  let login: (TokenSet & { returnTo?: string; wanted?: number }) | null = null;
  let loginError = '';
  try { login = await handleCallback(); } catch (err) { loginError = (err as Error).message; }
  const stored = loadJson<string>(VIEW_KEY, 'home');
  const saved = (VIEW_ALIAS[stored] ?? stored) as ViewId;
  const back = login?.returnTo && VIEWS.some((v) => v.id === login?.returnTo) ? login.returnTo as ViewId : null;
  const seg = pathSegment();
  const unknownRoute = !!seg && seg !== 'callback' && !pathView();
  switchView(back ?? (login || loginError ? 'character' : unknownRoute ? 'home' : pathView() ?? (VIEWS.some((v) => v.id === saved) ? saved : 'home')), false);

  let sde: Sde;
  try {
    [sde] = await Promise.all([loadSde(), itemsReady]);
  } catch (err) {
    const msg = alertBox((err as Error).message);
    for (const id of SDE_VIEWS) viewEl(id).innerHTML = panel({ body: msg });
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
  const later = <M>(id: ViewId, load: () => Promise<M>, fn: (m: M) => void) => lazyMounts.set(id, () => {
    load().then((m) => mount([id], () => fn(m)), (err) => { viewEl(id).innerHTML = panel({ body: alertBox((err as Error).message) }); });
  });
  const ctx = new AppContext(sde);
  home.setContext(ctx);
  charMenu.attach(ctx);
  showLogoutFlash();
  window.addEventListener(SESSION_EXPIRED_EVENT, (e) => {
    const id = (e as CustomEvent<number>).detail;
    const c = loadStoredCharacters().find((x) => x.characterId === id);
    toast(tx('Sesiunea EVE pentru {name} a expirat sau a fost revocată. Fă din nou login din meniul de caractere.', { name: c?.name ?? String(id) }));
    ctx.reloadCharacters();
  });
  window.addEventListener(SCOPES_CHANGED_EVENT, () => ctx.reloadCharacters());

  infoHandler = (typeId) => showItemInfo(ctx, typeId);
  infoAvailable = (typeId) => hasItemInfo(ctx.sde, typeId);
  market.setInfo(infoHandler, infoAvailable);
  mount(['fitting'], () => { fitting = createFittingView(viewEl('fitting'), ctx, (scope) => { browser.setScope(scope); if (scope) setSide(true); }); });
  let character: ReturnType<typeof createCharacterView> | null = null;
  mount(['character'], () => {
    viewEl('character').innerHTML = '<div id="charHead"></div><div id="charProfile" class="char-pane stack"></div><div id="charTree" class="char-pane"></div><div id="charPlan" class="char-pane stack"><div id="charQueue"></div><div id="charSkills"></div></div><div id="charReq" class="char-pane stack"></div><div id="charRoster" class="char-pane"></div><div id="charSettings" class="char-pane stack"></div>';
    const byId = (id: string) => document.getElementById(id)!;
    character = createCharacterView(byId('charProfile'), ctx, byId('charHead'), byId('charSettings'), { side: sidePane('character'), queue: byId('charQueue'), panes: { profile: byId('charProfile'), skills: byId('charTree'), plan: byId('charPlan'), req: byId('charReq'), roster: byId('charRoster'), settings: byId('charSettings') } });
    createSkillsView(byId('charSkills'), ctx, byId('charTree'), byId('charReq'));
    createRosterView(byId('charRoster'), ctx);
  });
  mount(['doctrines'], () => { doctrines = createDoctrinesView(viewEl('doctrines'), ctx, sidePane('doctrines'), { openFit: (f) => { switchView('fitting'); fitting?.load(f); }, currentFit: () => fitting?.current() ?? null }); });
  mount(['wallet'], () => createWalletView(viewEl('wallet'), ctx, sidePane('wallet')));
  mount(['orders'], () => createOrdersView(viewEl('orders'), ctx, sidePane('orders'), { onOpen: (name, typeId) => { switchView('market'); market.show(name, typeId); } }));
  mount(['skins'], () => createSkinsView(viewEl('skins'), ctx, sidePane('skins')));
  mount(['recon'], () => createReconView(viewEl('recon'), ctx, sidePane('recon')));
  later('navigation', () => import('./views/navigation'), (m) => m.createNavigationView(viewEl('navigation'), ctx, sidePane('navigation'), { openFit: (f) => { switchView('fitting'); fitting?.load(f); } }));
  later('mining', () => import('./views/mining'), (m) => m.createMiningView(viewEl('mining'), ctx, sidePane('mining')));
  later('industry', () => import('./views/industry'), (m) => m.createIndustryView(viewEl('industry'), ctx, sidePane('industry')));
  later('pi', () => import('./views/pi'), (m) => m.createPiView(viewEl('pi'), sidePane('pi')));
  later('mail', () => import('./views/mail'), (m) => m.createMailView(viewEl('mail'), ctx, sidePane('mail')));
  later('notifications', () => import('./views/notifications'), (m) => { notifications = m.createNotificationsView(viewEl('notifications'), ctx, sidePane('notifications')); });
  later('operations', () => import('./views/operations'), (m) => m.createOperationsView(viewEl('operations'), ctx, sidePane('operations'), { onTank: (site, faction) => { if (!fitting) return; switchView('fitting'); fitting.setNpc(site, faction); }, openDoctrine: (q) => { if (!doctrines?.openMatching(q)) return false; switchView('doctrines'); return true; } }));
  later('cosmos', () => import('./views/cosmos'), (m) => { cosmos = m.createCosmosView(viewEl('cosmos'), ctx, sidePane('cosmos')); if (activeView === 'cosmos') cosmos.show(); });
  later('missions', () => import('./views/missions'), (m) => { m.createMissionsView(viewEl('missions'), ctx, sidePane('missions'), { onTank: (site, faction) => { if (!fitting) return; switchView('fitting'); fitting.setNpc(site, faction); }, openFit: (f) => { switchView('fitting'); fitting?.load(f); } }); });
  intel.setContext(ctx);
  runLazy(activeView);
  const openShared = () => readSharedFit(sde).then((f) => {
    if (!f || !fitting) return;
    switchView('fitting');
    return fitting.loadIncoming(f).then((ok) => { if (ok) toast(tx('Fit deschis din link: {name}', { name: f.name })); });
  }).catch(() => toast(tx('Linkul de fit nu e valid sau e incomplet.')));
  const openDoctrine = () => {
    if (!hasSharedDoctrine()) return;
    readSharedDoctrine(sde).then((d) => {
      if (!d || !doctrines) return;
      switchView('doctrines');
      return doctrines.importShared(d);
    }).catch(() => toast(tx('Linkul de doctrină nu e valid sau e incomplet.')));
  };
  const openBuild = () => { if (sharedCode('build') && activeView !== 'industry') switchView('industry'); };
  resolveShortLink().catch(() => toast(tx('Linkul scurt nu mai există sau nu e valid.'))).finally(() => {
    openShared();
    openDoctrine();
    openBuild();
  });
  window.addEventListener('hashchange', () => { migrateLegacyHash(); openShared(); openDoctrine(); openBuild(); });

  const view = character as ReturnType<typeof createCharacterView> | null;
  if (view && login) await view.imported(login.characterId, login.characterName);
  if (login?.wanted && login.wanted !== login.characterId) {
    const want = loadStoredCharacters().find((c) => c.characterId === login.wanted)?.name ?? String(login.wanted);
    toast(tx('Ai aprobat pentru {got}, nu pentru {want}. Repetă și alege {want} pe pagina EVE.', { got: login.characterName, want }));
  }
  if (view && loginError) view.showError(loginError);
  if (!isDemo()) refreshStale(ctx, login?.characterId);
}

async function refreshStale(ctx: AppContext, skip?: number) {
  const stale = loadStoredCharacters().filter((c) => c.kind === 'esi' && c.characterId && c.characterId !== skip && hasTokens(c.characterId)
    && Date.now() - (Date.parse(c.updated ?? '') || 0) > STALE_AFTER);
  let changed = false;
  for (const c of stale) {
    try {
      upsertStoredCharacter({ ...(await importCharacter(c.characterId!, c.name)), id: c.id });
      changed = true;
    } catch { }
  }
  if (changed) ctx.reloadCharacters();
}

start();
registerServiceWorker();
startAlertWatcher();
startNotifyWatcher();
startNearbyWatcher();
startVisitTracker();
itemsReady.then(startOrderWatcher).catch(() => {});

const refreshListed = () => fetchListedTypes().then((ids) => browser.setListed(ids)).catch(() => {  });
refreshListed();
setInterval(refreshListed, 60 * 60 * 1000);

initNotifyBadge();
