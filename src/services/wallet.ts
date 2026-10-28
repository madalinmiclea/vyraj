import type { WalletEntry, WalletTransaction } from '../character/esi';
import { loadJson, saveJson, removeKey } from '../storage';
import { tx } from '../i18n';

export const PVE_REFS = new Set([
  'bounty_prizes', 'bounty_prize', 'ess_escrow_transfer', 'agent_mission_reward', 'agent_mission_time_bonus_reward',
  'agent_mission_collateral_paid', 'corporate_reward_payout', 'project_discovery_reward', 'daily_goal_payouts',
]);

export const REF_LABELS: Record<string, string> = {
  bounty_prizes: tx('Recompense NPC'),
  bounty_prize: tx('Recompense NPC'),
  ess_escrow_transfer: 'ESS',
  agent_mission_reward: tx('Misiuni'),
  agent_mission_time_bonus_reward: tx('Bonus misiuni'),
  market_transaction: tx('Piață'),
  market_escrow: tx('Garanție ordine'),
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
};

export const refLabel = (ref: string) => REF_LABELS[ref] ?? ref.replace(/_/g, ' ');

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
  while (list.length) {
    try {
      localStorage.setItem(key, JSON.stringify(list));
      return;
    } catch {
      list = list.slice(0, Math.floor(list.length / 2));
    }
  }
}

type PackedEntry = [number, number, string, number, number | null, string];
type PackedTrade = [number, number, number, 0 | 1, number, number];
const ARCHIVE_MAX = 20000;

export function archiveJournal(characterId: number, fresh: WalletEntry[]): WalletEntry[] {
  const key = `eve-fit:wallet:${characterId}`;
  const map = new Map<number, WalletEntry>();
  for (const [id, t, ref, amount, balance, description] of loadJson<PackedEntry[]>(key, [])) {
    map.set(id, { id, date: new Date(t * 1000).toISOString(), ref_type: ref, amount, balance: balance ?? undefined, description });
  }
  for (const e of fresh) map.set(e.id, e);
  const all = [...map.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, ARCHIVE_MAX);
  store(key, all.map((e): PackedEntry => [e.id, Math.round(Date.parse(e.date) / 1000), e.ref_type, e.amount ?? 0, e.balance ?? null, (e.description ?? '').slice(0, 160)]));
  return all;
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
  let earned = 0, spent = 0, pve = 0;
  for (const e of entries) {
    const a = e.amount ?? 0;
    if (a > 0) earned += a; else spent -= a;
    if (a > 0 && PVE_REFS.has(e.ref_type)) pve += a;
  }
  return { earned, spent, net: earned - spent, pve, count: entries.length };
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
  for (const e of entries) {
    const t = Date.parse(e.date);
    if (t < start || t > now) continue;
    const i = Math.min(n - 1, Math.floor((t - from) / size));
    const a = e.amount ?? 0;
    if (a > 0) out[i].earned += a; else out[i].spent -= a;
  }
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
  const fetched = loadJson<Record<string, unknown>>('eve-tools:wallet-fetched', {});
  delete fetched[characterId];
  saveJson('eve-tools:wallet-fetched', fetched);
}
