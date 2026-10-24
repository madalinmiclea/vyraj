import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, formatInt, formatNum, compactISK, emptyState, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { typeIconUrl } from '../services/market';
import {
  loadScan, scanJita, SCAN_STALE_MS, feesFromSkills, spreadPct, priceTrend, volumeTrend, bookPressure, stationTrade,
  HUBS, fetchHubPrices, haulRoutes, BASE_SALES_TAX, BASE_BROKER_FEE,
  type Scan, type IntelRow, type Fees, type HaulRow,
} from '../services/intel';
import { tx } from '../i18n';

type Tab = 'ideas' | 'volume' | 'trading' | 'trend' | 'haul';

const TABS: { id: Tab; label: string }[] = [
  { id: 'ideas', label: tx('Idei') },
  { id: 'volume', label: tx('Cele mai tranzacționate') },
  { id: 'trading', label: 'Station trading' },
  { id: 'trend', label: 'Trend' },
  { id: 'haul', label: tx('Transport') },
];

interface Settings {
  depth: number;
  share: number;
  minMargin: number;
  minVolume: number;
  maxPrice: number;
  category: string;
  fees: Fees | null;
  hub: string;
  direction: 'out' | 'in' | 'all';
  cargo: number;
}

const TAB_KEY = 'eve-intel:tab';
const SETTINGS_KEY = 'eve-intel:settings';
const SORT_KEY = 'eve-intel:sort';
const DEFAULTS: Settings = { depth: 400, share: 10, minMargin: 5, minVolume: 50, maxPrice: 0, category: '', fees: null, hub: 'amarr', direction: 'all', cargo: 60000 };

const isk = (v: number) => `<span class="num">${compactISK(v)}</span>`;
const pct = (v: number, digits = 1) => `<span class="num ${v > 0.05 ? 'pos' : v < -0.05 ? 'neg-text' : ''}">${v > 0 ? '+' : ''}${formatNum(v, digits)}%</span>`;
const age = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 60 ? tx('acum {n} min', { n: m }) : m < 1440 ? tx('acum {n} h', { n: Math.round(m / 60) }) : tx('acum {n} zile', { n: Math.round(m / 1440) });
};

function spark(values: number[]) {
  if (values.length < 2) return '';
  const w = 90, h = 22;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join('');
  const up = values[values.length - 1] >= values[0];
  return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" /></svg>`;
}

const itemCell = (r: IntelRow) => `<td class="intel-item" data-open="${r.typeId}"><img class="row-icon" src="${typeIconUrl(r.typeId, 32)}" alt="" /><span>${esc(r.name)}</span></td>`;

export function createIntelView(el: HTMLElement, ctx: AppContext | null, { onOpen }: { onOpen: (name: string, typeId: number) => void }) {
  let context = ctx;
  let tab = loadJson<Tab>(TAB_KEY, 'ideas');
  if (!TABS.some((t) => t.id === tab)) tab = 'ideas';
  let settings: Settings = { ...DEFAULTS, ...loadJson<Partial<Settings>>(SETTINGS_KEY, {}) };
  let sort = loadJson<Record<string, { key: string; desc: boolean }>>(SORT_KEY, {});
  let scan: Scan | null = loadScan();
  let scanning = false;
  let haul: { hub: string; rows: HaulRow[] } | null = null;
  let haulError = '';

  el.innerHTML = `${pageHead(tx('Intel Jita'), 'The Forge · Jita IV - Moon 4', 'Discourse')}
    <div class="intel-bar" id="intelBar"></div>
    <div class="tabs" id="intelTabs"></div>
    <div id="intelBody"></div>`;
  const bar = el.querySelector<HTMLElement>('#intelBar')!;
  const tabsEl = el.querySelector<HTMLElement>('#intelTabs')!;
  const body = el.querySelector<HTMLElement>('#intelBody')!;

  const skillFees = (): Fees => (context ? feesFromSkills(context.character.skills) : { salesTax: BASE_SALES_TAX, brokerFee: BASE_BROKER_FEE });
  const fees = (): Fees => settings.fees ?? skillFees();
  const save = () => saveJson(SETTINGS_KEY, settings);
  const categories = () => [...new Set((scan?.rows ?? []).map((r) => r.category))].sort();
  const rows = () => (scan?.rows ?? []).filter((r) => !settings.category || r.category === settings.category);
  const volumeOf = (id: number) => {
    if (!context) return 0;
    try { return context.sde.baseAttr(id, 161); } catch { return 0; }
  };

  function renderBar() {
    const f = fees();
    bar.innerHTML = `<div class="intel-status">
        ${scan ? `<span class="badge ${Date.now() - scan.at > SCAN_STALE_MS ? 'warn' : 'ok'}" >${age(scan.at)}</span><span class="dim small">${tx('{n} iteme listate · {m} analizate pe 30 zile', { n: formatInt(scan.scanned), m: formatInt(scan.rows.length) })}</span>` : `<span class="dim small">${tx('Nicio scanare încă')}</span>`}
      </div>
      <div class="form-grid intel-form">
        <label>${tx('Adâncime')}<select class="input" data-set="depth">${[200, 400, 800, 1500].map((n) => `<option value="${n}" ${settings.depth === n ? 'selected' : ''}>top ${n}</option>`).join('')}</select></label>
        <label>${tx('Categorie')}<select class="input" data-set="category"><option value="">${tx('Toate')}</option>${categories().map((c) => `<option ${settings.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label>Sales tax %<input class="input sm-input" type="number" step="0.01" min="0" data-fee="salesTax" value="${f.salesTax}" /></label>
        <label>Broker fee %<input class="input sm-input" type="number" step="0.01" min="0" data-fee="brokerFee" value="${f.brokerFee}" /></label>
        <button class="btn ghost sm" data-fee-reset ${settings.fees ? '' : 'disabled'}>${tx('Taxe din skill-uri')}</button>
        <button class="btn sm" data-scan ${scanning ? 'disabled' : ''}>${icon('refresh')}${scan ? tx('Rescanează') : tx('Scanează Jita')}</button>
      </div>`;
  }

  function renderTabs() {
    tabsEl.innerHTML = TABS.map((t) => `<button class="tab ${t.id === tab ? 'active' : ''}" data-intel-tab="${t.id}">${t.label}</button>`).join('');
  }

  function render() {
    renderBar();
    renderTabs();
    if (scanning) return;
    if (!scan) {
      body.innerHTML = panel({ body: emptyState({ title: tx('Piața Jita nescanată'), text: tx('Scanarea citește ordinele din The Forge și istoricul pe 30 de zile pentru cele mai active iteme.'), extra: `<div class="row-actions center"><button class="btn" data-scan>${icon('refresh')}${tx('Scanează Jita')}</button></div>` }) });
      return;
    }
    ({ ideas, volume, trading, trend, haul: transport } as Record<Tab, () => void>)[tab]();
  }

  function sorted<T>(id: string, list: T[], keys: Record<string, (x: T) => number | string>, fallback: string): T[] {
    const s = sort[id] && keys[sort[id].key] ? sort[id] : { key: fallback, desc: true };
    const get = keys[s.key];
    return [...list].sort((a, b) => {
      const x = get(a), y = get(b);
      const c = typeof x === 'string' ? x.localeCompare(String(y)) : (x as number) - (y as number);
      return s.desc ? -c : c;
    });
  }

  function th(id: string, key: string, label: string, right = true) {
    const s = sort[id];
    const mark = s?.key === key ? (s.desc ? ' ▾' : ' ▴') : '';
    return `<th class="${right ? 'r ' : ''}sortable" data-sort="${id}:${key}">${tx(label)}${mark}</th>`;
  }

  function tradeList() {
    const f = fees();
    return rows()
      .map((r) => ({ r, t: stationTrade(r, f, settings.share) }))
      .filter(({ r, t }) => t.margin >= settings.minMargin && r.vol30 >= settings.minVolume && (!settings.maxPrice || r.buyMax <= settings.maxPrice * 1e6));
  }

  function ideas() {
    const all = rows();
    const trades = tradeList().sort((a, b) => b.t.daily - a.t.daily).slice(0, 6);
    const turnover = [...all].sort((a, b) => b.isk30 - a.isk30).slice(0, 6);
    const rising = all.filter((r) => r.isk30 > 50e6 && r.vol7 >= r.vol30 * 0.7).sort((a, b) => priceTrend(b) - priceTrend(a)).slice(0, 6);
    const surge = all.filter((r) => r.isk30 > 20e6).sort((a, b) => volumeTrend(b) - volumeTrend(a)).slice(0, 6);
    const buyHeavy = all.filter((r) => r.isk30 > 50e6).sort((a, b) => bookPressure(b) - bookPressure(a)).slice(0, 6);
    const totalIsk = all.reduce((a, r) => a + r.isk30, 0);
    const card = (title: string, sub: string, list: string) => panel({ title, body: `<p class="dim small">${sub}</p><ul class="idea-list">${list || `<li class="dim">${tx('Nimic peste praguri.')}</li>`}</ul>` });
    const li = (r: IntelRow, right: string, meta: string) => `<li data-open="${r.typeId}"><img class="row-icon" src="${typeIconUrl(r.typeId, 32)}" alt="" /><span class="idea-name">${esc(r.name)}<small class="dim">${meta}</small></span><span class="idea-val">${right}</span></li>`;
    body.innerHTML = `<div class="history-kpis intel-kpis">
        <div><span class="label">${tx('ISK tranzacționat / zi')}</span><span class="value">${compactISK(totalIsk)}</span></div>
        <div><span class="label">${tx('Iteme analizate')}</span><span class="value">${formatInt(all.length)}</span></div>
        <div><span class="label">${tx('Oportunități station trading')}</span><span class="value">${formatInt(tradeList().length)}</span></div>
        <div><span class="label">${tx('Taxe buy → sell')}</span><span class="value">${formatNum(fees().brokerFee * 2 + fees().salesTax, 2)}%</span></div>
      </div>
      <div class="idea-grid">
        ${card(tx('Buy → sell în Jita'), tx('Cumperi cu buy order, vinzi cu sell order, după taxe, la {n}% din volumul zilnic.', { n: settings.share }), trades.map(({ r, t }) => li(r, `${isk(t.daily)}<small class="dim">${tx('/zi')}</small>`, `${formatNum(t.margin, 1)}% · ${formatInt(r.vol30)}${tx('/zi')}`)).join(''))}
        ${card(tx('Cel mai mare rulaj'), tx('ISK tranzacționat zilnic, media pe 30 de zile.'), turnover.map((r) => li(r, isk(r.isk30), tx('{n} buc/zi', { n: formatInt(r.vol30) }))).join(''))}
        ${card(tx('Preț în creștere'), tx('Media pe 7 zile față de 30 de zile, cu volum constant.'), rising.map((r) => li(r, pct(priceTrend(r)), `${compactISK(r.avg7)} vs ${compactISK(r.avg30)}`)).join(''))}
        ${card(tx('Volum în creștere'), tx('Cerere pe 7 zile față de 30 de zile.'), surge.map((r) => li(r, pct(volumeTrend(r), 0), tx('{a} vs {b} buc/zi', { a: formatInt(r.vol7), b: formatInt(r.vol30) }))).join(''))}
        ${card(tx('Presiune de cumpărare'), tx('Valoarea din buy orders față de sell orders în carte.'), buyHeavy.map((r) => li(r, `<span class="num">${formatNum(bookPressure(r), 0)}%</span>`, `${compactISK(r.buyBook * r.buyMax)} buy · ${compactISK(r.sellBook * r.sellMin)} sell`)).join(''))}
      </div>`;
  }

  function volume() {
    const list = sorted('volume', rows(), {
      name: (r) => r.name, vol: (r) => r.vol30, isk: (r) => r.isk30, buy: (r) => r.buyMax, sell: (r) => r.sellMin,
      spread: spreadPct, pt: priceTrend, vt: volumeTrend, press: bookPressure,
    }, 'isk').slice(0, 300);
    body.innerHTML = panel({
      title: tx('Cele mai tranzacționate'),
      count: tx('{n} iteme', { n: formatInt(list.length) }),
      body: `<div class="table-scroll"><table class="table compact intel-table"><thead><tr>
          ${th('volume', 'name', 'Item', false)}${th('volume', 'vol', 'Buc / zi')}${th('volume', 'isk', 'ISK / zi')}${th('volume', 'buy', 'Buy max')}${th('volume', 'sell', 'Sell min')}${th('volume', 'spread', 'Buy → sell')}${th('volume', 'pt', 'Preț 7z')}${th('volume', 'vt', 'Volum 7z')}${th('volume', 'press', 'Buy %')}<th class="r">${tx('30 zile')}</th>
        </tr></thead><tbody>
        ${list.map((r) => `<tr>${itemCell(r)}<td class="r num">${formatInt(r.vol30)}</td><td class="r">${isk(r.isk30)}</td><td class="r">${isk(r.buyMax)}</td><td class="r">${isk(r.sellMin)}</td><td class="r">${pct(spreadPct(r))}</td><td class="r">${pct(priceTrend(r))}</td><td class="r">${pct(volumeTrend(r), 0)}</td><td class="r num">${formatNum(bookPressure(r), 0)}</td><td class="r">${spark(r.spark)}</td></tr>`).join('')}
        </tbody></table></div>`,
    });
  }

  function trading() {
    const f = fees();
    const list = sorted('trading', tradeList(), {
      name: (x) => x.r.name, buy: (x) => x.r.buyMax, sell: (x) => x.r.sellMin, unit: (x) => x.t.unit, margin: (x) => x.t.margin,
      vol: (x) => x.r.vol30, daily: (x) => x.t.daily, capital: (x) => x.t.capital, comp: (x) => x.r.buyOrders + x.r.sellOrders,
    }, 'daily').slice(0, 300);
    body.innerHTML = panel({
      title: 'Station trading',
      count: tx('{n} iteme', { n: formatInt(list.length) }),
      body: `<div class="form-grid">
          <label>${tx('Marjă min %')}<input class="input sm-input" type="number" step="1" data-set="minMargin" value="${settings.minMargin}" /></label>
          <label>${tx('Volum min / zi')}<input class="input sm-input" type="number" step="10" data-set="minVolume" value="${settings.minVolume}" /></label>
          <label>${tx('Preț max (m ISK)')}<input class="input sm-input" type="number" step="1" min="0" data-set="maxPrice" value="${settings.maxPrice || ''}" placeholder="—" /></label>
          <label>${tx('Cota ta din volum %')}<input class="input sm-input" type="number" step="1" min="1" max="100" data-set="share" value="${settings.share}" /></label>
        </div>
        <p class="dim small">${tx('Cumpăr la buy max + broker {b}% → vând la sell min − broker {b}% − tax {t}%. Marja e raportată la costul de cumpărare.', { b: formatNum(f.brokerFee, 2), t: formatNum(f.salesTax, 2) })}</p>
        <div class="table-scroll"><table class="table compact intel-table"><thead><tr>
          ${th('trading', 'name', 'Item', false)}${th('trading', 'buy', 'Cumpăr la')}${th('trading', 'sell', 'Vând la')}${th('trading', 'unit', 'Profit / buc')}${th('trading', 'margin', 'Marjă')}${th('trading', 'vol', 'Buc / zi')}${th('trading', 'daily', 'Profit / zi')}${th('trading', 'capital', 'Capital / zi')}${th('trading', 'comp', 'Ordine')}
        </tr></thead><tbody>
        ${list.length ? list.map(({ r, t }) => `<tr>${itemCell(r)}<td class="r">${isk(r.buyMax)}</td><td class="r">${isk(r.sellMin)}</td><td class="r">${isk(t.unit)}</td><td class="r">${pct(t.margin)}</td><td class="r num">${formatInt(r.vol30)}</td><td class="r gold-text">${isk(t.daily)}</td><td class="r">${isk(t.capital)}</td><td class="r num dim">${r.buyOrders} / ${r.sellOrders}</td></tr>`).join('') : `<tr><td colspan="9" class="dim">${tx('Nimic peste praguri.')}</td></tr>`}
        </tbody></table></div>`,
    });
  }

  function trend() {
    const all = rows().filter((r) => r.isk30 > 10e6);
    const table = (id: string, title: string, list: IntelRow[]) => panel({
      title,
      body: `<table class="table compact intel-table"><thead><tr><th>Item</th><th class="r">${tx('Medie 7z')}</th><th class="r">${tx('Medie 30z')}</th><th class="r">${tx('Preț')}</th><th class="r">${tx('Volum')}</th><th class="r">${tx('30 zile')}</th></tr></thead><tbody>
        ${list.map((r) => `<tr data-row="${id}">${itemCell(r)}<td class="r">${isk(r.avg7)}</td><td class="r">${isk(r.avg30)}</td><td class="r">${pct(priceTrend(r))}</td><td class="r">${pct(volumeTrend(r), 0)}</td><td class="r">${spark(r.spark)}</td></tr>`).join('')}
        </tbody></table>`,
    });
    const byPrice = [...all].sort((a, b) => priceTrend(b) - priceTrend(a));
    body.innerHTML = `<div class="tool-grid even">
      ${table('up', tx('Cresc'), byPrice.slice(0, 25))}
      ${table('down', tx('Scad'), byPrice.slice(-25).reverse())}
    </div>`;
  }

  async function loadHaul() {
    if (!scan) return;
    const hub = HUBS.find((h) => h.id === settings.hub) ?? HUBS[0];
    haulError = '';
    body.innerHTML = panel({ body: loader(tx('Prețuri {name}', { name: hub.name })) });
    try {
      const prices = await fetchHubPrices(hub, scan.rows.map((r) => r.typeId));
      haul = { hub: hub.id, rows: haulRoutes(scan.rows, prices, fees(), volumeOf) };
    } catch (err) {
      haulError = (err as Error).message;
    }
    if (tab === 'haul') transport();
  }

  function transport() {
    const hub = HUBS.find((h) => h.id === settings.hub) ?? HUBS[0];
    if (!haul || haul.hub !== hub.id) { if (!haulError) { loadHaul(); return; } }
    const cargo = settings.cargo;
    const list = sorted('haul', (haul?.rows ?? []).filter((h) => (settings.direction === 'all' || h.direction === settings.direction) && (!settings.category || h.row.category === settings.category) && h.margin >= settings.minMargin), {
      name: (h) => h.row.name, buy: (h) => h.buy, sell: (h) => h.sell, unit: (h) => h.unit, margin: (h) => h.margin, m3: (h) => h.perM3,
      trip: (h) => (h.m3 > 0 ? Math.min(Math.floor(cargo / h.m3), h.depth) * h.unit : 0), depth: (h) => h.depth,
    }, 'trip').slice(0, 200);
    const route = (h: HaulRow) => (h.direction === 'out' ? `Jita → ${hub.name}` : `${hub.name} → Jita`);
    body.innerHTML = panel({
      title: tx('Transport între hub-uri'),
      count: tx('{n} rute', { n: formatInt(list.length) }),
      body: `<div class="form-grid">
          <label>Hub<select class="input" data-set="hub">${HUBS.map((h) => `<option value="${h.id}" ${h.id === hub.id ? 'selected' : ''}>${h.name}</option>`).join('')}</select></label>
          <label>${tx('Direcție')}<select class="input" data-set="direction">
            <option value="all" ${settings.direction === 'all' ? 'selected' : ''}>${tx('Ambele')}</option>
            <option value="out" ${settings.direction === 'out' ? 'selected' : ''}>Jita → ${hub.name}</option>
            <option value="in" ${settings.direction === 'in' ? 'selected' : ''}>${hub.name} → Jita</option>
          </select></label>
          <label>Cargo m³<input class="input sm-input" type="number" step="1000" min="1" data-set="cargo" value="${cargo}" /></label>
          <label>${tx('Marjă min %')}<input class="input sm-input" type="number" step="1" data-set="minMargin" value="${settings.minMargin}" /></label>
          <button class="btn ghost sm" data-haul-reload>${icon('refresh')}${tx('Reîncarcă')}</button>
        </div>
        <p class="dim small">${tx('Cumpăr instant din sell orders → vând instant în buy orders la destinație, după sales tax {t}%. Fără ordine de așteptat.', { t: formatNum(fees().salesTax, 2) })}</p>
        ${haulError ? alertBox(haulError) : ''}
        <div class="table-scroll"><table class="table compact intel-table"><thead><tr>
          ${th('haul', 'name', 'Item', false)}<th>${tx('Rută')}</th>${th('haul', 'buy', 'Cumpăr la')}${th('haul', 'sell', 'Vând la')}${th('haul', 'unit', 'Profit / buc')}${th('haul', 'margin', 'Marjă')}${th('haul', 'm3', 'ISK / m³')}${th('haul', 'depth', 'Cerere')}${th('haul', 'trip', 'Profit / cursă')}
        </tr></thead><tbody>
        ${list.length ? list.map((h) => {
          const units = h.m3 > 0 ? Math.min(Math.floor(cargo / h.m3), h.depth) : 0;
          return `<tr>${itemCell(h.row)}<td class="dim small">${route(h)}</td><td class="r">${isk(h.buy)}</td><td class="r">${isk(h.sell)}</td><td class="r">${isk(h.unit)}</td><td class="r">${pct(h.margin)}</td><td class="r">${h.m3 > 0 ? isk(h.perM3) : '—'}</td><td class="r num">${formatInt(h.depth)}</td><td class="r gold-text">${units ? isk(units * h.unit) : '—'}</td></tr>`;
        }).join('') : `<tr><td colspan="9" class="dim">${tx('Nicio rută profitabilă peste prag.')}</td></tr>`}
        </tbody></table></div>`,
    });
  }

  async function runScan() {
    if (scanning) return;
    scanning = true;
    render();
    body.innerHTML = panel({ body: `${loader(tx('Scanăm piața Jita'))}<div class="intel-progress"><div class="meter-track"><span id="scanBar" style="width:0%"></span></div><p class="dim small num" id="scanText"></p></div>` });
    try {
      scan = await scanJita(settings.depth, (p) => {
        const barEl = body.querySelector<HTMLElement>('#scanBar'), text = body.querySelector<HTMLElement>('#scanText');
        if (barEl) barEl.style.width = `${p.total ? (p.done / p.total) * 100 : 0}%`;
        if (text) text.textContent = `${p.stage} · ${p.done} / ${p.total}`;
      });
      haul = null;
      scanning = false;
      if (!scan.rows.length) toast(tx('Scanarea nu a întors date'));
      render();
    } catch (err) {
      scanning = false;
      render();
      body.insertAdjacentHTML('afterbegin', panel({ body: alertBox((err as Error).message) }));
    }
  }

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const at = (s: string) => t.closest<HTMLElement>(s);
    const tb = at('[data-intel-tab]');
    if (tb) { tab = tb.dataset.intelTab as Tab; saveJson(TAB_KEY, tab); render(); return; }
    if (at('[data-scan]')) { runScan(); return; }
    if (at('[data-fee-reset]')) { settings.fees = null; save(); render(); return; }
    if (at('[data-haul-reload]')) { haul = null; haulError = ''; render(); return; }
    const s = at('[data-sort]');
    if (s) {
      const [id, key] = s.dataset.sort!.split(':');
      sort[id] = { key, desc: sort[id]?.key === key ? !sort[id].desc : key !== 'name' };
      saveJson(SORT_KEY, sort);
      render();
      return;
    }
    const open = at('[data-open]');
    if (open) {
      const id = Number(open.dataset.open);
      const r = scan?.rows.find((x) => x.typeId === id);
      if (r) onOpen(r.name, id);
    }
  });

  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const fee = t.dataset.fee as keyof Fees | undefined;
    if (fee) {
      const v = Number(t.value);
      if (!(v >= 0)) return;
      settings.fees = { ...fees(), [fee]: v };
      save();
      render();
      return;
    }
    const key = t.dataset.set as keyof Settings | undefined;
    if (!key) return;
    const v = ['category', 'hub', 'direction'].includes(key) ? t.value : Number(t.value) || 0;
    settings = { ...settings, [key]: v };
    if (key === 'hub') { haul = null; haulError = ''; }
    save();
    render();
  });

  render();

  return {
    fees,
    setContext(c: AppContext) {
      context = c;
      c.onCharacterChange(() => { if (!settings.fees) render(); });
      render();
    },
  };
}
