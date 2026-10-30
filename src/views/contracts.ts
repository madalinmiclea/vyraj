import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, formatNum, formatISK, compactISK, emptyState, badge, openModal } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { fetchPrices, typeIconUrl } from '../services/market';
import { universeNames } from '../character/esi';
import { rosterCharacters } from '../character/roster';
import { hasTokens } from '../character/sso';
import { permissionButtons } from '../character/permissions';
import { typeName, resolveTypeNames } from '../services/typeNames';
import {
  scanContracts, lastContracts, contractCharacters, corpContractCharacters, contractItems, contractBids, isActive, dueAt,
  type OwnedContract, type ContractItem, type ContractType, type ContractStatus,
} from '../services/contracts';
import { tx, locale } from '../i18n';

type Scope = 'personal' | 'corporation';
type State = 'active' | 'done' | 'all';
type Kind = 'all' | 'item_exchange' | 'auction' | 'courier';

interface Ui { scope: Scope; state: State; kind: Kind }

const UI_KEY = 'eve-contracts:ui';
const VALUE_LIMIT = 60;

const TYPE_LABEL: Record<ContractType, string> = {
  item_exchange: tx('Schimb de iteme'),
  auction: tx('Licitație'),
  courier: tx('Curier'),
  loan: tx('Împrumut'),
  unknown: tx('Necunoscut'),
};

const STATUS: Record<ContractStatus, [string, string]> = {
  outstanding: [tx('Deschis'), 'accent'],
  in_progress: [tx('În curs'), 'warn'],
  finished_issuer: [tx('Finalizat'), 'ok'],
  finished_contractor: [tx('Finalizat'), 'ok'],
  finished: [tx('Finalizat'), 'ok'],
  cancelled: [tx('Anulat'), ''],
  rejected: [tx('Respins'), ''],
  failed: [tx('Eșuat'), 'danger'],
  deleted: [tx('Șters'), ''],
  reversed: [tx('Inversat'), 'danger'],
};

const dateTime = (ms: number) => new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const remaining = (ms: number) => {
  const m = Math.round(ms / 60000);
  if (m <= 0) return tx('expirat');
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  return tx('{n} zile', { n: Math.floor(h / 24) });
};

export interface ContractsPanel { show(): void; hide(): void }

export function createContractsPanel(el: HTMLElement, ctx: AppContext, deps: { onOpen: (name: string, typeId: number) => void }): ContractsPanel {
  const ui = loadJson<Ui>(UI_KEY, { scope: 'personal', state: 'active', kind: 'all' });
  const names = new Map<number, string>();
  const values = new Map<number, { given: number; asked: number; items: number }>();
  let busy = false;
  let error = '';
  let visible = false;

  const save = () => saveJson(UI_KEY, ui);
  const mine = () => new Set(rosterCharacters().map((c) => c.characterId!));
  const nameOf = (id: number | undefined) => (!id ? '—' : names.get(id) ?? (id >= 1e12 ? tx('Structură {id}', { id }) : '…'));

  async function resolveNames(list: OwnedContract[]) {
    const byOwner = new Map<number, number[]>();
    for (const c of list) {
      const ids = [c.issuer_id, c.issuer_corporation_id, c.assignee_id, c.acceptor_id, c.start_location_id, c.end_location_id].filter((x): x is number => !!x && !names.has(x));
      byOwner.set(c.ownerId, [...(byOwner.get(c.ownerId) ?? []), ...ids]);
    }
    for (const [owner, ids] of byOwner) {
      if (!ids.length) continue;
      const got = await universeNames([...new Set(ids)], owner).catch(() => new Map<number, string>());
      for (const [id, n] of got) names.set(id, n);
    }
  }

  async function valueContracts(list: OwnedContract[]) {
    const todo = list.filter((c) => (c.type === 'item_exchange' || c.type === 'auction') && isActive(c) && !values.has(c.contract_id)).slice(0, VALUE_LIMIT);
    if (!todo.length) return;
    const items = new Map<number, ContractItem[]>();
    await Promise.all(todo.map(async (c) => { items.set(c.contract_id, await contractItems(c).catch(() => [])); }));
    const prices = await fetchPrices([...new Set([...items.values()].flat().map((i) => i.type_id))]).catch(() => null);
    if (!prices) return;
    for (const c of todo) {
      const rows = items.get(c.contract_id) ?? [];
      const worth = (r: ContractItem) => (r.raw_quantity === -2 ? 0 : (prices.get(r.type_id)?.sellMin ?? 0) * r.quantity);
      values.set(c.contract_id, {
        given: rows.filter((r) => r.is_included).reduce((a, r) => a + worth(r), 0),
        asked: rows.filter((r) => !r.is_included).reduce((a, r) => a + worth(r), 0),
        items: rows.length,
      });
    }
  }

  function filtered(): OwnedContract[] {
    const scan = lastContracts();
    if (!scan) return [];
    const list = ui.scope === 'corporation' ? scan.corporation : scan.personal;
    return list
      .filter((c) => ui.state === 'all' || (ui.state === 'active' ? isActive(c) : !isActive(c)))
      .filter((c) => ui.kind === 'all' || c.type === ui.kind)
      .sort((a, b) => (dueAt(a) ?? Infinity) - (dueAt(b) ?? Infinity) || Date.parse(b.date_issued) - Date.parse(a.date_issued));
  }

  function kpis(list: OwnedContract[]) {
    const me = mine();
    const active = list.filter(isActive);
    const forYou = active.filter((c) => c.status === 'outstanding' && me.has(c.assignee_id) && !me.has(c.issuer_id));
    const soon = active.filter((c) => { const d = dueAt(c); return d != null && d - Date.now() < 86_400_000; });
    const issued = active.filter((c) => me.has(c.issuer_id) && c.type !== 'courier');
    const courier = active.filter((c) => c.type === 'courier' && c.status === 'in_progress');
    return `<div class="history-kpis">
      <div><span class="label">${tx('Active')}</span><span class="value">${formatInt(active.length)}</span></div>
      <div><span class="label">${tx('Oferite ție')}</span><span class="value ${forYou.length ? 'accent' : ''}">${formatInt(forYou.length)}</span></div>
      <div><span class="label">${tx('Expiră în 24 h')}</span><span class="value ${soon.length ? 'ord-bad' : ''}">${formatInt(soon.length)}</span></div>
      <div><span class="label">${tx('Valoare cerută (emise de tine)')}</span><span class="value">${compactISK(issued.reduce((a, c) => a + (c.price ?? 0), 0))}</span></div>
      <div><span class="label">${tx('Curier în curs')}</span><span class="value">${formatInt(courier.length)}</span></div>
      <div><span class="label">${tx('Colateral în curs')}</span><span class="value">${compactISK(courier.reduce((a, c) => a + (c.collateral ?? 0), 0))}</span></div>
    </div>`;
  }

  function priceCell(c: OwnedContract) {
    if (c.type === 'courier') return `<span class="num">${formatISK(c.reward ?? 0)}</span><div class="small dim">${tx('colateral {v}', { v: compactISK(c.collateral ?? 0) })}</div>`;
    if (c.type === 'auction') return `<span class="num">${formatISK(c.price ?? 0)}</span>${c.buyout ? `<div class="small dim">${tx('buyout {v}', { v: compactISK(c.buyout) })}</div>` : ''}`;
    return `<span class="num">${formatISK(c.price ?? 0)}</span>${c.reward ? `<div class="small dim">${tx('plătește {v}', { v: compactISK(c.reward) })}</div>` : ''}`;
  }

  function valueCell(c: OwnedContract) {
    if (c.type === 'courier') return `<span class="num">${formatNum(c.volume ?? 0, 0)} m³</span>`;
    const v = values.get(c.contract_id);
    if (!v) return isActive(c) && (c.type === 'item_exchange' || c.type === 'auction') ? '<span class="dim">…</span>' : '<span class="dim">—</span>';
    const net = v.given - v.asked;
    const pay = (c.price ?? 0) - (c.reward ?? 0);
    const diff = net - pay;
    const pct = pay > 0 ? (diff / pay) * 100 : 0;
    const me = mine();
    const good = me.has(c.issuer_id) ? diff < 0 : diff > 0;
    if (net < 0 && v.given === 0) return `<span class="num">${compactISK(v.asked)}</span><div class="small dim">${tx('cerut de emitent')}</div>`;
    return `<span class="num">${compactISK(net)}</span>${pay > 0 && net > 0 ? `<div class="small ${good ? 'pos' : 'neg'}">${diff >= 0 ? '+' : '−'}${compactISK(Math.abs(diff))} · ${formatNum(Math.abs(pct), 0)}%</div>` : ''}`;
  }

  function row(c: OwnedContract, multi: boolean) {
    const [label, tone] = STATUS[c.status] ?? [c.status, ''];
    const due = dueAt(c);
    const route = c.type === 'courier' ? `${esc(nameOf(c.start_location_id))} → ${esc(nameOf(c.end_location_id))}` : esc(nameOf(c.start_location_id));
    const who = `${esc(nameOf(c.issuer_id))}${c.assignee_id ? ` → ${esc(nameOf(c.assignee_id))}` : ''}`;
    return `<tr class="${due != null && due - Date.now() < 86_400_000 ? 'ord-beaten' : ''}">
      <td><button class="link ord-item" data-ct-open="${c.contract_id}">${icon(c.type === 'courier' ? 'jump' : c.type === 'auction' ? 'isk' : 'orders')}${esc(c.title?.trim() || TYPE_LABEL[c.type])}</button> ${badge(TYPE_LABEL[c.type])}${c.for_corporation ? badge('Corp') : ''}
        <div class="small dim ord-place" title="${esc(route)}">${multi ? `${esc(c.ownerName)} · ` : ''}${who} · ${route}</div></td>
      <td>${badge(label, tone, true)}</td>
      <td class="r">${priceCell(c)}</td>
      <td class="r">${valueCell(c)}</td>
      <td class="r num">${due != null ? remaining(due - Date.now()) : `<span class="dim">${dateTime(Date.parse(c.date_completed ?? c.date_expired))}</span>`}</td>
    </tr>`;
  }

  function render() {
    if (!visible) return;
    const logged = rosterCharacters().filter((c) => hasTokens(c.characterId!)).map((c) => ({ characterId: c.characterId!, name: c.name }));
    if (!logged.length) {
      el.innerHTML = panel({ body: emptyState({ title: tx('Niciun caracter logat'), text: tx('Fă login cu EVE din ecranul Caracter ca să vezi contractele.'), vy: 'No Capsuleer Bound', vyText: 'Bind a capsuleer through EVE login on the Character screen to see your contracts.' }) });
      return;
    }
    const corpReaders = corpContractCharacters();
    const needPersonal = !contractCharacters().length;
    const needCorp = ui.scope === 'corporation' && !corpReaders.length;
    if ((ui.scope === 'personal' && needPersonal) || needCorp) {
      el.innerHTML = `${scopeChips()}${panel({ body: permissionButtons(needCorp ? 'corporation' : 'contracts', logged) })}`;
      return;
    }
    const scan = lastContracts();
    if (!scan) {
      el.innerHTML = `${scopeChips()}${panel({ body: busy ? loader(tx('Citim contractele')) : error ? alertBox(error) : '' })}`;
      return;
    }
    const scoped = ui.scope === 'corporation' ? scan.corporation : scan.personal;
    const list = filtered();
    const multi = new Set(scoped.map((c) => c.ownerId)).size > 1;
    const chips = (items: [string, string][], key: keyof Ui) => `<div class="advice-sort">${items.map(([id, l]) => `<button class="chip-btn ${ui[key] === id ? 'active' : ''}" data-ct-${key}="${id}">${l}</button>`).join('')}</div>`;
    el.innerHTML = `${scopeChips()}${scan.errors.map((e) => alertBox(e)).join('')}
      ${panel({
        title: ui.scope === 'corporation' ? tx('Contractele corporației') : tx('Contractele tale'),
        count: list.length,
        actions: `<button class="btn ghost sm" data-ct-refresh ${busy ? 'disabled' : ''}>${icon('refresh')}${busy ? tx('Se verifică…') : tx('Verifică acum')}</button>`,
        body: `${kpis(scoped)}
          <div class="ct-filters">${chips([['active', tx('Active')], ['done', tx('Încheiate')], ['all', tx('Toate')]], 'state')}
          ${chips([['all', tx('Toate tipurile')], ['item_exchange', TYPE_LABEL.item_exchange], ['auction', TYPE_LABEL.auction], ['courier', TYPE_LABEL.courier]], 'kind')}</div>
          <div class="ord-meta small dim"><span>${tx('Citit la {time}. Valoarea e la Jita vânzare minimă pentru itemele din contract, comparată cu prețul.', { time: dateTime(scan.at) })}</span></div>
          ${list.length ? `<div class="table-scroll"><table class="table compact ord-table ct-table"><thead><tr>
            <th>${tx('Contract')}</th><th>${tx('Stare')}</th><th class="r">${tx('Preț')}</th><th class="r">${tx('Valoare Jita')}</th><th class="r">${tx('Expiră')}</th>
          </tr></thead><tbody>${list.map((c) => row(c, multi)).join('')}</tbody></table></div>`
          : `<p class="dim">${scoped.length ? tx('Niciun contract pentru filtrele alese.') : tx('Niciun contract în ultimele 30 de zile.')}</p>`}`,
      })}`;
  }

  function scopeChips() {
    return `<div class="advice-sort ct-scope">
      <button class="chip-btn ${ui.scope === 'personal' ? 'active' : ''}" data-ct-scope="personal">${tx('Personale')}</button>
      <button class="chip-btn ${ui.scope === 'corporation' ? 'active' : ''}" data-ct-scope="corporation">${tx('Corporație')}</button>
    </div>`;
  }

  async function refresh(force = false) {
    if (busy || (!contractCharacters().length && !corpContractCharacters().length)) { render(); return; }
    busy = true;
    error = '';
    render();
    try {
      const scan = await scanContracts(force);
      const all = [...scan.personal, ...scan.corporation];
      await resolveNames(all);
      busy = false;
      render();
      await valueContracts(filtered());
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
      render();
    }
  }

  async function details(c: OwnedContract) {
    const modal = openModal(c.title?.trim() || TYPE_LABEL[c.type], loader(tx('Citim itemele contractului')), { wide: true });
    const body = modal.querySelector<HTMLElement>('.panel-body')!;
    try {
      const [items, bids] = await Promise.all([
        c.type === 'courier' ? Promise.resolve([] as ContractItem[]) : contractItems(c),
        c.type === 'auction' ? contractBids(c).catch(() => []) : Promise.resolve([]),
      ]);
      await resolveTypeNames(items.map((i) => i.type_id));
      const prices = items.length ? await fetchPrices(items.map((i) => i.type_id)).catch(() => null) : null;
      const bidders = await universeNames(bids.map((b) => b.bidder_id), c.ownerId).catch(() => new Map<number, string>());
      const line = (i: ContractItem) => {
        const unit = i.raw_quantity === -2 ? 0 : prices?.get(i.type_id)?.sellMin ?? 0;
        return `<tr><td><button class="link ord-item" data-ct-type="${i.type_id}"><img class="row-icon" src="${typeIconUrl(i.type_id, 32)}" alt="" />${esc(typeName(i.type_id))}</button>${i.raw_quantity === -2 ? ` ${badge('BPC')}` : ''}</td>
          <td class="r num">${formatInt(i.quantity)}</td><td class="r num">${unit ? compactISK(unit) : '—'}</td><td class="r num">${unit ? compactISK(unit * i.quantity) : '—'}</td></tr>`;
      };
      const table = (rows: ContractItem[], title: string) => rows.length ? `<h4 class="ct-sub">${title}</h4><div class="table-scroll"><table class="table compact"><thead><tr><th>Item</th><th class="r">${tx('Cantitate')}</th><th class="r">${tx('Preț Jita')}</th><th class="r">${tx('Total')}</th></tr></thead><tbody>${rows.map(line).join('')}</tbody></table></div>` : '';
      const due = dueAt(c);
      const facts: [string, string][] = [
        [tx('Tip'), TYPE_LABEL[c.type]],
        [tx('Stare'), STATUS[c.status]?.[0] ?? c.status],
        [tx('Emis de'), nameOf(c.issuer_id)],
        [tx('Pentru'), c.assignee_id ? nameOf(c.assignee_id) : tx('Public')],
        [tx('Acceptat de'), c.acceptor_id ? nameOf(c.acceptor_id) : '—'],
        [c.type === 'courier' ? tx('De la') : tx('Locație'), nameOf(c.start_location_id)],
        ...(c.type === 'courier' ? [[tx('Până la'), nameOf(c.end_location_id)], [tx('Recompensă'), formatISK(c.reward ?? 0)], [tx('Colateral'), formatISK(c.collateral ?? 0)], [tx('Volum'), `${formatNum(c.volume ?? 0, 0)} m³`], [tx('Zile pentru livrare'), String(c.days_to_complete ?? '—')]] as [string, string][] : []),
        ...(c.type !== 'courier' ? [[tx('Preț'), formatISK(c.price ?? 0)]] as [string, string][] : []),
        ...(c.buyout ? [[tx('Buyout'), formatISK(c.buyout)]] as [string, string][] : []),
        [tx('Emis'), dateTime(Date.parse(c.date_issued))],
        [due != null ? tx('Termen') : tx('Expirat'), due != null ? `${dateTime(due)} · ${remaining(due - Date.now())}` : dateTime(Date.parse(c.date_expired))],
      ];
      body.innerHTML = `<dl class="ct-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${table(items.filter((i) => i.is_included), tx('Primești / oferă emitentul'))}
        ${table(items.filter((i) => !i.is_included), tx('Cere emitentul'))}
        ${bids.length ? `<h4 class="ct-sub">${tx('Oferte')}</h4><table class="table compact"><tbody>${[...bids].sort((a, b) => b.amount - a.amount).map((b) => `<tr><td>${esc(bidders.get(b.bidder_id) ?? String(b.bidder_id))}</td><td class="r num">${formatISK(b.amount)}</td><td class="r num dim">${dateTime(Date.parse(b.date_issued))}</td></tr>`).join('')}</tbody></table>` : ''}
        ${!items.length && c.type !== 'courier' ? `<p class="dim small">${tx('ESI nu mai arată itemele: contractul e încheiat de mult sau nu e vizibil pentru acest caracter.')}</p>` : ''}`;
    } catch (err) {
      body.innerHTML = alertBox((err as Error).message);
    }
    modal.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-ct-type]');
      if (!t) return;
      const id = Number(t.dataset.ctType);
      modal.remove();
      deps.onOpen(typeName(id), id);
    });
  }

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    for (const key of ['scope', 'state', 'kind'] as const) {
      const b = t.closest<HTMLElement>(`[data-ct-${key}]`);
      if (b) {
        (ui as unknown as Record<string, string>)[key] = b.getAttribute(`data-ct-${key}`)!;
        save();
        render();
        valueContracts(filtered()).then(render).catch(() => {});
        return;
      }
    }
    if (t.closest('[data-ct-refresh]')) { values.clear(); refresh(true); return; }
    const open = t.closest<HTMLElement>('[data-ct-open]');
    if (open) {
      const scan = lastContracts();
      const c = [...(scan?.personal ?? []), ...(scan?.corporation ?? [])].find((x) => x.contract_id === Number(open.dataset.ctOpen));
      if (c) details(c);
    }
  });

  ctx.onCharacterChange(render);

  return {
    show() {
      visible = true;
      el.hidden = false;
      render();
      if (!lastContracts()) refresh();
    },
    hide() {
      visible = false;
      el.hidden = true;
    },
  };
}
