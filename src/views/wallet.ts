import type { AppContext } from '../app/context';
import { panel, loader, esc, formatInt, formatNum, formatISK, compactISK, button, dataStamp } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { walletJournal, walletBalance, walletTransactions, type WalletEntry, type WalletTransaction } from '../character/esi';
import { PERIODS, periodStart, since, flow, flowBuckets, byRef, refLabel, pveSessions, archiveJournal, archiveTrades, bountyDetailMissing, tradeSummary, bountyTicks, tickSummary, pveActivity, type Period, type BountyTick } from '../services/wallet';
import { npcInfo, type NpcInfo } from '../services/npcKills';
import { loadMap, displaySec, secClass, type NavMap } from '../services/navigation';
import { heatmap } from '../ui/heatmap';
import type { Dmg } from '../services/missions';
import { flowChart, bindFlowChart, type FlowPoint } from '../ui/charts';
import { typeIconUrl } from '../services/market';
import { allEveItems } from '../data/items';
import { characterOrders, expiresAt, typeName, ORDERS_SCOPE, type CharacterOrder } from '../services/orders';
import { hasScope } from '../character/sso';
import { permissionGate } from '../character/permissions';
import { tx, locale } from '../i18n';

const PERIOD_KEY = 'eve-tools:wallet-period';
const JOURNAL_LIMIT = 300;
const TICK_LIMIT = 60;
const DMG_NAME: Record<Dmg, string> = { em: 'EM', th: tx('Termic'), kin: tx('Cinetic'), exp: tx('Exploziv') };
const DMG_CLS: Record<Dmg, string> = { em: 'em', th: 'thermal', kin: 'kinetic', exp: 'explosive' };
const FETCHED_KEY = 'eve-tools:wallet-fetched';
const ARCHIVE_GAP_MS = 7 * 86400000;

type Direction = 'all' | 'in' | 'out';

export type WalletSection = 'overview' | 'journal' | 'trades' | 'bounty' | 'ratting';

export const WALLET_SECTIONS: { id: WalletSection; label: string }[] = [
  { id: 'overview', label: tx('Prezentare') },
  { id: 'journal', label: tx('Jurnal') },
  { id: 'trades', label: tx('Cumpărat și vândut') },
  { id: 'bounty', label: tx('Bounty și tick-uri') },
  { id: 'ratting', label: tx('Unde și ce ai vânat') },
];

export interface WalletState { section: WalletSection; rerender?: () => void; onSection?: (section: WalletSection) => void }

const isk = (v: number) => `<span class="num">${compactISK(v)}</span>`;
const signed = (v: number) => `<span class="num ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : '−'}${compactISK(Math.abs(v))}</span>`;
const dateTime = (ms: number) => new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const day = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
const remaining = (ms: number) => {
  const m = Math.round(ms / 60000);
  if (m <= 0) return tx('expirat');
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  return tx('{n} zile', { n: Math.floor(h / 24) });
};
const describe = (e: WalletEntry) => (e.description && e.description.trim() !== '-' ? e.description : e.reason ?? '');

export async function renderWallet(body: HTMLElement, ctx: AppContext, characterId: number, alive: () => boolean, view: WalletState, force = false) {
  const fetchedAll = loadJson<Record<string, { at: number; balance: number }>>(FETCHED_KEY, {});
  let fetched = fetchedAll[characterId];
  let fresh: WalletEntry[] = [];
  let freshTrades: WalletTransaction[] = [];
  if (force || !fetched || Date.now() - fetched.at > ARCHIVE_GAP_MS || bountyDetailMissing(characterId)) {
    body.innerHTML = panel({ body: loader(tx('Citesc jurnalul portofelului')) });
    let balance: number;
    [fresh, balance, freshTrades] = await Promise.all([
      walletJournal(characterId),
      walletBalance(characterId),
      walletTransactions(characterId).catch(() => [] as WalletTransaction[]),
    ]);
    fetched = { at: Date.now(), balance };
    saveJson(FETCHED_KEY, { ...loadJson<Record<string, { at: number; balance: number }>>(FETCHED_KEY, {}), [characterId]: fetched });
  }
  if (!alive()) return;
  const { balance, at: fetchedAt } = fetched;
  const entries = archiveJournal(characterId, fresh);
  const trades = archiveTrades(characterId, freshTrades);
  const oldest = entries.length ? Date.parse(entries[entries.length - 1].date) : Date.now();
  let names: Map<number, string> | null = null;
  const itemName = (id: number) => {
    names ??= new Map(allEveItems.map((i) => [i.t, i.n]));
    return ctx.sde.types.get(id)?.name ?? names.get(id) ?? `#${id}`;
  };

  let period = loadJson<Period>(PERIOD_KEY, '30d');
  if (!PERIODS.some((p) => p.id === period)) period = '30d';
  let direction: Direction = 'all';
  let ref = '';
  let query = '';

  const root = document.createElement('div');
  root.className = 'stack wallet';
  body.replaceChildren(root);

  const bucketLabel = (b: { start: number; size: number }) => {
    const d = new Date(b.start);
    if (b.size < 86400000) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  };

  function journalRows(rows: WalletEntry[]) {
    const q = query.trim().toLowerCase();
    return rows.filter((e) => {
      const a = e.amount ?? 0;
      if (direction === 'in' && a <= 0) return false;
      if (direction === 'out' && a >= 0) return false;
      if (ref && e.ref_type !== ref) return false;
      if (q && !`${e.description ?? ''} ${refLabel(e.ref_type)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function renderJournal(rows: WalletEntry[]) {
    const el = root.querySelector<HTMLElement>('#walletJournal');
    if (!el) return;
    const list = journalRows(rows);
    const f = flow(list);
    el.innerHTML = `<p class="dim small">${tx('{n} intrări · câștigat {in} · cheltuit {out}', { n: formatInt(list.length), in: compactISK(f.earned), out: compactISK(f.spent) })}${list.length > JOURNAL_LIMIT ? ' · ' + tx('se văd primele {n}', { n: JOURNAL_LIMIT }) : ''}</p>
      ${list.length ? `<table class="table compact wallet-journal"><thead><tr><th>${tx('Data')}</th><th>${tx('Tip')}</th><th class="r">${tx('Sumă')}</th><th class="r">${tx('Sold')}</th><th>${tx('Descriere')}</th></tr></thead><tbody>
        ${list.slice(0, JOURNAL_LIMIT).map((e) => `<tr><td class="num dim">${dateTime(Date.parse(e.date))}</td><td>${esc(refLabel(e.ref_type))}</td><td class="r">${signed(e.amount ?? 0)}</td><td class="r">${e.balance != null ? isk(e.balance) : ''}</td><td class="desc dim" title="${esc(describe(e))}">${esc(describe(e))}</td></tr>`).join('')}
      </tbody></table>` : `<p class="dim">${tx('Nicio intrare pentru filtrele alese.')}</p>`}`;
  }

  let tickSeq = 0;
  async function renderTicks(rows: WalletEntry[]) {
    const el = root.querySelector<HTMLElement>('#walletTicks');
    if (!el) return;
    const seq = ++tickSeq;
    const ticks = bountyTicks(rows);
    const activity = pveActivity(entries);
    const active = activity.filter((d) => d.isk > 0);
    const cells = activity.map((d) => ({ day: d.day, value: d.isk, tip: `${day(d.day)} · ${d.isk ? `${compactISK(d.isk)} ISK${d.ticks ? ` · ${tx('{n} tick-uri', { n: d.ticks })}` : ''}` : tx('fără PvE')}` }));
    const heat = panel({
      title: tx('Activitate PvE'),
      count: tx('ultimele {n} săptămâni', { n: Math.round(activity.length / 7) }),
      body: `<div class="history-kpis compact">
          <div><span class="label">${tx('Zile active')}</span><span class="value">${formatInt(active.length)}</span></div>
          <div><span class="label">${tx('Venit PvE')}</span><span class="value up">${compactISK(active.reduce((a, d) => a + d.isk, 0))}</span></div>
          <div><span class="label">${tx('Tick-uri')}</span><span class="value">${formatInt(activity.reduce((a, d) => a + d.ticks, 0))}</span></div>
          <div><span class="label">${tx('Cea mai bună zi')}</span><span class="value">${active.length ? compactISK(Math.max(...active.map((d) => d.isk))) : '—'}</span></div>
        </div>
        ${heatmap(cells)}
        <div class="heatmap-legend dim small"><span>${tx('Mai puțin')}</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>${tx('Mai mult')}</span></div>
        ${oldest > activity[0].day ? `<p class="dim small wallet-note">${tx('Zilele dinainte de {date} se completează pe măsură ce Vyraj citește jurnalul (EVE dă doar ultimele 30 de zile).', { date: day(oldest) })}</p>` : ''}`,
    });
    const none = panel({ title: tx('Recompense NPC'), body: `<p class="dim">${tx('Niciun tick de recompense NPC în perioada aleasă. Tick-urile apar după ratting în anomalii sau misiuni, la fiecare 20 de minute.')}</p>` });
    if (!ticks.length) {
      el.innerHTML = view.section === 'bounty' ? none : `${heat}${none}`;
      return;
    }
    el.innerHTML = `${view.section === 'bounty' ? '' : heat}${panel({ body: loader(tx('Citesc numele NPC-urilor')) })}`;
    const s = tickSummary(ticks);
    const ids = [...new Set(ticks.flatMap((k) => k.kills.map(([id]) => id)))];
    const [info, nav] = await Promise.all([
      npcInfo(ids).catch(() => new Map<number, NpcInfo>()),
      loadMap().catch(() => null as NavMap | null),
    ]);
    if (seq !== tickSeq || !alive()) return;
    const npc = (id: number) => info.get(id) ?? { id, name: `#${id}`, group: '' };
    const sys = (id?: number) => {
      const x = id ? nav?.systems.get(id) : undefined;
      return x ? `<span class="tick-sys">${esc(x.name)} <span class="sec ${secClass(x.sec)}">${displaySec(x.sec).toFixed(1)}</span></span>` : `<span class="tick-sys dim">${id ? `#${id}` : '—'}</span>`;
    };
    const facBadge = (n: { faction?: NpcInfo['faction'] }) => (n.faction ? `<span class="badge">${esc(n.faction.name)}</span>` : '');
    const dmg = (list: Dmg[]) => list.map((d) => `<span class="dmg-tag ${DMG_CLS[d]}">${DMG_NAME[d]}</span>`).join('');
    const factions = new Map<string, { f: NonNullable<NpcInfo['faction']>; n: number }>();
    for (const t of s.targets) {
      const f = npc(t.id).faction;
      if (f) factions.set(f.id, { f, n: (factions.get(f.id)?.n ?? 0) + t.n });
    }
    const tickRow = (k: BountyTick) => {
      const kills = [...k.kills].sort((a, b) => b[1] - a[1]);
      const total = kills.reduce((a, [, n]) => a + n, 0);
      if (!kills.length) return `<div class="tick tick-plain">
          <span class="tick-time num dim">${dateTime(k.t)}</span>
          ${k.systemId ? sys(k.systemId) : `<span class="tick-sys dim">${tx('fără detalii')}</span>`}
          <span class="tick-ships"></span>
          <span class="tick-isk num up">+${compactISK(k.isk)}</span>
          <span></span>
        </div>`;
      return `<details class="tick">
        <summary>
          <span class="tick-time num dim">${dateTime(k.t)}</span>
          ${sys(k.systemId)}
          <span class="tick-ships">${kills.slice(0, 6).map(([id, n]) => `<span class="tick-ship" title="${esc(npc(id).name)}"><img src="${typeIconUrl(id, 32)}" alt="" loading="lazy" /><small>×${n}</small></span>`).join('')}${kills.length > 6 ? `<small class="dim">+${kills.length - 6}</small>` : ''}</span>
          <span class="tick-isk num up">+${compactISK(k.isk)}</span>
          ${icon('chevron', 'tick-chev')}
        </summary>
        <div class="tick-detail">
          <div class="dim small">${tx('{n} nave NPC distruse în acest tick', { n: formatInt(total) })}</div>
          ${kills.length ? `<table class="table compact"><tbody>${kills.map(([id, n]) => {
            const x = npc(id);
            return `<tr><td><span class="recon-ship"><img class="row-icon" src="${typeIconUrl(id, 32)}" alt="" loading="lazy" /><span>${esc(x.name)}</span></span></td><td class="dim">${esc(x.group)}</td><td>${facBadge(x)}</td><td class="r num">×${n}</td></tr>`;
          }).join('')}</tbody></table>` : `<p class="dim small">${tx('EVE nu a trimis lista de NPC-uri pentru acest tick.')}</p>`}
        </div>
      </details>`;
    };
    const best = s.best!;
    el.innerHTML = view.section === 'bounty' ? `${panel({
      title: tx('Recompense NPC'),
      count: tx('{n} tick-uri în perioadă', { n: formatInt(s.count) }),
      body: `<div class="history-kpis">
          <div><span class="label">${tx('Tick-uri')}</span><span class="value">${formatInt(s.count)}</span></div>
          <div><span class="label">${tx('ISK / tick mediu')}</span><span class="value">${compactISK(s.average)}</span></div>
          <div title="${esc(`${day(best.t)} · ${nav?.systems.get(best.systemId ?? 0)?.name ?? ''}`)}"><span class="label">${tx('Cel mai bun tick')}</span><span class="value up">${compactISK(best.isk)}</span></div>
          <div><span class="label">${tx('NPC distruse')}</span><span class="value">${formatInt(s.kills)}</span></div>
          <div><span class="label">${tx('Sisteme')}</span><span class="value">${formatInt(s.systems.length)}</span></div>
        </div>
        <p class="dim small">${tx('Cel mai bun tick: {isk} ISK în {system}, {date}.', { isk: compactISK(best.isk), system: nav?.systems.get(best.systemId ?? 0)?.name ?? '—', date: dateTime(best.t) })}</p>`,
    })}
    ${panel({
      title: tx('Tick-uri'),
      count: ticks.length > TICK_LIMIT ? tx('se văd primele {n}', { n: TICK_LIMIT }) : '',
      body: `<div class="tick-list">${ticks.slice(0, TICK_LIMIT).map(tickRow).join('')}</div>`,
    })}` : `${heat}
    <div class="tool-grid even">
      ${panel({
        title: tx('Unde ai făcut ratting'),
        body: s.systems.length ? `<table class="table compact"><thead><tr><th>${tx('Sistem')}</th><th class="r">${tx('Tick-uri')}</th><th class="r">ISK</th><th class="r">${tx('ISK / tick')}</th></tr></thead><tbody>
          ${s.systems.slice(0, 10).map((x) => `<tr><td>${sys(x.id)}</td><td class="r num">${formatInt(x.ticks)}</td><td class="r">${isk(x.isk)}</td><td class="r">${isk(x.isk / x.ticks)}</td></tr>`).join('')}
        </tbody></table>` : `<p class="dim">${tx('EVE nu a trimis sistemul pentru aceste tick-uri.')}</p>`,
      })}
      ${panel({
        title: tx('Ce ai distrus'),
        body: s.targets.length ? `<div class="wallet-scroll"><table class="table compact"><thead><tr><th>NPC</th><th>${tx('Clasă')}</th><th class="r">#</th></tr></thead><tbody>
          ${s.targets.slice(0, 40).map((t) => { const x = npc(t.id); return `<tr><td><span class="recon-ship"><img class="row-icon" src="${typeIconUrl(t.id, 32)}" alt="" loading="lazy" /><span>${esc(x.name)}</span></span></td><td class="dim">${esc(x.group)}</td><td class="r num">${formatInt(t.n)}</td></tr>`; }).join('')}
        </tbody></table></div>` : `<p class="dim">${tx('EVE nu a trimis lista de NPC-uri pentru aceste tick-uri.')}</p>`,
      })}
    </div>
    ${factions.size ? panel({
      title: tx('Contra cui lupți'),
      body: `<div class="tick-factions">${[...factions.values()].sort((a, b) => b.n - a.n).map(({ f, n }) => `<div class="tick-faction">
          <div class="tick-faction-head"><b>${esc(f.name)}</b><span class="dim small">${tx('{n} nave', { n: formatInt(n) })}</span></div>
          <div class="small"><span class="dim">${tx('Trag cu')}</span> ${dmg(f.shoot)}</div>
          <div class="small"><span class="dim">${tx('Slabi la')}</span> ${dmg(f.weak)}</div>
        </div>`).join('')}</div>
        <p class="dim small">${tx('Rezistențele tale ar trebui să acopere ce trag ei, iar muniția și dronele să lovească unde sunt slabi.')} <a href="#/missions">${tx('Deschide ghidul de misiuni')}</a></p>`,
    }) : ''}`;
  }

  let escrowSeq = 0;
  async function renderEscrow(rows: WalletEntry[]) {
    const el = root.querySelector<HTMLElement>('#walletEscrow');
    if (!el) return;
    const seq = ++escrowSeq;
    const title = tx('ISK blocat în escrow');
    const fees = rows.filter((e) => e.ref_type === 'brokers_fee').reduce((a, e) => a - Math.min(0, e.amount ?? 0), 0);
    const note = `<p class="dim small wallet-note">${tx('Escrow-ul este ISK-ul luat din portofel când pui un ordin de cumpărare, pentru cantitatea rămasă. Pe măsură ce ordinul se umple, plata se face din escrow. Când ordinul expiră sau îl anulezi, tot ce a rămas în escrow se întoarce automat în portofel. Comisionul de broker, plătit la plasare și la modificări, nu se mai întoarce.')}</p>`;
    const kpi = root.querySelector<HTMLElement>('#walletEscrowKpi .value');
    if (!hasScope(characterId, ORDERS_SCOPE)) {
      if (kpi) kpi.textContent = '—';
      el.innerHTML = panel({ title, body: permissionGate('orders', characterId) + note });
      return;
    }
    el.innerHTML = panel({ title, body: loader(tx('Citesc ordinele de cumpărare')) });
    let list: CharacterOrder[];
    try {
      list = await characterOrders(characterId);
    } catch (err) {
      if (kpi && seq === escrowSeq) kpi.textContent = '—';
      if (seq === escrowSeq && alive()) el.innerHTML = panel({ title, body: `<p class="dim">${esc((err as Error).message)}</p>` });
      return;
    }
    if (seq !== escrowSeq || !alive()) return;
    const buys = list.filter((o) => o.is_buy_order).sort((a, b) => expiresAt(a) - expiresAt(b));
    const own = buys.filter((o) => !o.is_corporation);
    const corp = buys.filter((o) => o.is_corporation);
    const sum = (l: CharacterOrder[]) => l.reduce((a, o) => a + (o.escrow ?? 0), 0);
    const held = sum(own);
    const value = own.reduce((a, o) => a + o.price * o.volume_remain, 0);
    const next = own[0];
    if (kpi) kpi.textContent = compactISK(held);
    const margin = own.some((o) => (o.escrow ?? 0) < o.price * o.volume_remain - 0.5);
    const row = (o: CharacterOrder) => {
      const full = o.price * o.volume_remain;
      const left = expiresAt(o) - Date.now();
      return `<tr><td><span class="recon-ship"><img class="row-icon" src="${typeIconUrl(o.type_id, 32)}" alt="" loading="lazy" /><span>${esc(typeName(o.type_id))}</span></span>${o.is_corporation ? ' <span class="badge">Corp</span>' : ''}</td>
        <td class="r num">${formatISK(o.price)}</td>
        <td class="r num nowrap">${formatInt(o.volume_remain)} <span class="small dim">/ ${formatInt(o.volume_total)}</span></td>
        <td class="r">${isk(o.escrow ?? 0)}${(o.escrow ?? 0) < full - 0.5 ? `<div class="small dim">${tx('din {v}', { v: compactISK(full) })}</div>` : ''}</td>
        <td class="r num nowrap">${remaining(left)}<div class="small dim">${dateTime(expiresAt(o))}</div></td></tr>`;
    };
    el.innerHTML = panel({
      title,
      count: buys.length ? tx('{n} ordine de cumpărare', { n: formatInt(buys.length) }) : '',
      actions: `<a class="btn ghost sm" href="#/orders">${tx('Deschide ordinele')}</a>`,
      body: `<div class="history-kpis">
          <div title="${tx('Suma care se întoarce în portofel dacă toate ordinele de cumpărare expiră sau le anulezi acum')}"><span class="label">${tx('În escrow acum')}</span><span class="value">${compactISK(held)}</span></div>
          <div title="${tx('Soldul din portofel plus ISK-ul din escrow')}"><span class="label">${tx('Sold cu escrow')}</span><span class="value">${compactISK(balance + held)}</span></div>
          <div><span class="label">${tx('Rămas de cumpărat')}</span><span class="value">${compactISK(value)}</span></div>
          <div title="${tx('Comision de broker plătit în perioada aleasă. Nu se returnează.')}"><span class="label">${tx('Comision broker în perioadă')}</span><span class="value down">${compactISK(fees)}</span></div>
          <div><span class="label">${tx('Primul expiră în')}</span><span class="value">${next ? remaining(expiresAt(next) - Date.now()) : '—'}</span></div>
        </div>
        ${buys.length ? `<div class="wallet-scroll"><table class="table compact"><thead><tr><th>Item</th><th class="r">${tx('Preț')}</th><th class="r">${tx('Rămas')}</th><th class="r">Escrow</th><th class="r">${tx('Expiră')}</th></tr></thead><tbody>${buys.map(row).join('')}</tbody></table></div>` : `<p class="dim">${tx('Niciun ordin de cumpărare activ, deci nimic blocat în escrow.')}</p>`}
        ${corp.length ? `<p class="dim small wallet-note">${tx('Ordinele de corporație ({isk}) folosesc walletul corporației și nu intră în totalul de mai sus; la expirare sau anulare escrow-ul lor se întoarce acolo.', { isk: compactISK(sum(corp)) })}</p>` : ''}
        ${margin ? `<p class="dim small wallet-note">${tx('Unele ordine au escrow mai mic decât valoarea lor, datorită skill-ului Margin Trading. Diferența se ia din portofel abia când se cumpără, așa că păstrează ISK disponibil.')}</p>` : ''}
        ${note}`,
    });
  }

  function exportCsv(rows: WalletEntry[]) {
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['date', 'type', 'amount', 'balance', 'description'].join(','), ...journalRows(rows).map((e) => [e.date, e.ref_type, e.amount ?? 0, e.balance ?? '', e.description ?? ''].map(cell).join(','))];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `wallet-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function render() {
    const from = periodStart(period);
    const rows = since(entries, from);
    const f = flow(rows);
    const inCount = rows.filter((e) => (e.amount ?? 0) > 0).length;
    const outCount = rows.filter((e) => (e.amount ?? 0) < 0).length;
    const sessions = pveSessions(rows);
    const hours = sessions.reduce((a, s) => a + (s.end - s.start), 0) / 3600000;
    const buckets = flowBuckets(rows, period, oldest);
    const points: FlowPoint[] = buckets.map((b) => ({ label: bucketLabel(b), earned: b.earned, spent: b.spent }));
    const size = buckets[0]?.size ?? 86400000;
    const bucketName = size < 86400000 ? tx('pe oră') : size > 86400000 ? tx('pe săptămână') : tx('pe zi');
    const chips = PERIODS.map((p) => `<button class="chip-btn ${p.id === period ? 'active' : ''}" data-wallet-period="${p.id}">${p.label}</button>`).join('');
    const partial = entries.length > 0 && from > 0 && from < oldest - 3600000;
    const refs = [...new Set(rows.map((e) => e.ref_type))].sort((a, b) => refLabel(a).localeCompare(refLabel(b)));
    if (ref && !refs.includes(ref)) ref = '';
    const cats = byRef(rows);
    const tradeRows = tradeSummary(since(trades, from)).slice(0, 300);

    const bar = `<div class="wallet-bar">
        <span class="dim small">${entries.length ? tx('Istoric salvat din {date}', { date: day(oldest) }) : tx('Nicio intrare în jurnal')}</span>
        <span class="wallet-bar-actions">${dataStamp(fetchedAt, 'data-wallet-refresh', { label: tx('Date din {time}'), title: tx('Jurnalul și soldul sunt păstrate până le reîmprospătezi. Click pentru a le citi din nou din ESI.') })}<span class="advice-sort">${chips}</span></span>
      </div>`;
    const overview = () => `${panel({
        title: tx('Sold și flux'),
        body: `<div class="history-kpis">
            <div><span class="label">${tx('Sold')}</span><span class="value">${compactISK(balance)}</span></div>
            <div id="walletEscrowKpi" title="${tx('ISK blocat în ordinele de cumpărare active. Se întoarce în portofel la expirare sau anulare.')}"><span class="label">${tx('În escrow')}</span><span class="value">…</span></div>
            <div title="${tx('Suma tuturor intrărilor pozitive din perioadă ({n})', { n: formatInt(inCount) })}"><span class="label">${tx('Venit total')}</span><span class="value up">${compactISK(f.earned)}</span></div>
            <div title="${tx('Suma tuturor intrărilor negative din perioadă ({n})', { n: formatInt(outCount) })}"><span class="label">${tx('Cheltuieli totale')}</span><span class="value down">${compactISK(f.spent)}</span></div>
            <div title="${tx('Venit total minus cheltuieli totale')}"><span class="label">Net</span><span class="value ${f.net >= 0 ? 'up' : 'down'}">${f.net >= 0 ? '+' : '−'}${compactISK(Math.abs(f.net))}</span></div>
            <div><span class="label">${tx('Venit PvE')}</span><span class="value">${compactISK(f.pve)}</span></div>
            <div><span class="label">${tx('ISK/oră PvE')}</span><span class="value">${compactISK(hours ? f.pve / hours : 0)}</span></div>
          </div>
          ${partial ? `<p class="dim small wallet-note">${tx('EVE dă doar ultimele 30 de zile din jurnal. Vyraj păstrează local tot ce citește, așa că perioadele mai lungi se completează pe măsură ce deschizi Portofel. Acum ai date din {date}.', { date: day(oldest) })}</p>` : ''}
          <h4 class="sub-head">${tx('Câștigat și cheltuit {bucket}', { bucket: bucketName })}</h4>
          <div class="wallet-chart">${flowChart(points)}</div>
          ${partial || (period === 'all' && entries.length) ? `<p class="dim small wallet-note">${tx('Graficul începe la {date}, prima zi cu date salvate local.', { date: day(oldest) })}</p>` : ''}`,
      })}
      <div id="walletEscrow"></div>
      <div class="tool-grid even">
        ${panel({
          title: tx('Toate perioadele'),
          body: `<table class="table compact wallet-periods"><thead><tr><th>${tx('Perioadă')}</th><th class="r">${tx('Câștigat')}</th><th class="r">${tx('Cheltuit')}</th><th class="r">Net</th><th class="r">PvE</th><th class="r">#</th></tr></thead><tbody>
            ${PERIODS.map((p) => {
              const x = flow(since(entries, periodStart(p.id)));
              return `<tr class="${p.id === period ? 'active' : ''}" data-wallet-period="${p.id}"><td>${p.label}</td><td class="r up">${isk(x.earned)}</td><td class="r down">${isk(x.spent)}</td><td class="r">${signed(x.net)}</td><td class="r">${isk(x.pve)}</td><td class="r num dim">${formatInt(x.count)}</td></tr>`;
            }).join('')}
          </tbody></table>`,
        })}
        ${panel({
          title: tx('Pe categorie'),
          body: cats.length ? `<div class="wallet-scroll"><table class="table compact"><thead><tr><th>${tx('Tip')}</th><th class="r">${tx('Câștigat')}</th><th class="r">${tx('Cheltuit')}</th><th class="r">Net</th></tr></thead><tbody>
            ${cats.map((r) => `<tr><td><button class="link" data-wallet-ref="${esc(r.ref)}">${esc(refLabel(r.ref))}</button></td><td class="r up">${r.income ? isk(r.income) : ''}</td><td class="r down">${r.spent ? isk(r.spent) : ''}</td><td class="r">${signed(r.income - r.spent)}</td></tr>`).join('')}
            </tbody></table></div>` : `<p class="dim">${tx('Nicio intrare în perioada aleasă.')}</p>`,
        })}
      </div>`;
    const journal = () => panel({
        title: tx('Jurnal'),
        actions: button(tx('Export CSV'), { iconName: 'download', cls: 'ghost sm', attrs: 'data-wallet-csv' }),
        body: `<div class="wallet-filters">
            <div class="advice-sort">${(['all', 'in', 'out'] as Direction[]).map((d) => `<button class="chip-btn ${d === direction ? 'active' : ''}" data-wallet-dir="${d}">${{ all: tx('Toate'), in: tx('Intrări'), out: tx('Ieșiri') }[d]}</button>`).join('')}</div>
            <select class="input plain" id="walletRef"><option value="">${tx('Toate tipurile')}</option>${refs.map((r) => `<option value="${esc(r)}" ${r === ref ? 'selected' : ''}>${esc(refLabel(r))}</option>`).join('')}</select>
            <input class="input plain" id="walletSearch" placeholder="${tx('Caută în descriere...')}" value="${esc(query)}" />
          </div>
          <div id="walletJournal"></div>`,
      });
    const tradesPanel = () => {
      const bought = tradeRows.reduce((a, r) => a + r.boughtIsk, 0);
      const sold = tradeRows.reduce((a, r) => a + r.soldIsk, 0);
      return panel({
        title: tx('Piață: ce ai cumpărat și vândut'),
        count: tradeRows.length ? tx('{n} iteme', { n: formatInt(tradeRows.length) }) : '',
        body: tradeRows.length ? `<div class="history-kpis compact">
            <div><span class="label">${tx('Cumpărat')}</span><span class="value down">${compactISK(bought)}</span></div>
            <div><span class="label">${tx('Vândut')}</span><span class="value up">${compactISK(sold)}</span></div>
            <div><span class="label">Net</span><span class="value ${sold - bought >= 0 ? 'up' : 'down'}">${sold - bought >= 0 ? '+' : '−'}${compactISK(Math.abs(sold - bought))}</span></div>
          </div>
          <table class="table compact"><thead><tr><th>Item</th><th class="r">${tx('Cumpărat')}</th><th class="r">ISK</th><th class="r">${tx('Vândut')}</th><th class="r">ISK</th></tr></thead><tbody>
          ${tradeRows.map((r) => `<tr><td><span class="recon-ship"><img class="row-icon" src="${typeIconUrl(r.typeId, 32)}" alt="" loading="lazy" /><span>${esc(itemName(r.typeId))}</span></span></td><td class="r num">${r.boughtQty ? formatInt(r.boughtQty) : ''}</td><td class="r down">${r.boughtIsk ? isk(r.boughtIsk) : ''}</td><td class="r num">${r.soldQty ? formatInt(r.soldQty) : ''}</td><td class="r up">${r.soldIsk ? isk(r.soldIsk) : ''}</td></tr>`).join('')}
        </tbody></table>` : `<p class="dim">${tx('Nicio tranzacție de piață în perioada aleasă.')}</p>`,
      });
    };
    const sessionsPanel = () => panel({
          title: tx('Sesiuni PvE'),
          count: sessions.length ? `${sessions.length} · ${formatNum(hours, 1)} h` : '',
          body: sessions.length ? `<div class="wallet-scroll"><table class="table compact"><thead><tr><th>Start</th><th class="r">${tx('Durată')}</th><th class="r">ISK</th><th class="r">${tx('ISK/oră')}</th></tr></thead><tbody>
            ${sessions.slice(0, 200).map((s) => { const h = (s.end - s.start) / 3600000; return `<tr><td class="num dim">${dateTime(s.start)}</td><td class="r num">${formatNum(h, 1)} h</td><td class="r">${isk(s.isk)}</td><td class="r">${isk(s.isk / h)}</td></tr>`; }).join('')}
            </tbody></table></div>` : `<p class="dim">${tx('Fără recompense NPC sau misiuni în jurnal.')}</p>`,
        });
    const content: Record<WalletSection, () => string> = {
      overview,
      journal,
      trades: tradesPanel,
      bounty: () => `<div id="walletTicks" class="stack"></div>${sessionsPanel()}`,
      ratting: () => '<div id="walletTicks" class="stack"></div>',
    };
    root.innerHTML = bar + content[view.section]();
    if (view.section === 'overview') { bindFlowChart(root, points); renderEscrow(rows); }
    if (view.section === 'journal') renderJournal(rows);
    if (view.section === 'bounty' || view.section === 'ratting') renderTicks(rows);
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-wallet-refresh]')) { renderWallet(body, ctx, characterId, alive, view, true).catch((err) => { if (alive()) body.innerHTML = panel({ body: `<p class="dim">${esc((err as Error).message)}</p>` }); }); return; }
    const p = t.closest<HTMLElement>('[data-wallet-period]');
    if (p) { period = p.dataset.walletPeriod as Period; saveJson(PERIOD_KEY, period); render(); return; }
    const d = t.closest<HTMLElement>('[data-wallet-dir]');
    if (d) {
      direction = d.dataset.walletDir as Direction;
      root.querySelectorAll<HTMLElement>('[data-wallet-dir]').forEach((b) => b.classList.toggle('active', b === d));
      renderJournal(since(entries, periodStart(period)));
      return;
    }
    const r = t.closest<HTMLElement>('[data-wallet-ref]');
    if (r) {
      ref = r.dataset.walletRef!;
      view.section = 'journal';
      view.onSection?.('journal');
      render();
      return;
    }
    if (t.closest('[data-wallet-csv]')) exportCsv(since(entries, periodStart(period)));
  });

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'walletSearch') { query = (t as HTMLInputElement).value; renderJournal(since(entries, periodStart(period))); }
  });

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'walletRef') { ref = (t as HTMLSelectElement).value; renderJournal(since(entries, periodStart(period))); }
  });

  view.rerender = render;
  render();
}
