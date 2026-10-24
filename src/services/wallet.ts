import type { WalletEntry } from '../character/esi';
import { tx } from '../i18n';

export const PVE_REFS = new Set([
  'bounty_prizes', 'bounty_prize', 'ess_escrow_transfer', 'agent_mission_reward', 'agent_mission_time_bonus_reward',
  'agent_mission_collateral_paid', 'corporate_reward_payout', 'project_discovery_reward', 'daily_goal_payouts',
]);

export const REF_LABELS: Record<string, string> = {
  bounty_prizes: 'Bounty',
  bounty_prize: 'Bounty',
  ess_escrow_transfer: 'ESS',
  agent_mission_reward: tx('Misiuni'),
  agent_mission_time_bonus_reward: tx('Bonus misiuni'),
  market_transaction: 'Market',
  market_escrow: 'Market escrow',
  transaction_tax: tx('Taxă tranzacții'),
  brokers_fee: 'Broker fee',
  player_donation: tx('Donații'),
  player_trading: tx('Trade direct'),
  insurance: tx('Asigurare'),
  contract_price: tx('Contracte'),
  contract_reward: tx('Contracte'),
  daily_goal_payouts: 'Daily goals',
  corporate_reward_payout: 'Corp reward',
  skill_purchase: tx('Skillbook-uri'),
  planetary_import_tax: 'PI import',
  planetary_export_tax: 'PI export',
  industry_job_tax: tx('Industrie'),
  reprocessing_tax: tx('Reprocesare'),
  jump_clone_installation_fee: 'Jump clone',
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
