import { authedJson, authedPages, corporationOf, corporationRoles, isPlayerCorp, canReadCorpWallet, CORP_SCOPES } from './corporation';
import { hasScope } from '../character/sso';

export interface CorpJournalEntry {
  id: number;
  date: string;
  ref_type: string;
  amount?: number;
  balance?: number;
  description: string;
  reason?: string;
  first_party_id?: number;
  second_party_id?: number;
  tax?: number;
  tax_receiver_id?: number;
}

export interface CorpDivision { division: number; name: string; balance: number }

export interface MemberTax {
  memberId: number;
  total: number;
  bounties: number;
  count: number;
  days: number;
  last: number;
  share: number;
}

export interface Withdrawal { id: number; date: number; who?: number; reason: string; amount: number }

export type CorpAccess =
  | { state: 'scope' }
  | { state: 'npc' }
  | { state: 'role'; roles: string[]; corporationId: number }
  | { state: 'ok'; roles: string[]; corporationId: number };

export async function corpAccess(characterId: number): Promise<CorpAccess> {
  if (!hasScope(characterId, CORP_SCOPES.roles) || !hasScope(characterId, CORP_SCOPES.wallets)) return { state: 'scope' };
  const corporationId = await corporationOf(characterId);
  if (!isPlayerCorp(corporationId)) return { state: 'npc' };
  const roles = await corporationRoles(characterId);
  return canReadCorpWallet(roles) ? { state: 'ok', roles, corporationId: corporationId! } : { state: 'role', roles, corporationId: corporationId! };
}

export async function corpDivisions(characterId: number, corporationId: number): Promise<CorpDivision[]> {
  const [balances, names] = await Promise.all([
    authedJson<{ division: number; balance: number }[]>(characterId, `/corporations/${corporationId}/wallets/`),
    hasScope(characterId, CORP_SCOPES.divisions)
      ? authedJson<{ wallet?: { division: number; name?: string }[] }>(characterId, `/corporations/${corporationId}/divisions/`).catch(() => ({ wallet: [] }))
      : Promise.resolve({ wallet: [] }),
  ]);
  const named = new Map((names.wallet ?? []).map((w) => [w.division, w.name ?? '']));
  return balances.sort((a, b) => a.division - b.division).map((b) => ({ ...b, name: named.get(b.division) || '' }));
}

export function corpJournal(characterId: number, corporationId: number, division: number, maxPages = 5): Promise<CorpJournalEntry[]> {
  return authedPages<CorpJournalEntry>(characterId, `/corporations/${corporationId}/wallets/${division}/journal/`, maxPages);
}

const REWARD_REFS = new Set(['bounty_prizes', 'bounty_prize', 'ess_escrow_transfer', 'agent_mission_reward', 'agent_mission_time_bonus_reward']);
const TAX_REFS = new Set(['corporate_reward_tax', 'daily_goal_payouts_tax']);

const isTax = (ref: string) => REWARD_REFS.has(ref) || TAX_REFS.has(ref) || ref.endsWith('_corporation_tax');
const isBounty = (ref: string) => ref.startsWith('bounty_') || ref === 'ess_escrow_transfer';

export function memberTaxes(journal: CorpJournalEntry[], corporationId: number, from: number) {
  const member = (id?: number) => (id && id !== corporationId && id >= 90_000_000 ? id : undefined);
  const party = (e: CorpJournalEntry) => member(e.second_party_id) ?? member(e.first_party_id);
  const window = journal.filter((e) => Date.parse(e.date) >= from);
  const acc = new Map<number, { total: number; bounties: number; count: number; days: Set<string>; last: number }>();
  for (const e of window) {
    if (!isTax(e.ref_type) || !(e.amount && e.amount > 0)) continue;
    const who = party(e);
    if (!who) continue;
    const a = acc.get(who) ?? { total: 0, bounties: 0, count: 0, days: new Set<string>(), last: 0 };
    a.total += e.amount;
    if (isBounty(e.ref_type)) a.bounties += e.amount;
    a.count++;
    a.days.add(e.date.slice(0, 10));
    a.last = Math.max(a.last, Date.parse(e.date));
    acc.set(who, a);
  }
  const total = [...acc.values()].reduce((s, a) => s + a.total, 0);
  const members: MemberTax[] = [...acc].map(([memberId, a]) => ({ memberId, total: a.total, bounties: a.bounties, count: a.count, days: a.days.size, last: a.last, share: total > 0 ? a.total / total : 0 }))
    .sort((a, b) => b.total - a.total || a.memberId - b.memberId);
  const withdrawals: Withdrawal[] = window.filter((e) => e.ref_type === 'corporation_account_withdrawal')
    .map((e) => ({ id: e.id, date: Date.parse(e.date), who: party(e), reason: e.reason || e.description || '', amount: Math.abs(e.amount ?? 0) }))
    .sort((a, b) => b.date - a.date);
  return { members, total, withdrawals, withdrawn: withdrawals.reduce((s, w) => s + w.amount, 0) };
}
