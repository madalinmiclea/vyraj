import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, formatInt, formatISK, compactISK, copyText, emptyState, windowTitle, badge, button } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { typeIconUrl } from '../services/market';
import { universeNames } from '../character/esi';
import { rosterCharacters } from '../character/roster';
import {
  scanOrders, lastScan, orderHistory, orderCharacters, notifyEnabled, setNotify, typeName, priceTick, expiresAt, modifiableAt,
  ORDERS_EVENT, type TrackedOrder, type Competition, type OrdersScan, type CharacterOrder,
} from '../services/orders';
import { tx, locale } from '../i18n';

type Tab = 'active' | 'history';
type Filter = 'all' | 'sell' | 'buy' | 'beaten';

const UI_KEY = 'eve-orders:ui';

interface UiState { tab: Tab; filter: Filter; character: number | 0 }

const FILTERS: [Filter, string][] = [
  ['all', tx('Toate')],
  ['sell', 'Sell'],
  ['buy', 'Buy'],
  ['beaten', tx('Depășite')],
];

const dateTime = (ms: number) => new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const remaining = (ms: number) => {
  const m = Math.round(ms / 60000);
  if (m <= 0) return tx('expirat');
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  return tx('{n} zile', { n: Math.floor(h / 24) });
};

const plainPrice = (v: number) => v.toFixed(2);

export function createOrdersView(el: HTMLElement, ctx: AppContext, side: HTMLElement, deps: { onOpen: (name: string, typeId: number) => void }) {
  const ui = loadJson<UiState>(UI_KEY, { tab: 'active', filter: 'all', character: 0 });
  if (!['active', 'history'].includes(ui.tab)) ui.tab = 'active';
  const places = new Map<number, string>();
  const history = new Map<number, CharacterOrder[]>();
  let busy = false;
  let error = '';

  el.innerHTML = `${pageHead(tx('Ordine market'), tx('Ordinele tuturor caracterelor, cu alertă la outbid și undercut'), 'Torg')}
    <div id="ordBody"></div>`;
  const body = el.querySelector<HTMLElement>('#ordBody')!;

  const save = () => saveJson(UI_KEY, ui);

  function renderSide(scan: OrdersScan | null) {
    const chars = orderCharacters();
    const count = (id: number) => scan?.orders.filter((o) => o.characterId === id).length ?? 0;
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Ordine market'))}</div>
      <div class="side-nav">
        <button class="side-link ${ui.tab === 'active' ? 'active' : ''}" data-ord-tab="active">${tx('Ordine active')}</button>
        <button class="side-link ${ui.tab === 'history' ? 'active' : ''}" data-ord-tab="history">${tx('Istoric ordine')}</button>
        ${chars.length > 1 ? `<div class="ord-side-label">${tx('Caractere')}</div>
          <button class="side-link ${!ui.character ? 'active' : ''}" data-ord-char="0">${tx('Toate caracterele')}${scan ? `<span class="ord-count">${scan.orders.length}</span>` : ''}</button>
          ${chars.map((c) => `<button class="side-link ${ui.character === c.characterId ? 'active' : ''}" data-ord-char="${c.characterId}">${esc(c.name)}${scan ? `<span class="ord-count">${count(c.characterId!)}</span>` : ''}</button>`).join('')}` : ''}
      </div>`;
  }

  async function resolvePlaces(orders: CharacterOrder[], characterId: number) {
    const ids = [...new Set(orders.map((o) => o.location_id))].filter((id) => !places.has(id));
    if (!ids.length) return;
    const names = await universeNames(ids, characterId).catch(() => new Map<number, string>());
    for (const id of ids) places.set(id, names.get(id) ?? (id >= 1e12 ? tx('Structură {id}', { id }) : String(id)));
  }

  async function resolveAll(orders: TrackedOrder[]) {
    const byChar = new Map<number, TrackedOrder[]>();
    for (const o of orders) byChar.set(o.characterId, [...(byChar.get(o.characterId) ?? []), o]);
    for (const [id, list] of byChar) await resolvePlaces(list, id);
  }

  const place = (id: number) => places.get(id) ?? '…';

  function statusBadge(o: TrackedOrder, c: Competition | undefined) {
    if (!c || c.status === 'unknown') return badge(tx('Necunoscut'), '', true);
    if (c.status === 'best') return badge(c.competitors ? tx('Cel mai bun') : tx('Singur'), 'ok', true);
    if (c.status === 'tied') return badge(tx('Egal'), 'warn', true);
    return badge(o.is_buy_order ? tx('Outbid ({n})', { n: c.ahead }) : tx('Undercut ({n})', { n: c.ahead }), 'danger', true);
  }

  function rivalCell(o: TrackedOrder, c: Competition | undefined) {
    if (!c || c.best == null) return '<span class="dim">—</span>';
    if (c.status === 'best') return c.next != null
      ? `<span class="num">${formatISK(c.next)}</span><div class="small dim">${tx('următorul, la {d}', { d: compactISK(Math.abs(c.next - o.price)) })}</div>`
      : '<span class="dim">—</span>';
    return `<span class="num">${formatISK(c.best)}</span><div class="small dim">${c.status === 'tied' ? tx('același preț') : `${o.is_buy_order ? '+' : '−'}${compactISK(Math.abs(c.best - o.price))}`}</div>`;
  }

  function actionCell(o: TrackedOrder, c: Competition | undefined) {
    const wait = modifiableAt(o) - Date.now();
    const timer = wait > 0 ? `<div class="small warn-text">${tx('modificabil în {t}', { t: remaining(wait) })}</div>` : '';
    if (c?.target != null) {
      return `${button(formatISK(c.target), { iconName: 'copy', cls: 'sm', attrs: `data-copy-price="${plainPrice(c.target)}" data-tip="${esc(tx('Copiază prețul nou, apoi Modify Order în joc și Ctrl+V'))}"` })}${timer}`;
    }
    return `<button class="btn ghost sm" data-copy-price="${plainPrice(o.price)}">${icon('copy')}${tx('Copiază')}</button>${timer}`;
  }

  function kpis(list: TrackedOrder[], scan: OrdersScan) {
    const sells = list.filter((o) => !o.is_buy_order);
    const buys = list.filter((o) => o.is_buy_order);
    const beaten = list.filter((o) => scan.competition.get(o.order_id)?.status === 'beaten').length;
    const soon = list.filter((o) => expiresAt(o) - Date.now() < 86_400_000).length;
    return `<div class="history-kpis">
      <div><span class="label">${tx('Ordine active')}</span><span class="value">${formatInt(list.length)}</span></div>
      <div><span class="label">${tx('Valoare sell')}</span><span class="value">${compactISK(sells.reduce((a, o) => a + o.price * o.volume_remain, 0))}</span></div>
      <div><span class="label">${tx('Escrow buy')}</span><span class="value">${compactISK(buys.reduce((a, o) => a + (o.escrow ?? 0), 0))}</span></div>
      <div><span class="label">${tx('Rămas de cumpărat')}</span><span class="value">${compactISK(buys.reduce((a, o) => a + o.price * o.volume_remain, 0))}</span></div>
      <div><span class="label">${tx('Depășite')}</span><span class="value ${beaten ? 'ord-bad' : ''}">${beaten}</span></div>
      <div><span class="label">${tx('Expiră în 24 h')}</span><span class="value">${soon}</span></div>
    </div>`;
  }

  const orderRow = (o: TrackedOrder, c: Competition | undefined, multi: boolean) => `<tr class="${c?.status === 'beaten' ? 'ord-beaten' : ''}">
      <td><button class="link ord-item" data-ord-open="${o.type_id}"><img class="row-icon" src="${typeIconUrl(o.type_id, 32)}" alt="" />${esc(typeName(o.type_id))}</button> ${o.is_buy_order ? badge('Buy', 'accent') : badge('Sell', 'gold')}${o.is_corporation ? badge('Corp') : ''}
        <div class="small dim ord-place" title="${esc(place(o.location_id))}">${multi ? `${esc(o.characterName)} · ` : ''}${esc(place(o.location_id))}${o.is_buy_order && o.range !== 'station' ? ` · ${tx('rază')} ${esc(o.range)}` : ''}</div></td>
      <td class="r"><span class="num">${formatISK(o.price)}</span><div class="small dim">tick ${formatISK(priceTick(o.price))}</div></td>
      <td class="r">${rivalCell(o, c)}</td>
      <td>${statusBadge(o, c)}</td>
      <td class="r num">${formatInt(o.volume_remain)}<div class="small dim">/ ${formatInt(o.volume_total)}</div></td>
      <td class="r num">${remaining(expiresAt(o) - Date.now())}</td>
      <td class="r ord-action">${actionCell(o, c)}</td>
    </tr>`;

  function activeTab() {
    const scan = lastScan();
    const chars = rosterCharacters();
    if (!chars.length) {
      body.innerHTML = panel({ body: emptyState({ title: tx('Niciun caracter logat'), text: tx('Fă login cu EVE din ecranul Caracter ca să vezi ordinele de market.') }) });
      return;
    }
    const warn = scan?.missingScope.length
      ? alertBox(tx('Fără permisiunea pentru ordine: {names}. Fă din nou login cu aceste caractere din meniul de caractere.', { names: scan.missingScope.join(', ') }), 'warn')
      : '';
    if (!scan) {
      body.innerHTML = panel({ body: busy ? loader(tx('Citim ordinele și registrul de market')) : error ? alertBox(error) : '' });
      return;
    }
    const multi = new Set(scan.orders.map((o) => o.characterId)).size > 1 && !ui.character;
    const mine = scan.orders.filter((o) => !ui.character || o.characterId === ui.character);
    const status = (o: TrackedOrder) => scan.competition.get(o.order_id)?.status;
    const rank = (o: TrackedOrder) => ({ beaten: 0, tied: 1, unknown: 2, best: 3 })[status(o) ?? 'unknown'];
    const list = mine
      .filter((o) => ui.filter === 'all' || (ui.filter === 'sell' ? !o.is_buy_order : ui.filter === 'buy' ? o.is_buy_order : status(o) === 'beaten' || status(o) === 'tied'))
      .sort((a, b) => rank(a) - rank(b) || Number(Boolean(a.is_buy_order)) - Number(Boolean(b.is_buy_order)) || typeName(a.type_id).localeCompare(typeName(b.type_id)));
    const actions = `<div class="advice-sort">${FILTERS.map(([id, label]) => `<button class="chip-btn ${ui.filter === id ? 'active' : ''}" data-ord-filter="${id}">${label}</button>`).join('')}</div>
      <button class="btn ghost sm" data-ord-refresh ${busy ? 'disabled' : ''}>${icon('refresh')}${busy ? tx('Se verifică…') : tx('Verifică acum')}</button>`;
    body.innerHTML = `${warn}${scan.errors.map((e) => alertBox(e)).join('')}
      ${panel({
        title: tx('Ordine active'),
        count: list.length,
        actions,
        body: `${kpis(mine, scan)}
          <div class="ord-meta small dim">
            <span>${tx('Verificat la {time}. Se reverifică singur la 5 minute cât timp aplicația e deschisă.', { time: dateTime(scan.at) })}</span>
            <label class="ord-toggle"><input type="checkbox" data-ord-notify ${notifyEnabled() ? 'checked' : ''} /> ${tx('Notificare la outbid / undercut')}</label>
          </div>
          ${list.length ? `<div class="table-scroll"><table class="table compact ord-table"><thead><tr>
            <th>Item</th><th class="r">${tx('Prețul meu')}</th><th class="r">${tx('Concurență')}</th><th>Status</th><th class="r">${tx('Rămas')}</th><th class="r">${tx('Expiră')}</th><th class="r">${tx('Preț nou')}</th>
          </tr></thead><tbody>${list.map((o) => orderRow(o, scan.competition.get(o.order_id), multi)).join('')}</tbody></table></div>`
          : `<p class="dim">${mine.length ? tx('Niciun ordin pentru filtrul ales.') : tx('Niciun ordin activ.')}</p>`}
          <p class="small dim ord-note">${tx('EVE acceptă doar 4 cifre semnificative la preț, deci pasul minim (tick) crește cu prețul: 0,01 ISK sub 100 ISK, 1.000 ISK la milioane. Prețul nou e cel mai mic pas care te pune primul. ESI nu poate modifica ordine: copiezi prețul, apoi Modify Order în joc și lipești.')}</p>`,
      })}`;
  }

  async function historyTab() {
    const chars = orderCharacters().filter((c) => !ui.character || c.characterId === ui.character);
    if (!chars.length) { activeTab(); return; }
    body.innerHTML = panel({ body: loader(tx('Citim istoricul ordinelor')) });
    try {
      await Promise.all(chars.filter((c) => !history.has(c.characterId!)).map(async (c) => {
        const list = await orderHistory(c.characterId!);
        await resolvePlaces(list, c.characterId!);
        history.set(c.characterId!, list);
      }));
    } catch (err) {
      body.innerHTML = panel({ body: alertBox((err as Error).message) });
      return;
    }
    if (ui.tab !== 'history') return;
    const rows = chars.flatMap((c) => (history.get(c.characterId!) ?? []).map((o) => ({ ...o, characterName: c.name })))
      .sort((a, b) => Date.parse(b.issued) - Date.parse(a.issued));
    const multi = chars.length > 1;
    const done = (o: CharacterOrder) => o.volume_total - o.volume_remain;
    const traded = rows.reduce((a, o) => a + done(o) * o.price * (o.is_buy_order ? 0 : 1), 0);
    const bought = rows.reduce((a, o) => a + done(o) * o.price * (o.is_buy_order ? 1 : 0), 0);
    const state = (o: CharacterOrder) => (o.volume_remain === 0 ? badge(tx('Completat'), 'ok') : o.state === 'cancelled' ? badge(tx('Anulat'), '') : badge(tx('Expirat'), 'warn'));
    body.innerHTML = panel({
      title: tx('Istoric ordine'),
      count: rows.length,
      body: `<div class="history-kpis">
          <div><span class="label">${tx('Vândut prin ordine')}</span><span class="value">${compactISK(traded)}</span></div>
          <div><span class="label">${tx('Cumpărat prin ordine')}</span><span class="value">${compactISK(bought)}</span></div>
        </div>
        ${rows.length ? `<div class="table-scroll"><table class="table compact ord-table"><thead><tr>
          <th>Item</th><th>${tx('Tip')}</th><th class="r">${tx('Preț')}</th><th class="r">${tx('Executat')}</th><th>${tx('Stare')}</th><th>${tx('Locație')}</th><th class="r">${tx('Plasat')}</th>
        </tr></thead><tbody>${rows.map((o) => `<tr>
          <td><button class="link ord-item" data-ord-open="${o.type_id}"><img class="row-icon" src="${typeIconUrl(o.type_id, 32)}" alt="" />${esc(typeName(o.type_id))}</button>${multi ? `<div class="small dim">${esc(o.characterName)}</div>` : ''}</td>
          <td>${o.is_buy_order ? badge('Buy', 'accent') : badge('Sell', 'gold')}</td>
          <td class="r num">${formatISK(o.price)}</td>
          <td class="r num">${formatInt(done(o))} / ${formatInt(o.volume_total)}</td>
          <td>${state(o)}</td>
          <td class="ord-place" title="${esc(place(o.location_id))}">${esc(place(o.location_id))}</td>
          <td class="r num">${dateTime(Date.parse(o.issued))}</td>
        </tr>`).join('')}</tbody></table></div>` : `<p class="dim">${tx('Niciun ordin închis în ultimele 90 de zile.')}</p>`}`,
    });
  }

  function render() {
    renderSide(lastScan());
    if (ui.tab === 'history') historyTab();
    else activeTab();
  }

  async function refresh(force = false) {
    if (busy) return;
    if (!orderCharacters().length) { render(); return; }
    busy = true;
    error = '';
    render();
    try {
      const scan = await scanOrders(force);
      await resolveAll(scan.orders);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
      render();
    }
  }

  window.addEventListener(ORDERS_EVENT, () => {
    if (busy) return;
    const scan = lastScan();
    if (scan) resolveAll(scan.orders).finally(render);
  });

  ctx.onCharacterChange(() => { history.clear(); render(); });

  side.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>('[data-ord-tab]');
    if (tab) { ui.tab = tab.dataset.ordTab as Tab; save(); render(); return; }
    const ch = t.closest<HTMLElement>('[data-ord-char]');
    if (ch) { ui.character = Number(ch.dataset.ordChar) || 0; save(); render(); }
  });

  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const f = t.closest<HTMLElement>('[data-ord-filter]');
    if (f) { ui.filter = f.dataset.ordFilter as Filter; save(); render(); return; }
    if (t.closest('[data-ord-refresh]')) { refresh(true); return; }
    const copy = t.closest<HTMLElement>('[data-copy-price]');
    if (copy) { copyText(copy.dataset.copyPrice!, tx('Preț copiat: {p}', { p: formatISK(Number(copy.dataset.copyPrice)) })); return; }
    const open = t.closest<HTMLElement>('[data-ord-open]');
    if (open) { const id = Number(open.dataset.ordOpen); deps.onOpen(typeName(id), id); }
  });

  body.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-ord-notify]')) setNotify(t.checked);
  });

  render();
  refresh();
}
