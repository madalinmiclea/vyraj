import type { AppContext } from '../app/context';
import { panel, loader, esc, formatInt, formatNum, compactISK, button } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { walletJournal, walletBalance, walletTransactions, type WalletEntry, type WalletTransaction } from '../character/esi';
import { PERIODS, periodStart, since, flow, flowBuckets, byRef, refLabel, pveSessions, archiveJournal, archiveTrades, tradeSummary, type Period } from '../services/wallet';
import { flowChart, bindFlowChart, type FlowPoint } from '../ui/charts';
import { typeIconUrl } from '../services/market';
import { allEveItems } from '../data/items';
import { tx, locale } from '../i18n';

const PERIOD_KEY = 'eve-tools:wallet-period';
const JOURNAL_LIMIT = 300;

type Direction = 'all' | 'in' | 'out';

const isk = (v: number) => `<span class="num">${compactISK(v)}</span>`;
const signed = (v: number) => `<span class="num ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : '−'}${compactISK(Math.abs(v))}</span>`;
const dateTime = (ms: number) => new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const day = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });

export async function renderWallet(body: HTMLElement, ctx: AppContext, characterId: number, alive: () => boolean) {
  body.innerHTML = panel({ body: loader(tx('Citesc wallet journal')) });
  const [fresh, balance, freshTrades] = await Promise.all([
    walletJournal(characterId),
    walletBalance(characterId),
    walletTransactions(characterId).catch(() => [] as WalletTransaction[]),
  ]);
  if (!alive()) return;
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
        ${list.slice(0, JOURNAL_LIMIT).map((e) => `<tr><td class="num dim">${dateTime(Date.parse(e.date))}</td><td>${esc(refLabel(e.ref_type))}</td><td class="r">${signed(e.amount ?? 0)}</td><td class="r">${e.balance != null ? isk(e.balance) : ''}</td><td class="desc dim" title="${esc(e.description ?? '')}">${esc(e.description ?? '')}</td></tr>`).join('')}
      </tbody></table>` : `<p class="dim">${tx('Nicio intrare pentru filtrele alese.')}</p>`}`;
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
    const tradeRows = tradeSummary(since(trades, from)).slice(0, 20);

    root.innerHTML = `${panel({
        title: 'Wallet',
        count: entries.length ? tx('istoric salvat din {date}', { date: day(oldest) }) : tx('nicio intrare în jurnal'),
        actions: `<div class="advice-sort">${chips}</div>`,
        body: `<div class="history-kpis">
            <div><span class="label">${tx('Sold')}</span><span class="value">${compactISK(balance)}</span></div>
            <div><span class="label">${tx('Câștigat')}</span><span class="value up">${compactISK(f.earned)}</span></div>
            <div><span class="label">${tx('Cheltuit')}</span><span class="value down">${compactISK(f.spent)}</span></div>
            <div><span class="label">Net</span><span class="value ${f.net >= 0 ? 'up' : 'down'}">${f.net >= 0 ? '+' : '−'}${compactISK(Math.abs(f.net))}</span></div>
            <div><span class="label">${tx('Venit PvE')}</span><span class="value">${compactISK(f.pve)}</span></div>
            <div><span class="label">${tx('ISK/oră PvE')}</span><span class="value">${compactISK(hours ? f.pve / hours : 0)}</span></div>
          </div>
          ${partial ? `<p class="dim small wallet-note">${tx('EVE dă doar ultimele 30 de zile din jurnal. Vyraj păstrează local tot ce citește, așa că perioadele mai lungi se completează pe măsură ce deschizi Wallet. Acum ai date din {date}.', { date: day(oldest) })}</p>` : ''}
          <h4 class="sub-head">${tx('Câștigat și cheltuit {bucket}', { bucket: bucketName })}</h4>
          ${flowChart(points)}`,
      })}
      ${panel({
        title: tx('Toate perioadele'),
        body: `<table class="table compact wallet-periods"><thead><tr><th>${tx('Perioadă')}</th><th class="r">${tx('Câștigat')}</th><th class="r">${tx('Cheltuit')}</th><th class="r">Net</th><th class="r">PvE</th><th class="r">#</th></tr></thead><tbody>
          ${PERIODS.map((p) => {
            const x = flow(since(entries, periodStart(p.id)));
            return `<tr class="${p.id === period ? 'active' : ''}" data-wallet-period="${p.id}"><td>${p.label}</td><td class="r up">${isk(x.earned)}</td><td class="r down">${isk(x.spent)}</td><td class="r">${signed(x.net)}</td><td class="r">${isk(x.pve)}</td><td class="r num dim">${formatInt(x.count)}</td></tr>`;
          }).join('')}
        </tbody></table>`,
      })}
      <div class="tool-grid even">
        ${panel({
          title: tx('Pe categorie'),
          body: cats.length ? `<table class="table compact"><thead><tr><th>${tx('Tip')}</th><th class="r">${tx('Câștigat')}</th><th class="r">${tx('Cheltuit')}</th><th class="r">Net</th></tr></thead><tbody>
            ${cats.map((r) => `<tr><td><button class="link" data-wallet-ref="${esc(r.ref)}">${esc(refLabel(r.ref))}</button></td><td class="r up">${r.income ? isk(r.income) : ''}</td><td class="r down">${r.spent ? isk(r.spent) : ''}</td><td class="r">${signed(r.income - r.spent)}</td></tr>`).join('')}
            </tbody></table>` : `<p class="dim">${tx('Nicio intrare în perioada aleasă.')}</p>`,
        })}
        ${panel({
          title: tx('Sesiuni PvE'),
          count: sessions.length ? `${sessions.length} · ${formatNum(hours, 1)} h` : '',
          body: sessions.length ? `<div class="wallet-scroll"><table class="table compact"><thead><tr><th>Start</th><th class="r">${tx('Durată')}</th><th class="r">ISK</th><th class="r">${tx('ISK/oră')}</th></tr></thead><tbody>
            ${sessions.slice(0, 200).map((s) => { const h = (s.end - s.start) / 3600000; return `<tr><td class="num dim">${dateTime(s.start)}</td><td class="r num">${formatNum(h, 1)} h</td><td class="r">${isk(s.isk)}</td><td class="r">${isk(s.isk / h)}</td></tr>`; }).join('')}
            </tbody></table></div>` : `<p class="dim">${tx('Fără bounty sau misiuni în jurnal.')}</p>`,
        })}
      </div>
      ${tradeRows.length ? panel({
        title: tx('Market: ce ai cumpărat și vândut'),
        body: `<table class="table compact"><thead><tr><th>Item</th><th class="r">${tx('Cumpărat')}</th><th class="r">ISK</th><th class="r">${tx('Vândut')}</th><th class="r">ISK</th></tr></thead><tbody>
          ${tradeRows.map((r) => `<tr><td><span class="recon-ship"><img class="row-icon" src="${typeIconUrl(r.typeId, 32)}" alt="" /><span>${esc(itemName(r.typeId))}</span></span></td><td class="r num">${r.boughtQty ? formatInt(r.boughtQty) : ''}</td><td class="r down">${r.boughtIsk ? isk(r.boughtIsk) : ''}</td><td class="r num">${r.soldQty ? formatInt(r.soldQty) : ''}</td><td class="r up">${r.soldIsk ? isk(r.soldIsk) : ''}</td></tr>`).join('')}
        </tbody></table>`,
      }) : ''}
      ${panel({
        title: tx('Jurnal'),
        actions: button(tx('Export CSV'), { iconName: 'download', cls: 'ghost sm', attrs: 'data-wallet-csv' }),
        body: `<div class="wallet-filters">
            <div class="advice-sort">${(['all', 'in', 'out'] as Direction[]).map((d) => `<button class="chip-btn ${d === direction ? 'active' : ''}" data-wallet-dir="${d}">${{ all: tx('Toate'), in: tx('Intrări'), out: tx('Ieșiri') }[d]}</button>`).join('')}</div>
            <select class="input plain" id="walletRef"><option value="">${tx('Toate tipurile')}</option>${refs.map((r) => `<option value="${esc(r)}" ${r === ref ? 'selected' : ''}>${esc(refLabel(r))}</option>`).join('')}</select>
            <input class="input plain" id="walletSearch" placeholder="${tx('Caută în descriere...')}" value="${esc(query)}" />
          </div>
          <div id="walletJournal"></div>`,
      })}`;
    bindFlowChart(root, points);
    renderJournal(rows);
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
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
      const sel = root.querySelector<HTMLSelectElement>('#walletRef');
      if (sel) sel.value = ref;
      renderJournal(since(entries, periodStart(period)));
      root.querySelector('#walletJournal')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  render();
}
