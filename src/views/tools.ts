import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, formatInt, formatNum, compactISK, copyText, toast, emptyState, windowTitle, dataStamp } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { parseItems, type AppraisalLine } from '../services/appraisal';
import { fetchPrices, forgetPrices, pricesAt, fetchLpOffers, resolveIds, typeIconUrl, type Aggregates, type LpOffer } from '../services/market';
import { loadAlerts, saveAlerts, addAlert, checkAlerts, hit, ALERTS_EVENT } from '../services/alerts';
import { TIERS, WEATHERS, loadRuns, saveRuns, filamentTypeId, profitOf, summarize, iskPerHour, type AbyssalRun } from '../services/abyssal';
import { renderWallet } from './wallet';
import { loyaltyPoints, listAssets, universeNames, type EsiAsset } from '../character/esi';
import { removeKey } from '../storage';
import { hasScope, loginProblem } from '../character/sso';
import { allEveItems } from '../data/items';
import { tx, locale } from '../i18n';

type Tab = 'appraisal' | 'abyssal' | 'wallet' | 'assets' | 'lp' | 'alerts';

const TABS: { id: Tab; label: string }[] = [
  { id: 'appraisal', label: tx('Evaluare') },
  { id: 'abyssal', label: tx('Jurnal abisal') },
  { id: 'wallet', label: tx('Portofel') },
  { id: 'assets', label: tx('Bunuri') },
  { id: 'lp', label: tx('Magazin LP') },
  { id: 'alerts', label: tx('Alerte preț') },
];

const TAB_KEY = 'eve-tools:tab';
const APPRAISAL_KEY = 'eve-tools:appraisal-text';
const BASIS_KEY = 'eve-tools:price-basis';
const LP_CORP_KEY = 'eve-tools:lp-corp';
const LAST_RUN_KEY = 'eve-tools:abyssal-last';
const ASSETS_KEY = 'eve-tools:assets:';
const LP_OFFERS_KEY = 'eve-tools:lp-offers';

interface AssetSnapshot { at: number; items: number; rows: [number, number, number][]; names: [number, string][] }
type OfferStore = Record<string, { at: number; offers: LpOffer[] }>;

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
    <button class="chip-btn ${basis === 'sell' ? 'active' : ''}" data-basis="sell">${tx('Jita vânzare')}</button>
    <button class="chip-btn ${basis === 'buy' ? 'active' : ''}" data-basis="buy">${tx('Jita cumpărare')}</button>
  </div>`;

  const ASSET_SAFETY = 2004;

  function esiCharacter(scope?: string): { id: number } | string {
    const c = ctx.character;
    const problem = loginProblem(c);
    if (problem || !c.characterId) return problem ?? '';
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

  let apIds: number[] = [];
  const lpPoints = new Map<number, { mine: { corporation_id: number; loyalty_points: number }[]; corpNames: Map<number, string> }>();

  async function priceTable(lines: AppraisalLine[]) {
    const prices = await fetchPrices(lines.map((l) => l.typeId));
    const rows = lines.map((l) => {
      const p = prices.get(l.typeId);
      return { ...l, sell: (p?.sellMin ?? 0) * l.quantity, buy: (p?.buyMax ?? 0) * l.quantity, unit: priceOf(p, basis) };
    }).sort((a, b) => (basis === 'sell' ? b.sell - a.sell : b.buy - a.buy));
    apIds = lines.map((l) => l.typeId);
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
        actions: dataStamp(pricesAt(apIds), 'data-ap-refresh') + basisChips(),
        body: `<div class="history-kpis">
            <div><span class="label">${tx('Jita vânzare')}</span><span class="value">${compactISK(t.sell)}</span></div>
            <div><span class="label">${tx('Jita cumpărare')}</span><span class="value">${compactISK(t.buy)}</span></div>
            <div><span class="label">${tx('90% din cumpărare')}</span><span class="value">${compactISK(t.buy * 0.9)}</span></div>
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
    const minutes = Number(v('abMinutes')), shipLoss = Math.max(0, Number(v('abLoss')) || 0);
    if (!(minutes >= 1)) { toast(tx('Pune durata run-ului în minute (minim 1).')); return; }
    const { lines, unknown } = parseItems(v('abLoot'));
    const fil = filamentTypeId(tier, weather);
    toast(tx('Calculez valorile…'));
    try {
      const prices = await fetchPrices([...lines.map((l) => l.typeId), ...(fil ? [fil] : [])], { fresh: true });
      const lootValue = lines.reduce((a, l) => a + priceOf(prices.get(l.typeId), 'sell') * l.quantity, 0);
      const filamentCost = fil ? priceOf(prices.get(fil), 'sell') : 0;
      saveRuns([...loadRuns(), { id: `${Date.now()}`, date: Date.now(), tier, weather, ship, minutes, filamentCost, lootValue, shipLoss }]);
      saveJson(LAST_RUN_KEY, { tier, weather, ship, minutes });
      const saved = tx('Run salvat · profit {isk} ISK', { isk: compactISK(lootValue - filamentCost - shipLoss) });
      toast(unknown.length ? `${saved} · ${tx('{n} linii de loot nerecunoscute: {list}', { n: unknown.length, list: unknown.slice(0, 5).join(', ') + (unknown.length > 5 ? '…' : '') })}` : saved);
      abyssal();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function wallet() {
    const c = esiCharacter('esi-wallet.read_character_wallet.v1');
    if (c === 'scope') { body.innerHTML = scopePrompt(); return; }
    if (typeof c === 'string') { body.innerHTML = panel({ body: alertBox(c) }); return; }
    const charId = ctx.character.id;
    try {
      await renderWallet(body, ctx, c.id, () => tab === 'wallet' && ctx.character.id === charId);
    } catch (err) {
      if (tab === 'wallet') body.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  async function assetSnapshot(characterId: number): Promise<AssetSnapshot> {
    const cached = loadJson<AssetSnapshot | null>(ASSETS_KEY + characterId, null);
    if (cached?.rows) return cached;
    const list = await listAssets(characterId);
    const byId = new Map(list.map((a) => [a.item_id, a]));
    const root = (a: EsiAsset) => { let cur = a; for (let i = 0; i < 10 && byId.has(cur.location_id); i++) cur = byId.get(cur.location_id)!; return cur.location_id; };
    const agg = new Map<string, [number, number, number]>();
    for (const a of list) {
      if (a.is_blueprint_copy) continue;
      const loc = root(a);
      const k = `${loc}:${a.type_id}`;
      const row = agg.get(k) ?? [loc, a.type_id, 0];
      row[2] += a.quantity;
      agg.set(k, row);
    }
    const rows = [...agg.values()];
    const names = await universeNames([...new Set(rows.map((r) => r[0]))], characterId).catch(() => new Map<number, string>());
    const snap: AssetSnapshot = { at: Date.now(), items: list.length, rows, names: [...names] };
    saveJson(ASSETS_KEY + characterId, snap);
    return snap;
  }

  async function assets() {
    const c = esiCharacter('esi-assets.read_assets.v1');
    if (c === 'scope') { body.innerHTML = scopePrompt(); return; }
    if (typeof c === 'string') { body.innerHTML = panel({ body: alertBox(c) }); return; }
    body.innerHTML = panel({ body: loader(tx('Citesc asset-urile și prețurile')) });
    try {
      const snap = await assetSnapshot(c.id);
      const typeIds = [...new Set(snap.rows.map((r) => r[1]))];
      const prices = await fetchPrices(typeIds);
      const locs = new Map<number, number>();
      const types = new Map<number, { qty: number; value: number }>();
      for (const [loc, typeId, qty] of snap.rows) {
        const value = priceOf(prices.get(typeId), basis) * qty;
        locs.set(loc, (locs.get(loc) ?? 0) + value);
        const t = types.get(typeId) ?? { qty: 0, value: 0 };
        t.qty += qty; t.value += value;
        types.set(typeId, t);
      }
      const names = new Map(snap.names);
      if (tab !== 'assets') return;
      const total = [...locs.values()].reduce((a, v) => a + v, 0);
      const at = Math.min(snap.at, pricesAt(typeIds) || snap.at);
      const locName = (id: number) => names.get(id) ?? (id === ASSET_SAFETY ? 'Asset Safety' : id > 1e12 ? tx('Structură {id}', { id }) : tx('Locație {id}', { id }));
      body.innerHTML = `${panel({
          title: tx('Valoare bunuri'),
          actions: dataStamp(at, 'data-assets-refresh', { label: tx('Date din {time}'), title: tx('Asset-urile și prețurile Jita sunt păstrate până le reîmprospătezi. Click pentru a le citi din nou.') }) + basisChips(),
          body: `<div class="history-kpis">
              <div><span class="label">Total</span><span class="value">${compactISK(total)}</span></div>
              <div><span class="label">${tx('Iteme')}</span><span class="value">${formatInt(snap.items)}</span></div>
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

  function refreshAssets() {
    const id = ctx.character.characterId;
    if (!id) return;
    const snap = loadJson<AssetSnapshot | null>(ASSETS_KEY + id, null);
    if (snap?.rows) forgetPrices(snap.rows.map((r) => r[1]));
    removeKey(ASSETS_KEY + id);
    assets();
  }

  async function lp() {
    const saved = loadJson<{ id: number; name: string } | null>(LP_CORP_KEY, null);
    const c = esiCharacter('esi-characters.read_loyalty.v1');
    let mine: { corporation_id: number; loyalty_points: number }[] = [];
    let corpNames = new Map<number, string>();
    if (typeof c !== 'string') {
      let known = lpPoints.get(c.id);
      if (!known) {
        const list = await loyaltyPoints(c.id).catch(() => null);
        const names = list ? await universeNames(list.map((m) => m.corporation_id)).catch(() => new Map<number, string>()) : new Map<number, string>();
        known = { mine: list ?? [], corpNames: names };
        if (list) lpPoints.set(c.id, known);
      }
      mine = [...known.mine];
      corpNames = known.corpNames;
    }
    body.innerHTML = `${panel({
        title: tx('Magazin LP'),
        actions: basisChips(),
        body: `<div class="form-grid">
            ${mine.length ? `<label>${tx('LP-ul meu')} <select class="input sm" id="lpMine"><option value="">—</option>${mine.sort((a, b) => b.loyalty_points - a.loyalty_points).map((m) => `<option value="${m.corporation_id}" ${saved?.id === m.corporation_id ? 'selected' : ''}>${esc(corpNames.get(m.corporation_id) ?? String(m.corporation_id))} · ${formatInt(m.loyalty_points)} LP</option>`).join('')}</select></label>` : ''}
            <label>${tx('Corporație')} <input class="input sm" id="lpCorp" placeholder="Caldari Navy" value="${esc(saved?.name ?? '')}" title="${tx('Scrie numele corporației și apasă Enter')}" /></label>
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
      const store = loadJson<OfferStore>(LP_OFFERS_KEY, {});
      let entry = store[corp.id];
      if (!entry) {
        entry = { at: Date.now(), offers: await fetchLpOffers(corp.id) };
        const keep = Object.entries(store).sort((a, b) => b[1].at - a[1].at).slice(0, 4);
        saveJson(LP_OFFERS_KEY, Object.fromEntries([...keep, [String(corp.id), entry]]));
      }
      const offers = entry.offers;
      const ids = offers.flatMap((o) => [o.type_id, ...o.required_items.map((r) => r.type_id)]);
      const prices = await fetchPrices(ids);
      const at = Math.min(entry.at, pricesAt(ids) || entry.at);
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
        actions: dataStamp(at, `data-lp-refresh="${corp.id}"`, { label: tx('Date din {time}'), title: tx('Ofertele LP și prețurile Jita sunt păstrate până le reîmprospătezi. Click pentru a le citi din nou.') }),
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
          <label>${tx('Item')} <input class="input sm" id="alName" placeholder="PLEX" /></label>
          <label><select class="input sm" id="alSide2"><option value="sell">${tx('vânzare min')}</option><option value="buy">${tx('cumpărare max')}</option></select></label>
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
          </tbody></table>` : emptyState({ title: tx('Nicio alertă'), vy: 'No Alerts Woven' })}`,
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
    if (at('[data-ap-refresh]')) { forgetPrices(apIds); runAppraisal(); return; }
    if (at('[data-assets-refresh]')) { refreshAssets(); return; }
    const lpr = at('[data-lp-refresh]');
    if (lpr) {
      const store = loadJson<OfferStore>(LP_OFFERS_KEY, {});
      const entry = store[lpr.dataset.lpRefresh!];
      if (entry) forgetPrices(entry.offers.flatMap((o) => [o.type_id, ...o.required_items.map((r) => r.type_id)]));
      delete store[lpr.dataset.lpRefresh!];
      saveJson(LP_OFFERS_KEY, store);
      lpPoints.clear();
      lp();
      return;
    }
    if (at('[data-ap-clear]')) { saveJson(APPRAISAL_KEY, ''); appraisal(); return; }
    const ct = at('[data-copy-total]');
    if (ct) { copyText(ct.dataset.copyTotal!, tx('Total copiat')); return; }
    if (at('[data-ab-save]')) { saveRun(); return; }
    const del = at('[data-ab-del]');
    if (del) { saveRuns(loadRuns().filter((r) => r.id !== del.dataset.abDel)); abyssal(); return; }
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
    if (t.id === 'lpCorp' && (t as HTMLInputElement).value.trim()) lpLoad();
  });

  window.addEventListener(ALERTS_EVENT, () => { if (tab === 'alerts') alerts(); });
  ctx.onCharacterChange(() => { if (tab === 'wallet' || tab === 'assets' || tab === 'lp') render(); });

  render();
}
