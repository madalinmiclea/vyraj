import { loadSde, Category, type Sde } from '../data/sde';
import { loadItems, allEveItems } from '../data/items';
import { spPerMinute, type Attributes } from '../character/training';
import { DEMO_ID, isDemoAuth, demoSystem } from './identity';
import { tx } from '../i18n';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const TICK = 20 * MIN;

const HOME = 60011866;
const JITA = 60003760;
const CITADEL = 1_035_466_617_946;
const CITADEL_SYSTEM = 30001261;
const SYSTEMS: [number, string][] = [[30001261, 'Y-W1Q3'], [30001262, 'Y6-HPG'], [30001264, 'KK-L97']];
const CONCORD = 1000125;

const ATTRIBUTES: Attributes = { charisma: 19, intelligence: 24, memory: 24, perception: 23, willpower: 21 };

const NPCS = {
  bs: [[23337, 862_500], [23339, 712_500], [23341, 975_000], [23342, 637_500]],
  bc: [[23321, 135_000], [23322, 112_500], [23324, 157_500]],
  cr: [[11928, 78_750], [11930, 67_500], [11931, 90_000]],
  sm: [[23314, 18_000], [23315, 22_500], [2385, 15_000], [10266, 11_250]],
  rare: [[13586, 1_875_000], [23349, 3_250_000]],
} as const;

const FORCED_V = [
  'Gallente Cruiser', 'Heavy Assault Cruisers', 'Drones', 'Drone Interfacing', 'Heavy Drone Operation', 'Medium Drone Operation', 'Light Drone Operation',
  'Drone Sharpshooting', 'Drone Durability', 'Drone Navigation', 'Drone Avionics', 'Gallente Drone Specialization', 'Shield Management', 'Shield Operation',
  'Shield Upgrades', 'Tactical Shield Manipulation', 'Capacitor Management', 'Capacitor Systems Operation', 'CPU Management', 'Power Grid Management',
  'Navigation', 'Acceleration Control', 'Evasive Maneuvering', 'Spaceship Command', 'Gallente Frigate', 'Gallente Destroyer', 'Mining', 'Mining Frigate',
  'Electronics Upgrades', 'Engineering', 'Mechanics', 'Hull Upgrades', 'Weapon Upgrades', 'Advanced Weapon Upgrades', 'Industry', 'Science', 'Trade',
];

const QUEUE = ['Gallente Battleship', 'Thermodynamics', 'Shield Compensation', 'Sentry Drone Interfacing'];

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

const pick = <T>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length)];
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

let world: Promise<{ sde: Sde; byName: Map<string, number> }> | null = null;

function loadWorld() {
  world ??= Promise.all([loadSde(), loadItems()]).then(([sde]) => {
    const byName = new Map<string, number>();
    for (const i of allEveItems) byName.set(i.n.toLowerCase(), i.t);
    return { sde, byName };
  });
  return world;
}

type World = Awaited<ReturnType<typeof loadWorld>>;

const idOf = (w: World, name: string) => w.sde.findType(name)?.id ?? w.byName.get(name.toLowerCase());

const spAt = (rank: number, level: number) => (level <= 0 ? 0 : Math.ceil(250 * rank * Math.pow(32, (level - 1) / 2)));

function skillLevels(w: World): Map<number, { level: number; rank: number }> {
  const forced = new Set(FORCED_V.map((n) => idOf(w, n)).filter((x): x is number => x != null));
  const queued = new Set(QUEUE.map((n) => idOf(w, n)).filter((x): x is number => x != null));
  const rankAttr = w.sde.attrId('skillTimeConstant');
  const out = new Map<number, { level: number; rank: number }>();
  for (const t of w.sde.typesInCategory(Category.Skill)) {
    const rank = w.sde.baseAttr(t.id, rankAttr) || 1;
    const r = rng(t.id * 2654435761)();
    let level = forced.has(t.id) ? 5 : rank >= 10 ? 0 : r < 0.22 ? 0 : r < 0.36 ? 3 : r < 0.74 ? 4 : 5;
    if (queued.has(t.id)) level = Math.min(level, 3);
    if (queued.has(t.id) && level === 0) level = 3;
    if (level) out.set(t.id, { level, rank });
  }
  return out;
}

function skills(w: World) {
  const list = [...skillLevels(w)].map(([id, s]) => ({ skill_id: id, active_skill_level: s.level, trained_skill_level: s.level, skillpoints_in_skill: spAt(s.rank, s.level) }));
  return { skills: list, total_sp: list.reduce((a, s) => a + s.skillpoints_in_skill, 0) + 350_000, unallocated_sp: 350_000 };
}

function skillQueue(w: World, now: number) {
  const levels = skillLevels(w);
  let at = Math.floor(now / HOUR) * HOUR - 3 * HOUR;
  const out: Record<string, unknown>[] = [];
  QUEUE.map((n) => idOf(w, n)).filter((x): x is number => x != null && levels.has(x)).forEach((id, i) => {
    const s = levels.get(id)!;
    const from = spAt(s.rank, s.level);
    const to = spAt(s.rank, s.level + 1);
    const minutes = (to - from) / spPerMinute(w.sde, id, ATTRIBUTES);
    const start = at;
    const finish = start + minutes * MIN;
    out.push({ skill_id: id, finished_level: s.level + 1, queue_position: i, start_date: iso(start), finish_date: iso(finish), training_start_sp: from, level_start_sp: from, level_end_sp: to });
    at = finish;
  });
  return out;
}

function implants(w: World) {
  return ['Ocular Filter - Basic', 'Memory Augmentation - Basic', 'Neural Boost - Basic', 'Cybernetic Subprocessor - Basic'].map((n) => idOf(w, n)).filter((x): x is number => x != null);
}

interface Slots { hi?: string[]; med?: string[]; lo?: string[]; rig?: string[]; drones?: [string, number][]; cargo?: [string, number][] }

function fitItems(w: World, shipId: number, slots: Slots) {
  const count = (attr: string) => Math.round(w.sde.baseAttr(shipId, w.sde.attrId(attr)) || 0);
  const out: { type_id: number; flag: string; quantity: number }[] = [];
  const add = (names: string[] | undefined, flag: string, max: number) => (names ?? []).slice(0, max).forEach((n, i) => {
    const id = idOf(w, n);
    if (id != null) out.push({ type_id: id, flag: `${flag}${i}`, quantity: 1 });
  });
  add(slots.hi, 'HiSlot', count('hiSlots'));
  add(slots.med, 'MedSlot', count('medSlots'));
  add(slots.lo, 'LoSlot', count('lowSlots'));
  add(slots.rig, 'RigSlot', count('rigSlots'));
  for (const [n, q] of slots.drones ?? []) { const id = idOf(w, n); if (id != null) out.push({ type_id: id, flag: 'DroneBay', quantity: q }); }
  for (const [n, q] of slots.cargo ?? []) { const id = idOf(w, n); if (id != null) out.push({ type_id: id, flag: 'Cargo', quantity: q }); }
  return out;
}

const ISHTAR: Slots = {
  med: ['Large Shield Extender II', 'Large Shield Extender II', 'Multispectrum Shield Hardener II', '10MN Afterburner II', 'Omnidirectional Tracking Link II'],
  lo: ['Drone Damage Amplifier II', 'Drone Damage Amplifier II', 'Drone Damage Amplifier II', 'Drone Damage Amplifier II', 'Power Diagnostic System II'],
  hi: ['Drone Link Augmentor II'],
  rig: ['Medium Core Defense Field Extender I', 'Medium Core Defense Field Extender I'],
  drones: [['Ogre II', 5], ['Hammerhead II', 5], ['Hobgoblin II', 5]],
  cargo: [['Nanite Repair Paste', 50]],
};

const VENTURE: Slots = { hi: ['Miner II', 'Miner II'], med: ['1MN Afterburner II', 'Survey Scanner II'], lo: ['Mining Laser Upgrade II'] };

function fittings(w: World) {
  const ishtar = idOf(w, 'Ishtar');
  const venture = idOf(w, 'Venture');
  const out: Record<string, unknown>[] = [];
  if (ishtar) out.push({ fitting_id: 7001, name: 'Ishtar anomalies', description: '', ship_type_id: ishtar, items: fitItems(w, ishtar, ISHTAR) });
  if (venture) out.push({ fitting_id: 7002, name: 'Venture mining', description: '', ship_type_id: venture, items: fitItems(w, venture, VENTURE) });
  return out;
}

interface Asset { item_id: number; type_id: number; location_id: number; location_flag: string; location_type: string; quantity: number; is_singleton: boolean; is_blueprint_copy?: boolean }

const SHIP_ITEM = 1_050_000_000_001;

function assets(w: World): Asset[] {
  const out: Asset[] = [];
  let next = 1_050_000_000_100;
  const put = (name: string, location: number, type: string, quantity = 1, singleton = false, flag = 'Hangar', item?: number) => {
    const id = idOf(w, name);
    if (id == null) return 0;
    const item_id = item ?? next++;
    out.push({ item_id, type_id: id, location_id: location, location_flag: flag, location_type: type, quantity, is_singleton: singleton });
    return item_id;
  };
  const ship = (name: string, slots: Slots, location: number, type: string, item?: number) => {
    const shipItem = put(name, location, type, 1, true, 'Hangar', item);
    const shipId = idOf(w, name);
    if (!shipItem || !shipId) return;
    for (const f of fitItems(w, shipId, slots)) out.push({ item_id: next++, type_id: f.type_id, location_id: shipItem, location_flag: f.flag, location_type: 'item', quantity: f.quantity, is_singleton: f.flag.includes('Slot') });
  };
  ship('Ishtar', ISHTAR, CITADEL, 'item', SHIP_ITEM);
  ship('Venture', VENTURE, HOME, 'station');
  put('Drake', JITA, 'station');
  put('Retriever', HOME, 'station');
  put('Ogre II', CITADEL, 'item', 10);
  put('Nanite Repair Paste', CITADEL, 'item', 400);
  put('Large Shield Extender II', JITA, 'station', 6);
  put('Drone Damage Amplifier II', HOME, 'station', 4);
  put('Hobgoblin I', HOME, 'station', 40);
  put('Veldspar', HOME, 'station', 184_000);
  put('Tritanium', HOME, 'station', 520_000);
  put('PLEX', HOME, 'station', 30);
  return out;
}

interface Entry { id: number; date: string; ref_type: string; amount: number; balance: number; description: string; reason?: string; context_id?: number; context_id_type?: string; first_party_id?: number; second_party_id?: number }
interface Trade { transaction_id: number; type_id: number; is_buy: boolean; date: string; quantity: number; unit_price: number; client_id: number; location_id: number; journal_ref_id: number; is_personal: boolean }

const LOOT: [string, number][] = [['Large Shield Extender II', 1_650_000], ['Ballistic Control System II', 1_120_000], ['Multispectrum Shield Hardener II', 980_000], ['Ogre II', 1_380_000]];
const SUPPLIES: [string, number][] = [['Nanite Repair Paste', 11_800], ['Hammerhead II', 610_000]];
const START_BALANCE = 1_240_000_000;

function ledger(w: World, now: number, name: string) {
  const firstDay = Math.floor(now / DAY) - 29;
  const raw: Omit<Entry, 'balance'>[] = [];
  const trades: Trade[] = [];
  const entry = (t: number, n: number, e: Omit<Entry, 'balance' | 'id' | 'date'>) => {
    if (t > now) return 0;
    const id = 24_000_000_000 + Math.floor(t / 1000) * 10 + n;
    raw.push({ id, date: iso(t), ...e });
    return id;
  };
  for (let d = firstDay; d <= firstDay + 29; d++) {
    const r = rng(d * 7919);
    const day = d * DAY;
    const [system, sysName] = pick(r, SYSTEMS);
    if (r() < 0.74) {
      const sessions = r() < 0.3 ? 2 : 1;
      for (let s = 0; s < sessions; s++) {
        let t = day + (16 + Math.floor(r() * 5) + s * 3) * HOUR + Math.floor(r() * 3) * TICK;
        const ticks = 4 + Math.floor(r() * 7);
        let session = 0;
        for (let k = 0; k < ticks; k++, t += TICK) {
          const kills = new Map<number, number>();
          const add = (list: readonly (readonly [number, number])[], lo: number, hi: number) => {
            const n = lo + Math.floor(r() * (hi - lo + 1));
            for (let i = 0; i < n; i++) { const [id] = pick(r, list); kills.set(id, (kills.get(id) ?? 0) + 1); }
          };
          add(NPCS.bs, 1, 4);
          add(NPCS.bc, 0, 3);
          add(NPCS.cr, 0, 2);
          add(NPCS.sm, 0, 3);
          if (r() < 0.04) add(NPCS.rare, 1, 1);
          const bounty = Object.fromEntries([...NPCS.bs, ...NPCS.bc, ...NPCS.cr, ...NPCS.sm, ...NPCS.rare]) as Record<number, number>;
          const amount = [...kills].reduce((a, [id, n]) => a + bounty[id] * n, 0);
          session += amount;
          entry(t, 1, { ref_type: 'bounty_prizes', amount, description: `${name} got bounty prizes for killing pirates in ${sysName}`, reason: [...kills].map(([id, n]) => `${id}: ${n}`).join(','), context_id: system, context_id_type: 'system_id', first_party_id: CONCORD, second_party_id: DEMO_ID });
        }
        if (r() < 0.5) entry(t + 5 * MIN, 2, { ref_type: 'ess_escrow_transfer', amount: Math.round(session * 0.12), description: `ESS Escrow Transfer`, context_id: system, context_id_type: 'system_id', first_party_id: CONCORD, second_party_id: DEMO_ID });
      }
    }
    entry(day + 9 * HOUR + Math.floor(r() * 6) * HOUR, 3, { ref_type: 'daily_goal_payouts', amount: 150_000, description: 'Daily Goal Payout', first_party_id: CONCORD, second_party_id: DEMO_ID });
    if (d % 3 === 0) {
      const t = day + 22 * HOUR + 15 * MIN;
      const [lootName, price] = pick(r, LOOT);
      const typeId = idOf(w, lootName);
      if (typeId) {
        const quantity = 3 + Math.floor(r() * 12);
        const unit = Math.round(price * (0.94 + r() * 0.1));
        const ref = entry(t, 4, { ref_type: 'market_transaction', amount: quantity * unit, description: `Market: ${name} sold stuff in Jita`, first_party_id: 2_112_000_001, second_party_id: DEMO_ID });
        if (ref) {
          trades.push({ transaction_id: 6_100_000_000 + d * 10 + 1, type_id: typeId, is_buy: false, date: iso(t), quantity, unit_price: unit, client_id: 2_112_000_001, location_id: JITA, journal_ref_id: ref, is_personal: true });
          entry(t + 1000, 5, { ref_type: 'transaction_tax', amount: -Math.round(quantity * unit * 0.036), description: 'Sales tax', first_party_id: DEMO_ID, second_party_id: CONCORD });
        }
      }
    }
    if (d % 4 === 1) {
      const t = day + 15 * HOUR + 40 * MIN;
      const [supName, price] = pick(r, SUPPLIES);
      const typeId = idOf(w, supName);
      if (typeId) {
        const quantity = supName.startsWith('Nanite') ? 200 : 5;
        const ref = entry(t, 6, { ref_type: 'market_transaction', amount: -quantity * price, description: `Market: ${name} bought stuff in Jita`, first_party_id: DEMO_ID, second_party_id: 2_112_000_002 });
        if (ref) trades.push({ transaction_id: 6_100_000_000 + d * 10 + 2, type_id: typeId, is_buy: true, date: iso(t), quantity, unit_price: price, client_id: 2_112_000_002, location_id: JITA, journal_ref_id: ref, is_personal: true });
      }
    }
    if (d % 5 === 2) entry(day + 14 * HOUR, 7, { ref_type: 'brokers_fee', amount: -Math.round(300_000 + r() * 600_000), description: 'Brokers fee', first_party_id: DEMO_ID, second_party_id: CONCORD });
    if (d % 4 === 3) entry(day + 12 * HOUR, 8, { ref_type: 'planetary_export_tax', amount: -Math.round(900_000 + r() * 700_000), description: 'Planetary Export Tax', first_party_id: DEMO_ID, second_party_id: CONCORD });
    if (d % 3 === 1) entry(day + 13 * HOUR, 9, { ref_type: 'industry_job_tax', amount: -Math.round(250_000 + r() * 400_000), description: 'Industry Job Tax', first_party_id: DEMO_ID, second_party_id: CONCORD });
    if (d % 9 === 4) entry(day + 20 * HOUR, 0, { ref_type: 'skill_purchase', amount: -Math.round(18_000_000 + r() * 30_000_000), description: 'Skill purchase', first_party_id: DEMO_ID, second_party_id: CONCORD });
  }
  raw.sort((a, b) => a.id - b.id);
  let balance = START_BALANCE;
  const journal: Entry[] = raw.map((e) => { balance += e.amount; return { ...e, balance }; });
  return { journal: journal.reverse(), trades: trades.sort((a, b) => b.transaction_id - a.transaction_id), balance };
}

function orders(w: World, now: number) {
  const row = (n: number, name: string, buy: boolean, price: number, total: number, remain: number, ageH: number) => {
    const id = idOf(w, name);
    return id == null ? null : { order_id: 6_900_000_000 + n, type_id: id, region_id: 10000002, location_id: JITA, range: buy ? 'station' : 'region', is_buy_order: buy, price, volume_total: total, volume_remain: remain, min_volume: 1, issued: iso(now - ageH * HOUR), duration: 90, escrow: buy ? price * remain : undefined, is_corporation: false };
  };
  return [row(1, 'Large Shield Extender II', false, 1_689_000, 10, 6, 30), row(2, 'Ogre II', false, 1_412_000, 15, 15, 5), row(3, 'Nanite Repair Paste', true, 11_250, 2000, 1400, 50)].filter(Boolean);
}

function orderHistory(w: World, now: number) {
  return orders(w, now).map((o, i) => o && { ...o, order_id: 6_800_000_000 + i, issued: iso(now - (6 + i * 3) * DAY), volume_remain: 0, state: i === 1 ? 'cancelled' : 'expired' });
}

function blueprints(w: World) {
  const row = (n: number, name: string, me: number, te: number, runs: number, quantity: number) => {
    const id = idOf(w, name);
    return id == null ? null : { item_id: 1_050_000_009_000 + n, type_id: id, location_id: HOME, location_flag: 'Hangar', material_efficiency: me, time_efficiency: te, quantity, runs };
  };
  return [row(1, 'Hobgoblin I Blueprint', 10, 20, -1, -1), row(2, 'Ogre II Blueprint', 2, 4, 10, -2), row(3, 'Drake Blueprint', 8, 16, -1, -1), row(4, 'Nanite Repair Paste Blueprint', 10, 20, -1, -1), row(5, 'Hammerhead I Blueprint', 6, 12, -1, -1)].filter(Boolean);
}

function jobs(w: World, now: number) {
  const row = (n: number, activity: number, bpName: string, productName: string | null, runs: number, startH: number, lengthH: number, cost: number) => {
    const bp = idOf(w, bpName);
    if (bp == null) return null;
    const start = Math.floor(now / HOUR) * HOUR - startH * HOUR;
    return { job_id: 5_800_000 + n, activity_id: activity, blueprint_type_id: bp, product_type_id: productName ? idOf(w, productName) : bp, runs, licensed_runs: runs, cost, status: 'active', start_date: iso(start), end_date: iso(start + lengthH * HOUR), facility_id: HOME, blueprint_location_id: HOME, output_location_id: HOME, installer_id: DEMO_ID, station_id: HOME, duration: lengthH * 3600, blueprint_id: 1_050_000_009_100 + n };
  };
  return [row(1, 1, 'Hobgoblin I Blueprint', 'Hobgoblin I', 100, 3, 9, 412_000), row(2, 4, 'Drake Blueprint', null, 1, 20, 31, 1_350_000), row(3, 1, 'Nanite Repair Paste Blueprint', 'Nanite Repair Paste', 20, 30, 26, 286_000)].filter(Boolean);
}

const PLANETS = [
  { planet_id: 40080195, solar_system_id: 30001261, product: 2267, schematic: 126, output: 2398, expiresH: 26, installH: 46 },
  { planet_id: 40080301, solar_system_id: 30001262, product: 2268, schematic: 121, output: 3645, expiresH: -3, installH: 69 },
];

function planets(now: number) {
  return PLANETS.map((p) => ({ planet_id: p.planet_id, planet_type: 'barren', solar_system_id: p.solar_system_id, upgrade_level: 4, num_pins: 7, last_update: iso(now - 7 * HOUR) }));
}

function planet(now: number, planetId: number) {
  const p = PLANETS.find((x) => x.planet_id === planetId);
  if (!p) return null;
  const base = planetId * 10;
  const factory = (i: number) => ({ pin_id: base + 3 + i, type_id: 2473, schematic_id: p.schematic, factory_details: { schematic_id: p.schematic }, latitude: 1, longitude: 1 });
  return {
    pins: [
      { pin_id: base + 1, type_id: 2524, contents: [], latitude: 1, longitude: 1 },
      { pin_id: base + 2, type_id: 2848, install_time: iso(now - p.installH * HOUR), expiry_time: iso(now + p.expiresH * HOUR), last_cycle_start: iso(now - 20 * MIN), extractor_details: { cycle_time: 1800, product_type_id: p.product, qty_per_cycle: 6420, head_radius: 0.02, heads: Array.from({ length: 10 }, (_, i) => ({ head_id: i, latitude: 1, longitude: 1 })) }, latitude: 1, longitude: 1 },
      factory(0), factory(1), factory(2),
      { pin_id: base + 8, type_id: 2544, contents: [{ type_id: p.output, amount: 2400 + (planetId % 7) * 300 }, { type_id: p.product, amount: 9000 }], latitude: 1, longitude: 1 },
      { pin_id: base + 9, type_id: 2541, contents: [{ type_id: p.product, amount: 21000 }], latitude: 1, longitude: 1 },
    ],
    links: [],
    routes: [],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-pages': '1' } });
}

export async function demoResponse(input: string, init?: RequestInit): Promise<Response | null> {
  const url = new URL(input);
  const path = url.pathname.replace(/^\/(latest|v\d+)\//, '/');
  if (new RegExp(`^/characters/${DEMO_ID}/?$`).test(path)) return json({ name: tx('Pilot demo'), corporation_id: 1000120, birthday: '2019-04-12T18:00:00Z', gender: 'female', race_id: 4, bloodline_id: 7, security_status: 2.4 });
  if (!isDemoAuth(new Headers(init?.headers).get('authorization'))) return null;
  const method = (init?.method ?? 'GET').toUpperCase();
  const w = await loadWorld();
  const now = Date.now();
  const structure = path.match(/^\/universe\/structures\/(\d+)\/?$/);
  if (structure) return Number(structure[1]) === CITADEL ? json({ name: 'Y-W1Q3 - Astrahus', solar_system_id: CITADEL_SYSTEM, type_id: 35832, owner_id: 1 }) : json({ error: 'Forbidden' }, 403);
  const m = path.match(/^\/characters\/(\d+)\/(.*?)\/?$/);
  if (!m || Number(m[1]) !== DEMO_ID) return json({ error: 'Not found' }, 404);
  const route = m[2];
  const name = JSON.parse(atob(new Headers(init?.headers).get('authorization')!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).name as string;
  switch (route) {
    case 'skills': return json(skills(w));
    case 'attributes': return json({ ...ATTRIBUTES, bonus_remaps: 1 });
    case 'implants': return json(implants(w));
    case 'skillqueue': return json(skillQueue(w, now));
    case 'fittings': return method === 'POST' ? json({ fitting_id: 7000 + Math.floor(Math.random() * 999) }, 201) : json(fittings(w));
    case 'assets': return json(assets(w));
    case 'assets/names': return json((JSON.parse(String(init?.body ?? '[]')) as number[]).filter((id) => id === SHIP_ITEM).map((id) => ({ item_id: id, name: 'Ishtar demo' })));
    case 'ship': { const id = idOf(w, 'Ishtar'); return json({ ship_item_id: SHIP_ITEM, ship_type_id: id, ship_name: 'Ishtar demo' }); }
    case 'location': { const sys = demoSystem(now); return json(sys === CITADEL_SYSTEM ? { solar_system_id: sys, structure_id: CITADEL } : { solar_system_id: sys }); }
    case 'online': return json({ online: true, last_login: iso(now - 2 * HOUR), logins: 812 });
    case 'wallet': return json(ledger(w, now, name).balance);
    case 'wallet/journal': return json(ledger(w, now, name).journal);
    case 'wallet/transactions': return json(ledger(w, now, name).trades);
    case 'loyalty/points': return json([{ corporation_id: 1000120, loyalty_points: 146_500 }, { corporation_id: 1000035, loyalty_points: 38_200 }]);
    case 'orders': return json(orders(w, now));
    case 'orders/history': return json(orderHistory(w, now));
    case 'blueprints': return json(blueprints(w));
    case 'industry/jobs': return json(jobs(w, now));
    case 'planets': return json(planets(now));
    default: {
      const pl = route.match(/^planets\/(\d+)$/);
      if (pl) { const body = planet(now, Number(pl[1])); return body ? json(body) : json({ error: 'Not found' }, 404); }
      return json([], 200);
    }
  }
}
