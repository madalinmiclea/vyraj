import { walletJournal, walletBalance, walletTransactions, type WalletEntry, type WalletTransaction } from '../character/esi';
import { loadJson, saveJson, removeKey, storageKey, evictCaches } from '../storage';
import { tx, lang } from '../i18n';

export const PVE_REFS = new Set([
  'bounty_prizes', 'bounty_prize', 'ess_escrow_transfer', 'agent_mission_reward', 'agent_mission_time_bonus_reward',
  'agent_mission_collateral_paid', 'corporate_reward_payout', 'project_discovery_reward', 'daily_goal_payouts',
]);

export const BOUNTY_REFS = new Set(['bounty_prizes', 'bounty_prize']);

export const REF_LABELS: Record<string, string> = {
  bounty_prizes: tx('Recompense NPC'),
  bounty_prize: tx('Recompense NPC'),
  ess_escrow_transfer: 'ESS',
  agent_mission_reward: tx('Misiuni'),
  agent_mission_time_bonus_reward: tx('Bonus misiuni'),
  market_transaction: tx('Piață'),
  market_escrow: tx('Escrow ordine'),
  transaction_tax: tx('Taxă tranzacții'),
  brokers_fee: tx('Comision broker'),
  player_donation: tx('Donații'),
  player_trading: tx('Trade direct'),
  insurance: tx('Asigurare'),
  contract_price: tx('Contracte'),
  contract_reward: tx('Contracte'),
  daily_goal_payouts: tx('Obiective zilnice'),
  corporate_reward_payout: tx('Recompensă corporație'),
  skill_purchase: tx('Skillbook-uri'),
  planetary_import_tax: tx('Import PI'),
  planetary_export_tax: tx('Export PI'),
  industry_job_tax: tx('Industrie'),
  reprocessing_tax: tx('Reprocesare'),
  jump_clone_installation_fee: tx('Clonă de salt'),
  structure_gate_jump: 'Ansiblex',
  lp_store: tx('Magazin LP'),
  contract_deposit: tx('Depozit contract'),
  contract_deposit_refund: tx('Depozit contract returnat'),
  contract_brokers_fee: tx('Comision broker contract'),
  contract_brokers_fee_corp: tx('Comision broker contract'),
  contract_sales_tax: tx('Taxă vânzare contract'),
  contract_collateral: tx('Colateral contract'),
  contract_collateral_refund: tx('Colateral returnat'),
  contract_collateral_payout: tx('Colateral încasat'),
  contract_reward_deposited: tx('Recompensă curierat depusă'),
  contract_reward_refund: tx('Recompensă curierat returnată'),
  contract_auction_bid: tx('Ofertă licitație'),
  contract_auction_bid_refund: tx('Ofertă licitație returnată'),
  contract_auction_bid_corp: tx('Ofertă licitație'),
  contract_auction_sold: tx('Licitație vândută'),
  contract_price_payment_corp: tx('Contracte'),
  air_career_program_reward: tx('Program de carieră AIR'),
  repair_bill: tx('Reparații'),
  clone_activation: tx('Activare clonă'),
  clone_transfer: tx('Transfer clonă'),
  docking_fee: tx('Taxă de andocare'),
  office_rental_fee: tx('Chirie birou'),
  corporation_account_withdrawal: tx('Retragere din corporație'),
  corporate_reward_tax: tx('Taxă corporație'),
  bounty_surcharge: tx('Taxă recompense'),
  agent_location_services: tx('Agent locator'),
  agent_mission_collateral_paid: tx('Colateral misiune plătit'),
  agent_mission_collateral_refunded: tx('Colateral misiune returnat'),
  agent_donation: tx('Donație de la agent'),
  agent_services_rendered: tx('Servicii agent'),
  medal_creation: tx('Creare medalie'),
  medal_issued: tx('Medalie acordată'),
  war_fee: tx('Taxă de război'),
  war_fee_surrender: tx('Taxă de capitulare'),
  alliance_maintainance_fee: tx('Întreținere alianță'),
  sovereignity_bill: tx('Factură suveranitate'),
  infrastructure_hub_maintenance: tx('Întreținere infrastructure hub'),
  manufacturing: tx('Fabricație'),
  researching_time_productivity: tx('Cercetare TE'),
  researching_material_productivity: tx('Cercetare ME'),
  copying: tx('Copiere blueprint'),
  reverse_engineering: tx('Inginerie inversă'),
  reaction: tx('Reacții'),
  planetary_construction: tx('Construcții PI'),
  market_provider_tax: tx('Taxă furnizor piață'),
  kill_right_fee: tx('Kill right'),
  cspa: 'CSPA',
  ess_escrow_payment: 'ESS',
  project_discovery_tax: tx('Taxă Project Discovery'),
  project_discovery_reward: 'Project Discovery',
  freelance_jobs_reward: tx('Joburi freelance'),
  freelance_jobs_reward_corporation_tax: tx('Taxă joburi freelance'),
  freelance_jobs_escrow_refund: tx('Joburi freelance returnate'),
  freelance_jobs_duration_fee: tx('Taxă joburi freelance'),
  freelance_jobs_broadcasting_fee: tx('Taxă joburi freelance'),
  daily_challenge_reward: tx('Provocare zilnică'),
  insurgency_corruption_contribution_reward: tx('Recompensă insurgență'),
  insurgency_suppression_contribution_reward: tx('Recompensă insurgență'),
  milestone_reward_payment: tx('Recompensă de etapă'),
  skyhook_claim_fee: tx('Taxă skyhook'),
  asset_safety_recovery_tax: tx('Taxă Asset Safety'),
  cosmetic_market_component_item_purchase: tx('Piață cosmetice'),
  cosmetic_market_skin_sale: tx('Piață cosmetice'),
  cosmetic_market_skin_purchase: tx('Piață cosmetice'),
  cosmetic_market_skin_sale_broker_fee: tx('Piață cosmetice'),
  cosmetic_market_skin_sale_tax: tx('Piață cosmetice'),
  cosmetic_market_skin_transaction: tx('Piață cosmetice'),
  external_trade_freeze: tx('Comerț extern blocat'),
  external_trade_thaw: tx('Comerț extern deblocat'),
  external_trade_delivery: tx('Comerț extern livrat'),
};

const pretty = (ref: string) => { const t = ref.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

export const refLabel = (ref: string) => REF_LABELS[ref] ?? pretty(ref);

const DESCRIPTIONS: [RegExp, string][] = [
  [/^(.+) got bounty prizes for killing pirates in (.+)$/, '{a} a primit recompense pentru pirații uciși în {b}'],
  [/^(.+) received a time bonus for completing a mission$/, '{a} a primit bonusul de timp pentru o misiune'],
  [/^(.+) received a reward for completing a mission$/, '{a} a primit recompensa pentru o misiune'],
  [/^Mission reward bonus from agent (.+)$/i, 'Bonus de misiune de la agentul {a}'],
  [/^Mission reward from agent (.+)$/i, 'Recompensă de misiune de la agentul {a}'],
  [/^CONCORD rewarded (.+) for completing an incursion site$/, 'CONCORD l-a răsplătit pe {a} pentru un site de incursiune'],
  [/^Market: (.+) bought stuff in (.+)$/, 'Piață: {a} a cumpărat în {b}'],
  [/^Market: (.+) sold stuff in (.+)$/, 'Piață: {a} a vândut în {b}'],
  [/^Market: (.+) bought stuff from (.+)$/, 'Piață: {a} a cumpărat de la {b}'],
  [/^Market escrow release$/i, 'Escrow eliberat'],
  [/^Sales tax$/i, 'Taxă de vânzare'],
  [/^Brokers? fee$/i, 'Comision broker'],
  [/^Bounty prizes$/i, 'Recompense NPC'],
  [/^Skill purchase$/i, 'Cumpărare skillbook'],
  [/^Donation$/i, 'Donație'],
  [/^Daily Goal Payout$/i, 'Plată obiectiv zilnic'],
  [/^Office rental$/i, 'Chirie birou'],
  [/^Industry Job Tax$/i, 'Taxă job industrie'],
  [/^Planetary Export Tax$/i, 'Taxă export PI'],
  [/^Planetary Import Tax$/i, 'Taxă import PI'],
];

function translateDescription(text: string) {
  if (lang !== 'ro') return text;
  for (const [re, ro] of DESCRIPTIONS) {
    const m = re.exec(text.trim());
    if (m) return ro.replace('{a}', m[1] ?? '').replace('{b}', m[2] ?? '');
  }
  return text;
}

export function entryLabel(e: { ref_type: string; amount?: number }) {
  if (e.ref_type === 'market_escrow') return (e.amount ?? 0) < 0 ? tx('Blocat în escrow') : tx('Returnat din escrow');
  return refLabel(e.ref_type);
}

export function entryDescription(e: { ref_type: string; amount?: number; description?: string; reason?: string }) {
  if (e.ref_type === 'market_escrow') return (e.amount ?? 0) < 0 ? tx('ISK mutat din portofel în escrow pentru un ordin de cumpărare') : tx('ISK întors din escrow în portofel (ordin expirat, anulat sau modificat)');
  return translateDescription(e.description && e.description.trim() !== '-' ? e.description : e.reason ?? '');
}

export interface Session {
  start: number;
  end: number;
  isk: number;
  ticks: number;
}

const GAP = 30 * 60 * 1000;
const TICK = 20 * 60 * 1000;

export function pveSessions(entries: WalletEntry[]): Session[] {
  const income = entries
    .filter((e) => PVE_REFS.has(e.ref_type) && (e.amount ?? 0) > 0)
    .map((e) => ({ t: Date.parse(e.date), isk: e.amount ?? 0 }))
    .sort((a, b) => a.t - b.t);
  const out: Session[] = [];
  for (const e of income) {
    const last = out[out.length - 1];
    if (last && e.t - last.end <= GAP) { last.end = e.t; last.isk += e.isk; last.ticks++; }
    else out.push({ start: e.t - TICK, end: e.t, isk: e.isk, ticks: 1 });
  }
  return out.reverse();
}

export function byRef(entries: WalletEntry[]) {
  const map = new Map<string, { ref: string; income: number; spent: number }>();
  for (const e of entries) {
    const a = e.amount ?? 0;
    const r = map.get(e.ref_type) ?? { ref: e.ref_type, income: 0, spent: 0 };
    if (a > 0) r.income += a; else r.spent += -a;
    map.set(e.ref_type, r);
  }
  return [...map.values()].sort((a, b) => b.income + b.spent - (a.income + a.spent));
}

export function daily(entries: WalletEntry[], days = 30) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const start = today.getTime() - (days - 1) * 86400000;
  const out = Array.from({ length: days }, (_, i) => ({ day: start + i * 86400000, pve: 0, net: 0 }));
  for (const e of entries) {
    const i = Math.floor((Date.parse(e.date) - start) / 86400000);
    if (i < 0 || i >= days) continue;
    const a = e.amount ?? 0;
    out[i].net += a;
    if (PVE_REFS.has(e.ref_type) && a > 0) out[i].pve += a;
  }
  return out;
}

export type Period = '1d' | '7d' | '30d' | '90d' | 'all';

export const PERIODS: { id: Period; label: string; days: number }[] = [
  { id: '1d', label: tx('24 ore'), days: 1 },
  { id: '7d', label: tx('7 zile'), days: 7 },
  { id: '30d', label: tx('30 zile'), days: 30 },
  { id: '90d', label: tx('90 zile'), days: 90 },
  { id: 'all', label: tx('Tot'), days: Infinity },
];

const DAY = 86400000;
const HOUR = 3600000;

export function periodStart(period: Period, now = Date.now()) {
  const days = PERIODS.find((p) => p.id === period)?.days ?? 30;
  return Number.isFinite(days) ? now - days * DAY : 0;
}

export const since = <T extends { date: string }>(rows: T[], from: number) => (from ? rows.filter((r) => Date.parse(r.date) >= from) : rows);

function store(key: string, rows: unknown[]) {
  let list = rows;
  let evicted = false;
  while (list.length) {
    try {
      localStorage.setItem(storageKey(key), JSON.stringify(list));
      return;
    } catch {
      if (!evicted) { evicted = true; evictCaches(); continue; }
      list = list.slice(0, Math.floor(list.length / 2));
    }
  }
}

type PackedEntry = [number, number, string, number, number | null, string, string?, number?];
type PackedTrade = [number, number, number, 0 | 1, number, number];
const ARCHIVE_MAX = 20000;

export function archiveJournal(characterId: number, fresh: WalletEntry[]): WalletEntry[] {
  const key = `eve-fit:wallet:${characterId}`;
  const map = new Map<number, WalletEntry>();
  for (const [id, t, ref, amount, balance, description, reason, context] of loadJson<PackedEntry[]>(key, [])) {
    map.set(id, { id, date: new Date(t * 1000).toISOString(), ref_type: ref, amount, balance: balance ?? undefined, description, reason: reason || undefined, context_id: context ?? undefined, context_id_type: context ? 'system_id' : undefined });
  }
  for (const e of fresh) map.set(e.id, e);
  const all = [...map.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, ARCHIVE_MAX);
  store(key, all.map((e): PackedEntry => {
    const row: PackedEntry = [e.id, Math.round(Date.parse(e.date) / 1000), e.ref_type, e.amount ?? 0, e.balance ?? null, (e.description ?? '').slice(0, 160)];
    if (BOUNTY_REFS.has(e.ref_type)) row.push(e.reason ?? '', e.context_id_type === 'system_id' ? e.context_id : undefined);
    return row;
  }));
  return all;
}

export function savedBountySystems(characterId: number, after = 0): { systemId: number; time: number }[] {
  const out: { systemId: number; time: number }[] = [];
  for (const [, t, ref, amount, , , , context] of loadJson<PackedEntry[]>(`eve-fit:wallet:${characterId}`, [])) {
    if (context && t > after && BOUNTY_REFS.has(ref) && amount > 0) out.push({ systemId: context, time: t * 1000 });
  }
  return out;
}

export const WALLET_SCOPE = 'esi-wallet.read_character_wallet.v1';
const FETCHED_KEY = 'eve-tools:wallet-fetched';
const ARCHIVE_GAP_MS = 7 * DAY;

export async function syncWallet(characterId: number, force = false, onFetch?: () => void) {
  let fetched = loadJson<Record<string, { at: number; balance: number }>>(FETCHED_KEY, {})[characterId];
  let fresh: WalletEntry[] = [];
  let freshTrades: WalletTransaction[] = [];
  if (force || !fetched || Date.now() - fetched.at > ARCHIVE_GAP_MS || bountyDetailMissing(characterId)) {
    onFetch?.();
    let balance: number;
    [fresh, balance, freshTrades] = await Promise.all([
      walletJournal(characterId),
      walletBalance(characterId),
      walletTransactions(characterId).catch(() => [] as WalletTransaction[]),
    ]);
    fetched = { at: Date.now(), balance };
    saveJson(FETCHED_KEY, { ...loadJson<Record<string, { at: number; balance: number }>>(FETCHED_KEY, {}), [characterId]: fetched });
  }
  return { entries: archiveJournal(characterId, fresh), trades: archiveTrades(characterId, freshTrades), at: fetched.at, balance: fetched.balance };
}

export function bountyDetailMissing(characterId: number, now = Date.now()): boolean {
  const cutoff = Math.round(now / 1000) - 30 * 86400;
  return loadJson<PackedEntry[]>(`eve-fit:wallet:${characterId}`, []).some((r) => BOUNTY_REFS.has(r[2]) && r[1] > cutoff && r.length < 7);
}

export function archiveTrades(characterId: number, fresh: WalletTransaction[]): WalletTransaction[] {
  const key = `eve-fit:wallet-trades:${characterId}`;
  const map = new Map<number, WalletTransaction>();
  for (const [id, t, typeId, buy, quantity, price] of loadJson<PackedTrade[]>(key, [])) {
    map.set(id, { transaction_id: id, date: new Date(t * 1000).toISOString(), type_id: typeId, is_buy: buy === 1, quantity, unit_price: price });
  }
  for (const r of fresh) map.set(r.transaction_id, r);
  const all = [...map.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, ARCHIVE_MAX);
  store(key, all.map((r): PackedTrade => [r.transaction_id, Math.round(Date.parse(r.date) / 1000), r.type_id, r.is_buy ? 1 : 0, r.quantity, r.unit_price]));
  return all;
}

export function flow(entries: WalletEntry[]) {
  let earned = 0, spent = 0, pve = 0, escrow = 0;
  for (const e of entries) {
    const a = e.amount ?? 0;
    if (e.ref_type === 'market_escrow') { escrow += a; continue; }
    if (a > 0) earned += a; else spent -= a;
    if (a > 0 && PVE_REFS.has(e.ref_type)) pve += a;
  }
  if (escrow > 0) earned += escrow; else spent -= escrow;
  return { earned, spent, net: earned - spent, pve, escrow, count: entries.length };
}

export interface FlowBucket {
  start: number;
  size: number;
  earned: number;
  spent: number;
}

export function flowBuckets(entries: WalletEntry[], period: Period, oldest: number, now = Date.now()): FlowBucket[] {
  const days = period === 'all' ? Math.max(1, Math.ceil((now - oldest) / DAY)) : PERIODS.find((p) => p.id === period)!.days;
  const start = period === 'all' ? Math.min(oldest, now - DAY) : Math.max(now - days * DAY, Math.min(oldest, now - DAY));
  const size = period === '1d' ? HOUR : days > 120 ? 7 * DAY : DAY;
  const align = period === '1d' ? HOUR : DAY;
  const from = Math.floor(start / align) * align;
  const n = Math.max(1, Math.ceil((now - from) / size));
  const out: FlowBucket[] = Array.from({ length: n }, (_, i) => ({ start: from + i * size, size, earned: 0, spent: 0 }));
  const escrow = new Array<number>(n).fill(0);
  for (const e of entries) {
    const t = Date.parse(e.date);
    if (t < start || t > now) continue;
    const i = Math.min(n - 1, Math.floor((t - from) / size));
    const a = e.amount ?? 0;
    if (e.ref_type === 'market_escrow') { escrow[i] += a; continue; }
    if (a > 0) out[i].earned += a; else out[i].spent -= a;
  }
  escrow.forEach((a, i) => { if (a > 0) out[i].earned += a; else out[i].spent -= a; });
  return out;
}

export interface TradeRow {
  typeId: number;
  boughtQty: number;
  boughtIsk: number;
  soldQty: number;
  soldIsk: number;
}

export function tradeSummary(rows: WalletTransaction[]): TradeRow[] {
  const map = new Map<number, TradeRow>();
  for (const r of rows) {
    const row = map.get(r.type_id) ?? { typeId: r.type_id, boughtQty: 0, boughtIsk: 0, soldQty: 0, soldIsk: 0 };
    const value = r.quantity * (r.unit_price ?? 0);
    if (r.is_buy) { row.boughtQty += r.quantity; row.boughtIsk += value; } else { row.soldQty += r.quantity; row.soldIsk += value; }
    map.set(r.type_id, row);
  }
  return [...map.values()].sort((a, b) => b.boughtIsk + b.soldIsk - (a.boughtIsk + a.soldIsk));
}

export function forgetWallet(characterId: number) {
  removeKey(`eve-fit:wallet:${characterId}`);
  removeKey(`eve-fit:wallet-trades:${characterId}`);
  removeKey(`eve-tools:assets:${characterId}`);
  const fetched = loadJson<Record<string, unknown>>(FETCHED_KEY, {});
  delete fetched[characterId];
  saveJson(FETCHED_KEY, fetched);
}

export interface BountyTick {
  id: number;
  t: number;
  isk: number;
  systemId?: number;
  kills: [number, number][];
}

export function parseKills(reason?: string): [number, number][] {
  const out = new Map<number, number>();
  for (const part of (reason ?? '').split(',')) {
    const m = part.match(/^\s*(\d+)\s*:\s*(\d+)\s*$/);
    if (m) out.set(Number(m[1]), (out.get(Number(m[1])) ?? 0) + Number(m[2]));
  }
  return [...out];
}

export function bountyTicks(entries: WalletEntry[]): BountyTick[] {
  return entries
    .filter((e) => BOUNTY_REFS.has(e.ref_type) && (e.amount ?? 0) > 0)
    .map((e) => ({ id: e.id, t: Date.parse(e.date), isk: e.amount ?? 0, systemId: e.context_id_type === 'system_id' ? e.context_id : undefined, kills: parseKills(e.reason) }))
    .sort((a, b) => b.t - a.t);
}

export function tickSummary(ticks: BountyTick[]) {
  const systems = new Map<number, { isk: number; ticks: number }>();
  const targets = new Map<number, number>();
  let best: BountyTick | null = null;
  let isk = 0;
  for (const k of ticks) {
    isk += k.isk;
    if (!best || k.isk > best.isk) best = k;
    if (k.systemId) {
      const s = systems.get(k.systemId) ?? { isk: 0, ticks: 0 };
      s.isk += k.isk;
      s.ticks++;
      systems.set(k.systemId, s);
    }
    for (const [id, n] of k.kills) targets.set(id, (targets.get(id) ?? 0) + n);
  }
  return {
    count: ticks.length,
    isk,
    average: ticks.length ? isk / ticks.length : 0,
    kills: [...targets.values()].reduce((a, n) => a + n, 0),
    best,
    systems: [...systems].map(([id, s]) => ({ id, ...s })).sort((a, b) => b.isk - a.isk),
    targets: [...targets].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n),
  };
}

export interface ActivityDay { day: number; isk: number; ticks: number }

export function pveActivity(entries: WalletEntry[], days = 91, now = Date.now()): ActivityDay[] {
  const today = Math.floor(now / DAY) * DAY;
  const start = today - (days - 1) * DAY;
  const out: ActivityDay[] = Array.from({ length: days }, (_, i) => ({ day: start + i * DAY, isk: 0, ticks: 0 }));
  for (const e of entries) {
    const a = e.amount ?? 0;
    if (a <= 0 || !PVE_REFS.has(e.ref_type)) continue;
    const i = Math.floor((Date.parse(e.date) - start) / DAY);
    if (i < 0 || i >= days) continue;
    out[i].isk += a;
    if (BOUNTY_REFS.has(e.ref_type)) out[i].ticks++;
  }
  return out;
}

export interface RealisedRow {
  typeId: number;
  soldQty: number;
  matchedQty: number;
  revenue: number;
  cost: number;
  profit: number;
  unmatchedIsk: number;
  heldQty: number;
  heldCost: number;
}

export function realisedProfit(rows: WalletTransaction[], from: number): RealisedRow[] {
  const sorted = [...rows].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.transaction_id - b.transaction_id);
  const stock = new Map<number, { qty: number; cost: number }>();
  const out = new Map<number, RealisedRow>();
  for (const r of sorted) {
    const s = stock.get(r.type_id) ?? { qty: 0, cost: 0 };
    const price = r.unit_price ?? 0;
    if (r.is_buy) {
      s.qty += r.quantity;
      s.cost += r.quantity * price;
      stock.set(r.type_id, s);
      continue;
    }
    const matched = Math.min(s.qty, r.quantity);
    const avg = s.qty > 0 ? s.cost / s.qty : 0;
    if (Date.parse(r.date) >= from) {
      const row = out.get(r.type_id) ?? { typeId: r.type_id, soldQty: 0, matchedQty: 0, revenue: 0, cost: 0, profit: 0, unmatchedIsk: 0, heldQty: 0, heldCost: 0 };
      row.soldQty += r.quantity;
      row.matchedQty += matched;
      row.revenue += matched * price;
      row.cost += matched * avg;
      row.profit = row.revenue - row.cost;
      row.unmatchedIsk += (r.quantity - matched) * price;
      out.set(r.type_id, row);
    }
    s.qty -= matched;
    s.cost -= matched * avg;
    stock.set(r.type_id, s);
  }
  for (const row of out.values()) {
    const s = stock.get(row.typeId);
    row.heldQty = s?.qty ?? 0;
    row.heldCost = s?.cost ?? 0;
  }
  return [...out.values()].sort((a, b) => Number(b.matchedQty > 0) - Number(a.matchedQty > 0) || b.profit - a.profit || b.unmatchedIsk - a.unmatchedIsk);
}
