import { loadSkins, licenseIndex } from '../services/skins';
import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, formatNum, compactISK, copyText, toast, emptyState, dataStamp } from '../ui/components';
import { icon } from '../ui/icons';
import { fold } from '../ui/fold';
import { loadJson, saveJson } from '../storage';
import { parseItems, type AppraisalLine } from '../services/appraisal';
import { fetchPrices, forgetPrices, pricesAt, fetchLpOffers, fetchHistory, fetchJitaSellBook, fetchJitaBuyBook, JITA_STATION, lastDays, resolveIds, typeIconUrl, type Aggregates, type LpOffer } from '../services/market';
import { loadAlerts, saveAlerts, addAlert, checkAlerts, hit, ALERTS_EVENT } from '../services/alerts';
import { TIERS, WEATHERS, loadRuns, saveRuns, filamentTypeId, profitOf, summarize, iskPerHour, type AbyssalRun } from '../services/abyssal';
import { loyaltyPoints, listAssets, universeNames, currentShip, characterLocation, dynamicItem, type EsiAsset } from '../character/esi';
import { removeKey } from '../storage';
import { hasScope, loginProblem } from '../character/sso';
import { permissionGate, type PermId } from '../character/permissions';
import { typeName, resolveTypeNames } from '../services/typeNames';
import { showItemInfo } from '../ui/itemInfo';
import { tx, locale } from '../i18n';

export type ToolTab = 'appraisal' | 'abyssal' | 'assets' | 'lp' | 'alerts';

const APPRAISAL_KEY = 'eve-tools:appraisal-text';
const BASIS_KEY = 'eve-tools:price-basis';
const LP_CORP_KEY = 'eve-tools:lp-corp';
const LAST_RUN_KEY = 'eve-tools:abyssal-last';
const ASSETS_KEY = 'eve-tools:assets:';
const LP_OFFERS_KEY = 'eve-tools:lp-offers';

interface AssetLine { typeId: number; qty: number; value: number; kind: number }
interface AssetSnapshot { v?: number; at: number; items: number; rows: [number, number, number, number?][]; names: [number, string][]; dyn?: [number, number, number][] }
const DYN_KEY = 'eve-tools:dynamic-items';
const ROW_PLAIN = 0, ROW_BPC = 1, ROW_MUTATED = 2;
type Book = [number, number][];
type OfferStore = Record<string, { at: number; offers: LpOffer[]; daily?: Record<string, [number, number]>; books?: Record<string, Book> }>;
type LpSort = 'real' | 'buy' | 'sell';
const LP_SORT_KEY = 'eve-tools:lp-sort';
const LP_HISTORY_MAX = 120;
const LP_COL_KEY = 'eve-tools:lp-col';
const LP_FILTER_KEY = 'eve-tools:lp-filter';
const LP_SHOW_MAX = 100;
const LP_FLOOR_KEY = 'eve-tools:lp-floor';
const LP_SUGGEST_MIN_SHARE = 0.03;
type LpCol = 'name' | 'lp' | 'cost' | 'sellP' | 'buyP' | 'profit' | 'spread' | 'demand' | 'daily' | 'real' | 'buy' | 'sell';
interface LpFilter { q: string; hideTraps: boolean; minDaily: number; minIskLp: number; afford: boolean }

interface LpRow {
  o: LpOffer;
  p: Aggregates | undefined;
  req: number;
  cost: number;
  sell: number;
  buy: number;
  real: number;
  spread: number;
  daily: number | null;
  bpc: boolean;
  short: { typeId: number; need: number; have: number }[];
  costFor: (n: number) => { cost: number; short: { typeId: number; need: number; have: number }[] };
}

interface LpCalc { n: number; lp: number; cost: number; sell: number; buy: number; real: number; short: LpRow['short'] }

function bookCost(book: Book | undefined, qty: number, fallback: number) {
  let left = qty;
  let cost = 0;
  let last = fallback;
  for (const [price, vol] of book ?? []) {
    if (left <= 0) break;
    const take = Math.min(left, vol);
    cost += take * price;
    left -= take;
    last = price;
  }
  return { cost: cost + left * last, have: qty - left };
}

function reqCum(book: Book | undefined, owned: number, units: number, fallback: number) {
  const fromOwn = Math.min(owned, units);
  const b = bookCost(book, units - fromOwn, fallback);
  return { cost: b.cost, have: fromOwn + b.have, own: fromOwn };
}

type OwnSource = 'none' | 'jita' | 'here';
const LP_OWN_KEY = 'eve-tools:lp-own';
const FITTED = /^(HiSlot|MedSlot|LoSlot|RigSlot|SubSystemSlot|Implant|Skill|Booster)/;


type Basis = 'sell' | 'buy';

const priceOf = (p: Aggregates | undefined, basis: Basis) => (p ? (basis === 'sell' ? p.sellMin : p.buyMax) : 0);
const isk = (v: number) => `<span class="num">${compactISK(v)}</span>`;
const dateTime = (ms: number) => new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export interface ToolPanel { show(next: ToolTab): void; hide(): void }

export function createToolPanel(body: HTMLElement, ctx: AppContext): ToolPanel {
  let tab: ToolTab | null = null;
  let basis = loadJson<Basis>(BASIS_KEY, 'sell');

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

  function scopePrompt(perm: PermId) {
    return panel({ body: permissionGate(perm, ctx.character.characterId!, ctx.character.name) });
  }

  function render() {
    if (tab) ({ appraisal, abyssal, assets, lp, alerts } as Record<ToolTab, () => void>)[tab]();
  }

  let apIds: number[] = [];
  let lpSort = loadJson<LpSort>(LP_SORT_KEY, 'real');
  let lpShown: { corp: { id: number; name: string }; points: number } | null = null;
  let lpCol = loadJson<{ key: LpCol; desc: boolean }>(LP_COL_KEY, { key: lpSort, desc: true });
  if ((lpCol.key as string) === 'mine') lpCol = { key: lpSort, desc: true };
  const lpQty = new Map<number, number>();
  let lpFilter: LpFilter = { q: '', hideTraps: false, minDaily: 0, minIskLp: 0, afford: false, ...loadJson<Partial<LpFilter>>(LP_FILTER_KEY, {}) };
  let lpData: { corp: { id: number; name: string }; points: number; rows: LpRow[]; pending: boolean; books: Record<string, Book>; prices: Map<number, Aggregates> } | null = null;
  let lpOwnSrc = loadJson<OwnSource>(LP_OWN_KEY, 'none');
  let lpFloor = loadJson<number>(LP_FLOOR_KEY, 80);
  let lpOwned: { key: string; at: number; label: string; counts: Map<number, number> } | null = null;
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
          ${t.rows.map((r) => `<tr><td><img class="row-icon" src="${typeIconUrl(r.typeId, 32, r.name)}" alt="" />${esc(r.name)}</td><td class="r num">${formatInt(r.quantity)}</td><td class="r">${isk(r.unit)}</td><td class="r">${isk(r.sell)}</td><td class="r">${isk(r.buy)}</td></tr>`).join('')}
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
        count: runs.length ? (runs.length === 1 ? tx('1 run') : tx('{n} run-uri', { n: runs.length })) : '',
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

  async function assetSnapshot(characterId: number): Promise<AssetSnapshot> {
    const cached = loadJson<AssetSnapshot | null>(ASSETS_KEY + characterId, null);
    if (cached?.rows && cached.v === 2) return cached;
    const list = await listAssets(characterId);
    const byId = new Map(list.map((a) => [a.item_id, a]));
    const root = (a: EsiAsset) => { let cur = a; for (let i = 0; i < 10 && byId.has(cur.location_id); i++) cur = byId.get(cur.location_id)!; return cur.location_id; };
    const agg = new Map<string, [number, number, number, number]>();
    const dyn: [number, number, number][] = [];
    for (const a of list) {
      const loc = root(a);
      const kind = a.is_blueprint_copy ? ROW_BPC : ctx.sde.isAbyssal(a.type_id) ? ROW_MUTATED : ROW_PLAIN;
      if (kind === ROW_MUTATED) dyn.push([loc, a.type_id, a.item_id]);
      const k = `${loc}:${a.type_id}:${kind}`;
      const row = agg.get(k) ?? [loc, a.type_id, 0, kind];
      row[2] += a.quantity;
      agg.set(k, row);
    }
    const rows = [...agg.values()];
    const names = await universeNames([...new Set(rows.map((r) => r[0]))], characterId).catch(() => new Map<number, string>());
    const snap: AssetSnapshot = { v: 2, at: Date.now(), items: list.length, rows, names: [...names], dyn };
    saveJson(ASSETS_KEY + characterId, snap);
    return snap;
  }

  let assetLines = new Map<number, AssetLine[]>();

  async function dynamicSources(items: [number, number, number][]): Promise<Map<number, [number, number]>> {
    const store = loadJson<Record<string, [number, number]>>(DYN_KEY, {});
    const todo = items.filter(([, , id]) => !store[id]).slice(0, 300);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const [, typeId, itemId] = todo[next++];
        try { const d = await dynamicItem(typeId, itemId); store[itemId] = [d.source_type_id, d.mutator_type_id]; } catch { }
      }
    };
    if (todo.length) {
      await Promise.all(Array.from({ length: 4 }, worker));
      const live = new Set(items.map(([, , id]) => String(id)));
      saveJson(DYN_KEY, Object.fromEntries(Object.entries(store).filter(([id]) => live.has(id))));
    }
    return new Map(items.filter(([, , id]) => store[id]).map(([, , id]) => [id, store[id]]));
  }

  const kindBadge = (kind: number) => kind === ROW_BPC
    ? ` <span class="badge warn" title="${esc(tx('Copie de blueprint. Nu are preț de piață, nu intră în total.'))}">BPC</span>`
    : kind === ROW_MUTATED ? ` <span class="badge" title="${esc(tx('Valoare estimată: itemul de bază plus mutaplasmidul. Itemele mutate nu au preț de piață.'))}">${tx('Mutat')}</span>` : '';
  const openLocs = new Set<number>();

  let skinShip: Map<number, number> | null = null;
  const assetIcon = (id: number) => { const ship = skinShip?.get(id); return ship ? typeIconUrl(ship, 32) : typeIconUrl(id, 32, typeName(id)); };
  const assetItemLink = (id: number) => `<button class="link asset-item" data-asset-info="${id}" title="${esc(tx('Deschide informațiile itemului'))}"><img class="row-icon" src="${assetIcon(id)}" alt="" loading="lazy" />${esc(typeName(id))}</button>`;

  function assetItemsRow(loc: number) {
    const lines = [...(assetLines.get(loc) ?? [])].sort((a, b) => b.value - a.value || typeName(a.typeId).localeCompare(typeName(b.typeId)));
    return `<tr class="asset-items" data-asset-items="${loc}"><td colspan="2"><table class="table compact"><tbody>${lines.map((l) => `<tr><td>${assetItemLink(l.typeId)}${kindBadge(l.kind)}</td><td class="r num">${formatInt(l.qty)}</td><td class="r">${l.value ? isk(l.value) : '<span class="dim">—</span>'}</td></tr>`).join('')}</tbody></table></td></tr>`;
  }

  function toggleLocation(row: HTMLElement) {
    const loc = Number(row.dataset.assetLoc);
    const open = !openLocs.has(loc);
    if (open) { openLocs.add(loc); row.insertAdjacentHTML('afterend', assetItemsRow(loc)); }
    else { openLocs.delete(loc); row.nextElementSibling?.matches('[data-asset-items]') && row.nextElementSibling.remove(); }
    row.setAttribute('aria-expanded', String(open));
  }

  async function assets() {
    const c = esiCharacter('esi-assets.read_assets.v1');
    if (c === 'scope') { body.innerHTML = scopePrompt('assets'); return; }
    if (typeof c === 'string') { body.innerHTML = panel({ body: alertBox(c) }); return; }
    body.innerHTML = panel({ body: loader(tx('Citesc asset-urile și prețurile')) });
    try {
      const snap = await assetSnapshot(c.id);
      const dyn = await dynamicSources(snap.dyn ?? []);
      const dynTypes = [...dyn.values()].flat();
      const typeIds = [...new Set([...snap.rows.map((r) => r[1]), ...dynTypes])];
      const names = new Map(snap.names);
      const unnamed = [...new Set(snap.rows.map((r) => r[0]))].filter((id) => !names.has(id) && id !== ASSET_SAFETY);
      const [prices, found] = await Promise.all([
        fetchPrices(typeIds),
        unnamed.length ? universeNames(unnamed, c.id).catch(() => new Map<number, string>()) : Promise.resolve(new Map<number, string>()),
        resolveTypeNames(typeIds),
      ]);
      if (!skinShip && typeIds.some((id) => / SKIN$/.test(typeName(id)))) {
        skinShip = await loadSkins().then((l) => new Map([...licenseIndex(l)].map(([lic, key]) => [lic, Number(key.slice(key.lastIndexOf('|') + 1))]))).catch(() => new Map<number, number>());
      }
      if (found.size) {
        for (const [id, n] of found) names.set(id, n);
        saveJson(ASSETS_KEY + c.id, { ...snap, names: [...names] });
      }
      const locs = new Map<number, number>();
      const types = new Map<number, { qty: number; value: number; kind: number }>();
      const byLoc = new Map<number, AssetLine[]>();
      const dynValue = new Map<string, number>();
      for (const [loc, typeId, itemId] of snap.dyn ?? []) {
        const src = dyn.get(itemId);
        if (!src) continue;
        const k = `${loc}:${typeId}`;
        dynValue.set(k, (dynValue.get(k) ?? 0) + priceOf(prices.get(src[0]), basis) + priceOf(prices.get(src[1]), basis));
      }
      for (const [loc, typeId, qty, kind = ROW_PLAIN] of snap.rows) {
        const value = kind === ROW_BPC ? 0 : kind === ROW_MUTATED ? dynValue.get(`${loc}:${typeId}`) ?? 0 : priceOf(prices.get(typeId), basis) * qty;
        locs.set(loc, (locs.get(loc) ?? 0) + value);
        if (kind === ROW_BPC) { const list = byLoc.get(loc) ?? []; list.push({ typeId, qty, value, kind }); byLoc.set(loc, list); continue; }
        const t = types.get(typeId) ?? { qty: 0, value: 0, kind };
        t.qty += qty; t.value += value;
        types.set(typeId, t);
        const list = byLoc.get(loc) ?? [];
        list.push({ typeId, qty, value, kind });
        byLoc.set(loc, list);
      }
      assetLines = byLoc;
      if (tab !== 'assets') return;
      const total = [...locs.values()].reduce((a, v) => a + v, 0);
      const at = Math.min(snap.at, pricesAt(typeIds) || snap.at);
      const locName = (id: number) => names.get(id) ?? (id === ASSET_SAFETY ? 'Asset Safety' : id > 1e12 ? tx('Structură {id}', { id }) : tx('Locație {id}', { id }));
      const locTitle = (id: number) => (!names.has(id) && id > 1e12 ? ` title="${esc(tx('Niciun caracter logat nu are acces la structură, așa că ESI nu îi dă numele.'))}"` : '');
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
          ${panel({ title: tx('Pe locație'), body: `<table class="table compact asset-locs"><tbody>${[...locs.entries()].sort((a, b) => b[1] - a[1]).map(([id, v]) => `<tr class="asset-loc" data-asset-loc="${id}" aria-expanded="${openLocs.has(id)}"${locTitle(id)}><td><span class="asset-caret"></span>${esc(locName(id))} <span class="dim small">${formatInt(byLoc.get(id)!.length)}</span></td><td class="r">${isk(v)}</td></tr>${openLocs.has(id) ? assetItemsRow(id) : ''}`).join('')}</tbody></table>` })}
          ${panel({ title: tx('Cele mai valoroase'), body: `<table class="table compact"><tbody>${[...types.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 40).map(([id, t]) => `<tr><td>${assetItemLink(id)}${kindBadge(t.kind)}</td><td class="r num">${formatInt(t.qty)}</td><td class="r">${isk(t.value)}</td></tr>`).join('')}</tbody></table>` })}
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
      const list = await loyaltyPoints(c.id).catch(() => null);
      if (list) {
        const missing = list.map((m) => m.corporation_id).filter((id) => !known?.corpNames.has(id));
        const names = missing.length ? await universeNames(missing).catch(() => new Map<number, string>()) : new Map<number, string>();
        known = { mine: list, corpNames: new Map([...(known?.corpNames ?? []), ...names]) };
        lpPoints.set(c.id, known);
      }
      known ??= { mine: [], corpNames: new Map<number, string>() };
      mine = [...known.mine];
      corpNames = known.corpNames;
    }
    body.innerHTML = `${panel({
        title: tx('Magazin LP'),
        body: `<div class="form-grid">
            ${mine.length ? `<label>${tx('LP-ul meu')} <select class="input sm" id="lpMine"><option value="">—</option>${mine.sort((a, b) => b.loyalty_points - a.loyalty_points).map((m) => `<option value="${m.corporation_id}" ${saved?.id === m.corporation_id ? 'selected' : ''}>${esc(corpNames.get(m.corporation_id) ?? String(m.corporation_id))} · ${formatInt(m.loyalty_points)} LP</option>`).join('')}</select></label>` : ''}
            <label>${tx('Corporație')} <input class="input sm" id="lpCorp" placeholder="Caldari Navy" value="${esc(saved?.name ?? '')}" title="${tx('Scrie numele corporației și apasă Enter')}" /></label>
            <label title="${tx('Itemele cerute pe care le ai deja nu mai costă nimic. Se numără doar din hangarul și cargo-ul din locul ales, nu din toate stațiile.')}">${tx('Iteme cerute din hangar')} <select class="input sm" id="lpOwn">
              <option value="none" ${lpOwnSrc === 'none' ? 'selected' : ''}>${tx('Nu, le cumpăr pe toate')}</option>
              <option value="jita" ${lpOwnSrc === 'jita' ? 'selected' : ''}>${tx('Jita 4-4 (hangar și cargo)')}</option>
              <option value="here" ${lpOwnSrc === 'here' ? 'selected' : ''}>${tx('Unde sunt acum (stație și cargo)')}</option>
            </select></label>
            <label title="${tx('Suggest se oprește când următoarea ofertă ar aduce sub acest procent din cel mai bun ISK/LP. LP-ul rămas îl folosești altă dată, când piața arată mai bine.')}">${tx('Prag calitate %')} <input class="input sm num lp-floor" id="lpFloor" type="number" min="10" max="100" step="5" value="${lpFloor}" /></label>
            <button class="btn sm lp-suggest-btn" data-lp-suggest title="${tx('Împarte LP-ul tău între oferte pentru cel mai mare câștig la vânzare instant, după buy orders și itemele cerute disponibile în Jita.')}">${icon('refresh')}${tx('Suggest')}</button>
          </div>
          ${c === 'scope' ? permissionGate('loyalty', ctx.character.characterId!, ctx.character.name) : ''}`,
      })}
      <div id="lpSuggest"></div>
      <div id="lpResult"></div>`;
    if (saved) lpLoadOwned().finally(() => loadOffers(saved, mine.find((m) => m.corporation_id === saved.id)?.loyalty_points ?? 0));
  }

  const lpPerLp = (r: LpRow, mode: LpSort) => (r[mode] - r.cost) / r.o.lp_cost;

  const lpSortChips = () => `<div class="advice-sort">
    <button class="chip-btn ${lpSort === 'real' ? 'active' : ''}" data-lp-sort="real" title="${tx('Prețul mediu la care s-a vândut efectiv în Jita în ultimele 30 de zile, cel mult prețul de sell. Fără vânzări, valoarea din buy orders.')}">${tx('Realist')}</button>
    <button class="chip-btn ${lpSort === 'buy' ? 'active' : ''}" data-lp-sort="buy" title="${tx('Vinzi acum în cel mai bun buy order din Jita.')}">${tx('Vânzare instant')}</button>
    <button class="chip-btn ${lpSort === 'sell' ? 'active' : ''}" data-lp-sort="sell" title="${tx('Listezi la cel mai mic sell din Jita și aștepți un cumpărător.')}">${tx('Sell order')}</button>
  </div>`;

  const lpIsTrap = (r: LpRow) => (r.p?.buyMax ? r.spread >= 0.5 : r.sell > 0);

  function lpCalc(r: LpRow): LpCalc {
    const n = lpQty.get(r.o.offer_id) ?? 1;
    const c = n === 1 ? { cost: r.cost, short: r.short } : r.costFor(n);
    return { n, lp: r.o.lp_cost * n, cost: c.cost, sell: r.sell * n, buy: r.buy * n, real: r.real * n, short: c.short };
  }

  const calcPerLp = (c: LpCalc, mode: LpSort) => (c[mode] - c.cost) / c.lp;

  function lpColValue(r: LpRow, key: LpCol): number | string {
    const c = lpCalc(r);
    switch (key) {
      case 'name': return typeName(r.o.type_id).toLowerCase();
      case 'lp': return c.lp;
      case 'cost': return c.cost;
      case 'sellP': return c.sell;
      case 'buyP': return c.buy;
      case 'profit': return c[lpSort] - c.cost;
      case 'spread': return r.p?.sellMin && r.p?.buyMax ? r.spread : 2;
      case 'demand': return r.p?.buyVolume ?? 0;
      case 'daily': return r.daily ?? -1;
      default: return calcPerLp(c, key);
    }
  }

  function lpTh(key: LpCol, label: string, title = '', left = false) {
    const mark = lpCol.key === key ? (lpCol.desc ? ' ▾' : ' ▴') : '';
    return `<th class="${left ? '' : 'r '}sortable ${lpCol.key === key ? 'lp-sorted' : ''}" data-lp-col="${key}" ${title ? `title="${esc(title)}"` : ''}>${label}${mark}</th>`;
  }

  function lpVisible() {
    if (!lpData) return [];
    const { rows, points } = lpData;
    const words = fold(lpFilter.q.trim()).split(/\s+/).filter(Boolean);
    const list = rows.filter((r) => (!words.length || ((n) => words.every((w) => n.includes(w)))(fold(typeName(r.o.type_id))))
      && (!lpFilter.hideTraps || (!lpIsTrap(r) && !r.bpc && !r.short.length))
      && (!lpFilter.minDaily || (r.daily ?? 0) >= lpFilter.minDaily)
      && (!lpFilter.minIskLp || calcPerLp(lpCalc(r), lpSort) >= lpFilter.minIskLp)
      && (!lpFilter.afford || !points || points >= r.o.lp_cost));
    const dir = lpCol.desc ? -1 : 1;
    return list.sort((a, b) => {
      const x = lpColValue(a, lpCol.key);
      const y = lpColValue(b, lpCol.key);
      return (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)) * dir;
    });
  }

  function lpCells(r: LpRow) {
    if (!lpData) return '';
    const { points, pending } = lpData;
    const c = lpCalc(r);
    const profit = c[lpSort] - c.cost;
    const perLpCell = (mode: LpSort) => {
      const v = calcPerLp(c, mode);
      return `<td class="r num ${v >= 0 ? 'up' : 'down'} ${mode === lpSort ? 'lp-key' : 'dim'}">${formatInt(v)}</td>`;
    };
    const units = c.n * r.o.quantity;
    return `<td><img class="row-icon" src="${typeIconUrl(r.o.type_id, 32)}" alt="" />${units > 1 ? `${formatInt(units)}× ` : ''}${esc(typeName(r.o.type_id))}${lpFlags(r, c, points)}</td>
        <td class="r num">${formatInt(c.lp)}</td>
        <td class="r" title="${esc([`ISK ${compactISK(r.o.isk_cost * c.n)}`, ...r.o.required_items.map((x) => { const own = Math.min(lpOwned && lpOwnSrc !== 'none' ? lpOwned.counts.get(x.type_id) ?? 0 : 0, x.quantity * c.n); return `${formatInt(x.quantity * c.n)}× ${typeName(x.type_id)}${own ? ` (${tx('{n} din hangar', { n: formatInt(own) })})` : ''}`; })].join(', '))}">${isk(c.cost)}</td>
        <td class="r">${c.sell ? isk(c.sell) : '—'}</td>
        <td class="r">${c.buy ? isk(c.buy) : '—'}</td>
        <td class="r num ${profit >= 0 ? 'up' : 'down'} lp-key">${compactISK(profit)}</td>
        <td class="r num ${r.spread >= 0.5 ? 'down' : r.spread >= 0.2 ? 'warn-text' : 'dim'}">${r.p?.sellMin && r.p?.buyMax ? `${Math.round(r.spread * 100)}%` : '—'}</td>
        <td class="r num dim">${r.p?.buyMax ? `${formatInt(r.p.buyVolume)} <span class="small">· ${formatInt(r.p.buyOrders)}</span>` : '0'}</td>
        <td class="r num dim">${r.daily == null ? (pending && !r.bpc ? '…' : '—') : r.daily >= 10 ? formatInt(r.daily) : formatNum(r.daily, 1)}</td>
        ${perLpCell('real')}${perLpCell('buy')}${perLpCell('sell')}`;
  }

  function lpRowHtml(r: LpRow) {
    const n = lpQty.get(r.o.offer_id);
    return `<tr class="${lpIsTrap(r) ? 'lp-trap' : ''}" data-lp-row="${r.o.offer_id}"><td class="lp-qty"><input class="input sm num" type="number" min="1" step="1" data-lp-qty="${r.o.offer_id}" value="${n ?? ''}" placeholder="1" title="${esc(tx('Câte schimburi vrei să faci. Toate cifrele din rând se recalculează pentru numărul ăsta.'))}" /></td>${lpCells(r)}</tr>`;
  }

  function lpQtyInput(input: HTMLInputElement) {
    const id = Number(input.dataset.lpQty);
    const v = Math.floor(Number(input.value));
    if (v > 1) lpQty.set(id, v); else lpQty.delete(id);
    const r = lpData?.rows.find((x) => x.o.offer_id === id);
    const tr = input.closest('tr');
    if (!r || !tr) return;
    tr.querySelectorAll('td:not(.lp-qty)').forEach((td) => td.remove());
    tr.insertAdjacentHTML('beforeend', lpCells(r));
    tr.classList.toggle('lp-trap', lpIsTrap(r));
  }

  function renderLpTable() {
    const box = body.querySelector<HTMLElement>('#lpTable');
    if (!box || !lpData) return;
    const { pending } = lpData;
    const list = lpVisible();
    const shown = list.slice(0, LP_SHOW_MAX);
    const mode = { real: tx('realist'), buy: tx('instant'), sell: tx('sell order') }[lpSort];
    box.innerHTML = `<p class="dim small lp-note">${list.length > shown.length ? tx('Arăt primele {n} din {m} oferte filtrate.', { n: shown.length, m: list.length }) : tx('{n} oferte după filtre.', { n: list.length })}${pending ? ` <span class="warn-text">${tx('Citesc volumele zilnice…')}</span>` : ''}</p>
      ${shown.length ? `<table class="table compact lp-table"><thead><tr><th class="lp-qty" title="${esc(tx('Câte schimburi vrei să faci. Toate cifrele din rând se recalculează pentru numărul ăsta.'))}">${tx('Cant.')}</th>${lpTh('name', 'Item', '', true)}${lpTh('lp', 'LP')}${lpTh('cost', tx('Cost ISK'))}${lpTh('sellP', tx('Sell Jita'))}${lpTh('buyP', tx('Buy Jita'))}${lpTh('profit', tx('Câștig'), tx('Câștigul pe valoarea aleasă ({mode}), după costul în ISK și itemele cerute.', { mode }))}${lpTh('spread', tx('Spread'))}${lpTh('demand', tx('Cerere buy'), tx('Cantitatea totală cerută de buy orders în Jita și numărul de ordere.'))}${lpTh('daily', tx('Vândute/zi'), tx('Bucăți vândute pe zi în The Forge, media pe 30 de zile.'))}${lpTh('real', tx('ISK/LP realist'))}${lpTh('buy', tx('ISK/LP instant'))}${lpTh('sell', tx('ISK/LP sell'))}</tr></thead><tbody>
      ${shown.map(lpRowHtml).join('')}
      </tbody></table>` : emptyState({ title: tx('Nicio ofertă nu trece de filtre'), vy: 'No Offers Woven' })}`;
    body.querySelectorAll<HTMLElement>('[data-lp-sort]').forEach((el) => el.classList.toggle('active', el.dataset.lpSort === lpSort));
  }

  const lpFilterBar = (points: number) => `<div class="form-grid lp-filters">
      <label class="lp-search">${tx('Caută')} <span class="lp-search-box"><input class="input sm" data-lp-f="q" data-list="lpNames" value="${esc(lpFilter.q)}" placeholder="${tx('Nume item, unul sau mai multe cuvinte')}" autocomplete="off" spellcheck="false" />${lpFilter.q ? `<button class="icon-btn" data-lp-clear title="${tx('Golește căutarea')}">✕</button>` : ''}</span></label>
      <datalist id="lpNames">${[...new Map((lpData?.rows ?? []).map((r) => [r.o.type_id, r])).values()].sort((a, b) => typeName(a.o.type_id).localeCompare(typeName(b.o.type_id))).map((r) => `<option value="${esc(typeName(r.o.type_id))}">${formatInt(r.o.lp_cost)} LP</option>`).join('')}</datalist>
      <label title="${tx('Se aplică pe valoarea aleasă: realist, instant sau sell order.')}">${tx('ISK/LP minim')} <input class="input sm num" type="number" min="0" step="100" data-lp-f="minIskLp" value="${lpFilter.minIskLp || ''}" placeholder="0" /></label>
      <label>${tx('Vândute/zi minim')} <input class="input sm num" type="number" min="0" step="1" data-lp-f="minDaily" value="${lpFilter.minDaily || ''}" placeholder="0" /></label>
      <label class="check"><input type="checkbox" data-lp-f="hideTraps" ${lpFilter.hideTraps ? 'checked' : ''} /> ${tx('Ascunde capcanele și BPC-urile')}</label>
      ${points ? `<label class="check"><input type="checkbox" data-lp-f="afford" ${lpFilter.afford ? 'checked' : ''} /> ${tx('Doar ce îmi permit cu LP-ul meu')}</label>` : ''}
    </div>`;

  function lpFlags(r: LpRow, c: LpCalc, points: number) {
    const out: string[] = [];
    const pct = Math.round(r.spread * 100);
    if (r.bpc) out.push(`<span class="badge warn" title="${tx('Magazinul dă copii (BPC), piața arată prețul originalului (BPO). Valoarea nu e reală.')}">BPC</span>`);
    if (!r.p?.buyMax) out.push(`<span class="badge danger" title="${tx('Nimeni nu cumpără acest item în Jita acum.')}">${tx('Fără buy orders')}</span>`);
    else if (r.spread >= 0.5) out.push(`<span class="badge danger" title="${tx('Sell {sell}, cel mai bun buy {buy}. Prețul de sell nu e ce primești.', { sell: compactISK(r.p.sellMin), buy: compactISK(r.p.buyMax) })}">${tx('Capcană · spread {n}%', { n: pct })}</span>`);
    else if (r.spread >= 0.2) out.push(`<span class="badge warn" title="${tx('Diferență mare între sell și buy.')}">${tx('Spread {n}%', { n: pct })}</span>`);
    if (r.daily != null && r.daily < 1) out.push(`<span class="badge warn" title="${tx('Sub o bucată vândută pe zi, în medie, în ultimele 30 de zile.')}">${tx('Se vinde rar')}</span>`);
    for (const x of c.short) out.push(`<span class="badge danger" title="${esc(tx('În Jita sunt de vânzare doar {have} × {item}, oferta cere {need}. Costul e estimat.', { have: formatInt(x.have), item: typeName(x.typeId), need: formatInt(x.need) }))}">${tx('Iteme cerute lipsă')}</span>`);
    if (points && c.lp > points) out.push(`<span class="badge warn" title="${esc(tx('Ai {have} LP, trebuie {need}.', { have: formatInt(points), need: formatInt(c.lp) }))}">${tx('LP insuficient')}</span>`);
    const units = c.n * r.o.quantity;
    if (r.p?.buyMax && units > r.p.buyVolume) out.push(`<span class="badge warn" title="${tx('Vrei să vinzi {n} buc., buy orders din Jita cer doar {m}.', { n: formatInt(units), m: formatInt(r.p.buyVolume) })}">${tx('Buy orders insuficiente')}</span>`);
    return out.length ? `<span class="lp-flags">${out.join('')}</span>` : '';
  }

  function lpRows(offers: LpOffer[], prices: Map<number, Aggregates>, daily: Record<string, [number, number]>, books: Record<string, Book>, owned: Map<number, number>): LpRow[] {
    return offers.filter((o) => o.lp_cost > 0).map((o) => {
      const p = prices.get(o.type_id);
      const fall = (id: number) => priceOf(prices.get(id), 'sell');
      const one = o.required_items.map((r) => ({ r, ...reqCum(books[r.type_id], owned.get(r.type_id) ?? 0, r.quantity, fall(r.type_id)) }));
      const req = one.reduce((a, x) => a + x.cost, 0);
      const short = one.filter((x) => x.have < x.r.quantity).map((x) => ({ typeId: x.r.type_id, need: x.r.quantity, have: x.have }));
      const costFor = (n: number) => {
        const parts = o.required_items.map((r) => ({ r, ...reqCum(books[r.type_id], owned.get(r.type_id) ?? 0, r.quantity * n, fall(r.type_id)) }));
        return { cost: o.isk_cost * n + parts.reduce((a, x) => a + x.cost, 0), short: parts.filter((x) => x.have < x.r.quantity * n).map((x) => ({ typeId: x.r.type_id, need: x.r.quantity * n, have: x.have })) };
      };
      const sellU = p?.sellMin ?? 0;
      const buyU = p?.buyMax ?? 0;
      const h = daily[o.type_id];
      const realU = h && h[0] >= 1 && h[1] > 0 ? Math.max(buyU, sellU ? Math.min(sellU, h[1]) : h[1]) : buyU;
      return {
        o, p, req,
        cost: o.isk_cost + req,
        sell: sellU * o.quantity,
        buy: buyU * o.quantity,
        real: realU * o.quantity,
        spread: sellU > 0 ? (buyU > 0 ? Math.max(0, (sellU - buyU) / sellU) : 1) : 0,
        daily: h ? h[0] : null,
        bpc: / Blueprint$/.test(typeName(o.type_id)),
        short, costFor,
      };
    }).filter((r) => r.sell > 0 || r.buy > 0);
  }

  const lpFetching = new Set<number>();

  async function lpDaily(corpId: number, rows: LpRow[]) {
    const daily: Record<string, [number, number]> = {};
    const best = (r: LpRow) => Math.max(lpPerLp(r, 'sell'), lpPerLp(r, 'buy'));
    const want = [...new Set([...rows].filter((r) => !r.bpc).sort((a, b) => best(b) - best(a)).map((r) => r.o.type_id))].slice(0, LP_HISTORY_MAX);
    let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < want.length) {
        const id = want[i++];
        const days = lastDays(await fetchHistory(id).catch(() => []), 30);
        const vol = days.reduce((a, d) => a + d.volume, 0);
        daily[id] = [vol / 30, vol ? days.reduce((a, d) => a + d.average * d.volume, 0) / vol : 0];
      }
    }));
    const store = loadJson<OfferStore>(LP_OFFERS_KEY, {});
    if (!store[corpId]) return;
    store[corpId].daily = daily;
    saveJson(LP_OFFERS_KEY, store);
  }

  async function loadOffers(corp: { id: number; name: string }, points: number, quiet = false) {
    const out = body.querySelector<HTMLElement>('#lpResult');
    if (!out) return;
    lpShown = { corp, points };
    if (!quiet) out.innerHTML = panel({ body: loader(tx('Oferte {name}', { name: corp.name })) });
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
      const books = entry.books ?? {};
      const reqIds = [...new Set(offers.flatMap((o) => o.required_items.map((r) => r.type_id)))].filter((id) => !books[id]);
      if (reqIds.length) {
        let i = 0;
        await Promise.all(Array.from({ length: 6 }, async () => {
          while (i < reqIds.length) {
            const id = reqIds[i++];
            books[id] = await fetchJitaSellBook(id).catch(() => []);
          }
        }));
        const fresh = loadJson<OfferStore>(LP_OFFERS_KEY, {});
        if (fresh[corp.id]) { fresh[corp.id].books = books; saveJson(LP_OFFERS_KEY, fresh); }
      }
      const owned = lpOwnSrc !== 'none' && lpOwned?.key === `${ctx.character.characterId}:${lpOwnSrc}` ? lpOwned.counts : new Map<number, number>();
      const all = lpRows(offers, prices, entry.daily ?? {}, books, owned);
      const pending = !entry.daily;
      if (tab !== 'lp' || lpShown?.corp.id !== corp.id) return;
      if (lpData?.corp.id !== corp.id) lpQty.clear();
      lpData = { corp, points, rows: all, pending, books, prices };
      out.innerHTML = panel({
        title: corp.name,
        count: tx('{n} oferte cu preț', { n: all.length }),
        actions: lpSortChips() + dataStamp(at, `data-lp-refresh="${corp.id}"`, { label: tx('Date din {time}'), title: tx('Ofertele LP și prețurile Jita sunt păstrate până le reîmprospătezi. Click pentru a le citi din nou.') }),
        body: `${lpFilterBar(points)}<div id="lpTable"></div>`,
      });
      renderLpTable();
      if (pending && !lpFetching.has(corp.id)) {
        lpFetching.add(corp.id);
        await lpDaily(corp.id, all).finally(() => lpFetching.delete(corp.id));
        if (tab === 'lp' && lpShown?.corp.id === corp.id) loadOffers(corp, points, true);
      }
    } catch (err) {
      out.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  async function lpLoadOwned(): Promise<boolean> {
    if (lpOwnSrc === 'none') { lpOwned = null; return true; }
    const c = esiCharacter('esi-assets.read_assets.v1');
    if (c === 'scope') { toast(tx('Ai nevoie de permisiunea „Bunuri și nave” ca să număr itemele din hangar.')); return false; }
    if (typeof c === 'string') { toast(c || tx('Loghează un caracter')); return false; }
    const key = `${c.id}:${lpOwnSrc}`;
    if (lpOwned?.key === key) return true;
    try {
      const roots = new Set<number>();
      let label = 'Jita 4-4';
      if (lpOwnSrc === 'jita') roots.add(JITA_STATION);
      else {
        if (!hasScope(c.id, 'esi-location.read_location.v1')) { toast(tx('Ai nevoie de permisiunea „Locație și status” ca să știu unde ești.')); return false; }
        const loc = await characterLocation(c.id);
        const dock = loc.station_id ?? loc.structure_id;
        if (dock) { roots.add(dock); label = (await universeNames([dock], c.id).catch(() => new Map<number, string>())).get(dock) ?? String(dock); }
        else label = tx('nava ta');
        const ship = await currentShip(c.id).catch(() => null);
        if (ship) roots.add(ship.ship_item_id);
      }
      const items = await listAssets(c.id);
      const inside = new Set(items.filter((a) => roots.has(a.location_id)).map((a) => a.item_id));
      const counts = new Map<number, number>();
      for (const a of items) {
        if (FITTED.test(a.location_flag)) continue;
        if (roots.has(a.location_id) || inside.has(a.location_id)) counts.set(a.type_id, (counts.get(a.type_id) ?? 0) + a.quantity);
      }
      lpOwned = { key, at: Date.now(), label, counts };
      const need = new Set((lpData?.rows ?? []).flatMap((r) => r.o.required_items.map((q) => q.type_id)));
      const found = [...need].filter((id) => counts.get(id));
      toast(found.length ? tx('Am găsit {n} tipuri de iteme cerute în {loc}.', { n: found.length, loc: label }) : tx('Nu am găsit iteme cerute în {loc}.', { loc: label }));
      return true;
    } catch (err) {
      toast((err as Error).message);
      return false;
    }
  }

  function bookRevenue(book: Book, units: number) {
    let left = units;
    let sum = 0;
    for (const [price, vol] of book) {
      if (left <= 0) break;
      const take = Math.min(left, vol);
      sum += take * price;
      left -= take;
    }
    return sum;
  }

  async function lpSuggest() {
    const out = body.querySelector<HTMLElement>('#lpSuggest');
    if (!out) return;
    if (!lpData) { toast(tx('Încarcă mai întâi ofertele unei corporații')); return; }
    const { points, rows, corp } = lpData;
    if (!points) { toast(tx('Alege corporația din „LP-ul meu” ca să știu câte LP ai')); return; }
    out.innerHTML = panel({ body: loader(tx('Caut cea mai bună combinație…')) });
    try {
      const pool = rows.filter((r) => !r.bpc && r.buy > 0 && !r.short.length && r.o.lp_cost <= points && r.buy > r.cost)
        .sort((a, b) => (b.buy - b.cost) / b.o.lp_cost - (a.buy - a.cost) / a.o.lp_cost).slice(0, 40);
      const books = new Map<number, Book>();
      let i = 0;
      const ids = [...new Set(pool.map((r) => r.o.type_id))];
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (i < ids.length) {
          const id = ids[i++];
          books.set(id, await fetchJitaBuyBook(id).catch(() => []));
        }
      }));
      const state = pool.map((r) => ({ r, n: 0, rev: 0, cost: 0 }));
      const ownedNow = lpOwnSrc !== 'none' && lpOwned?.key === `${ctx.character.characterId}:${lpOwnSrc}` ? lpOwned.counts : new Map<number, number>();
      const fall = (id: number) => priceOf(lpData!.prices.get(id), 'sell');
      const consumed = new Map<number, number>();
      const sold = new Map<number, number>();
      const reqBooks = lpData.books;
      const next = (s: typeof state[number]) => {
        const book = books.get(s.r.o.type_id) ?? [];
        const done = sold.get(s.r.o.type_id) ?? 0;
        const rev = bookRevenue(book, done + s.r.o.quantity) - bookRevenue(book, done);
        let cost = s.r.o.isk_cost;
        let ok = true;
        for (const q of s.r.o.required_items) {
          const own = ownedNow.get(q.type_id) ?? 0;
          const used = consumed.get(q.type_id) ?? 0;
          const after = reqCum(reqBooks[q.type_id], own, used + q.quantity, fall(q.type_id));
          if (after.have < used + q.quantity) ok = false;
          cost += after.cost - reqCum(reqBooks[q.type_id], own, used, fall(q.type_id)).cost;
        }
        return { rev, cost, ok, gain: rev - cost };
      };
      const take = (s: typeof state[number], m: ReturnType<typeof next>) => {
        s.n++;
        s.rev += m.rev;
        s.cost += m.cost;
        sold.set(s.r.o.type_id, (sold.get(s.r.o.type_id) ?? 0) + s.r.o.quantity);
        for (const q of s.r.o.required_items) consumed.set(q.type_id, (consumed.get(q.type_id) ?? 0) + q.quantity);
      };
      let left = points;
      let top = 0;
      let stop: { name: string; per: number } | null = null;
      for (let guard = 0; guard < 5000; guard++) {
        let best: { s: typeof state[number]; m: ReturnType<typeof next>; per: number } | null = null;
        for (const s of state) {
          if (s.r.o.lp_cost > left) continue;
          const m = next(s);
          if (!m.ok || m.gain <= 0) continue;
          const per = m.gain / s.r.o.lp_cost;
          if (!best || per > best.per) best = { s, m, per };
        }
        if (!best) break;
        top = Math.max(top, best.per);
        if (best.per < top * (lpFloor / 100)) { stop = { name: typeName(best.s.r.o.type_id), per: best.per }; break; }
        take(best.s, best.m);
        left -= best.s.r.o.lp_cost;
      }
      const gainAll = state.reduce((a, s) => a + s.rev - s.cost, 0);
      for (const s of state) if (s.n > 0 && s.rev - s.cost < gainAll * LP_SUGGEST_MIN_SHARE) s.n = 0;
      const picks = state.filter((s) => s.n > 0).sort((a, b) => (b.rev - b.cost) - (a.rev - a.cost));
      if (lpData?.corp.id !== corp.id) return;
      const tot = picks.reduce((a, s) => ({ lp: a.lp + s.n * s.r.o.lp_cost, cost: a.cost + s.cost, rev: a.rev + s.rev }), { lp: 0, cost: 0, rev: 0 });
      out.innerHTML = panel({
        title: tx('Sugestie · vânzare instant'),
        count: tx('{lp} din {all} LP', { lp: formatInt(tot.lp), all: formatInt(points) }),
        actions: picks.length ? `<button class="btn ghost sm" data-lp-apply>${tx('Pune cantitățile în tabel')}</button><button class="icon-btn" data-lp-suggest-close title="${tx('Închide')}">✕</button>` : `<button class="icon-btn" data-lp-suggest-close title="${tx('Închide')}">✕</button>`,
        body: picks.length ? `<table class="table compact lp-table"><thead><tr><th>Item</th><th class="r">${tx('Schimburi')}</th><th class="r">LP</th><th class="r">${tx('Cost ISK')}</th><th class="r">${tx('Încasat instant')}</th><th class="r">${tx('Câștig')}</th><th class="r">ISK/LP</th></tr></thead><tbody>
            ${picks.map((s) => `<tr data-lp-pick="${s.r.o.offer_id}" data-n="${s.n}"><td><img class="row-icon" src="${typeIconUrl(s.r.o.type_id, 32)}" alt="" />${esc(typeName(s.r.o.type_id))}</td><td class="r num">${formatInt(s.n)}</td><td class="r num">${formatInt(s.n * s.r.o.lp_cost)}</td><td class="r">${isk(s.cost)}</td><td class="r">${isk(s.rev)}</td><td class="r num up">${compactISK(s.rev - s.cost)}</td><td class="r num lp-key">${formatInt((s.rev - s.cost) / (s.n * s.r.o.lp_cost))}</td></tr>`).join('')}
            <tr class="lp-total"><td>${tx('Total')}</td><td></td><td class="r num">${formatInt(tot.lp)}</td><td class="r">${isk(tot.cost)}</td><td class="r">${isk(tot.rev)}</td><td class="r num up">${compactISK(tot.rev - tot.cost)}</td><td class="r num lp-key">${formatInt(tot.lp ? (tot.rev - tot.cost) / tot.lp : 0)}</td></tr>
          </tbody></table>
          <p class="dim small lp-note">${tx('Prețurile vin din buy orders-urile din Jita, ordin cu ordin, iar itemele cerute din sell orders, la fel. Nu includ taxa de vânzare. Îți trebuie {isk} ISK pentru cumpărături.', { isk: compactISK(tot.cost) })} ${points - tot.lp > 0 ? tx('Rămân {lp} LP.', { lp: formatInt(points - tot.lp) }) : ''}${stop ? ` ${tx('Următorul schimb ar fi fost {item} la {per} ISK/LP, sub pragul de {floor} ISK/LP ({pct}% din cel mai bun).', { item: stop.name, per: formatInt(stop.per), floor: formatInt(top * lpFloor / 100), pct: lpFloor })}` : ''}</p>`
          : emptyState({ title: tx('Nicio ofertă nu aduce câștig la vânzare instant acum'), vy: 'No Profit Woven' }),
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

  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const at = (s: string) => t.closest<HTMLElement>(s);
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
    const info = at('[data-asset-info]');
    if (info) { showItemInfo(ctx, Number(info.dataset.assetInfo)); return; }
    const loc = at('[data-asset-loc]');
    if (loc) { toggleLocation(loc); return; }
    const ls = at('[data-lp-sort]');
    if (ls) {
      lpSort = ls.dataset.lpSort as LpSort;
      lpCol = { key: lpSort, desc: true };
      saveJson(LP_SORT_KEY, lpSort);
      saveJson(LP_COL_KEY, lpCol);
      renderLpTable();
      return;
    }
    if (at('[data-lp-clear]')) {
      lpFilter = { ...lpFilter, q: '' };
      saveJson(LP_FILTER_KEY, lpFilter);
      const inp = body.querySelector<HTMLInputElement>('[data-lp-f="q"]');
      if (inp) { inp.value = ''; inp.focus(); }
      at('[data-lp-clear]')!.remove();
      renderLpTable();
      return;
    }
    if (at('[data-lp-suggest]')) { lpSuggest(); return; }
    if (at('[data-lp-suggest-close]')) { const o = body.querySelector<HTMLElement>('#lpSuggest'); if (o) o.innerHTML = ''; return; }
    if (at('[data-lp-apply]')) {
      lpQty.clear();
      body.querySelectorAll<HTMLElement>('[data-lp-pick]').forEach((tr) => lpQty.set(Number(tr.dataset.lpPick), Number(tr.dataset.n)));
      lpSort = 'buy';
      lpCol = { key: 'profit', desc: true };
      saveJson(LP_SORT_KEY, lpSort);
      saveJson(LP_COL_KEY, lpCol);
      renderLpTable();
      body.querySelector('#lpTable')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const lc = at('[data-lp-col]');
    if (lc) {
      const key = lc.dataset.lpCol as LpCol;
      lpCol = lpCol.key === key ? { key, desc: !lpCol.desc } : { key, desc: key !== 'name' };
      if (key === 'real' || key === 'buy' || key === 'sell') { lpSort = key; saveJson(LP_SORT_KEY, lpSort); }
      saveJson(LP_COL_KEY, lpCol);
      renderLpTable();
      return;
    }
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

  const lpFilterInput = (t: HTMLElement) => {
    const f = t.dataset.lpF as keyof LpFilter | undefined;
    if (!f) return false;
    const el = t as HTMLInputElement;
    lpFilter = { ...lpFilter, [f]: el.type === 'checkbox' ? el.checked : f === 'q' ? el.value : Math.max(0, Number(el.value) || 0) };
    saveJson(LP_FILTER_KEY, lpFilter);
    if (f === 'q') {
      const box = t.closest('.lp-search-box');
      const btn = box?.querySelector('[data-lp-clear]');
      if (el.value && box && !btn) box.insertAdjacentHTML('beforeend', `<button class="icon-btn" data-lp-clear title="${tx('Golește căutarea')}">✕</button>`);
      else if (!el.value) btn?.remove();
    }
    renderLpTable();
    return true;
  };

  body.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.lpQty) { lpQtyInput(t); return; }
    lpFilterInput(t);
  });

  body.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.lpF) { lpFilterInput(t); return; }
    if (t.id === 'lpFloor') {
      lpFloor = Math.min(100, Math.max(10, Math.round(Number((t as HTMLInputElement).value) || 80)));
      (t as HTMLInputElement).value = String(lpFloor);
      saveJson(LP_FLOOR_KEY, lpFloor);
      return;
    }
    if (t.id === 'lpOwn') {
      lpOwnSrc = (t as HTMLSelectElement).value as OwnSource;
      saveJson(LP_OWN_KEY, lpOwnSrc);
      lpOwned = null;
      lpLoadOwned().then(() => { if (lpShown) loadOffers(lpShown.corp, lpShown.points, true); });
      return;
    }
    if (t.id === 'lpMine') {
      const sel = t as HTMLSelectElement;
      body.querySelector<HTMLInputElement>('#lpCorp')!.value = sel.value ? sel.selectedOptions[0].text.split(' · ')[0] : '';
      if (sel.value) lpLoad();
    }
    if (t.id === 'lpCorp' && (t as HTMLInputElement).value.trim()) lpLoad();
  });

  window.addEventListener(ALERTS_EVENT, () => { if (tab === 'alerts') alerts(); });
  ctx.onCharacterChange(() => { if (tab === 'assets' || tab === 'lp') render(); });

  return {
    show(next) { tab = next; render(); },
    hide() { tab = null; },
  };
}
