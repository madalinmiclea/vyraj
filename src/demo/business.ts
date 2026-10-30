import { DEMO_ID } from './identity';
import { DEMO_CORP } from '../services/corporation';
import { tx } from '../i18n';

const HOUR = 3_600_000;
const DAY = 86_400_000;

const JITA = 60003760;
const AMARR = 60008494;
const HOME = 60011866;
const CONCORD = 1000125;

const MEMBERS: [number, string][] = [
  [2_199_990_001, 'Vesna Korvin'],
  [2_199_990_002, 'Bran Ostrava'],
  [2_199_990_003, 'Mira Solnce'],
  [2_199_990_004, 'Dag Varga'],
  [2_199_990_005, 'Ilya Stern'],
  [2_199_990_006, 'Runa Halden'],
  [2_199_990_007, 'Tomas Kvet'],
];
const [VESNA, BRAN, MIRA, DAG] = MEMBERS.map(([id]) => id);

const T = { ogre: 2446, hammer: 2185, ishtar: 12005, dda: 4405, gila: 17715, trit: 34, drake: 24698, lse: 3841 };

const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

export const businessNames = (): Record<number, string> => ({
  [DEMO_CORP]: 'Rodna Collective',
  ...Object.fromEntries(MEMBERS),
});

interface Seed {
  id: number;
  type: string;
  status: string;
  issuer: number;
  assignee?: number;
  acceptor?: number;
  corp?: boolean;
  title?: string;
  price?: number;
  reward?: number;
  collateral?: number;
  buyout?: number;
  volume?: number;
  issuedH: number;
  expiresH: number;
  acceptedH?: number;
  completedH?: number;
  days?: number;
  from?: number;
  to?: number;
  items?: [number, number, boolean][];
  bids?: [number, number, number][];
}

function seeds(): Seed[] {
  return [
    { id: 7_100_001, type: 'item_exchange', status: 'outstanding', issuer: DEMO_ID, title: tx('Ogre II la preț bun'), price: 21_500_000, issuedH: 30, expiresH: 9 * 24, from: JITA, items: [[T.ogre, 15, true]] },
    { id: 7_100_002, type: 'item_exchange', status: 'outstanding', issuer: MIRA, assignee: DEMO_ID, title: tx('Ishtar gata de zbor'), price: 132_000_000, issuedH: 50, expiresH: 19, from: HOME, items: [[T.ishtar, 1, true], [T.dda, 2, true], [T.hammer, 5, true]] },
    { id: 7_100_003, type: 'courier', status: 'in_progress', issuer: BRAN, acceptor: DEMO_ID, title: tx('Minerale spre casă'), reward: 18_000_000, collateral: 900_000_000, volume: 58_000, issuedH: 40, expiresH: 6 * 24, acceptedH: 22, days: 3, from: JITA, to: HOME },
    { id: 7_100_004, type: 'auction', status: 'outstanding', issuer: DEMO_ID, title: tx('Gila, licitație'), price: 120_000_000, buyout: 210_000_000, issuedH: 70, expiresH: 2 * 24 + 5, from: AMARR, items: [[T.gila, 1, true]], bids: [[VESNA, 131_000_000, 40], [DAG, 146_500_000, 12]] },
    { id: 7_100_005, type: 'item_exchange', status: 'outstanding', issuer: DEMO_ID, title: tx('Cumpăr Tritanium'), price: 0, reward: 4_100_000, issuedH: 6, expiresH: 13 * 24, from: JITA, items: [[T.trit, 1_000_000, false]] },
    { id: 7_100_006, type: 'item_exchange', status: 'finished', issuer: DAG, acceptor: DEMO_ID, price: 6_000_000, issuedH: 140, expiresH: -60, completedH: 120, from: JITA, items: [[T.hammer, 5, true]] },
    { id: 7_100_007, type: 'courier', status: 'finished', issuer: DEMO_ID, acceptor: VESNA, title: tx('Loot spre Jita'), reward: 9_000_000, collateral: 400_000_000, volume: 12_500, issuedH: 260, expiresH: -100, acceptedH: 250, completedH: 230, days: 3, from: HOME, to: JITA },
    { id: 7_100_008, type: 'item_exchange', status: 'rejected', issuer: DEMO_ID, assignee: BRAN, price: 3_400_000, issuedH: 200, expiresH: -150, from: HOME, items: [[T.lse, 2, true]] },
    { id: 7_200_001, type: 'item_exchange', status: 'outstanding', issuer: MIRA, assignee: DEMO_CORP, corp: true, title: tx('Drake de doctrină pentru membri'), price: 1, issuedH: 20, expiresH: 12 * 24, from: HOME, items: [[T.drake, 3, true]] },
    { id: 7_200_002, type: 'courier', status: 'outstanding', issuer: BRAN, assignee: DEMO_CORP, corp: true, title: tx('Transport corporație'), reward: 25_000_000, collateral: 1_200_000_000, volume: 210_000, issuedH: 8, expiresH: 22, days: 5, from: AMARR, to: HOME },
  ];
}

function contract(s: Seed, now: number) {
  return {
    contract_id: s.id,
    type: s.type,
    status: s.status,
    availability: s.corp ? 'corporation' : s.assignee ? 'personal' : 'public',
    issuer_id: s.issuer,
    issuer_corporation_id: s.issuer === DEMO_ID ? 1000120 : DEMO_CORP,
    assignee_id: s.assignee ?? 0,
    acceptor_id: s.acceptor ?? 0,
    title: s.title ?? '',
    for_corporation: false,
    date_issued: iso(now - s.issuedH * HOUR),
    date_expired: iso(now + s.expiresH * HOUR),
    date_accepted: s.acceptedH != null ? iso(now - s.acceptedH * HOUR) : undefined,
    date_completed: s.completedH != null ? iso(now - s.completedH * HOUR) : undefined,
    days_to_complete: s.days ?? 0,
    start_location_id: s.from,
    end_location_id: s.to ?? s.from,
    price: s.price ?? 0,
    reward: s.reward ?? 0,
    collateral: s.collateral ?? 0,
    buyout: s.buyout,
    volume: s.volume ?? 0,
  };
}

const DIVISIONS: [number, number][] = [[1, 4_820_000_000], [2, 1_310_000_000], [3, 640_000_000], [4, 212_000_000], [5, 0], [6, 75_000_000], [7, 18_500_000]];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function corpJournal(division: number, now: number) {
  const r = rng(division * 7919);
  const rows: { id: number; date: string; ref_type: string; amount: number; description: string; reason?: string; first_party_id?: number; second_party_id?: number }[] = [];
  let id = 30_000_000_000 + division * 1_000_000;
  const day0 = Math.floor(now / DAY) * DAY;
  for (let d = 29; d >= 0; d--) {
    if (division === 1) {
      MEMBERS.forEach(([member], i) => {
        if (r() < 0.25 + i * 0.07) return;
        const ticks = 1 + Math.floor(r() * (6 - i * 0.6));
        for (let k = 0; k < ticks; k++) {
          const at = day0 - d * DAY + (8 + i + k * 0.34) * HOUR;
          if (at > now) continue;
          rows.push({ id: ++id, date: iso(at), ref_type: 'bounty_prizes', amount: Math.round(600_000 + r() * 2_400_000), description: 'Bounty prizes', first_party_id: CONCORD, second_party_id: member });
        }
        if (r() < 0.3) rows.push({ id: ++id, date: iso(day0 - d * DAY + (15 + i) * HOUR), ref_type: 'agent_mission_reward', amount: Math.round(300_000 + r() * 900_000), description: 'Mission reward', first_party_id: 3_008_416, second_party_id: member });
        if (r() < 0.12) rows.push({ id: ++id, date: iso(day0 - d * DAY + (19 + i * 0.2) * HOUR), ref_type: 'ess_escrow_transfer', amount: Math.round(2_000_000 + r() * 6_000_000), description: 'ESS escrow', first_party_id: CONCORD, second_party_id: member });
      });
      if (d % 9 === 4) rows.push({ id: ++id, date: iso(day0 - d * DAY + 21 * HOUR), ref_type: 'corporation_account_withdrawal', amount: -Math.round(150_000_000 + r() * 250_000_000), description: 'Corporate withdrawal', reason: tx('SRP pentru operațiunea de flotă'), first_party_id: DEMO_CORP, second_party_id: MIRA });
      if (d % 30 === 12) rows.push({ id: ++id, date: iso(day0 - d * DAY + 11 * HOUR), ref_type: 'office_rental_fee', amount: -42_000_000, description: 'Office rental', first_party_id: DEMO_CORP, second_party_id: 1000035 });
      if (d % 7 === 2) rows.push({ id: ++id, date: iso(day0 - d * DAY + 13 * HOUR), ref_type: 'player_donation', amount: Math.round(20_000_000 + r() * 80_000_000), description: 'Donation', reason: tx('Pentru fondul de nave'), first_party_id: DAG, second_party_id: DEMO_CORP });
    } else if (r() < 0.35) {
      rows.push({ id: ++id, date: iso(day0 - d * DAY + 12 * HOUR), ref_type: r() < 0.5 ? 'market_escrow' : 'contract_price', amount: Math.round((r() - 0.55) * 90_000_000), description: 'Division transfer', first_party_id: DEMO_CORP, second_party_id: MEMBERS[Math.floor(r() * MEMBERS.length)][0] });
    }
  }
  const done = rows.filter((e) => Date.parse(e.date) <= now).sort((a, b) => b.id - a.id);
  let balance = DIVISIONS.find(([d]) => d === division)?.[1] ?? 0;
  return done.map((e) => { const out = { ...e, balance }; balance -= e.amount; return out; });
}

const DIVISION_NAMES = () => [tx('Master Wallet'), tx('Fond de nave'), tx('Logistică'), tx('Industrie'), '', tx('Taxe PI'), tx('Rezervă')];

export function demoBusiness(path: string, now: number): unknown | undefined {
  const all = seeds();
  const find = (id: number) => all.find((s) => s.id === id);
  if (path === `/characters/${DEMO_ID}/contracts`) return all.filter((s) => !s.corp).map((s) => contract(s, now));
  if (path === `/characters/${DEMO_ID}/roles`) return { roles: ['Accountant', 'Station_Manager'] };
  if (path === `/corporations/${DEMO_CORP}/contracts`) return all.filter((s) => s.corp).map((s) => contract(s, now));
  const items = path.match(/^\/(?:characters|corporations)\/\d+\/contracts\/(\d+)\/items$/);
  if (items) return (find(Number(items[1]))?.items ?? []).map(([type_id, quantity, is_included], i) => ({ record_id: i + 1, type_id, quantity, is_included, is_singleton: false }));
  const bids = path.match(/^\/(?:characters|corporations)\/\d+\/contracts\/(\d+)\/bids$/);
  if (bids) return (find(Number(bids[1]))?.bids ?? []).map(([bidder_id, amount, ago], i) => ({ bid_id: i + 1, bidder_id, amount, date_issued: iso(now - ago * HOUR) }));
  if (path === `/corporations/${DEMO_CORP}/wallets`) return DIVISIONS.map(([division, balance]) => ({ division, balance }));
  if (path === `/corporations/${DEMO_CORP}/divisions`) { const names = DIVISION_NAMES(); return { wallet: DIVISIONS.map(([division]) => ({ division, name: names[division - 1] || undefined })), hangar: [] }; }
  const journal = path.match(new RegExp(`^/corporations/${DEMO_CORP}/wallets/(\\d+)/journal$`));
  if (journal) return corpJournal(Number(journal[1]), now);
  if (path === `/corporations/${DEMO_CORP}`) return { name: 'Rodna Collective', ticker: 'RODNA', member_count: MEMBERS.length + 1 };
  return undefined;
}
