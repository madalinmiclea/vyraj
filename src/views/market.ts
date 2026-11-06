import { icon } from '../ui/icons';
import { pageHead, searchField, statCard, loader, alertBox, badge, button, esc, formatISK, formatInt, compactISK, copyText, toast, openModal, closeModal, panel, lore } from '../ui/components';
import { resolveType, fetchJitaAggregates, fetchHistory, lastDays, typeIconUrl, isGlobalMarket, JITA_REGION, type HistoryDay } from '../services/market';
import { openHubModal } from './hubModal';
import { createOrderBookPanel } from './marketBook';
import { allHubs, BASE_SALES_TAX, BASE_BROKER_FEE, type Fees } from '../services/intel';
import { seriesChart, bindSeriesChart, type SeriesPoint } from '../ui/charts';
import { addAlert, loadAlerts, hit } from '../services/alerts';
import { loadJson, saveJson } from '../storage';
import { tx } from '../i18n';
import { allEveItems } from '../data/items';
import { fold } from '../ui/fold';

const QUICK = ['PLEX', 'Large Skill Injector', 'Tritanium', 'Drake', 'Gila', 'Multispectrum Energized Membrane II', 'Compressed Veldspar', 'Nanite Repair Paste'];
const RECENT_KEY = 'eve-market:recent';
const RANGE_KEY = 'eve-market:history-range';
const RANGES = [30, 90, 365];
const HUB_KEY = 'eve-market:hub';
const HISTORY_MARKET_KEY = 'eve-market:history-market';


let nameIndex: Map<string, number> | null = null;
const typeIdByName = () => nameIndex ?? (allEveItems.length ? (nameIndex = new Map(allEveItems.map((it) => [it.n.trim(), it.t]))) : new Map<string, number>());

const loadRecent = () => loadJson<string[]>(RECENT_KEY, []);
function saveRecent(name: string) {
  saveJson(RECENT_KEY, [name, ...loadRecent().filter((n) => n !== name)].slice(0, 16));
}

export interface MarketView {
  show(itemName: string, knownTypeId?: number | null): Promise<void>;
  focus(): void;
  setInfo(fn: (typeId: number) => void, has: (typeId: number) => boolean): void;
  setFees(fn: () => Fees): void;
  itemsLoaded(): void;
}

export function createMarketView(el: HTMLElement, { onType }: { onType?: (q: string) => void }): MarketView {
  el.innerHTML = `
    ${pageHead(tx('Piață'), tx('Ordine din toate regiunile, istoric și hub-uri pentru orice item'), 'Conduit')}
    <div style="margin-bottom: 22px">
      ${searchField({ id: 'searchInput', placeholder: tx('Caută'), large: true, hint: 'Enter' })}
    </div>
    <div id="marketState"></div>
  `;

  const input = el.querySelector<HTMLInputElement>('#searchInput')!;
  const state = el.querySelector<HTMLElement>('#marketState')!;
  let lastPrices: Record<string, string> | null = null;
  let showInfo: ((typeId: number) => void) | null = null;
  let hasInfo: ((typeId: number) => boolean) | null = null;
  const infoButton = (typeId: number) => (isGlobalMarket(typeId) || (hasInfo && !hasInfo(typeId)) ? '' : button(tx('Informații'), { iconName: 'info', cls: 'ghost sm', attrs: `data-show-info="${typeId}"` }));
  let requestId = 0;
  let current: { typeId: number; name: string; sell: number; buy: number } | null = null;
  let history: HistoryDay[] = [];
  let range = loadJson<number>(RANGE_KEY, 90);
  let hubId = loadJson<string>(HUB_KEY, 'rens');
  if (!allHubs().some((h) => h.id === hubId)) hubId = 'rens';
  let historyMarket = loadJson<string>(HISTORY_MARKET_KEY, 'jita');
  let getFees: () => Fees = () => ({ salesTax: BASE_SALES_TAX, brokerFee: BASE_BROKER_FEE });
  const orderBook = createOrderBookPanel(() => getFees());
  const loadBook = (typeId: number) => { const el = state.querySelector<HTMLElement>('#bookPanel'); if (el) orderBook.load(el, typeId); };
  const hub = () => allHubs().find((h) => h.id === hubId)!;
  const historyName = () => (current && isGlobalMarket(current.typeId) ? tx('piața globală PLEX') : historyMarket === 'hub' ? hub().name : 'Jita');

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
    if (target.closest('[data-hub-add]')) {
      openHubModal((id) => {
        if (id) { hubId = id; saveJson(HUB_KEY, hubId); }
        if (!allHubs().some((h) => h.id === hubId)) hubId = 'rens';
        if (id) { historyMarket = 'hub'; saveJson(HISTORY_MARKET_KEY, historyMarket); }
        if (current) loadHistory(current.typeId, requestId);
      });
      return;
    }
    const hb = target.closest<HTMLElement>('[data-hub]');
    if (hb && current) { hubId = hb.dataset.hub!; saveJson(HUB_KEY, hubId); historyMarket = 'hub'; saveJson(HISTORY_MARKET_KEY, historyMarket); loadHistory(current.typeId, requestId); return; }
    const hm = target.closest<HTMLElement>('[data-history-market]');
    if (hm && current) { historyMarket = hm.dataset.historyMarket!; saveJson(HISTORY_MARKET_KEY, historyMarket); loadHistory(current.typeId, requestId); return; }
    if (target.closest('[data-alert]') && current) { openAlert(current); return; }
    const copy = target.closest<HTMLElement>('[data-copy]');
    if (copy && lastPrices?.[copy.dataset.copy!]) copyText(lastPrices[copy.dataset.copy!], tx('Preț copiat în clipboard'));
  });

  function renderWelcome() {
    const recent = loadRecent();
    const tile = (n: string) => {
      const t = typeIdByName().get(n);
      return `<button class="item-tile" data-item="${esc(n)}" title="${esc(n)}">${t ? `<img src="${typeIconUrl(t, 32)}" alt="" loading="lazy" />` : '<span></span>'}<span>${esc(n)}</span></button>`;
    };
    const section = (title: string, names: string[]) => names.length ? `<section class="item-tiles-block"><h4 class="window-title">${title}</h4><div class="item-tiles mini">${names.map(tile).join('')}</div></section>` : '';
    state.innerHTML = `<div class="market-welcome">
      <div class="market-welcome-head">${icon('market')}<div><h3>${lore(tx('Selectează o țintă'), 'Choose What the Conduit Weighs')}</h3><p>${lore(tx('Alege un item din browserul de iteme sau caută-l mai sus. Ordinele vin live din toate regiunile.'), 'Pick an item from the item browser or search above. Orders flow live from every region.')}</p></div></div>
      ${alertsBlock()}
      ${section(tx('Vizitate recent'), recent)}
      ${section(tx('Populare'), QUICK.filter((n) => !recent.includes(n)))}
    </div>`;
  }

  function alertsBlock() {
    const alerts = loadAlerts();
    if (!alerts.length) return '';
    const tiles = alerts.map((a) => {
      const on = a.current != null && hit(a, a.current);
      const rule = `${a.side === 'sell' ? 'Sell' : 'Buy'} ${a.op === 'below' ? '≤' : '≥'} ${compactISK(a.price)}`;
      const now = a.current != null ? ` · ${tx('acum {p}', { p: compactISK(a.current) })}` : '';
      return `<button class="item-tile ${on ? 'hit' : ''}" data-item="${esc(a.name)}"><img src="${typeIconUrl(a.typeId, 32)}" alt="" loading="lazy" /><span class="tile-text"><span>${esc(a.name)}</span><small>${rule}${now}</small></span></button>`;
    }).join('');
    return `<section class="item-tiles-block"><h4 class="window-title">${tx('Alerte de preț')}</h4><div class="item-tiles">${tiles}</div></section>`;
  }

  function openAlert(item: { typeId: number; name: string; sell: number; buy: number }) {
    const modal = openModal(`${tx('Alertă preț')} · ${item.name}`, `
      <div class="alert-form">
        <label>${tx('Preț')} <select class="input sm" id="alSide"><option value="sell">${tx('vânzare min')}</option><option value="buy">${tx('cumpărare max')}</option></select></label>
        <label><select class="input sm" id="alOp"><option value="below">${tx('sub sau egal cu')}</option><option value="above">${tx('peste sau egal cu')}</option></select></label>
        <label><input class="input sm num" id="alPrice" type="number" min="0" step="any" value="${Math.round(item.sell * 0.95)}" /> ISK</label>
      </div>
      <p class="dim small">${tx('Acum')}: ${tx('vânzare')} <span class="num">${formatISK(item.sell)}</span> · ${tx('cumpărare')} <span class="num">${formatISK(item.buy)}</span></p>
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
      ${allHubs().map((x) => `<button class="chip-btn ${historyMarket === 'hub' && x.id === hubId ? 'active' : ''}" data-hub="${x.id}">${esc(x.name)}</button>`).join('')}
      <button class="chip-btn" data-hub-add title="${esc(tx('Adaugă un hub propriu'))}">+</button>
    </div>`;
  }

  function renderHistory() {
    const el = state.querySelector<HTMLElement>('#historyPanel');
    if (!el) return;
    const days = lastDays(history, range);
    if (!days.length) { el.innerHTML = panel({ title: tx('Istoric preț {name}', { name: historyName() }), actions: historyChips(), body: `<p class="dim small">${tx('Fără istoric pentru itemul ăsta.')}</p>` }); return; }
    const points: SeriesPoint[] = days.map((d) => ({ label: d.date.slice(5).split('-').reverse().join('.'), value: d.average, low: d.lowest, high: d.highest, bar: d.volume }));
    const last30 = lastDays(history, 30);
    const avg30 = last30.reduce((a, d) => a + d.average * d.volume, 0) / Math.max(1, last30.reduce((a, d) => a + d.volume, 0));
    const vol30 = last30.reduce((a, d) => a + d.volume, 0) / 30;
    const first = days[0].average, last = days[days.length - 1].average;
    const change = first ? ((last - first) / first) * 100 : 0;
    el.innerHTML = panel({
      title: tx('Istoric preț {name}', { name: historyName() }),
      actions: `${historyChips()}<div class="advice-sort">${RANGES.map((n) => `<button class="chip-btn ${n === range ? 'active' : ''}" data-range="${n}">${n === 365 ? tx('1 an') : tx('{n} zile', { n })}</button>`).join('')}</div>`,
      body: `<div class="history-kpis">
          <div><span class="label">${tx('Medie 30 zile')}</span><span class="value">${last30.length ? compactISK(avg30) : '—'}</span></div>
          <div><span class="label">${tx('Volum pe zi')}</span><span class="value">${formatInt(vol30)}</span></div>
          <div><span class="label">${tx('Schimbare')} ${range === 365 ? tx('1 an') : tx('{n} zile', { n: range })}</span><span class="value ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : ''}${change.toFixed(1)}%</span></div>
          <div><span class="label">${tx('Min / max')}</span><span class="value">${compactISK(Math.min(...days.map((d) => d.lowest)))} / ${compactISK(Math.max(...days.map((d) => d.highest)))}</span></div>
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

  function localMatches(q: string) {
    const words = fold(q.trim()).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const full = words.join(' ');
    const rank = (n: string) => (n === full ? 0 : n.startsWith(full) ? 1 : n.includes(full) ? 2 : 3);
    return allEveItems
      .map((it) => ({ it, n: fold(it.n.trim()) }))
      .filter((x) => words.every((w) => x.n.includes(w)))
      .sort((a, b) => rank(a.n) - rank(b.n) || a.n.length - b.n.length || a.n.localeCompare(b.n))
      .map((x) => x.it);
  }

  async function show(itemName: string, knownTypeId: number | null = null) {
    if (knownTypeId == null && allEveItems.length) {
      const hits = localMatches(itemName);
      const exact = hits.find((h) => fold(h.n.trim()) === fold(itemName.trim()));
      if (exact) { show(exact.n.trim(), exact.t); return; }
      if (hits.length === 1) { show(hits[0].n.trim(), hits[0].t); return; }
      if (hits.length > 1) {
        ++requestId;
        input.value = itemName;
        current = null;
        const list = hits.slice(0, 24);
        state.innerHTML = panel({
          title: tx('Rezultate pentru „{q}”', { q: itemName }),
          count: hits.length > list.length ? tx('primele {n} din {total}', { n: list.length, total: formatInt(hits.length) }) : formatInt(hits.length),
          body: `<div class="item-tiles">${list.map((h) => `<button class="item-tile" data-item="${esc(h.n.trim())}"><img src="${typeIconUrl(h.t, 32)}" alt="" loading="lazy" /><span>${esc(h.n.trim())}</span></button>`).join('')}</div>`,
        });
        return;
      }
    }
    const id = ++requestId;
    input.value = itemName;
    state.innerHTML = loader(tx('Interogăm piața din Jita 4-4'));

    try {
      const { typeId, name } = knownTypeId ? { typeId: knownTypeId, name: itemName } : await resolveType(itemName);
      orderBook.prefetch(typeId);
      const p = await fetchJitaAggregates(typeId);
      if (id !== requestId) return;

      saveRecent(name);
      if (p.sellMin === 0 && p.buyMax === 0) {
        state.innerHTML = `
          <section class="panel item-head unlisted">
            <div class="item-icon"><img src="${typeIconUrl(typeId)}" alt="" /></div>
            <div>
              <h2 id="itemTitle">${esc(name)}</h2>
              <div class="meta">${badge(tx('Fără ordine în Jita'), 'warn', true)}</div>
            </div>
            <div class="actions">${infoButton(typeId)}<a class="btn ghost sm" href="https://everef.net/types/${typeId}" target="_blank" rel="noopener">${icon('external')}EVE Ref</a></div>
          </section>
          <div id="bookPanel"></div>`;
        current = { typeId, name, sell: 0, buy: 0 };
        loadBook(typeId);
        return;
      }

      lastPrices = { sell: p.sellMin > 0 ? p.sellMin.toFixed(2) : '', buy: p.buyMax > 0 ? p.buyMax.toFixed(2) : '', median: p.sellMedian > 0 ? p.sellMedian.toFixed(2) : '' };

      state.innerHTML = `
        <section class="panel glow item-head">
          <div class="item-icon"><img src="${typeIconUrl(typeId)}" alt="" /></div>
          <div>
            <h2 id="itemTitle">${esc(name)}</h2>
            <div class="meta">
              ${badge(isGlobalMarket(typeId) ? tx('Piața globală PLEX') : 'Jita 4-4', 'accent', true)}
            </div>
          </div>
          <div class="actions">
            ${infoButton(typeId)}
            ${button(tx('Copiază prețul de vânzare'), { iconName: 'copy', cls: 'ghost sm', attrs: 'data-copy="sell"' })}
            ${button(tx('Alertă preț'), { iconName: 'alert', cls: 'ghost sm', attrs: 'data-alert' })}
            <a class="btn ghost sm" href="https://everef.net/types/${typeId}" target="_blank" rel="noopener">${icon('external')}EVE Ref</a>
          </div>
        </section>

        <div id="bookPanel"></div>

        <div class="stats">
          ${statCard({ label: tx('Cea mai mică ofertă de vânzare'), id: 'sellPrice', tone: 'sell' })}
          ${statCard({ label: tx('Cea mai mare ofertă de cumpărare'), id: 'buyPrice', tone: 'buy' })}
          ${statCard({ label: tx('Preț median (vânzare)'), id: 'medianPrice', tone: 'median' })}
        </div>

        <div id="historyPanel"></div>
      `;
      current = { typeId, name, sell: p.sellMin, buy: p.buyMax };
      loadBook(typeId);
      loadHistory(typeId, id);

      const setStat = (sid: string, value: number, meta: string) => {
        const valueEl = state.querySelector<HTMLElement>('#' + sid)!;
        valueEl.innerHTML = value > 0 ? `${formatISK(value)}<small>ISK</small>` : '—';
        valueEl.title = value > 0 ? `${compactISK(value)} ISK` : tx('Niciun ordin pe partea asta');
        state.querySelector('#' + sid + 'Meta')!.innerHTML = meta;
      };
      setStat('sellPrice', p.sellMin, tx('Volum <span class="num">{v}</span> · <span class="num">{n}</span> ordine', { v: formatInt(p.sellVolume), n: formatInt(p.sellOrders) }));
      setStat('buyPrice', p.buyMax, tx('Volum <span class="num">{v}</span> · <span class="num">{n}</span> ordine', { v: formatInt(p.buyVolume), n: formatInt(p.buyOrders) }));
      setStat('medianPrice', p.sellMedian, p.sellMedian > 0 ? `≈ <span class="num">${compactISK(p.sellMedian)}</span> ISK` : tx('Fără ordine de vânzare'));
    } catch (err) {
      if (id !== requestId) return;
      const msg = err instanceof TypeError ? tx('Nu am putut contacta serverul de prețuri (Fuzzwork). Verifică conexiunea și încearcă din nou.') : (err as Error).message;
      input.value = itemName;
      state.innerHTML = `${alertBox(msg)}<div class="row-actions">${button(tx('Încearcă din nou'), { iconName: 'refresh', cls: 'sm', attrs: 'data-market-retry' })}</div>`;
      const retry = () => {
        window.removeEventListener('online', retry);
        if (id === requestId) show(itemName, knownTypeId);
      };
      state.querySelector('[data-market-retry]')?.addEventListener('click', retry);
      window.addEventListener('online', retry);
      setTimeout(() => { if (id === requestId && state.querySelector('[data-market-retry]')) retry(); }, 30_000);
    }
  }

  renderWelcome();
  return {
    show,
    focus: () => input.focus(),
    setInfo: (fn, has) => {
      showInfo = fn;
      hasInfo = has;
      state.querySelectorAll<HTMLElement>('[data-show-info]').forEach((b) => { if (!has(Number(b.dataset.showInfo))) b.remove(); });
    },
    setFees: (fn) => { getFees = fn; },
    itemsLoaded: () => { if (!current && state.querySelector('.market-welcome')) renderWelcome(); },
  };
}
