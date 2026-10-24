import { icon } from '../ui/icons';
import { pageHead, searchField, statCard, emptyState, loader, alertBox, badge, button, esc, formatISK, formatInt, compactISK, copyText, toast, openModal, closeModal, panel } from '../ui/components';
import { resolveType, fetchJitaAggregates, fetchHistory, typeIconUrl, isGlobalMarket, JITA_REGION, type HistoryDay, type Aggregates } from '../services/market';
import { HUBS, fetchHubPrices, BASE_SALES_TAX, type Fees, type HubPrice } from '../services/intel';
import { seriesChart, bindSeriesChart, type SeriesPoint } from '../ui/charts';
import { addAlert } from '../services/alerts';
import { loadJson, saveJson } from '../storage';
import { tx } from '../i18n';
import { allEveItems } from '../data/items';

const QUICK = ['PLEX', 'Large Skill Injector', 'Tritanium', 'Drake', 'Gila', 'Multispectrum Energized Membrane II', 'Compressed Veldspar', 'Nanite Repair Paste'];
const RECENT_KEY = 'eve-market:recent';
const RANGE_KEY = 'eve-market:history-range';
const RANGES = [30, 90, 365];
const HUB_KEY = 'eve-market:hub';
const HISTORY_MARKET_KEY = 'eve-market:history-market';

let nameIndex: Map<string, number> | null = null;
const typeIdByName = () => nameIndex ?? (allEveItems.length ? (nameIndex = new Map(allEveItems.map((it) => [it.n, it.t]))) : new Map<string, number>());

const loadRecent = () => loadJson<string[]>(RECENT_KEY, []);
function saveRecent(name: string) {
  saveJson(RECENT_KEY, [name, ...loadRecent().filter((n) => n !== name)].slice(0, 16));
}

export interface MarketView {
  show(itemName: string, knownTypeId?: number | null): Promise<void>;
  focus(): void;
  setInfo(fn: (typeId: number) => void): void;
  setFees(fn: () => Fees): void;
  itemsLoaded(): void;
}

export function createMarketView(el: HTMLElement, { onType }: { onType?: (q: string) => void }): MarketView {
  el.innerHTML = `
    ${pageHead('Market', 'Jita IV - Moon 4 · Caldari Navy Assembly Plant', 'Conduit')}
    <div style="margin-bottom: 22px">
      ${searchField({ id: 'searchInput', placeholder: tx('Caută'), large: true, hint: 'Enter' })}
    </div>
    <div id="marketState"></div>
  `;

  const input = el.querySelector<HTMLInputElement>('#searchInput')!;
  const state = el.querySelector<HTMLElement>('#marketState')!;
  let lastPrices: Record<string, string> | null = null;
  let showInfo: ((typeId: number) => void) | null = null;
  let requestId = 0;
  let current: { typeId: number; name: string; sell: number; buy: number } | null = null;
  let history: HistoryDay[] = [];
  let range = loadJson<number>(RANGE_KEY, 90);
  let hubId = loadJson<string>(HUB_KEY, 'rens');
  if (!HUBS.some((h) => h.id === hubId)) hubId = 'rens';
  let historyMarket = loadJson<string>(HISTORY_MARKET_KEY, 'jita');
  let getFees: () => Fees = () => ({ salesTax: BASE_SALES_TAX, brokerFee: 3 });
  let jitaPrices: Aggregates | null = null;
  const hub = () => HUBS.find((h) => h.id === hubId)!;
  const historyName = () => (historyMarket === 'hub' ? hub().name : 'Jita');

  input.addEventListener('input', () => onType?.(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) show(input.value.trim());
  });

  state.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const chip = target.closest<HTMLElement>('[data-item]');
    if (chip) { input.value = chip.dataset.item!; show(chip.dataset.item!); return; }
    const info = target.closest<HTMLElement>('[data-show-info]');
    if (info) { if (showInfo) showInfo(Number(info.dataset.showInfo)); else toast(tx('Datele de fitting încă se încarcă')); return; }
    const r = target.closest<HTMLElement>('[data-range]');
    if (r) { range = Number(r.dataset.range); saveJson(RANGE_KEY, range); renderHistory(); return; }
    const hb = target.closest<HTMLElement>('[data-hub]');
    if (hb && current) { hubId = hb.dataset.hub!; saveJson(HUB_KEY, hubId); loadHub(current.typeId, requestId); if (historyMarket === 'hub') loadHistory(current.typeId, requestId); return; }
    const hm = target.closest<HTMLElement>('[data-history-market]');
    if (hm && current) { historyMarket = hm.dataset.historyMarket!; saveJson(HISTORY_MARKET_KEY, historyMarket); loadHistory(current.typeId, requestId); return; }
    if (target.closest('[data-alert]') && current) { openAlert(current); return; }
    const copy = target.closest<HTMLElement>('[data-copy]');
    if (copy && lastPrices) copyText(lastPrices[copy.dataset.copy!], tx('Preț copiat în clipboard'));
  });

  function renderWelcome() {
    const recent = loadRecent();
    const tile = (n: string) => {
      const t = typeIdByName().get(n);
      return `<button class="item-tile" data-item="${esc(n)}">${t ? `<img src="${typeIconUrl(t, 32)}" alt="" loading="lazy" />` : '<span></span>'}<span>${esc(n)}</span></button>`;
    };
    const section = (title: string, names: string[]) => names.length ? `<section class="item-tiles-block"><h4 class="window-title">${title}</h4><div class="item-tiles">${names.map(tile).join('')}</div></section>` : '';
    state.innerHTML = `<div class="market-welcome">
      <div class="market-welcome-head">${icon('market')}<div><h3>${tx('Selectează o țintă')}</h3><p>${tx('Alege un item din browserul din stânga sau caută-l mai sus. Prețurile vin live din ordinele din Jita 4-4.')}</p></div></div>
      ${section(tx('Vizitate recent'), recent)}
      ${section(tx('Populare'), QUICK.filter((n) => !recent.includes(n)))}
    </div>`;
  }

  function openAlert(item: { typeId: number; name: string; sell: number; buy: number }) {
    const modal = openModal(`${tx('Alertă preț')} · ${item.name}`, `
      <div class="alert-form">
        <label>${tx('Preț')} <select class="input sm" id="alSide"><option value="sell">sell min</option><option value="buy">buy max</option></select></label>
        <label><select class="input sm" id="alOp"><option value="below">${tx('sub sau egal cu')}</option><option value="above">${tx('peste sau egal cu')}</option></select></label>
        <label><input class="input sm num" id="alPrice" type="number" min="0" step="any" value="${Math.round(item.sell * 0.95)}" /> ISK</label>
      </div>
      <p class="dim small">${tx('Acum')}: sell <span class="num">${formatISK(item.sell)}</span> · buy <span class="num">${formatISK(item.buy)}</span></p>
      <div class="row-actions"><button class="btn sm" data-save-alert>${tx('Salvează alerta')}</button></div>`);
    modal.querySelector('[data-save-alert]')!.addEventListener('click', () => {
      const price = Number(modal.querySelector<HTMLInputElement>('#alPrice')!.value);
      if (!(price > 0)) { toast(tx('Pune un preț')); return; }
      addAlert({
        typeId: item.typeId, name: item.name, price,
        side: modal.querySelector<HTMLSelectElement>('#alSide')!.value as 'sell' | 'buy',
        op: modal.querySelector<HTMLSelectElement>('#alOp')!.value as 'below' | 'above',
      });
      closeModal();
      toast(tx('Alertă salvată'));
    });
  }

  function historyChips() {
    if (current && isGlobalMarket(current.typeId)) return '';
    return `<div class="advice-sort">
      <button class="chip-btn ${historyMarket !== 'hub' ? 'active' : ''}" data-history-market="jita">Jita</button>
      <button class="chip-btn ${historyMarket === 'hub' ? 'active' : ''}" data-history-market="hub">${hub().name}</button>
    </div>`;
  }

  function hubTable(j: Aggregates, h: HubPrice) {
    const name = hub().name;
    const tax = getFees().salesTax;
    const diff = (a: number, b: number) => {
      if (!(a > 0 && b > 0)) return '<span class="dim">—</span>';
      const d = (a / b - 1) * 100;
      return `<span class="num ${d > 0.05 ? 'pos' : d < -0.05 ? 'neg-text' : ''}">${d > 0 ? '+' : ''}${d.toFixed(1)}%</span>`;
    };
    const route = (from: string, to: string, buy: number, sell: number, depth: number) => {
      if (!(buy > 0 && sell > 0)) return `<tr><td>${from} → ${to}</td><td class="r dim" colspan="5">${tx('fără ordine pe una din părți')}</td></tr>`;
      const unit = sell * (1 - tax / 100) - buy;
      const margin = (unit / buy) * 100;
      return `<tr><td>${from} → ${to}</td><td class="r num">${formatISK(buy)}</td><td class="r num">${formatISK(sell)}</td><td class="r num ${unit > 0 ? 'pos' : 'neg-text'}">${formatISK(unit)}</td><td class="r num ${unit > 0 ? 'pos' : 'neg-text'}">${margin > 0 ? '+' : ''}${margin.toFixed(1)}%</td><td class="r num">${formatInt(depth)}</td></tr>`;
    };
    const row = (label: string, p: { sellMin: number; buyMax: number; sellVolume: number; buyVolume: number; sellOrders: number; buyOrders: number }) => `<tr>
      <td><b>${label}</b></td>
      <td class="r num">${p.buyMax > 0 ? formatISK(p.buyMax) : '—'}</td>
      <td class="r num">${p.sellMin > 0 ? formatISK(p.sellMin) : '—'}</td>
      <td class="r num">${formatInt(p.buyVolume)} <span class="dim">/ ${formatInt(p.buyOrders)}</span></td>
      <td class="r num">${formatInt(p.sellVolume)} <span class="dim">/ ${formatInt(p.sellOrders)}</span></td>
    </tr>`;
    const hp = { sellMin: h.sellMin, buyMax: h.buyMax, sellVolume: h.sellBook, buyVolume: h.buyBook, sellOrders: h.sellOrders, buyOrders: h.buyOrders };
    return `<table class="table compact hub-table"><thead><tr><th>${tx('Piață')}</th><th class="r">Buy max</th><th class="r">Sell min</th><th class="r">${tx('Volum buy / ordine')}</th><th class="r">${tx('Volum sell / ordine')}</th></tr></thead><tbody>
        ${row('Jita 4-4', j)}
        ${row(name, hp)}
        <tr class="hub-diff"><td class="dim">${tx('{name} față de Jita', { name })}</td><td class="r">${diff(h.buyMax, j.buyMax)}</td><td class="r">${diff(h.sellMin, j.sellMin)}</td><td></td><td></td></tr>
      </tbody></table>
      <h4 class="sub-head">${tx('Cumpăr instant → vând instant, după sales tax {tax}%', { tax: tax.toFixed(2) })}</h4>
      <table class="table compact hub-table"><thead><tr><th>${tx('Rută')}</th><th class="r">${tx('Cumpăr la')}</th><th class="r">${tx('Vând la')}</th><th class="r">${tx('Profit / buc')}</th><th class="r">${tx('Marjă')}</th><th class="r">${tx('Cerere')}</th></tr></thead><tbody>
        ${route('Jita', name, j.sellMin, h.buyMax, h.buyBook)}
        ${route(name, 'Jita', h.sellMin, j.buyMax, Math.min(h.sellBook, j.buyVolume))}
      </tbody></table>`;
  }

  async function loadHub(typeId: number, id: number) {
    const el = state.querySelector<HTMLElement>('#hubPanel');
    if (!el || !jitaPrices || isGlobalMarket(typeId)) return;
    const h = hub();
    const actions = `<div class="advice-sort">${HUBS.map((x) => `<button class="chip-btn ${x.id === h.id ? 'active' : ''}" data-hub="${x.id}">${x.name}</button>`).join('')}</div>`;
    el.innerHTML = panel({ title: `Jita vs ${h.name}`, actions, body: loader(tx('Prețuri {name}', { name: h.name })) });
    try {
      const prices = await fetchHubPrices(h, [typeId]);
      if (id !== requestId || !jitaPrices) return;
      const hp = prices.get(typeId) ?? { sellMin: 0, buyMax: 0, sellBook: 0, buyBook: 0, sellOrders: 0, buyOrders: 0 };
      el.innerHTML = panel({ title: `Jita vs ${h.name}`, actions, body: hubTable(jitaPrices, hp) });
    } catch (err) {
      if (id === requestId) el.innerHTML = panel({ title: `Jita vs ${h.name}`, actions, body: alertBox((err as Error).message) });
    }
  }

  function renderHistory() {
    const el = state.querySelector<HTMLElement>('#historyPanel');
    if (!el) return;
    const days = history.slice(-range);
    if (!days.length) { el.innerHTML = panel({ title: tx('Istoric preț {name}', { name: historyName() }), actions: historyChips(), body: `<p class="dim small">${tx('Fără istoric pentru itemul ăsta.')}</p>` }); return; }
    const points: SeriesPoint[] = days.map((d) => ({ label: d.date.slice(5).split('-').reverse().join('.'), value: d.average, low: d.lowest, high: d.highest, bar: d.volume }));
    const last30 = history.slice(-30);
    const avg30 = last30.reduce((a, d) => a + d.average * d.volume, 0) / Math.max(1, last30.reduce((a, d) => a + d.volume, 0));
    const vol30 = last30.reduce((a, d) => a + d.volume, 0) / Math.max(1, last30.length);
    const first = days[0].average, last = days[days.length - 1].average;
    const change = first ? ((last - first) / first) * 100 : 0;
    el.innerHTML = panel({
      title: tx('Istoric preț {name}', { name: historyName() }),
      actions: `${historyChips()}<div class="advice-sort">${RANGES.map((n) => `<button class="chip-btn ${n === range ? 'active' : ''}" data-range="${n}">${n === 365 ? tx('1 an') : tx('{n} zile', { n })}</button>`).join('')}</div>`,
      body: `<div class="history-kpis">
          <div><span class="label">${tx('Medie 30 zile')}</span><span class="value">${compactISK(avg30)}</span></div>
          <div><span class="label">${tx('Volum pe zi')}</span><span class="value">${formatInt(vol30)}</span></div>
          <div><span class="label">${tx('Schimbare')} ${range === 365 ? tx('1 an') : tx('{n} zile', { n: range })}</span><span class="value ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : ''}${change.toFixed(1)}%</span></div>
          <div><span class="label">Min / max</span><span class="value">${compactISK(Math.min(...days.map((d) => d.lowest)))} / ${compactISK(Math.max(...days.map((d) => d.highest)))}</span></div>
        </div>
        ${seriesChart(points)}`,
    });
    bindSeriesChart(el, points);
  }

  async function loadHistory(typeId: number, id: number) {
    const el = state.querySelector<HTMLElement>('#historyPanel');
    if (!el) return;
    el.innerHTML = panel({ title: tx('Istoric preț {name}', { name: historyName() }), actions: historyChips(), body: loader(tx('Încarc istoricul')) });
    try {
      const h = await fetchHistory(typeId, historyMarket === 'hub' ? hub().region : JITA_REGION);
      if (id !== requestId) return;
      history = h;
      renderHistory();
    } catch (err) {
      if (id === requestId) el.innerHTML = panel({ title: tx('Istoric preț {name}', { name: historyName() }), actions: historyChips(), body: alertBox((err as Error).message) });
    }
  }

  async function show(itemName: string, knownTypeId: number | null = null) {
    const id = ++requestId;
    input.value = itemName;
    state.innerHTML = loader(tx('Interogăm piața din Jita 4-4'));

    try {
      const { typeId, name } = knownTypeId ? { typeId: knownTypeId, name: itemName } : await resolveType(itemName);
      const p = await fetchJitaAggregates(typeId);
      if (id !== requestId) return;

      saveRecent(name);
      if (p.sellMin === 0 && p.buyMax === 0) {
        state.innerHTML = `
          <section class="panel item-head unlisted">
            <div class="item-icon"><img src="${typeIconUrl(typeId)}" alt="" /></div>
            <div>
              <h2 id="itemTitle">${esc(name)}</h2>
              <div class="meta">${badge(tx('Fără ordine în Jita'), 'warn', true)}${badge('Type ID ' + typeId)}</div>
            </div>
            <div class="actions">${button('Show Info', { iconName: 'info', cls: 'ghost sm', attrs: `data-show-info="${typeId}"` })}<a class="btn ghost sm" href="https://everef.net/types/${typeId}" target="_blank" rel="noopener">${icon('external')}EVE Ref</a></div>
          </section>
          ${emptyState({ title: tx('Nimeni nu vinde sau cumpără acum'), text: tx('Itemul există în joc, dar nu are niciun ordin activ în Jita (des întâlnit la module de officer și iteme rare). Verifică din nou mai târziu; prețurile se reîmprospătează la fiecare căutare.') })}
          <div id="hubPanel" class="hub-panel"></div>`;
        current = { typeId, name, sell: 0, buy: 0 };
        jitaPrices = p;
        loadHub(typeId, id);
        return;
      }

      const spread = p.sellMin - p.buyMax;
      const pct = p.buyMax > 0 ? (spread / p.buyMax) * 100 : 0;
      lastPrices = { sell: p.sellMin.toFixed(2), buy: p.buyMax.toFixed(2), median: p.sellMedian.toFixed(2) };

      state.innerHTML = `
        <section class="panel glow item-head">
          <div class="item-icon"><img src="${typeIconUrl(typeId)}" alt="" /></div>
          <div>
            <h2 id="itemTitle">${esc(name)}</h2>
            <div class="meta">
              ${badge(isGlobalMarket(typeId) ? tx('Piața globală PLEX') : 'Jita 4-4', 'accent', true)}
              ${badge('Type ID ' + typeId)}
            </div>
          </div>
          <div class="actions">
            ${button('Show Info', { iconName: 'info', cls: 'ghost sm', attrs: `data-show-info="${typeId}"` })}
            ${button(tx('Copiază sell'), { iconName: 'copy', cls: 'ghost sm', attrs: 'data-copy="sell"' })}
            ${button(tx('Alertă preț'), { iconName: 'alert', cls: 'ghost sm', attrs: 'data-alert' })}
            <a class="btn ghost sm" href="https://everef.net/types/${typeId}" target="_blank" rel="noopener">${icon('external')}EVE Ref</a>
          </div>
        </section>

        <div class="stats">
          ${statCard({ label: tx('Cel mai mic sell'), id: 'sellPrice', tone: 'sell' })}
          ${statCard({ label: tx('Cel mai mare buy'), id: 'buyPrice', tone: 'buy' })}
          ${statCard({ label: tx('Preț median (sell)'), id: 'medianPrice', tone: 'median' })}
        </div>

        <section class="panel spread">
          <div>
            <div class="label">${tx('Marjă buy → sell (cumpăr la buy, vând la sell)')}</div>
            <div class="amount" id="spreadAmount">${formatISK(spread)} <small class="dim" style="font-size:15px">ISK</small></div>
          </div>
          <div class="spread-gauge">
            <div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, pct * 2))}%"></div></div>
            <div class="ticks"><span>0%</span><span>25%</span><span>50%+</span></div>
          </div>
          <div class="pct ${pct < 0 ? 'neg' : ''}" id="spreadPercent">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</div>
        </section>
        <div id="hubPanel" class="hub-panel"></div>
        <div id="historyPanel"></div>
      `;
      current = { typeId, name, sell: p.sellMin, buy: p.buyMax };
      jitaPrices = p;
      loadHub(typeId, id);
      loadHistory(typeId, id);

      const setStat = (sid: string, value: number, meta: string) => {
        const valueEl = state.querySelector<HTMLElement>('#' + sid)!;
        valueEl.innerHTML = `${formatISK(value)}<small>ISK</small>`;
        valueEl.title = `${compactISK(value)} ISK`;
        state.querySelector('#' + sid + 'Meta')!.innerHTML = meta;
      };
      setStat('sellPrice', p.sellMin, tx('Volum <span class="num">{v}</span> · <span class="num">{n}</span> ordine', { v: formatInt(p.sellVolume), n: formatInt(p.sellOrders) }));
      setStat('buyPrice', p.buyMax, tx('Volum <span class="num">{v}</span> · <span class="num">{n}</span> ordine', { v: formatInt(p.buyVolume), n: formatInt(p.buyOrders) }));
      setStat('medianPrice', p.sellMedian, `≈ <span class="num">${compactISK(p.sellMedian)}</span> ISK`);
    } catch (err) {
      if (id !== requestId) return;
      const msg = err instanceof TypeError ? tx('Nu am putut contacta serverul de prețuri (Fuzzwork). Verifică conexiunea și încearcă din nou.') : (err as Error).message;
      state.innerHTML = alertBox(msg);
    }
  }

  renderWelcome();
  return {
    show,
    focus: () => input.focus(),
    setInfo: (fn) => { showInfo = fn; },
    setFees: (fn) => { getFees = fn; },
    itemsLoaded: () => { if (!current && state.querySelector('.market-welcome')) renderWelcome(); },
  };
}
