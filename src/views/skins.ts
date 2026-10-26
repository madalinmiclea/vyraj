import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, emptyState, esc, badge, formatInt, compactISK, searchField, toast, openModal, closeModal, copyText, windowTitle, dataStamp } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { typeIconUrl, fetchListedTypes, fetchPrices } from '../services/market';
import { loadSkins, loadOwned, saveOwned, skinKey, applyExtras, applySync, lastSync, importList, migrateOwned, type SkinLine, type ShipRef } from '../services/skins';
import { Category } from '../data/sde';
import { showItemInfo } from '../ui/itemInfo';
import { listAssets, walletTransactions } from '../character/esi';
import { hasTokens, hasScope } from '../character/sso';
import { tx, locale } from '../i18n';
import { allEveItems } from '../data/items';
import { fold } from '../ui/fold';

type Sort = 'name' | 'owned' | 'progress';
type Mode = 'all' | 'mine' | 'shop';
type ShopOrder = 'cheap' | 'expensive';
type ComboKind = 'ship' | 'line';

interface ComboItem {
  value: string;
  html: string;
}

interface ShopRow {
  line: SkinLine;
  ship: SkinLine['ships'][number];
  license: number;
  price: number;
  own?: boolean;
}

const SORTS: { id: Sort; label: string }[] = [
  { id: 'name', label: tx('Nume') },
  { id: 'owned', label: tx('Nave deținute') },
  { id: 'progress', label: tx('Progres %') },
];

const PREFS_KEY = 'eve-skins:prefs';
const SHOP_LIMIT = 400;
const EXPENSIVE_LIMIT = 100;
const COMBO_LIMIT = 60;
const PRICES_KEY = 'eve-skins:prices';

export function createSkinsView(el: HTMLElement, ctx: AppContext, side: HTMLElement) {
  const prefs = loadJson<{ sort?: string; mode?: string; shopOrder?: ShopOrder }>(PREFS_KEY, {});
  let sort: Sort = SORTS.some((x) => x.id === prefs.sort) ? prefs.sort as Sort : 'name';
  let mode: Mode = prefs.mode === 'shop' || prefs.mode === 'mine' ? prefs.mode : 'all';
  let shopOrder: ShopOrder = prefs.shopOrder ?? 'cheap';
  let shopToken = 0;
  let query = '';
  let priceCache = loadJson<{ at: number; p: Record<string, number> }>(PRICES_KEY, { at: 0, p: {} });
  const licenseNames = new Map<number, string>();
  let pickShip: number | null = null;
  let pickLine: string | null = null;
  let combo: { input: HTMLInputElement; kind: ComboKind; menu: HTMLElement; items: ComboItem[]; active: number } | null = null;
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
  const savePrefs = () => saveJson(PREFS_KEY, { sort, mode, shopOrder });

  function shell() {
    el.innerHTML = `<div id="skinHead"></div>
      <div class="skin-toolbar">
        ${searchField({ id: 'skinSearch', placeholder: tx('Caută SKIN sau navă') })}
        <label class="select-field skin-order" id="skinSorts"><span>${tx('Ordonează după')}</span><select class="input" id="skinSortSel">${SORTS.map((o) => `<option value="${o.id}">${o.label}</option>`).join('')}</select></label>
      </div>
      <div id="skinBody"></div>`;
    const search = el.querySelector<HTMLInputElement>('#skinSearch')!;
    search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); renderBody(); });
    el.querySelector<HTMLSelectElement>('#skinSortSel')!.addEventListener('change', (e) => { sort = (e.target as HTMLSelectElement).value as Sort; savePrefs(); renderGrid(); });
    el.addEventListener('click', onClick);
    side.addEventListener('click', onClick);
    el.addEventListener('input', (e) => { const i = (e.target as HTMLElement).closest<HTMLInputElement>('[data-skin-combo]'); if (i) showCombo(i); });
    el.addEventListener('focusin', (e) => { const i = (e.target as HTMLElement).closest<HTMLInputElement>('[data-skin-combo]'); if (i) { i.select(); showCombo(i); } });
    el.addEventListener('focusout', (e) => { if ((e.target as HTMLElement).closest('[data-skin-combo]')) closeCombo(); });
    el.addEventListener('keydown', onComboKey);
    addEventListener('scroll', placeCombo, true);
    addEventListener('resize', placeCombo);
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
      ${mode === 'shop' ? '' : `<div class="skin-head-row"><div class="history-kpis">
        <div><span class="label">${tx('SKIN-uri deținute')}</span><span class="value">${formatInt(have)} / ${formatInt(total)}</span></div>
        <div><span class="label">${tx('Colecții începute')}</span><span class="value">${formatInt(started)} / ${formatInt(lines.length)}</span></div>
        <div><span class="label">${tx('Colecții complete')}</span><span class="value">${formatInt(complete)}</span></div>
        <div><span class="label">${tx('Progres')}</span><span class="value">${total ? ((have / total) * 100).toFixed(1) : '0.0'}%</span></div>
      </div>${mode === 'mine' ? actions() : ''}</div>`}`;
    el.querySelector<HTMLElement>('#skinSorts')!.style.display = mode === 'mine' ? '' : 'none';
    el.querySelector<HTMLSelectElement>('#skinSortSel')!.value = sort;
  }

  function actions() {
    const c = ctx.character;
    const esi = c.kind === 'esi' && c.characterId && hasTokens(c.characterId) ? c.characterId : 0;
    const at = lastSync(c.id);
    const label = syncing ? tx('Sincronizez...') : at ? tx('Sincronizat {time}', { time: new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }) : tx('Nesincronizat');
    const status = !esi ? ''
      : `<button class="btn ghost sm skin-sync ${syncing ? 'busy' : at ? 'ok' : ''}" data-skin-sync title="${esc(tx('Se sincronizează automat din ESI la fiecare 10 minute. Click pentru sincronizare acum.'))}"><i class="skin-sync-dot"></i>${label}${icon('refresh')}</button>`;
    return `<div class="skin-head-actions">${status}<button class="btn sm" data-skin-list>${icon('upload')}${tx('Importă listă')}</button></div>`;
  }

  function visible(): SkinLine[] {
    const list = lines.filter((l) => {
      const n = count(l);
      if (mode === 'mine' && n === 0) return false;
      if (!query) return true;
      return l.name.toLowerCase().includes(query) || l.ships.some((s) => s.name.toLowerCase().includes(query));
    });
    const order = mode === 'mine' ? sort : 'name';
    if (order === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    if (order === 'owned') list.sort((a, b) => count(b) - count(a) || count(b) / b.ships.length - count(a) / a.ships.length || a.name.localeCompare(b.name));
    if (order === 'progress') list.sort((a, b) => count(b) / b.ships.length - count(a) / a.ships.length || count(b) - count(a) || a.name.localeCompare(b.name));
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
    closeCombo();
    const body = el.querySelector<HTMLElement>('#skinBody')!;
    const token = ++shopToken;
    const picked = pickShip !== null || pickLine !== null;
    const cands = lines.flatMap((line) => pickLine !== null && line.name !== pickLine ? [] : line.ships
      .filter((ship) => (pickShip === null || ship.id === pickShip) && (picked || (ship.licenses.length && !owned.has(skinKey(line.name, ship.id)))))
      .map((ship) => ({ line, ship, own: owned.has(skinKey(line.name, ship.id)) })))
      .filter(({ line, ship }) => !query || line.name.toLowerCase().includes(query) || ship.name.toLowerCase().includes(query));
    if (!cands.length && !picked) { body.innerHTML = panel({ body: emptyState({ title: tx('Nimic de cumpărat'), text: tx('Ai toate SKIN-urile din filtrul curent.'), vy: 'All Raiment Gathered', vyText: 'Every SKIN in the current filter is already yours.' }) }); return; }
    try {
      const need = [...new Set(cands.flatMap((m) => m.ship.licenses))].filter((id) => !(id in priceCache.p));
      if (need.length) {
        body.innerHTML = panel({ body: loader(tx('Citesc prețurile din Jita')) });
        const listed = await fetchListedTypes().catch(() => null);
        const ids = need.filter((id) => !listed || listed.has(id));
        const fetched = ids.length ? await fetchPrices(ids) : new Map<number, { sellMin?: number }>();
        if (token !== shopToken) return;
        const next = { at: priceCache.at || Date.now(), p: { ...priceCache.p } };
        for (const id of need) next.p[id] = fetched.get(id)?.sellMin ?? 0;
        priceCache = next;
        saveJson(PRICES_KEY, priceCache);
      }
      if (token !== shopToken) return;
      const rows: ShopRow[] = [];
      let unpriced = 0;
      for (const m of cands) {
        let best: { license: number; price: number } | null = null;
        for (const id of m.ship.licenses) {
          const p = priceCache.p[id] ?? 0;
          if (p > 0 && (!best || p < best.price)) best = { license: id, price: p };
        }
        if (!best && !m.own) unpriced++;
        if (best) rows.push({ ...m, ...best }); else if (picked) rows.push({ ...m, license: 0, price: 0 });
      }
      rows.sort((a, b) => (a.price ? 0 : 1) - (b.price ? 0 : 1) || a.price - b.price || a.ship.name.localeCompare(b.ship.name) || a.line.name.localeCompare(b.line.name));
      const buy = rows.filter((r) => !r.own && r.price > 0);
      const total = buy.reduce((a, r) => a + r.price, 0);
      const limit = picked ? rows.length : shopOrder === 'cheap' ? SHOP_LIMIT : EXPENSIVE_LIMIT;
      if (shopOrder === 'expensive') {
        const n = rows.findIndex((r) => !r.price);
        const pricedRows = n < 0 ? rows : rows.slice(0, n);
        rows.splice(0, pricedRows.length, ...pricedRows.reverse());
      }
      let running = 0;
      const shown = rows.slice(0, limit);
      body.innerHTML = `${panel({
        body: `<div class="history-kpis">
          <div><span class="label">${tx('De cumpărat din Jita')}</span><span class="value">${formatInt(buy.length)}</span></div>
          <div><span class="label">${tx('Cost total')}</span><span class="value">${compactISK(total)}</span></div>
          <div><span class="label">${tx('Cel mai ieftin')}</span><span class="value">${buy.length ? compactISK(Math.min(...buy.map((x) => x.price))) : '—'}</span></div>
          <div><span class="label">${tx('Cel mai scump')}</span><span class="value">${buy.length ? compactISK(Math.max(...buy.map((x) => x.price))) : '—'}</span></div>
          <div><span class="label">${tx('Fără ordere în Jita')}</span><span class="value">${formatInt(unpriced)}</span></div>
        </div>`,
      })}
      ${panel({
        title: picked ? tx('SKIN-uri filtrate') : shopOrder === 'cheap' ? tx('Cele mai ieftine') : tx('Cele mai scumpe'),
        count: rows.length > limit ? `${limit} / ${formatInt(rows.length)}` : formatInt(rows.length),
        actions: `${pricesButton()}<div class="advice-sort"><button class="chip-btn ${shopOrder === 'cheap' ? 'active' : ''}" data-skin-order="cheap">${tx('Ieftine')}</button><button class="chip-btn ${shopOrder === 'expensive' ? 'active' : ''}" data-skin-order="expensive">${tx('Scumpe')}</button></div>`,
        body: `<table class="table compact skin-shop"><thead>
          <tr class="skin-filter-row"><th></th><th></th><th>${comboField('ship')}</th><th>${comboField('line')}</th><th colspan="2"></th></tr>
          <tr><th class="r">#</th><th></th><th>${tx('Navă')}</th><th>SKIN</th><th class="r">${tx('Preț Jita')}</th><th class="r">${tx('Total cumulat')}</th></tr></thead><tbody>
          ${shown.length ? shown.map((r, i) => {
            if (!r.own) running += r.price;
            return `<tr class="${r.own ? 'skin-owned' : ''}">
              <td class="r num dim">${i + 1}</td>
              <td>${swatch(r.line, 'xs')}</td>
              <td><button class="skin-link" data-skin-copy="${esc(licenseName(r))}" title="${esc(tx('Click pentru a copia: {name}', { name: licenseName(r) }))}"><img class="row-icon" src="${typeIconUrl(r.ship.id, 32)}" alt="" loading="lazy" />${esc(r.ship.name)}</button></td>
              <td><button class="skin-link" data-skin-copy="${esc(licenseName(r))}" title="${esc(tx('Click pentru a copia: {name}', { name: licenseName(r) }))}">${esc(r.line.name)}</button>${r.own ? ` ${badge(tx('Deținut'), 'ok')}` : ''}</td>
              <td class="r num">${r.price ? compactISK(r.price) : `<span class="dim">${tx('Fără ordere')}</span>`}</td>
              <td class="r num dim">${r.own || !r.price ? '' : compactISK(running)}</td>
            </tr>`;
          }).join('') : `<tr><td colspan="6" class="dim skin-shop-empty">${tx('Niciun SKIN pentru filtrul ales.')}</td></tr>`}
        </tbody></table>`,
      })}`;
    } catch (err) {
      if (token === shopToken) body.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  function licenseName(r: ShopRow) {
    if (!licenseNames.size) for (const it of allEveItems) if (it.c === 'Ship SKINs') licenseNames.set(it.t, it.n);
    const id = r.license || r.ship.license;
    return licenseNames.get(id) ?? r.ship.licenses.map((x) => licenseNames.get(x)).find(Boolean) ?? `${r.ship.name} ${r.line.name} SKIN`;
  }

  function pricesButton() {
    return dataStamp(priceCache.at, 'data-skin-prices');
  }

  function comboField(kind: ComboKind) {
    const value = kind === 'ship' ? (pickShip !== null ? shipName(pickShip) : '') : pickLine ?? '';
    return `<div class="field skin-combo ${value ? 'picked' : ''}">${icon('search')}<input class="input" type="text" data-skin-combo="${kind}" value="${esc(value)}" placeholder="${esc(kind === 'ship' ? tx('Filtrează navă') : tx('Filtrează colecție'))}" autocomplete="off" spellcheck="false" />${value ? `<button class="skin-combo-clear" data-skin-clear="${kind}" title="${esc(tx('Șterge filtrul'))}">${icon('close')}</button>` : ''}</div>`;
  }

  function shipName(id: number) {
    for (const l of lines) for (const s of l.ships) if (s.id === id) return s.name;
    return shipRefs.get(id)?.name ?? String(id);
  }

  function comboOptions(kind: ComboKind, q: string): ComboItem[] {
    const needle = fold(q.trim());
    const rank = (name: string) => { const f = fold(name); return !needle || f.startsWith(needle) ? 0 : f.includes(needle) ? 1 : f.split(/[\s-]+/).some((w) => w.startsWith(needle)) ? 1 : -1; };
    if (kind === 'ship') {
      const ships = new Map<number, { ship: SkinLine['ships'][number]; n: number }>();
      for (const l of lines) {
        if (pickLine !== null && l.name !== pickLine) continue;
        for (const s of l.ships) { const e = ships.get(s.id); if (e) e.n++; else ships.set(s.id, { ship: s, n: 1 }); }
      }
      return [...ships.values()].map((e) => ({ e, k: rank(e.ship.name) })).filter((x) => x.k >= 0)
        .sort((a, b) => a.k - b.k || a.e.ship.name.localeCompare(b.e.ship.name)).slice(0, COMBO_LIMIT)
        .map(({ e }) => ({ value: String(e.ship.id), html: `<img src="${typeIconUrl(e.ship.id, 32)}" alt="" loading="lazy" /><span>${esc(e.ship.name)}</span><small>${esc(e.ship.group)} · ${tx('{n} SKIN-uri', { n: e.n })}</small>` }));
    }
    return lines.filter((l) => pickShip === null || l.ships.some((s) => s.id === pickShip)).map((l) => ({ l, k: rank(l.name) })).filter((x) => x.k >= 0)
      .sort((a, b) => a.k - b.k || a.l.name.localeCompare(b.l.name)).slice(0, COMBO_LIMIT)
      .map(({ l }) => ({ value: l.name, html: `${swatch(l, 'xs')}<span>${esc(l.name)}</span><small>${tx('{n} nave', { n: l.ships.length })}</small>` }));
  }

  function placeCombo() {
    if (!combo) return;
    const r = combo.input.getBoundingClientRect();
    const below = innerHeight - r.bottom - 8;
    const up = below < 220 && r.top - 8 > below;
    combo.menu.style.minWidth = `${Math.max(r.width, 280)}px`;
    combo.menu.style.maxHeight = `${Math.min(380, Math.max(140, up ? r.top - 8 : below))}px`;
    combo.menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - combo.menu.offsetWidth - 8))}px`;
    if (up) { combo.menu.style.top = ''; combo.menu.style.bottom = `${innerHeight - r.top + 4}px`; } else { combo.menu.style.bottom = ''; combo.menu.style.top = `${r.bottom + 4}px`; }
  }

  function showCombo(input: HTMLInputElement) {
    const kind = input.dataset.skinCombo as ComboKind;
    if (!combo || combo.input !== input) {
      closeCombo();
      const menu = document.createElement('div');
      menu.className = 'xsel-menu skin-combo-menu';
      menu.setAttribute('role', 'listbox');
      menu.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const o = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
        if (o) chooseCombo(Number(o.dataset.i));
      });
      document.body.appendChild(menu);
      combo = { input, kind, menu, items: [], active: 0 };
    }
    const typed = (kind === 'ship' ? (pickShip !== null ? shipName(pickShip) : '') : pickLine ?? '') === input.value ? '' : input.value;
    combo.items = comboOptions(kind, typed);
    combo.active = 0;
    combo.menu.innerHTML = `<div class="xsel-list">${combo.items.length
      ? combo.items.map((it, i) => `<div class="xsel-opt ${i === 0 ? 'active' : ''}" role="option" data-i="${i}">${it.html}</div>`).join('')
      : `<div class="xsel-opt disabled"><span>${tx('Nicio potrivire')}</span></div>`}</div>`;
    placeCombo();
  }

  function moveCombo(step: number) {
    if (!combo || !combo.items.length) return;
    combo.active = (combo.active + step + combo.items.length) % combo.items.length;
    combo.menu.querySelectorAll('.xsel-opt.active').forEach((o) => o.classList.remove('active'));
    const o = combo.menu.querySelector<HTMLElement>(`[data-i="${combo.active}"]`);
    o?.classList.add('active');
    o?.scrollIntoView({ block: 'nearest' });
  }

  function chooseCombo(i: number) {
    if (!combo) return;
    const it = combo.items[i];
    if (!it) return;
    if (combo.kind === 'ship') pickShip = Number(it.value); else pickLine = it.value;
    renderShop();
  }

  function closeCombo() {
    if (!combo) return;
    const { input, kind, menu } = combo;
    combo = null;
    menu.remove();
    if (input.isConnected) input.value = kind === 'ship' ? (pickShip !== null ? shipName(pickShip) : '') : pickLine ?? '';
  }

  function onComboKey(e: KeyboardEvent) {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-skin-combo]');
    if (!input) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!combo) showCombo(input); else moveCombo(e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (combo) chooseCombo(combo.active); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeCombo(); input.blur(); }
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
    if (t.closest('[data-skin-list]')) { openImport(); return; }
    if (t.closest('[data-skin-sync]')) { sync(); return; }
    if (t.closest('[data-skin-close]')) { open = null; renderGrid(); return; }
    const m = t.closest<HTMLElement>('[data-skin-mode]');
    if (m) { mode = m.dataset.skinMode as Mode; open = null; closeCombo(); savePrefs(); render(); el.closest('.main')?.scrollTo({ top: 0 }); return; }
    const info = t.closest<HTMLElement>('[data-skin-info]');
    if (info) { showItemInfo(ctx, Number(info.dataset.skinInfo)); return; }
    if (t.closest('[data-skin-prices]')) { priceCache = { at: 0, p: {} }; saveJson(PRICES_KEY, priceCache); renderShop(); return; }
    const cl = t.closest<HTMLElement>('[data-skin-clear]');
    if (cl) { if (cl.dataset.skinClear === 'ship') pickShip = null; else pickLine = null; renderShop(); return; }
    const so = t.closest<HTMLElement>('[data-skin-order]');
    if (so) { shopOrder = so.dataset.skinOrder as ShopOrder; savePrefs(); renderShop(); return; }
    const cp = t.closest<HTMLElement>('[data-skin-copy]');
    if (cp) { copyText(cp.dataset.skinCopy!, tx('Copiat: {name}', { name: cp.dataset.skinCopy! })); return; }
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
