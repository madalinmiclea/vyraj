import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, formatInt, formatNum, compactISK, copyText, toast, emptyState, windowTitle } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { parseItems, type AppraisalLine } from '../services/appraisal';
import { fetchPrices, fetchLpOffers, resolveIds, typeIconUrl, type Aggregates } from '../services/market';
import { loadAlerts, saveAlerts, addAlert, checkAlerts, hit, ALERTS_EVENT } from '../services/alerts';
import { TIERS, WEATHERS, loadRuns, saveRuns, filamentTypeId, profitOf, summarize, iskPerHour, type AbyssalRun } from '../services/abyssal';
import { pveSessions, byRef, daily, refLabel } from '../services/wallet';
import { walletJournal, walletBalance, loyaltyPoints, listAssets, universeNames, type EsiAsset } from '../character/esi';
import { hasTokens, hasScope } from '../character/sso';
import { allEveItems } from '../data/items';
import { seriesChart, bindSeriesChart, type SeriesPoint } from '../ui/charts';
import { tx, locale } from '../i18n';

type Tab = 'appraisal' | 'abyssal' | 'wallet' | 'assets' | 'lp' | 'alerts';

const TABS: { id: Tab; label: string }[] = [
  { id: 'appraisal', label: 'Appraisal' },
  { id: 'abyssal', label: tx('Jurnal Abyssal') },
  { id: 'wallet', label: 'Wallet' },
  { id: 'assets', label: 'Assets' },
  { id: 'lp', label: 'LP Store' },
  { id: 'alerts', label: tx('Alerte preț') },
];

const TAB_KEY = 'eve-tools:tab';
const APPRAISAL_KEY = 'eve-tools:appraisal-text';
const BASIS_KEY = 'eve-tools:price-basis';
const LP_CORP_KEY = 'eve-tools:lp-corp';
const LAST_RUN_KEY = 'eve-tools:abyssal-last';

type Basis = 'sell' | 'buy';

const priceOf = (p: Aggregates | undefined, basis: Basis) => (p ? (basis === 'sell' ? p.sellMin : p.buyMax) : 0);
const isk = (v: number) => `<span class="num">${compactISK(v)}</span>`;
const dateTime = (ms: number) => new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const typeName = (id: number) => allEveItems.find((i) => i.t === id)?.n.trim() ?? `Type ${id}`;

export function createToolsView(el: HTMLElement, ctx: AppContext, side: HTMLElement) {
  let tab = loadJson<Tab>(TAB_KEY, 'appraisal');
  if (!TABS.some((t) => t.id === tab)) tab = 'appraisal';
  let basis = loadJson<Basis>(BASIS_KEY, 'sell');

  el.innerHTML = `${pageHead(tx('Unelte ISK'), 'Jita 4-4', 'Tithe')}
    <div id="toolBody"></div>`;
  const body = el.querySelector<HTMLElement>('#toolBody')!;

  const basisChips = () => `<div class="advice-sort">
    <button class="chip-btn ${basis === 'sell' ? 'active' : ''}" data-basis="sell">Jita sell</button>
    <button class="chip-btn ${basis === 'buy' ? 'active' : ''}" data-basis="buy">Jita buy</button>
  </div>`;

  function esiCharacter(scope?: string): { id: number } | string {
    const c = ctx.character;
    if (c.kind !== 'esi' || !c.characterId || !hasTokens(c.characterId)) return tx('Selectează un caracter importat din EVE (ecranul Caracter).');
    if (scope && !hasScope(c.characterId, scope)) return 'scope';
    return { id: c.characterId };
  }

  function scopePrompt() {
    return panel({ body: alertBox(tx('Login-ul acestui caracter nu are toate permisiunile. Fă din nou login din ecranul Caracter.')) });
  }

  function renderTabs() {
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Unelte ISK'))}</div>
      <div class="side-nav">${TABS.map((t) => `<button class="side-link ${t.id === tab ? 'active' : ''}" data-tool-tab="${t.id}">${t.label}</button>`).join('')}</div>`;
  }

  function render() {
    renderTabs();
    ({ appraisal, abyssal, wallet, assets, lp, alerts } as Record<Tab, () => void>)[tab]();
  }

  async function priceTable(lines: AppraisalLine[]) {
    const prices = await fetchPrices(lines.map((l) => l.typeId));
    const rows = lines.map((l) => {
      const p = prices.get(l.typeId);
      return { ...l, sell: (p?.sellMin ?? 0) * l.quantity, buy: (p?.buyMax ?? 0) * l.quantity, unit: priceOf(p, basis) };
    }).sort((a, b) => (basis === 'sell' ? b.sell - a.sell : b.buy - a.buy));
    return { rows, sell: rows.reduce((a, r) => a + r.sell, 0), buy: rows.reduce((a, r) => a + r.buy, 0) };
  }

  function appraisal() {
    const text = loadJson<string>(APPRAISAL_KEY, '');
    body.innerHTML = `<div class="tool-grid">
      ${panel({
        title: tx('Lipește iteme'),
        body: `<textarea class="input area" id="apText" rows="16" spellcheck="false" placeholder="${tx('Copiază din inventar, contract, EFT sau listă')}">${esc(text)}</textarea>
          <div class="row-actions"><button class="btn sm" data-appraise>${icon('market')}${tx('Evaluează')}</button><button class="btn ghost sm" data-ap-clear>${tx('Golește')}</button></div>`,
      })}
      <div id="apResult"></div>
    </div>`;
    if (text.trim()) runAppraisal();
  }

  async function runAppraisal() {
    const out = body.querySelector<HTMLElement>('#apResult');
    const text = body.querySelector<HTMLTextAreaElement>('#apText')?.value ?? '';
    saveJson(APPRAISAL_KEY, text);
    if (!out) return;
    const { lines, unknown } = parseItems(text);
    if (!lines.length) { out.innerHTML = panel({ body: `<p class="dim">${tx('Niciun item recunoscut.')}</p>` }); return; }
    out.innerHTML = panel({ body: loader(tx('Prețuri {name}', { name: 'Jita' })) });
    try {
      const t = await priceTable(lines);
      out.innerHTML = panel({
        title: tx('Evaluare'),
        count: tx('{n} tipuri · {q} bucăți', { n: lines.length, q: formatInt(lines.reduce((a, l) => a + l.quantity, 0)) }),
        actions: basisChips(),
        body: `<div class="history-kpis">
            <div><span class="label">Jita sell</span><span class="value">${compactISK(t.sell)}</span></div>
            <div><span class="label">Jita buy</span><span class="value">${compactISK(t.buy)}</span></div>
            <div><span class="label">90% buy</span><span class="value">${compactISK(t.buy * 0.9)}</span></div>
          </div>
          <div class="row-actions"><button class="btn ghost sm" data-copy-total="${Math.round(basis === 'sell' ? t.sell : t.buy)}">${icon('copy')}${tx('Copiază total')}</button></div>
          <table class="table compact"><thead><tr><th>Item</th><th class="r">${tx('Cant.')}</th><th class="r">${tx('Unitar')}</th><th class="r">Sell</th><th class="r">Buy</th></tr></thead><tbody>
          ${t.rows.map((r) => `<tr><td><img class="row-icon" src="${typeIconUrl(r.typeId, 32)}" alt="" />${esc(r.name)}</td><td class="r num">${formatInt(r.quantity)}</td><td class="r">${isk(r.unit)}</td><td class="r">${isk(r.sell)}</td><td class="r">${isk(r.buy)}</td></tr>`).join('')}
          </tbody></table>
          ${unknown.length ? `<p class="small warn-text">${tx('Nerecunoscute')}: ${unknown.slice(0, 20).map(esc).join(', ')}${unknown.length > 20 ? '…' : ''}</p>` : ''}`,
      });
    } catch (err) {
      out.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  function abyssal() {
    const runs = loadRuns().sort((a, b) => b.date - a.date);
    const last = loadJson<Partial<AbyssalRun>>(LAST_RUN_KEY, { tier: 3, weather: 'Electrical', ship: '' });
    const totalProfit = runs.reduce((a, r) => a + profitOf(r), 0);
    const totalMin = runs.reduce((a, r) => a + r.minutes, 0);
    const summaryTable = (title: string, list: ReturnType<typeof summarize>) => `<h4 class="sub-head">${title}</h4>
      <table class="table compact"><thead><tr><th></th><th class="r">${tx('Run-uri')}</th><th class="r">${tx('Profit mediu')}</th><th class="r">${tx('ISK/oră')}</th><th class="r">${tx('Pierderi')}</th></tr></thead><tbody>
      ${list.map((s) => `<tr><td>${esc(s.key)}</td><td class="r num">${s.runs}</td><td class="r">${isk(s.profit / s.runs)}</td><td class="r">${isk(iskPerHour(s.profit, s.minutes))}</td><td class="r num">${s.losses}</td></tr>`).join('')}
      </tbody></table>`;
    body.innerHTML = `<div class="tool-grid">
      ${panel({
        title: tx('Run nou'),
        body: `<div class="form-grid">
            <label>Tier <select class="input sm" id="abTier">${TIERS.map((t, i) => `<option value="${i}" ${i === last.tier ? 'selected' : ''}>T${i} ${t}</option>`).join('')}</select></label>
            <label>${tx('Vreme')} <select class="input sm" id="abWeather">${WEATHERS.map((w) => `<option ${w === last.weather ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
            <label>${tx('Navă')} <input class="input sm" id="abShip" value="${esc(last.ship ?? '')}" /></label>
            <label>${tx('Durată (min)')} <input class="input sm num" id="abMinutes" type="number" min="1" value="${last.minutes ?? 20}" /></label>
            <label>${tx('Navă pierdută (ISK)')} <input class="input sm num" id="abLoss" type="number" min="0" value="0" /></label>
          </div>
          <label class="block-label">${tx('Loot (lipește din inventar)')}</label>
          <textarea class="input area" id="abLoot" rows="8" spellcheck="false"></textarea>
          <div class="row-actions"><button class="btn sm" data-ab-save>${icon('save')}${tx('Salvează run-ul')}</button></div>`,
      })}
      ${panel({
        title: tx('Rezultate'),
        count: runs.length ? tx('{n} run-uri', { n: runs.length }) : '',
        body: runs.length ? `<div class="history-kpis">
            <div><span class="label">${tx('Profit total')}</span><span class="value">${compactISK(totalProfit)}</span></div>
            <div><span class="label">${tx('ISK/oră')}</span><span class="value">${compactISK(iskPerHour(totalProfit, totalMin))}</span></div>
            <div><span class="label">${tx('Profit mediu')}</span><span class="value">${compactISK(totalProfit / runs.length)}</span></div>
            <div><span class="label">${tx('Timp')}</span><span class="value">${formatNum(totalMin / 60, 1)} h</span></div>
          </div>
          ${summaryTable(tx('Pe tier și vreme'), summarize(runs, (r) => `T${r.tier} ${TIERS[r.tier]} ${r.weather}`))}
          ${summaryTable(tx('Pe navă'), summarize(runs, (r) => r.ship || '—'))}
          <h4 class="sub-head">${tx('Run-uri')}</h4>
          <table class="table compact"><thead><tr><th>${tx('Data')}</th><th>Run</th><th class="r">Min</th><th class="r">Filament</th><th class="r">Loot</th><th class="r">Profit</th><th></th></tr></thead><tbody>
          ${runs.map((r) => `<tr><td class="num dim">${dateTime(r.date)}</td><td>T${r.tier} ${TIERS[r.tier]} ${esc(r.weather)} · ${esc(r.ship || '—')}</td><td class="r num">${r.minutes}</td><td class="r">${isk(r.filamentCost)}</td><td class="r">${isk(r.lootValue)}</td><td class="r ${profitOf(r) >= 0 ? 'up' : 'down'}">${isk(profitOf(r))}</td><td><button class="icon-btn" data-ab-del="${r.id}" title="${tx('Șterge')}">✕</button></td></tr>`).join('')}
          </tbody></table>` : `<p class="dim">${tx('Niciun run salvat.')}</p>`,
      })}
    </div>`;
  }

  async function saveRun() {
    const v = (id: string) => body.querySelector<HTMLInputElement>('#' + id)!.value;
    const tier = Number(v('abTier')), weather = v('abWeather'), ship = v('abShip').trim();
    const minutes = Math.max(1, Number(v('abMinutes')) || 20), shipLoss = Math.max(0, Number(v('abLoss')) || 0);
    const { lines } = parseItems(v('abLoot'));
    const fil = filamentTypeId(tier, weather);
    toast(tx('Calculez valorile…'));
    try {
      const prices = await fetchPrices([...lines.map((l) => l.typeId), ...(fil ? [fil] : [])]);
      const lootValue = lines.reduce((a, l) => a + priceOf(prices.get(l.typeId), 'sell') * l.quantity, 0);
      const filamentCost = fil ? priceOf(prices.get(fil), 'sell') : 0;
      saveRuns([...loadRuns(), { id: `${Date.now()}`, date: Date.now(), tier, weather, ship, minutes, filamentCost, lootValue, shipLoss }]);
      saveJson(LAST_RUN_KEY, { tier, weather, ship, minutes });
      toast(tx('Run salvat · profit {isk} ISK', { isk: compactISK(lootValue - filamentCost - shipLoss) }));
      abyssal();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function wallet() {
    const c = esiCharacter('esi-wallet.read_character_wallet.v1');
    if (c === 'scope') { body.innerHTML = scopePrompt(); return; }
    if (typeof c === 'string') { body.innerHTML = panel({ body: alertBox(c) }); return; }
    body.innerHTML = panel({ body: loader(tx('Citesc wallet journal')) });
    try {
      const [entries, balance] = await Promise.all([walletJournal(c.id), walletBalance(c.id)]);
      if (tab !== 'wallet') return;
      const sessions = pveSessions(entries);
      const days = daily(entries, 30);
      const points: SeriesPoint[] = days.map((d) => ({ label: new Date(d.day).toISOString().slice(5, 10).split('-').reverse().join('.'), value: d.pve }));
      const pveTotal = sessions.reduce((a, s) => a + s.isk, 0);
      const pveHours = sessions.reduce((a, s) => a + (s.end - s.start), 0) / 3600000;
      const oldest = entries.length ? entries.reduce((m, e) => Math.min(m, Date.parse(e.date)), Infinity) : Date.now();
      body.innerHTML = `${panel({
          title: 'Wallet',
          count: tx('{n} intrări din {date}', { n: formatInt(entries.length), date: dateTime(oldest) }),
          body: `<div class="history-kpis">
              <div><span class="label">${tx('Sold')}</span><span class="value">${compactISK(balance)}</span></div>
              <div><span class="label">${tx('Venit PvE')}</span><span class="value">${compactISK(pveTotal)}</span></div>
              <div><span class="label">${tx('Ore active')}</span><span class="value">${formatNum(pveHours, 1)}</span></div>
              <div><span class="label">${tx('ISK/oră PvE')}</span><span class="value">${compactISK(pveHours ? pveTotal / pveHours : 0)}</span></div>
            </div>
            <h4 class="sub-head">${tx('Venit PvE pe zi (30 zile)')}</h4>
            ${seriesChart(points, { bars: true })}`,
        })}
        <div class="tool-grid">
          ${panel({
            title: tx('Sesiuni PvE'),
            body: sessions.length ? `<table class="table compact"><thead><tr><th>Start</th><th class="r">${tx('Durată')}</th><th class="r">ISK</th><th class="r">${tx('ISK/oră')}</th></tr></thead><tbody>
              ${sessions.slice(0, 40).map((s) => { const h = (s.end - s.start) / 3600000; return `<tr><td class="num dim">${dateTime(s.start)}</td><td class="r num">${formatNum(h, 1)} h</td><td class="r">${isk(s.isk)}</td><td class="r">${isk(s.isk / h)}</td></tr>`; }).join('')}
              </tbody></table>` : `<p class="dim">${tx('Fără bounty sau misiuni în jurnal.')}</p>`,
          })}
          ${panel({
            title: tx('Pe categorie'),
            body: `<table class="table compact"><thead><tr><th>${tx('Tip')}</th><th class="r">${tx('Intrat')}</th><th class="r">${tx('Ieșit')}</th></tr></thead><tbody>
              ${byRef(entries).map((r) => `<tr><td>${esc(refLabel(r.ref))}</td><td class="r up">${r.income ? isk(r.income) : ''}</td><td class="r down">${r.spent ? isk(r.spent) : ''}</td></tr>`).join('')}
              </tbody></table>`,
          })}
        </div>`;
      bindSeriesChart(body, points, { valueLabel: 'PvE' });
    } catch (err) {
      body.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  async function assets() {
    const c = esiCharacter('esi-assets.read_assets.v1');
    if (c === 'scope') { body.innerHTML = scopePrompt(); return; }
    if (typeof c === 'string') { body.innerHTML = panel({ body: alertBox(c) }); return; }
    body.innerHTML = panel({ body: loader(tx('Citesc asset-urile și prețurile')) });
    try {
      const list = await listAssets(c.id);
      const byId = new Map(list.map((a) => [a.item_id, a]));
      const root = (a: EsiAsset) => { let cur = a; for (let i = 0; i < 10 && byId.has(cur.location_id); i++) cur = byId.get(cur.location_id)!; return cur.location_id; };
      const prices = await fetchPrices(list.map((a) => a.type_id));
      const valued = list.map((a) => ({ a, value: a.is_blueprint_copy ? 0 : priceOf(prices.get(a.type_id), basis) * a.quantity, loc: root(a) }));
      const locs = new Map<number, number>();
      const types = new Map<number, { qty: number; value: number }>();
      for (const v of valued) {
        locs.set(v.loc, (locs.get(v.loc) ?? 0) + v.value);
        const t = types.get(v.a.type_id) ?? { qty: 0, value: 0 };
        t.qty += v.a.quantity; t.value += v.value;
        types.set(v.a.type_id, t);
      }
      const names = await universeNames([...locs.keys()]).catch(() => new Map<number, string>());
      if (tab !== 'assets') return;
      const total = valued.reduce((a, v) => a + v.value, 0);
      const locName = (id: number) => names.get(id) ?? (id > 1e12 ? tx('Structură {id}', { id }) : tx('Locație {id}', { id }));
      body.innerHTML = `${panel({
          title: tx('Valoare assets'),
          actions: basisChips(),
          body: `<div class="history-kpis">
              <div><span class="label">Total</span><span class="value">${compactISK(total)}</span></div>
              <div><span class="label">${tx('Iteme')}</span><span class="value">${formatInt(list.length)}</span></div>
              <div><span class="label">${tx('Locații')}</span><span class="value">${formatInt(locs.size)}</span></div>
            </div>`,
        })}
        <div class="tool-grid">
          ${panel({ title: tx('Pe locație'), body: `<table class="table compact"><tbody>${[...locs.entries()].sort((a, b) => b[1] - a[1]).map(([id, v]) => `<tr><td>${esc(locName(id))}</td><td class="r">${isk(v)}</td></tr>`).join('')}</tbody></table>` })}
          ${panel({ title: tx('Cele mai valoroase'), body: `<table class="table compact"><tbody>${[...types.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 40).map(([id, t]) => `<tr><td><img class="row-icon" src="${typeIconUrl(id, 32)}" alt="" />${esc(typeName(id))}</td><td class="r num">${formatInt(t.qty)}</td><td class="r">${isk(t.value)}</td></tr>`).join('')}</tbody></table>` })}
        </div>`;
    } catch (err) {
      body.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  async function lp() {
    const saved = loadJson<{ id: number; name: string } | null>(LP_CORP_KEY, null);
    const c = esiCharacter('esi-characters.read_loyalty.v1');
    let mine: { corporation_id: number; loyalty_points: number }[] = [];
    let corpNames = new Map<number, string>();
    if (typeof c !== 'string') {
      mine = await loyaltyPoints(c.id).catch(() => []);
      corpNames = await universeNames(mine.map((m) => m.corporation_id)).catch(() => new Map());
    }
    body.innerHTML = `${panel({
        title: 'LP Store',
        actions: basisChips(),
        body: `<div class="form-grid">
            ${mine.length ? `<label>${tx('LP-ul meu')} <select class="input sm" id="lpMine"><option value="">—</option>${mine.sort((a, b) => b.loyalty_points - a.loyalty_points).map((m) => `<option value="${m.corporation_id}" ${saved?.id === m.corporation_id ? 'selected' : ''}>${esc(corpNames.get(m.corporation_id) ?? String(m.corporation_id))} · ${formatInt(m.loyalty_points)} LP</option>`).join('')}</select></label>` : ''}
            <label>${tx('Corporație')} <input class="input sm" id="lpCorp" placeholder="Caldari Navy" value="${esc(saved?.name ?? '')}" /></label>
            <button class="btn sm" data-lp-load>${icon('search')}${tx('Încarcă')}</button>
          </div>
`,
      })}
      <div id="lpResult"></div>`;
    if (saved) loadOffers(saved, mine.find((m) => m.corporation_id === saved.id)?.loyalty_points ?? 0);
  }

  async function loadOffers(corp: { id: number; name: string }, points: number) {
    const out = body.querySelector<HTMLElement>('#lpResult');
    if (!out) return;
    out.innerHTML = panel({ body: loader(tx('Oferte {name}', { name: corp.name })) });
    try {
      const offers = await fetchLpOffers(corp.id);
      const prices = await fetchPrices(offers.flatMap((o) => [o.type_id, ...o.required_items.map((r) => r.type_id)]));
      const rows = offers.filter((o) => o.lp_cost > 0).map((o) => {
        const p = prices.get(o.type_id);
        const value = priceOf(p, basis) * o.quantity;
        const req = o.required_items.reduce((a, r) => a + priceOf(prices.get(r.type_id), 'sell') * r.quantity, 0);
        const profit = value - o.isk_cost - req;
        return { o, value, req, profit, perLp: profit / o.lp_cost, volume: p?.sellVolume ?? 0 };
      }).filter((r) => r.value > 0).sort((a, b) => b.perLp - a.perLp);
      if (tab !== 'lp') return;
      out.innerHTML = panel({
        title: corp.name,
        count: tx('{n} oferte cu preț', { n: rows.length }),
        body: `<table class="table compact"><thead><tr><th>Item</th><th class="r">LP</th><th class="r">ISK</th><th class="r">${tx('Iteme cerute')}</th><th class="r">${tx('Valoare')}</th><th class="r">ISK/LP</th><th class="r">${tx('Pe piață')}</th>${points ? `<th class="r">${tx('Cu LP-ul tău')}</th>` : ''}</tr></thead><tbody>
          ${rows.slice(0, 80).map((r) => `<tr><td><img class="row-icon" src="${typeIconUrl(r.o.type_id, 32)}" alt="" />${r.o.quantity > 1 ? `${formatInt(r.o.quantity)}× ` : ''}${esc(typeName(r.o.type_id))}</td>
            <td class="r num">${formatInt(r.o.lp_cost)}</td><td class="r">${isk(r.o.isk_cost)}</td>
            <td class="r" title="${esc(r.o.required_items.map((x) => `${x.quantity}× ${typeName(x.type_id)}`).join(', '))}">${r.req ? isk(r.req) : ''}</td>
            <td class="r">${isk(r.value)}</td><td class="r num ${r.perLp >= 0 ? 'up' : 'down'}">${formatInt(r.perLp)}</td><td class="r num dim">${formatInt(r.volume)}</td>
            ${points ? `<td class="r">${isk(Math.floor(points / r.o.lp_cost) * r.profit)}</td>` : ''}</tr>`).join('')}
          </tbody></table>`,
      });
    } catch (err) {
      out.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  async function lpLoad() {
    const sel = body.querySelector<HTMLSelectElement>('#lpMine');
    const input = body.querySelector<HTMLInputElement>('#lpCorp')!.value.trim();
    let corp: { id: number; name: string } | null = null;
    if (sel?.value && (!input || sel.selectedOptions[0].text.startsWith(input))) corp = { id: Number(sel.value), name: sel.selectedOptions[0].text.split(' · ')[0] };
    else if (input) {
      try {
        const r = await resolveIds([input]);
        const hitCorp = r.corporations?.[0];
        if (!hitCorp) { toast(tx('Nu am găsit corporația')); return; }
        corp = { id: hitCorp.id, name: hitCorp.name };
      } catch (err) { toast((err as Error).message); return; }
    }
    if (!corp) return;
    saveJson(LP_CORP_KEY, corp);
    body.querySelector<HTMLInputElement>('#lpCorp')!.value = corp.name;
    const points = sel ? Number([...sel.options].find((o) => Number(o.value) === corp!.id)?.text.split(' · ')[1]?.replace(/\D/g, '') ?? 0) : 0;
    loadOffers(corp, points);
  }

  function alerts() {
    const list = loadAlerts();
    body.innerHTML = panel({
      title: tx('Alerte preț'),
      count: list.length ? tx('{n} active', { n: list.length }) : '',
      actions: list.length ? `<button class="btn ghost sm" data-al-check>${icon('refresh')}${tx('Verifică acum')}</button>` : '',
      body: `<div class="form-grid">
          <label>Item <input class="input sm" id="alName" placeholder="PLEX" /></label>
          <label><select class="input sm" id="alSide2"><option value="sell">sell min</option><option value="buy">buy max</option></select></label>
          <label><select class="input sm" id="alOp2"><option value="below">≤</option><option value="above">≥</option></select></label>
          <label><input class="input sm num" id="alPrice2" type="number" min="0" step="any" placeholder="ISK" /></label>
          <button class="btn sm" data-al-add>${icon('plus')}${tx('Adaugă')}</button>
        </div>
        ${list.length ? `<table class="table compact"><thead><tr><th>Item</th><th>${tx('Condiție')}</th><th class="r">${tx('Acum')}</th><th>${tx('Verificat')}</th><th></th></tr></thead><tbody>
          ${list.map((a) => `<tr class="${a.current != null && hit(a, a.current) ? 'alert-hit' : ''}"><td><img class="row-icon" src="${typeIconUrl(a.typeId, 32)}" alt="" />${esc(a.name)}</td>
            <td>${a.side} ${a.op === 'below' ? '≤' : '≥'} ${isk(a.price)}</td>
            <td class="r">${a.current != null ? isk(a.current) : '—'}</td>
            <td class="num dim">${a.checkedAt ? dateTime(a.checkedAt) : '—'}</td>
            <td><button class="icon-btn" data-al-del="${a.id}" title="${tx('Șterge')}">✕</button></td></tr>`).join('')}
          </tbody></table>` : emptyState({ title: tx('Nicio alertă'), text: '' })}`,
    });
  }

  function addAlertFromForm() {
    const v = (id: string) => body.querySelector<HTMLInputElement>('#' + id)!.value;
    const { lines } = parseItems(v('alName'));
    const price = Number(v('alPrice2'));
    if (!lines.length) { toast(tx('Item necunoscut')); return; }
    if (!(price > 0)) { toast(tx('Pune un preț')); return; }
    addAlert({ typeId: lines[0].typeId, name: lines[0].name, side: v('alSide2') as 'sell' | 'buy', op: v('alOp2') as 'below' | 'above', price });
    checkAlerts().catch(() => {});
  }

  side.addEventListener('click', (e) => {
    const tb = (e.target as HTMLElement).closest<HTMLElement>('[data-tool-tab]');
    if (tb) { tab = tb.dataset.toolTab as Tab; saveJson(TAB_KEY, tab); render(); }
  });

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const at = (s: string) => t.closest<HTMLElement>(s);
    const tb = at('[data-tool-tab]');
    if (tb) { tab = tb.dataset.toolTab as Tab; saveJson(TAB_KEY, tab); render(); return; }
    const b = at('[data-basis]');
    if (b) {
      basis = b.dataset.basis as Basis;
      saveJson(BASIS_KEY, basis);
      if (tab === 'appraisal') runAppraisal(); else if (tab === 'lp') lpLoad(); else render();
      return;
    }
    if (at('[data-appraise]')) { runAppraisal(); return; }
    if (at('[data-ap-clear]')) { saveJson(APPRAISAL_KEY, ''); appraisal(); return; }
    const ct = at('[data-copy-total]');
    if (ct) { copyText(ct.dataset.copyTotal!, tx('Total copiat')); return; }
    if (at('[data-ab-save]')) { saveRun(); return; }
    const del = at('[data-ab-del]');
    if (del) { saveRuns(loadRuns().filter((r) => r.id !== del.dataset.abDel)); abyssal(); return; }
    if (at('[data-lp-load]')) { lpLoad(); return; }
    if (at('[data-al-add]')) { addAlertFromForm(); return; }
    if (at('[data-al-check]')) { checkAlerts().then(() => toast(tx('Verificat'))).catch((err) => toast((err as Error).message)); return; }
    const ad = at('[data-al-del]');
    if (ad) saveAlerts(loadAlerts().filter((a) => a.id !== ad.dataset.alDel));
  });

  el.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'lpMine') {
      const sel = t as HTMLSelectElement;
      body.querySelector<HTMLInputElement>('#lpCorp')!.value = sel.value ? sel.selectedOptions[0].text.split(' · ')[0] : '';
      if (sel.value) lpLoad();
    }
  });

  window.addEventListener(ALERTS_EVENT, () => { if (tab === 'alerts') alerts(); });
  ctx.onCharacterChange(() => { if (tab === 'wallet' || tab === 'assets' || tab === 'lp') render(); });

  render();
}
