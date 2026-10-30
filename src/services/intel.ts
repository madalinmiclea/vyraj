import { loadJson, saveJson } from '../storage';
import { allEveItems } from '../data/items';
import { fetchListedTypes, fetchPrices, fetchHistory, esiAggregates, lastDays, type Aggregates } from './market';
import { ESI, esiFetch } from './esiClient';
import { tx } from '../i18n';

export const ACCOUNTING = 16622;
export const BROKER_RELATIONS = 3446;
export const BASE_SALES_TAX = 7.5;
export const BASE_BROKER_FEE = 3;

export interface Fees {
  salesTax: number;
  brokerFee: number;
}

export function feesFromSkills(skills: Map<number, number>): Fees {
  const acc = skills.get(ACCOUNTING) ?? 0;
  const br = skills.get(BROKER_RELATIONS) ?? 0;
  return {
    salesTax: +(BASE_SALES_TAX * (1 - 0.11 * acc)).toFixed(3),
    brokerFee: +(BASE_BROKER_FEE - 0.3 * br).toFixed(2),
  };
}

export interface IntelRow {
  typeId: number;
  name: string;
  category: string;
  sellMin: number;
  buyMax: number;
  sellBook: number;
  buyBook: number;
  sellOrders: number;
  buyOrders: number;
  vol30: number;
  vol7: number;
  avg30: number;
  avg7: number;
  isk30: number;
  orders30: number;
  spark: number[];
}

export interface Scan {
  at: number;
  scanned: number;
  rows: IntelRow[];
}

export interface Progress {
  stage: string;
  done: number;
  total: number;
}

const SCAN_KEY = 'eve-intel:scan';
export const SCAN_STALE_MS = 60 * 60 * 1000;

export const loadScan = () => loadJson<Scan | null>(SCAN_KEY, null);

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>, onStep: () => void) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item).catch(() => {});
      onStep();
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function scanJita(depth: number, onProgress: (p: Progress) => void): Promise<Scan> {
  onProgress({ stage: tx('Iteme listate în Jita'), done: 0, total: 1 });
  const listed = await fetchListedTypes();
  const known = new Map(allEveItems.filter((i) => listed.has(i.t)).map((i) => [i.t, i]));
  const ids = [...known.keys()];

  const prices = new Map<number, Aggregates>();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  let done = 0;
  onProgress({ stage: tx('Ordine Jita'), done, total: chunks.length });
  await pool(chunks, 6, async (chunk) => {
    const res = await fetchPrices(chunk, { fresh: true });
    res.forEach((v, k) => prices.set(k, v));
  }, () => onProgress({ stage: tx('Ordine Jita'), done: ++done, total: chunks.length }));

  const candidates = [...prices.entries()]
    .filter(([, p]) => p.sellMin > 0 && p.buyMax > 0 && p.sellMin < p.buyMax * 20)
    .map(([id, p]) => ({ id, p, score: Math.sqrt(p.buyMax * p.buyVolume * p.sellMin * Math.min(p.sellVolume, p.buyVolume * 5)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, depth);

  const rows: IntelRow[] = [];
  done = 0;
  onProgress({ stage: tx('Istoric tranzacții'), done, total: candidates.length });
  await pool(candidates, 8, async ({ id, p }) => {
    const hist = lastDays(await fetchHistory(id), 30);
    if (!hist.length) return;
    const last7 = lastDays(hist, 7);
    const item = known.get(id)!;
    rows.push({
      typeId: id,
      name: item.n.trim(),
      category: item.c,
      sellMin: p.sellMin,
      buyMax: p.buyMax,
      sellBook: p.sellVolume,
      buyBook: p.buyVolume,
      sellOrders: p.sellOrders,
      buyOrders: p.buyOrders,
      vol30: hist.reduce((a, d) => a + d.volume, 0) / 30,
      vol7: last7.reduce((a, d) => a + d.volume, 0) / 7,
      avg30: avg(hist.map((d) => d.average)),
      avg7: avg(last7.map((d) => d.average)),
      isk30: hist.reduce((a, d) => a + d.volume * d.average, 0) / 30,
      orders30: hist.reduce((a, d) => a + d.order_count, 0) / 30,
      spark: hist.map((d) => +d.average.toPrecision(5)),
    });
  }, () => onProgress({ stage: tx('Istoric tranzacții'), done: ++done, total: candidates.length }));

  const scan = { at: Date.now(), scanned: ids.length, rows };
  saveJson(SCAN_KEY, scan);
  return scan;
}

export const priceTrend = (r: IntelRow) => (r.avg30 > 0 ? (r.avg7 / r.avg30 - 1) * 100 : 0);
export const volumeTrend = (r: IntelRow) => (r.vol30 > 0 ? (r.vol7 / r.vol30 - 1) * 100 : 0);
export const bookPressure = (r: IntelRow) => {
  const b = r.buyBook * r.buyMax, s = r.sellBook * r.sellMin;
  return b + s > 0 ? (b / (b + s)) * 100 : 50;
};

export function orderFlip(buy: number, sell: number, fees: Fees) {
  if (!(buy > 0 && sell > 0)) return { unit: 0, margin: 0, cost: 0, valid: false };
  const broker = fees.brokerFee / 100;
  const tax = fees.salesTax / 100;
  const cost = buy * (1 + broker);
  const unit = sell * (1 - tax - broker) - cost;
  return { unit, margin: (unit / cost) * 100, cost, valid: true };
}

export function instantFlip(buy: number, sell: number, fees: Fees) {
  if (!(buy > 0 && sell > 0)) return { unit: 0, margin: 0, valid: false };
  const unit = sell * (1 - fees.salesTax / 100) - buy;
  return { unit, margin: (unit / buy) * 100, valid: true };
}

export function flipProfit(r: IntelRow, fees: Fees) {
  const { unit, margin, cost } = orderFlip(r.buyMax, r.sellMin, fees);
  return { unit, margin, cost };
}

export const netMarginPct = (r: IntelRow, fees: Fees) => flipProfit(r, fees).margin;

export function stationTrade(r: IntelRow, fees: Fees, share: number) {
  const { unit, margin, cost } = flipProfit(r, fees);
  const units = r.vol30 * (share / 100);
  return { unit, margin, units, daily: unit * units, capital: units * cost };
}

export interface Hub {
  id: string;
  name: string;
  station: number;
  region: number;
}

export const HUBS: Hub[] = [
  { id: 'amarr', name: 'Amarr', station: 60008494, region: 10000043 },
  { id: 'dodixie', name: 'Dodixie', station: 60011866, region: 10000032 },
  { id: 'rens', name: 'Rens', station: 60004588, region: 10000030 },
  { id: 'hek', name: 'Hek', station: 60005686, region: 10000042 },
];

const CUSTOM_HUBS_KEY = 'eve-intel:custom-hubs';

export const customHubs = () => loadJson<Hub[]>(CUSTOM_HUBS_KEY, []);
export const allHubs = (): Hub[] => [...HUBS, ...customHubs()];

export function saveCustomHubs(list: Hub[]) {
  saveJson(CUSTOM_HUBS_KEY, list);
}

export interface SystemStations { system: string; region: number; stations: { id: number; name: string }[] }

export async function systemStations(name: string): Promise<SystemStations> {
  const ids = await esiFetch(`${ESI}/universe/ids/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([name.trim()]) });
  const found = ids.ok ? ((await ids.json()) as { systems?: { id: number; name: string }[] }).systems?.[0] : undefined;
  if (!found) throw new Error(tx('Nu găsesc sistemul „{name}”. Scrie numele exact, ca în joc.', { name: name.trim() }));
  const sys = await (await esiFetch(`${ESI}/universe/systems/${found.id}/`)).json() as { stations?: number[]; constellation_id: number };
  const con = await (await esiFetch(`${ESI}/universe/constellations/${sys.constellation_id}/`)).json() as { region_id: number };
  const stationIds = sys.stations ?? [];
  if (!stationIds.length) throw new Error(tx('{name} nu are stații NPC. Prețurile se citesc doar din stații NPC.', { name: found.name }));
  const res = await esiFetch(`${ESI}/universe/names/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stationIds) });
  const names = res.ok ? (await res.json()) as { id: number; name: string }[] : [];
  return { system: found.name, region: con.region_id, stations: stationIds.map((id) => ({ id, name: names.find((n) => n.id === id)?.name ?? String(id) })) };
}

export interface HubPrice {
  sellMin: number;
  buyMax: number;
  sellBook: number;
  buyBook: number;
  sellOrders: number;
  buyOrders: number;
}

const HUB_KEY = 'eve-intel:hub-prices';
type HubStore = Record<string, { at: number; p: Record<string, number[]> }>;
let hubStore: HubStore | null = null;
const hubs = () => (hubStore ??= loadJson<HubStore>(HUB_KEY, {}));

export function hubPricesAt(hub: Hub): number {
  return hubs()[hub.id]?.at ?? 0;
}

export function forgetHubPrices(hub: Hub) {
  delete hubs()[hub.id];
  saveJson(HUB_KEY, hubs());
}

export async function fetchHubPrices(hub: Hub, typeIds: number[], { fresh = false }: { fresh?: boolean } = {}): Promise<Map<number, HubPrice>> {
  const entry = fresh ? undefined : hubs()[hub.id];
  const out = new Map<number, HubPrice>();
  const missing: number[] = [];
  for (const id of new Set(typeIds)) {
    const v = entry?.p[id];
    if (v) out.set(id, { sellMin: v[0], buyMax: v[1], sellBook: v[2], buyBook: v[3], sellOrders: v[4], buyOrders: v[5] });
    else missing.push(id);
  }
  if (!missing.length) return out;
  const got = new Map<number, HubPrice>();
  const chunks: number[][] = [];
  for (let i = 0; i < missing.length; i += 100) chunks.push(missing.slice(i, i + 100));
  await pool(chunks, 4, async (chunk) => {
    const json = await fetch(`https://market.fuzzwork.co.uk/aggregates/?station=${hub.station}&types=${chunk.join(',')}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    if (!json) {
      await Promise.all(chunk.map(async (id) => {
        const a = await esiAggregates(hub.region, id, hub.station).catch(() => null);
        if (a) got.set(id, { sellMin: a.sellMin, buyMax: a.buyMax, sellBook: a.sellVolume, buyBook: a.buyVolume, sellOrders: a.sellOrders, buyOrders: a.buyOrders });
      }));
      return;
    }
    for (const id of chunk) {
      const d = json[id] ?? {};
      got.set(id, {
        sellMin: parseFloat(d.sell?.min || '0'),
        buyMax: parseFloat(d.buy?.max || '0'),
        sellBook: parseFloat(d.sell?.volume || '0'),
        buyBook: parseFloat(d.buy?.volume || '0'),
        sellOrders: parseFloat(d.sell?.orderCount || '0'),
        buyOrders: parseFloat(d.buy?.orderCount || '0'),
      });
    }
  }, () => {});
  got.forEach((v, k) => out.set(k, v));
  if (!fresh && got.size) {
    const store = hubs();
    const cur = store[hub.id] ?? { at: Date.now(), p: {} };
    got.forEach((v, k) => { cur.p[k] = [v.sellMin, v.buyMax, v.sellBook, v.buyBook, v.sellOrders, v.buyOrders]; });
    store[hub.id] = cur;
    saveJson(HUB_KEY, store);
  }
  return out;
}

export interface HaulRow {
  row: IntelRow;
  direction: 'out' | 'in';
  buy: number;
  sell: number;
  unit: number;
  margin: number;
  m3: number;
  perM3: number;
  depth: number;
}

export function haulRoutes(rows: IntelRow[], hubPrices: Map<number, HubPrice>, fees: Fees, volumeOf: (typeId: number) => number): HaulRow[] {
  const out: HaulRow[] = [];
  for (const r of rows) {
    const h = hubPrices.get(r.typeId);
    if (!h) continue;
    const m3 = volumeOf(r.typeId);
    const push = (direction: 'out' | 'in', buy: number, sell: number, depth: number) => {
      const { unit, margin, valid } = instantFlip(buy, sell, fees);
      if (!valid || unit <= 0) return;
      out.push({ row: r, direction, buy, sell, unit, margin, m3, perM3: m3 > 0 ? unit / m3 : 0, depth });
    };
    push('out', r.sellMin, h.buyMax, h.buyBook);
    push('in', h.sellMin, r.buyMax, Math.min(h.sellBook, r.buyBook));
  }
  return out;
}

const VOLUME_KEY = 'eve-intel:packaged-volume';

export async function fetchPackagedVolumes(typeIds: number[]): Promise<Map<number, number>> {
  const cache = loadJson<Record<string, number>>(VOLUME_KEY, {});
  const missing = [...new Set(typeIds)].filter((id) => cache[id] == null);
  let changed = false;
  await pool(missing, 6, async (id) => {
    const res = await esiFetch(`${ESI}/universe/types/${id}/`);
    if (!res.ok) return;
    const t = (await res.json()) as { packaged_volume?: number; volume?: number };
    const v = t.packaged_volume ?? t.volume;
    if (typeof v === 'number' && v > 0) { cache[id] = v; changed = true; }
  }, () => {});
  if (changed) saveJson(VOLUME_KEY, cache);
  return new Map(typeIds.filter((id) => cache[id] != null).map((id) => [id, cache[id]]));
}
