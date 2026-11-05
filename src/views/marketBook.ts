import { windowTitle, loader, alertBox, dataStamp, esc, formatISK, formatInt, compactISK } from '../ui/components';
import { tx } from '../i18n';
import { loadJson, saveJson } from '../storage';
import { JITA_STATION, GLOBAL_PLEX_REGION, isGlobalMarket } from '../services/market';
import { allHubs } from '../services/intel';
import { cachedBook, fetchOrderBook, resolveLocationNames, locationName, isStructure, type BookOrder, type OrderBook } from '../services/orderBook';
import { loadMap, displaySec, secClass, JOVE_REGIONS, type NavMap, type NavSystem } from '../services/navigation';
import { storedActiveCharacter, loadStoredCharacters } from '../character/characters';
import { hasScope } from '../character/sso';
import { characterLocation } from '../character/esi';
import { characterOrders, ORDERS_SCOPE } from '../services/orders';

const FILTER_KEY = 'eve-market:book-filters';
const ORIGIN_KEY = 'eve-market:origin';
const LOCATION_SCOPE = 'esi-location.read_location.v1';
const ROWS = 200;

interface Filters {
  priceOn: boolean; priceMin: string; priceMax: string;
  qtyOn: boolean; qtyMin: string; qtyMax: string;
  jumpsOn: boolean; jumpsMin: string; jumpsMax: string;
  entered: boolean;
  exNull: boolean; exLow: boolean; exHigh: boolean; exNpc: boolean; exStructures: boolean;
  locOn: boolean; loc: string;
  regionOn: boolean; region: string;
  hubsOnly: boolean; npcOnly: boolean; mineOnly: boolean;
}

const DEFAULTS: Filters = {
  priceOn: false, priceMin: '', priceMax: '',
  qtyOn: false, qtyMin: '', qtyMax: '',
  jumpsOn: false, jumpsMin: '0', jumpsMax: '10',
  entered: false,
  exNull: false, exLow: false, exHigh: false, exNpc: false, exStructures: false,
  locOn: false, loc: '',
  regionOn: false, region: '',
  hubsOnly: false, npcOnly: false, mineOnly: false,
};

type Side = 'sell' | 'buy';
type SortKey = 'region' | 'qty' | 'price' | 'loc' | 'jumps' | 'range' | 'min' | 'expires' | 'modified';

export interface OrderBookPanel {
  load(host: HTMLElement, typeId: number): void;
}

const matcher = (q: string) => {
  const s = q.trim();
  if (!s) return () => true;
  try {
    const re = new RegExp(s, 'i');
    return (v: string) => re.test(v);
  } catch {
    const low = s.toLowerCase();
    return (v: string) => v.toLowerCase().includes(low);
  }
};

const num = (v: string) => (v.trim() === '' ? null : Number(v));

export function createOrderBookPanel(): OrderBookPanel {
  let host: HTMLElement = document.createElement('div');
  const bound = new WeakSet<HTMLElement>();
  let f: Filters = { ...DEFAULTS, ...loadJson<Partial<Filters>>(FILTER_KEY, {}) };
  let typeId = 0;
  let book: OrderBook | null = null;
  let map: NavMap | null = null;
  let error = '';
  let progress: { done: number; total: number } | null = null;
  let request = 0;
  let origin: { system: NavSystem; esi: boolean } | null = null;
  let jumps = new Map<number, number>();
  let mine: Set<number> | null = null;
  let mineError = '';
  const expanded = { sell: false, buy: false };
  let shown: number[] = [];
  const sort: Record<Side, { key: SortKey; dir: 1 | -1 }> = { sell: { key: 'price', dir: 1 }, buy: { key: 'price', dir: -1 } };

  const global = () => isGlobalMarket(typeId);
  const regions = () => (global() || !map ? [GLOBAL_PLEX_REGION] : [...map.regions.keys()].filter((id) => id < 11000000 && !JOVE_REGIONS.has(id)));
  const hubStations = () => new Set([JITA_STATION, ...allHubs().map((h) => h.station)]);
  const saveFilters = () => saveJson(FILTER_KEY, f);
  const main = () => host.querySelector<HTMLElement>('.book-main');

  function bind(el: HTMLElement) {
    if (bound.has(el)) return;
    bound.add(el);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-book-refresh]')) { fetchBook(true); return; }
      if (t.closest('[data-book-reset]')) { f = { ...DEFAULTS }; saveFilters(); renderAll(); return; }
      const more = t.closest<HTMLElement>('[data-book-more]');
      if (more) { const side = more.dataset.bookMore as Side; expanded[side] = !expanded[side]; renderMain(); return; }
      const th = t.closest<HTMLElement>('[data-sort]');
      if (th) {
        const [side, key] = th.dataset.sort!.split(':') as [Side, SortKey];
        sort[side] = sort[side].key === key ? { key, dir: sort[side].dir === 1 ? -1 : 1 } : { key, dir: key === 'price' && side === 'buy' ? -1 : 1 };
        renderMain();
      }
    });
    const onField = (e: Event) => {
      const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-f]');
      if (!input) return;
      const key = input.dataset.f as keyof Filters;
      if (input.type === 'checkbox') (f as unknown as Record<string, boolean>)[key] = input.checked;
      else (f as unknown as Record<string, string>)[key] = input.value;
      saveFilters();
      if (key === 'mineOnly' && f.mineOnly && !mine) loadMine();
      renderMain();
    };
    el.addEventListener('input', onField);
    el.addEventListener('change', (e) => {
      const o = (e.target as HTMLElement).closest<HTMLInputElement>('[data-book-origin]');
      if (o) { setOrigin(o.value); return; }
      onField(e);
    });
  }

  async function setOrigin(value: string) {
    const v = value.trim();
    if (v && !map?.find(v)) return;
    saveJson(ORIGIN_KEY, v ? map!.find(v)!.name : '');
    await resolveOrigin();
    renderAll();
  }

  async function resolveOrigin() {
    origin = null;
    jumps = new Map();
    if (!map) return;
    const typed = loadJson<string>(ORIGIN_KEY, '');
    let system = typed ? map.find(typed) ?? null : null;
    let esi = false;
    const c = storedActiveCharacter();
    if (!system && c?.characterId && hasScope(c.characterId, LOCATION_SCOPE)) {
      const loc = await characterLocation(c.characterId).catch(() => null);
      system = loc ? map.systems.get(loc.solar_system_id) ?? null : null;
      esi = !!system;
    }
    if (!system) return;
    origin = { system, esi };
    jumps = map.gateDistances(system.id, 400);
  }

  async function loadMine() {
    const chars = loadStoredCharacters().filter((c) => c.kind === 'esi' && c.characterId && hasScope(c.characterId, ORDERS_SCOPE));
    if (!chars.length) { mineError = tx('Necesită login cu permisiunea pentru ordinele tale.'); mine = new Set(); renderMain(); return; }
    const ids = new Set<number>();
    await Promise.all(chars.map(async (c) => (await characterOrders(c.characterId!).catch(() => [])).forEach((o) => ids.add(o.order_id))));
    mine = ids;
    mineError = '';
    renderMain();
  }

  const rangeLabel = (r: string) => {
    if (r === 'station') return tx('Stație');
    if (r === 'solarsystem') return tx('Sistem');
    if (r === 'region') return tx('Regiune');
    const n = Number(r);
    return n === 1 ? tx('1 salt') : tx('{n} salturi', { n });
  };

  const ago = (ms: number) => {
    const min = Math.max(0, (Date.now() - ms) / 60000);
    if (min < 60) return tx('{n} min', { n: Math.floor(min) });
    if (min < 48 * 60) return tx('{n} h', { n: Math.floor(min / 60) });
    return tx('{n} z', { n: Math.floor(min / 1440) });
  };

  const left = (o: BookOrder) => {
    const ms = o.issued + o.duration * 86400000 - Date.now();
    if (ms <= 0) return '0';
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return d ? `${d}${tx('z')} ${h}h` : `${h}h ${m}m`;
  };

  const sysOf = (o: BookOrder) => map?.systems.get(o.systemId);
  const regionName = (o: BookOrder) => map?.regions.get(o.regionId) ?? '';
  const locLabel = (o: BookOrder) => locationName(o.locationId) || (isStructure(o.locationId) ? `${sysOf(o)?.name ?? ''} · ${tx('structură')}` : sysOf(o)?.name ?? '');
  const jumpsOf = (o: BookOrder) => jumps.get(o.systemId) ?? null;

  function filtered(): BookOrder[] {
    if (!book) return [];
    const pMin = f.priceOn ? num(f.priceMin) : null, pMax = f.priceOn ? num(f.priceMax) : null;
    const qMin = f.qtyOn ? num(f.qtyMin) : null, qMax = f.qtyOn ? num(f.qtyMax) : null;
    const jOn = f.jumpsOn && !!origin;
    const jMin = jOn ? num(f.jumpsMin) : null, jMax = jOn ? num(f.jumpsMax) : null;
    const locOk = f.locOn ? matcher(f.loc) : null;
    const regOk = f.regionOn ? matcher(f.region) : null;
    const hubs = f.hubsOnly ? hubStations() : null;
    return book.orders.filter((o) => {
      if (pMin != null && o.price < pMin) return false;
      if (pMax != null && o.price > pMax) return false;
      if (qMin != null && o.remain < qMin) return false;
      if (qMax != null && o.remain > qMax) return false;
      if (jOn) {
        const j = jumpsOf(o);
        if (j == null) return false;
        if (jMin != null && j < jMin) return false;
        if (jMax != null && j > jMax) return false;
      }
      const sys = sysOf(o);
      if (sys) {
        if (f.exNull && sys.sec <= 0) return false;
        if (f.exLow && sys.sec > 0 && sys.sec < 0.45) return false;
        if (f.exHigh && sys.sec >= 0.45) return false;
      }
      if (f.exNpc && !isStructure(o.locationId)) return false;
      if (f.exStructures && isStructure(o.locationId)) return false;
      if (locOk && !locOk(locLabel(o))) return false;
      if (regOk && !regOk(regionName(o))) return false;
      if (hubs && !hubs.has(o.locationId)) return false;
      if (f.npcOnly && o.duration < 365) return false;
      if (f.mineOnly && !mine?.has(o.id)) return false;
      return true;
    });
  }

  function sorted(side: Side, list: BookOrder[]) {
    const { key, dir } = sort[side];
    const val = (o: BookOrder): number | string => {
      switch (key) {
        case 'region': return regionName(o);
        case 'qty': return o.remain;
        case 'loc': return locLabel(o);
        case 'jumps': return jumpsOf(o) ?? 1e9;
        case 'range': return o.range === 'station' ? -2 : o.range === 'solarsystem' ? 0 : o.range === 'region' ? 1e6 : Number(o.range);
        case 'min': return o.minVolume;
        case 'expires': return o.issued + o.duration * 86400000;
        case 'modified': return -o.issued;
        default: return o.price;
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
      return c * dir || (side === 'sell' ? a.price - b.price : b.price - a.price);
    });
  }

  function topAverage(list: BookOrder[]) {
    const total = list.reduce((a, o) => a + o.remain, 0);
    if (!total) return 0;
    const cap = Math.max(1, total * 0.05);
    let left = cap, sum = 0;
    for (const o of list) {
      const take = Math.min(left, o.remain);
      sum += take * o.price;
      left -= take;
      if (left <= 0) break;
    }
    return sum / (cap - Math.max(0, left));
  }

  function summary(allSell: BookOrder[], allBuy: BookOrder[]) {
    const s = topAverage([...allSell].sort((a, b) => a.price - b.price));
    const ref = s || Math.max(0, ...allBuy.map((o) => o.price));
    const sell = ref ? allSell.filter((o) => o.price <= ref * 10) : allSell;
    const buy = ref ? allBuy.filter((o) => o.price >= ref / 10) : allBuy;
    const b = topAverage([...buy].sort((a, b) => b.price - a.price));
    const vol = (l: BookOrder[]) => l.reduce((a, o) => a + o.remain, 0);
    const cell = (label: string, value: string, cls = '') => `<div><span class="label">${label}</span><span class="value ${cls}">${value}</span></div>`;
    return `<div class="history-kpis book-kpis">
      ${cell(tx('Vânzare medie (5%)'), s ? `${compactISK(s)} ISK` : '—', 'book-sell')}
      ${cell(tx('Cumpărare medie (5%)'), b ? `${compactISK(b)} ISK` : '—', 'book-buy')}
      ${cell(tx('Marjă medie'), s && b ? `${compactISK(s - b)} ISK` : '—')}
      ${cell(tx('Volum vânzare'), formatInt(vol(sell)))}
      ${cell(tx('Volum cumpărare'), formatInt(vol(buy)))}
    </div>`;
  }

  function sideTable(side: Side, orders: BookOrder[]) {
    const title = side === 'sell' ? tx('Vânzători') : tx('Cumpărători');
    const head = `<h4 class="sub-head book-side ${side}">${title} <span class="dim">· ${tx('{n} ordine', { n: formatInt(orders.length) })}</span></h4>`;
    if (!orders.length) return `${head}<p class="dim small">${side === 'sell' ? tx('Niciun ordin de vânzare.') : tx('Niciun ordin de cumpărare.')}</p>`;
    const all = sorted(side, orders);
    const list = expanded[side] ? all : all.slice(0, ROWS);
    list.forEach((o) => shown.push(o.locationId));
    const loc = !global();
    const buy = side === 'buy';
    const th = (key: SortKey, label: string, cls = '') => {
      const on = sort[side].key === key;
      return `<th class="${cls} sortable ${on ? 'on' : ''}" data-sort="${side}:${key}">${label}${on ? (sort[side].dir === 1 ? ' ▴' : ' ▾') : ''}</th>`;
    };
    const rows = list.map((o) => {
      const sys = sysOf(o);
      const j = jumpsOf(o);
      const name = locLabel(o);
      return `<tr class="${mine?.has(o.id) ? 'mine' : ''}">
        ${loc ? `<td class="book-region">${esc(regionName(o))}</td>` : ''}
        <td class="r num">${f.entered ? `${formatInt(o.remain)}<span class="dim">/${formatInt(o.total)}</span>` : formatInt(o.remain)}</td>
        <td class="r num ${buy ? 'book-buy' : 'book-sell'}">${formatISK(o.price)}</td>
        ${loc ? `<td class="book-loc" title="${esc(name)}">${sys ? `<span class="num ${secClass(sys.sec)}">${displaySec(sys.sec).toFixed(1)}</span> ` : ''}${esc(name || '—')}</td>` : ''}
        ${loc ? `<td class="r num">${j == null ? '<span class="dim">—</span>' : j}</td>` : ''}
        ${buy && loc ? `<td>${rangeLabel(o.range)}</td><td class="r num">${formatInt(o.minVolume)}</td>` : ''}
        <td class="r num">${left(o)}</td>
        <td class="r num dim">${ago(o.issued)}</td>
      </tr>`;
    }).join('');
    const more = all.length > ROWS ? `<div class="row-actions"><button class="chip-btn" data-book-more="${side}">${expanded[side] ? tx('Arată mai puține') : tx('Arată toate ({n})', { n: formatInt(all.length) })}</button></div>` : '';
    return `${head}<div class="book-scroll"><table class="table compact book-table"><thead><tr>
      ${loc ? th('region', tx('Regiune')) : ''}
      ${th('qty', tx('Cantitate'), 'r')}
      ${th('price', tx('Preț'), 'r')}
      ${loc ? th('loc', tx('Locație')) : ''}
      ${loc ? th('jumps', tx('Salturi'), 'r') : ''}
      ${buy && loc ? `${th('range', tx('Rază'))}${th('min', tx('Vol. min'), 'r')}` : ''}
      ${th('expires', tx('Expiră în'), 'r')}
      ${th('modified', tx('Ultima modificare'), 'r')}
    </tr></thead><tbody>${rows}</tbody></table></div>${more}`;
  }

  const check = (key: keyof Filters, label: string, cls = '') => `<label class="book-check ${cls}"><input type="checkbox" data-f="${key}" ${f[key] ? 'checked' : ''} /> <span>${label}</span></label>`;
  const rangeRow = (on: keyof Filters, min: keyof Filters, max: keyof Filters, label: string) => `<div class="book-range">
      ${check(on, label)}
      <div class="book-range-in"><input class="input sm num" type="number" min="0" step="any" data-f="${min}" value="${esc(String(f[min]))}" placeholder="min" /><span class="dim">–</span><input class="input sm num" type="number" min="0" step="any" data-f="${max}" value="${esc(String(f[max]))}" placeholder="max" /></div>
    </div>`;

  function filtersHtml() {
    if (global()) return '';
    const originValue = origin && !origin.esi ? origin.system.name : loadJson<string>(ORIGIN_KEY, '');
    const where = origin ? `${esc(origin.system.name)} · ${esc(map?.region(origin.system) ?? '')}` : tx('niciun sistem ales');
    return `<aside class="panel book-filters">
      <div class="panel-body">
        <label class="book-origin"><span>${tx('Pornești din')}</span><input class="input sm" data-book-origin list="bookOriginList" value="${esc(originValue)}" placeholder="${esc(origin?.esi ? tx('locația ta din EVE') : tx('Scrie un sistem'))}" autocomplete="off" /></label>
        <datalist id="bookOriginList"></datalist>
        <p class="dim small">${origin?.esi ? tx('Locația ta din EVE: {s}', { s: where }) : where}</p>
        ${rangeRow('priceOn', 'priceMin', 'priceMax', tx('Preț'))}
        ${rangeRow('qtyOn', 'qtyMin', 'qtyMax', tx('Cantitate'))}
        ${rangeRow('jumpsOn', 'jumpsMin', 'jumpsMax', tx('Salturi'))}
        ${check('entered', tx('Arată cantitatea inițială'))}
        <div class="book-group"><span class="book-group-label">${tx('Exclude')}</span>
          ${check('exNull', 'Null sec', 'sec-null')}
          ${check('exLow', 'Low sec', 'sec-lo')}
          ${check('exHigh', 'High sec', 'sec-hi')}
          ${check('exNpc', tx('Stații NPC'))}
          ${check('exStructures', tx('Structuri jucători'))}
        </div>
        <div class="book-text">${check('locOn', tx('Locație'))}<input class="input sm" data-f="loc" value="${esc(f.loc)}" placeholder="${esc(tx('nume sau regex'))}" /></div>
        <div class="book-text">${check('regionOn', tx('Regiune'))}<input class="input sm" data-f="region" value="${esc(f.region)}" placeholder="${esc(tx('nume sau regex'))}" /></div>
        ${check('hubsOnly', tx('Doar hub-uri de piață'))}
        ${check('npcOnly', tx('Doar ordine NPC'))}
        ${check('mineOnly', tx('Doar ordinele mele'))}
        <div class="row-actions"><button class="btn ghost sm" data-book-reset>${tx('Resetează filtrele')}</button></div>
      </div>
    </aside>`;
  }

  function renderMain() {
    const el = main();
    if (!el) return;
    const stamp = book && !progress ? dataStamp(book.at, 'data-book-refresh', { label: tx('Ordine din {time}'), title: tx('Click pentru a citi din nou ordinele.') }) : '';
    const scope = global() ? tx('Piața globală PLEX') : tx('Toate regiunile');
    let body = '';
    shown = [];
    if (progress) body = loader(tx('Încarc ordinele {done}/{total} regiuni', { done: progress.done, total: progress.total }));
    else if (error) body = alertBox(error);
    else if (book) {
      const list = filtered();
      const sell = list.filter((o) => !o.buy), buy = list.filter((o) => o.buy);
      body = `${summary(sell, buy)}
        ${book.failed ? `<p class="dim small">${tx('{n} regiuni nu au răspuns.', { n: book.failed })}</p>` : ''}
        ${f.mineOnly && mineError ? `<p class="dim small">${esc(mineError)}</p>` : ''}
        ${sideTable('sell', sell)}${sideTable('buy', buy)}`;
    }
    el.innerHTML = `<div class="panel-head">${windowTitle(tx('Ordine de piață'), scope)}<div class="panel-actions">${stamp}</div></div><div class="panel-body">${body}</div>`;
    if (book && !progress) names();
  }

  function renderAll() {
    host.innerHTML = `<div class="book-layout ${global() ? 'single' : ''}">${filtersHtml()}<section class="panel book-main"></section></div>`;
    const input = host.querySelector<HTMLInputElement>('[data-book-origin]');
    const list = host.querySelector<HTMLDataListElement>('#bookOriginList');
    input?.addEventListener('input', () => {
      if (list && map) list.innerHTML = map.suggest(input.value, 10).map((s) => `<option value="${esc(s.name)}">${esc(map!.region(s))}</option>`).join('');
    });
    renderMain();
  }

  async function names() {
    if (!book) return;
    const id = request;
    if (await resolveLocationNames(shown) && id === request) renderMain();
  }

  async function fetchBook(fresh: boolean) {
    const id = ++request;
    expanded.sell = expanded.buy = false;
    error = '';
    if (!map) map = await loadMap().catch(() => null);
    if (id !== request) return;
    const list = regions();
    const hit = fresh ? null : cachedBook(typeId, list);
    if (hit) { book = hit; progress = null; renderMain(); return; }
    progress = { done: 0, total: list.length };
    renderMain();
    try {
      const b = await fetchOrderBook(typeId, list, (done) => {
        if (id !== request || !progress) return;
        progress.done = done;
        const p = host.querySelector('.book-main .scan p');
        if (p) p.textContent = tx('Încarc ordinele {done}/{total} regiuni', { done, total: list.length });
      });
      if (id !== request) return;
      book = b;
    } catch (err) {
      if (id !== request) return;
      error = (err as Error).message;
      book = null;
    }
    progress = null;
    renderMain();
  }

  return {
    async load(el: HTMLElement, t: number) {
      host = el;
      bind(el);
      typeId = t;
      book = null;
      if (!map) map = await loadMap().catch(() => null);
      if (!origin) await resolveOrigin();
      if (f.mineOnly && !mine) loadMine();
      renderAll();
      fetchBook(false);
    },
  };
}
