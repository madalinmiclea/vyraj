import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, emptyState, esc, formatInt, compactISK, searchField, toast, openModal, closeModal, copyText, windowTitle } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { typeIconUrl, fetchListedTypes, fetchPrices } from '../services/market';
import { loadSkins, loadOwned, saveOwned, skinKey, applyExtras, applySync, lastSync, importList, migrateOwned, type SkinLine, type ShipRef } from '../services/skins';
import { Category } from '../data/sde';
import { showItemInfo } from '../ui/itemInfo';
import { listAssets, walletTransactions } from '../character/esi';
import { hasTokens, hasScope } from '../character/sso';
import { tx, locale } from '../i18n';

type Filter = 'all' | 'started' | 'complete' | 'missing';
type Sort = 'name' | 'progress' | 'size';
type Mode = 'all' | 'mine' | 'shop';
type ShopOrder = 'cheap' | 'expensive';

interface ShopRow {
  line: SkinLine;
  ship: SkinLine['ships'][number];
  license: number;
  price: number;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: tx('Toate') },
  { id: 'started', label: tx('Începute') },
  { id: 'complete', label: tx('Complete') },
  { id: 'missing', label: tx('Neîncepute') },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: 'name', label: tx('Nume') },
  { id: 'progress', label: tx('Progres') },
  { id: 'size', label: tx('Nr. nave') },
];

const PREFS_KEY = 'eve-skins:prefs';
const SHOP_LIMIT = 400;
const EXPENSIVE_LIMIT = 100;

export function createSkinsView(el: HTMLElement, ctx: AppContext, side: HTMLElement) {
  const prefs = loadJson<{ filter: Filter; sort: Sort; mode?: string; shopOrder?: ShopOrder }>(PREFS_KEY, { filter: 'all', sort: 'name' });
  let filter = prefs.filter;
  let sort = prefs.sort;
  let mode: Mode = prefs.mode === 'shop' || prefs.mode === 'mine' ? prefs.mode : 'all';
  let shopOrder: ShopOrder = prefs.shopOrder ?? 'cheap';
  let shopToken = 0;
  let query = '';
  let open: string | null = null;
  let syncing = false;
  let lines: SkinLine[] = [];
  let owned = loadOwned(ctx.character.id);
  const shipRefs = new Map<number, ShipRef>(ctx.sde.typesInCategory(Category.Ship).map((t) => [t.id, { id: t.id, name: t.name, group: t.groupName }]));
  const swatch = (l: SkinLine, cls = '') => {
    const c = (l.colors ?? []).filter(Boolean) as string[];
    if (!c.length) return `<span class="skin-swatch ship ${cls}"><img src="${typeIconUrl(l.ships[0]?.id ?? 0, 64)}" alt="" loading="lazy" /></span>`;
    const [hull, primary = hull, secondary = primary, glow = secondary] = c;
    return `<span class="skin-swatch ${cls}" style="--hull:${hull};--primary:${primary};--secondary:${secondary};--glow:${glow}"></span>`;
  };

  el.innerHTML = loader(tx('Încărcăm SKIN-urile'));

  const count = (l: SkinLine) => l.ships.reduce((a, s) => a + (owned.has(skinKey(l.name, s.id)) ? 1 : 0), 0);
  const savePrefs = () => saveJson(PREFS_KEY, { filter, sort, mode, shopOrder });

  function shell() {
    el.innerHTML = `<div id="skinHead"></div>
      <div class="skin-toolbar">
        ${searchField({ id: 'skinSearch', placeholder: tx('Caută SKIN sau navă') })}
        <div class="advice-sort" id="skinFilters"></div>
        <div class="advice-sort" id="skinSorts"></div>
        <div class="skin-toolbar-actions" id="skinActions"></div>
      </div>
      <div id="skinBody"></div>`;
    const search = el.querySelector<HTMLInputElement>('#skinSearch')!;
    search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); renderBody(); });
    el.addEventListener('click', onClick);
    side.addEventListener('click', onClick);
  }

  function renderHead() {
    const total = lines.reduce((a, l) => a + l.ships.length, 0);
    const have = lines.reduce((a, l) => a + count(l), 0);
    const complete = lines.filter((l) => count(l) === l.ships.length).length;
    const started = lines.filter((l) => count(l) > 0).length;
    const title = mode === 'all' ? tx('SKIN-uri nave') : mode === 'mine' ? tx('Colecția mea') : tx('De cumpărat');
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('SKIN-uri'))}</div>
      <div class="side-nav">${([['all', tx('SKIN-uri nave'), formatInt(total)], ['mine', tx('Colecția mea'), formatInt(have)], ['shop', tx('De cumpărat'), '']] as [Mode, string, string][])
        .map(([id, label, n]) => `<button class="side-link ${mode === id ? 'active' : ''}" data-skin-mode="${id}"><span>${label}</span>${n ? `<span class="count">${n}</span>` : ''}</button>`).join('')}</div>`;
    el.querySelector('#skinHead')!.innerHTML = `${pageHead(title, ctx.character.name, 'Raiment')}
      ${mode === 'shop' ? '' : `<div class="history-kpis">
        <div><span class="label">${tx('SKIN-uri deținute')}</span><span class="value">${formatInt(have)} / ${formatInt(total)}</span></div>
        <div><span class="label">${tx('Colecții începute')}</span><span class="value">${formatInt(started)} / ${formatInt(lines.length)}</span></div>
        <div><span class="label">${tx('Colecții complete')}</span><span class="value">${formatInt(complete)}</span></div>
        <div><span class="label">${tx('Progres')}</span><span class="value">${total ? ((have / total) * 100).toFixed(1) : '0.0'}%</span></div>
      </div>`}`;
    el.querySelector<HTMLElement>('#skinFilters')!.style.display = mode === 'shop' ? 'none' : '';
    el.querySelector<HTMLElement>('#skinSorts')!.style.display = mode === 'shop' ? 'none' : '';
    el.querySelector('#skinFilters')!.innerHTML = FILTERS.filter((f) => mode !== 'mine' || f.id !== 'missing').map((f) => `<button class="chip-btn ${f.id === filter ? 'active' : ''}" data-skin-filter="${f.id}">${f.label}</button>`).join('');
    el.querySelector('#skinSorts')!.innerHTML = SORTS.map((s) => `<button class="chip-btn ${s.id === sort ? 'active' : ''}" data-skin-sort="${s.id}">${s.label}</button>`).join('');
    const c = ctx.character;
    const esi = c.kind === 'esi' && c.characterId && hasTokens(c.characterId) ? c.characterId : 0;
    const at = lastSync(c.id);
    const status = !esi ? ''
      : `<span class="skin-sync small dim">${icon('refresh')}${syncing ? tx('Sincronizez...') : at ? tx('Sincronizat {time}', { time: new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }) : tx('Nesincronizat')}</span>`;
    el.querySelector('#skinActions')!.innerHTML = mode !== 'mine' ? '' : `${status}<button class="btn sm" data-skin-list>${icon('upload')}${tx('Importă listă')}</button>`;
  }

  function visible(): SkinLine[] {
    const list = lines.filter((l) => {
      const n = count(l);
      if (mode === 'mine' && n === 0) return false;
      if (filter === 'started' && (n === 0 || n === l.ships.length)) return false;
      if (filter === 'complete' && n !== l.ships.length) return false;
      if (filter === 'missing' && mode !== 'mine' && n > 0) return false;
      if (!query) return true;
      return l.name.toLowerCase().includes(query) || l.ships.some((s) => s.name.toLowerCase().includes(query));
    });
    if (sort === 'progress') list.sort((a, b) => count(b) / b.ships.length - count(a) / a.ships.length || a.name.localeCompare(b.name));
    if (sort === 'size') list.sort((a, b) => b.ships.length - a.ships.length || a.name.localeCompare(b.name));
    return list;
  }

  function tile(l: SkinLine) {
    const n = count(l);
    const pct = (n / l.ships.length) * 100;
    const state = n === l.ships.length ? 'complete' : n > 0 ? 'started' : '';
    return `<button class="skin-tile ${state} ${open === l.name ? 'open' : ''}" data-skin-line="${esc(l.name)}">
      ${swatch(l)}
      <span class="skin-name">${esc(l.name)}</span>
      <span class="skin-count num">${n}/${l.ships.length}</span>
      <span class="skin-bar"><i style="width:${pct}%"></i></span>
    </button>`;
  }

  function detail(l: SkinLine) {
    const n = count(l);
    return `<div class="skin-detail">
      <div class="skin-detail-head">
        ${swatch(l, 'sm')}
        <div><h3>${esc(l.name)}</h3><span class="num dim">${n}/${l.ships.length}</span></div>
        <div class="skin-detail-actions">
          <button class="btn sm ghost" data-skin-all="1">${icon('check')}${tx('Toate')}</button>
          <button class="btn sm ghost" data-skin-all="0">${icon('close')}${tx('Niciuna')}</button>
          <button class="btn sm ghost icon-only" data-skin-close>${icon('close')}</button>
        </div>
      </div>
      <div class="skin-ships">${l.ships.map((s) => `<div class="skin-ship ${owned.has(skinKey(l.name, s.id)) ? 'owned' : ''}">
        <button class="skin-ship-info" data-skin-info="${s.id}"><img src="${typeIconUrl(s.id, 32)}" alt="" loading="lazy" /><span><b>${esc(s.name)}</b><small>${esc(s.group)}</small></span></button>
        <button class="skin-ship-check" data-skin-ship="${s.id}">${icon('check')}</button>
      </div>`).join('')}</div>
    </div>`;
  }


  function renderGrid() {
    const body = el.querySelector<HTMLElement>('#skinBody')!;
    const list = visible();
    if (!list.length) { body.innerHTML = panel({ body: emptyState({ title: tx('Nimic de afișat'), text: tx('Niciun SKIN nu se potrivește filtrului.'), vy: 'No Raiment Answers', vyText: 'No SKIN answers the current filter.' }) }); return; }
    body.innerHTML = `<div class="skin-grid">${list.map((l) => tile(l) + (open === l.name ? detail(l) : '')).join('')}</div>`;
  }

  function renderBody() {
    if (mode === 'shop') renderShop(); else renderGrid();
  }

  function render() {
    renderHead();
    renderBody();
  }

  async function renderShop() {
    const body = el.querySelector<HTMLElement>('#skinBody')!;
    const token = ++shopToken;
    const missing = lines.flatMap((line) => line.ships
      .filter((ship) => ship.licenses.length && !owned.has(skinKey(line.name, ship.id)))
      .map((ship) => ({ line, ship })))
      .filter(({ line, ship }) => !query || line.name.toLowerCase().includes(query) || ship.name.toLowerCase().includes(query));
    if (!missing.length) { body.innerHTML = panel({ body: emptyState({ title: tx('Nimic de cumpărat'), text: tx('Ai toate SKIN-urile din filtrul curent.'), vy: 'All Raiment Gathered', vyText: 'Every SKIN in the current filter is already yours.' }) }); return; }
    body.innerHTML = panel({ body: loader(tx('Citesc prețurile din Jita')) });
    try {
      const listed = await fetchListedTypes().catch(() => null);
      const ids = [...new Set(missing.flatMap((m) => m.ship.licenses))].filter((id) => !listed || listed.has(id));
      const prices = await fetchPrices(ids);
      if (token !== shopToken) return;
      const rows: ShopRow[] = [];
      let unpriced = 0;
      for (const m of missing) {
        let best: { license: number; price: number } | null = null;
        for (const id of m.ship.licenses) {
          const p = prices.get(id)?.sellMin ?? 0;
          if (p > 0 && (!best || p < best.price)) best = { license: id, price: p };
        }
        if (best) rows.push({ ...m, ...best }); else unpriced++;
      }
      rows.sort((a, b) => a.price - b.price || a.ship.name.localeCompare(b.ship.name));
      const total = rows.reduce((a, r) => a + r.price, 0);
      const cheapest = rows[0]?.price ?? 0;
      const limit = shopOrder === 'cheap' ? SHOP_LIMIT : EXPENSIVE_LIMIT;
      if (shopOrder === 'expensive') rows.reverse();
      let running = 0;
      const shown = rows.slice(0, limit);
      body.innerHTML = `${panel({
        body: `<div class="history-kpis">
          <div><span class="label">${tx('De cumpărat din Jita')}</span><span class="value">${formatInt(rows.length)}</span></div>
          <div><span class="label">${tx('Cost total')}</span><span class="value">${compactISK(total)}</span></div>
          <div><span class="label">${tx('Cel mai ieftin')}</span><span class="value">${rows.length ? compactISK(cheapest) : '—'}</span></div>
          <div><span class="label">${tx('Cel mai scump')}</span><span class="value">${rows.length ? compactISK(Math.max(...rows.map((x) => x.price))) : '—'}</span></div>
          <div><span class="label">${tx('Fără ordere în Jita')}</span><span class="value">${formatInt(unpriced)}</span></div>
        </div>`,
      })}
      ${panel({
        title: shopOrder === 'cheap' ? tx('Cele mai ieftine') : tx('Cele mai scumpe'),
        count: rows.length > limit ? `${limit} / ${formatInt(rows.length)}` : formatInt(rows.length),
        actions: `<div class="advice-sort"><button class="chip-btn ${shopOrder === 'cheap' ? 'active' : ''}" data-skin-order="cheap">${tx('Ieftine')}</button><button class="chip-btn ${shopOrder === 'expensive' ? 'active' : ''}" data-skin-order="expensive">${tx('Scumpe')}</button></div>`,
        body: `<table class="table compact skin-shop"><thead><tr><th class="r">#</th><th></th><th>${tx('Navă')}</th><th>SKIN</th><th class="r">${tx('Preț Jita')}</th><th class="r">${tx('Total cumulat')}</th><th></th></tr></thead><tbody>
          ${shown.map((r, i) => {
            running += r.price;
            return `<tr>
              <td class="r num dim">${i + 1}</td>
              <td>${swatch(r.line, 'xs')}</td>
              <td><button class="skin-link" data-skin-info="${r.ship.id}"><img class="row-icon" src="${typeIconUrl(r.ship.id, 32)}" alt="" loading="lazy" />${esc(r.ship.name)}</button></td>
              <td>${esc(r.line.name)}</td>
              <td class="r num">${compactISK(r.price)}</td>
              <td class="r num dim">${compactISK(running)}</td>
              <td class="r"><button class="btn sm ghost icon-only" data-skin-copy="${esc(`${r.ship.name} ${r.line.name} SKIN`)}">${icon('copy')}</button></td>
            </tr>`;
          }).join('')}
        </tbody></table>`,
      })}`;
    } catch (err) {
      if (token === shopToken) body.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  function persist() {
    saveOwned(ctx.character.id, owned);
    render();
  }

  async function sync() {
    const c = ctx.character;
    if (syncing || !lines.length || c.kind !== 'esi' || !c.characterId || !hasTokens(c.characterId)) return;
    const characterId = c.characterId;
    const id = c.id;
    syncing = true;
    if (el.querySelector('#skinHead')) renderHead();
    try {
      const [assets, transactions] = await Promise.all([
        hasScope(characterId, 'esi-assets.read_assets.v1') ? listAssets(characterId).catch(() => undefined) : undefined,
        hasScope(characterId, 'esi-wallet.read_character_wallet.v1') ? walletTransactions(characterId).catch(() => undefined) : undefined,
      ]);
      if (ctx.character.id !== id) return;
      const added = applySync(id, lines, owned, { assets, transactions });
      saveOwned(id, owned);
      if (added.length) toast(tx('{n} SKIN-uri noi în colecție', { n: added.length }));
    } finally {
      syncing = false;
      if (el.querySelector('#skinHead')) { renderHead(); if (mode !== 'shop') renderGrid(); }
    }
  }


  function openImport() {
    const modal = openModal(tx('Importă listă SKIN-uri'), `
      <p class="small dim">${tx('Câte o colecție pe rând: <code>Colecție: Navă, Navă, Navă</code>')}</p>
      <textarea class="input area" id="skinImportText" rows="14" spellcheck="false"></textarea>
      <div class="row-actions"><button class="btn sm" data-skin-import-run>${icon('check')}${tx('Importă')}</button></div>
      <div id="skinImportResult"></div>`, { wide: true });
    modal.querySelector('[data-skin-import-run]')!.addEventListener('click', () => {
      const text = modal.querySelector<HTMLTextAreaElement>('#skinImportText')!.value;
      const res = importList(text, lines, shipRefs, owned);
      saveOwned(ctx.character.id, owned);
      render();
      const summary = `${tx('{n} SKIN-uri adăugate, {m} erau deja bifate', { n: res.added, m: res.already })}${res.newShips ? `, ${tx('{n} nave noi adăugate în colecții', { n: res.newShips })}` : ''}.`;
      if (!res.unknown.length) { closeModal(); toast(summary); return; }
      modal.querySelector('#skinImportResult')!.innerHTML = `${alertBox(summary)}
        <p class="small dim">${tx('Nu am recunoscut:')}</p><ul class="small">${res.unknown.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>`;
    });
  }

  function onClick(e: Event) {
    const t = e.target as HTMLElement;
    const f = t.closest<HTMLElement>('[data-skin-filter]');
    if (f) { filter = f.dataset.skinFilter as Filter; savePrefs(); render(); return; }
    const s = t.closest<HTMLElement>('[data-skin-sort]');
    if (s) { sort = s.dataset.skinSort as Sort; savePrefs(); render(); return; }
    if (t.closest('[data-skin-list]')) { openImport(); return; }
    if (t.closest('[data-skin-close]')) { open = null; renderGrid(); return; }
    const m = t.closest<HTMLElement>('[data-skin-mode]');
    if (m) { mode = m.dataset.skinMode as Mode; open = null; savePrefs(); render(); el.closest('.main')?.scrollTo({ top: 0 }); return; }
    const info = t.closest<HTMLElement>('[data-skin-info]');
    if (info) { showItemInfo(ctx, Number(info.dataset.skinInfo)); return; }
    const so = t.closest<HTMLElement>('[data-skin-order]');
    if (so) { shopOrder = so.dataset.skinOrder as ShopOrder; savePrefs(); renderShop(); return; }
    const cp = t.closest<HTMLElement>('[data-skin-copy]');
    if (cp) { copyText(cp.dataset.skinCopy!, tx('Nume copiat, caută-l în market')); return; }
    const line = lines.find((l) => l.name === open);
    const ship = t.closest<HTMLElement>('[data-skin-ship]');
    if (ship && line) {
      const key = skinKey(line.name, Number(ship.dataset.skinShip));
      if (owned.has(key)) owned.delete(key); else owned.add(key);
      persist();
      return;
    }
    const all = t.closest<HTMLElement>('[data-skin-all]');
    if (all && line) {
      for (const sh of line.ships) {
        const key = skinKey(line.name, sh.id);
        if (all.dataset.skinAll === '1') owned.add(key); else owned.delete(key);
      }
      persist();
      return;
    }
    const tileEl = t.closest<HTMLElement>('[data-skin-line]');
    if (tileEl) {
      open = open === tileEl.dataset.skinLine ? null : tileEl.dataset.skinLine!;
      renderGrid();
      if (open) el.querySelector('.skin-tile.open')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  ctx.onCharacterChange(() => {
    owned = loadOwned(ctx.character.id);
    if (lines.length && migrateOwned(lines, owned)) saveOwned(ctx.character.id, owned);
    if (lines.length) { render(); sync(); }
  });

  loadSkins()
    .then((data) => {
      lines = data;
      applyExtras(lines, shipRefs);
      if (migrateOwned(lines, owned)) saveOwned(ctx.character.id, owned);
      shell();
      render();
      sync();
      setInterval(sync, 10 * 60 * 1000);
    })
    .catch((err) => { el.innerHTML = panel({ body: alertBox((err as Error).message) }); });
}
