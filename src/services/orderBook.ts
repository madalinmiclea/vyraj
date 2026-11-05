import { loadJson, saveJson, isDemo } from '../storage';
import { ESI, esiPages } from './esiClient';
import { universeNames } from '../character/esi';

export interface BookOrder {
  id: number;
  buy: boolean;
  price: number;
  remain: number;
  total: number;
  minVolume: number;
  locationId: number;
  systemId: number;
  regionId: number;
  range: string;
  issued: number;
  duration: number;
}

interface EsiBookOrder {
  order_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
  volume_total: number;
  min_volume: number;
  location_id: number;
  system_id: number;
  range: string;
  issued: string;
  duration: number;
}

export interface OrderBook {
  at: number;
  typeId: number;
  orders: BookOrder[];
  failed: number;
}

const books = new Map<string, OrderBook>();
const BOOKS_MAX = 30;
const bookKey = (typeId: number, regions: number[]) => `${typeId}:${regions.length === 1 ? regions[0] : 'all'}`;

export const cachedBook = (typeId: number, regions: number[]) => books.get(bookKey(typeId, regions)) ?? null;

const FIRST = [10000002, 10000043, 10000032, 10000030, 10000042];

type Step = (done: number, partial: OrderBook) => void;
const inflight = new Map<string, { promise: Promise<OrderBook>; listeners: Set<Step>; done: number; partial: OrderBook | null }>();

export function fetchOrderBook(typeId: number, regions: number[], onStep: Step): Promise<OrderBook> {
  const key = bookKey(typeId, regions);
  const running = inflight.get(key);
  if (running) {
    running.listeners.add(onStep);
    if (running.partial) onStep(running.done, running.partial);
    return running.promise;
  }
  const entry = { promise: Promise.resolve(null as unknown as OrderBook), listeners: new Set<Step>([onStep]), done: 0, partial: null as OrderBook | null };
  entry.promise = loadBook(typeId, regions, (done, partial) => {
    entry.done = done;
    entry.partial = partial;
    entry.listeners.forEach((fn) => fn(done, partial));
  }).finally(() => inflight.delete(key));
  inflight.set(key, entry);
  return entry.promise;
}

type WireOrder = [number, number, number, number, number, number, number, number, number, string, string, number];

const PROXY = `${(import.meta.env.VITE_R2Z2_URL || 'https://vyraj-r2z2.vyraj.workers.dev').replace(/\/+$/, '')}/book`;
const CHUNK = 23;

const fromWire = (o: WireOrder): BookOrder => ({
  id: o[0], buy: o[1] === 1, price: o[2], remain: o[3], total: o[4], minVolume: o[5],
  locationId: o[6], systemId: o[7], regionId: o[8], range: o[9], issued: Date.parse(o[10]), duration: o[11],
});

async function direct(typeId: number, region: number): Promise<BookOrder[]> {
  const rows = await esiPages<EsiBookOrder>((page) => `${ESI}/markets/${region}/orders/?order_type=all&type_id=${typeId}&page=${page}`, undefined, Infinity, { bulk: true });
  return rows.map((o) => ({
    id: o.order_id,
    buy: o.is_buy_order,
    price: o.price,
    remain: o.volume_remain,
    total: o.volume_total,
    minVolume: o.min_volume,
    locationId: o.location_id,
    systemId: o.system_id,
    regionId: region,
    range: o.range,
    issued: Date.parse(o.issued),
    duration: o.duration,
  }));
}

async function viaProxy(typeId: number, chunk: number[]): Promise<{ orders: BookOrder[]; failed: number[] }> {
  const res = await fetch(`${PROXY}?type=${typeId}&r=${chunk.join(',')}`);
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as { failed: number[]; orders: WireOrder[] };
  return { orders: data.orders.map(fromWire), failed: data.failed ?? [] };
}

async function loadBook(typeId: number, regions: number[], onStep: Step): Promise<OrderBook> {
  const orders: BookOrder[] = [];
  let done = 0;
  let failed = 0;
  const sorted = [...regions].sort((a, b) => (FIRST.includes(b) ? 1 : 0) - (FIRST.includes(a) ? 1 : 0));
  const step = (n: number) => { done += n; onStep(done, { at: Date.now(), typeId, orders, failed }); };
  const directAll = async (list: number[]) => {
    const queue = [...list];
    await Promise.all(Array.from({ length: Math.min(20, list.length) }, async () => {
      for (let region = queue.shift(); region != null; region = queue.shift()) {
        try {
          orders.push(...(await direct(typeId, region)));
        } catch {
          failed++;
        }
        step(1);
      }
    }));
  };
  if (isDemo()) await directAll(sorted);
  else {
    const chunks: number[][] = [];
    for (let i = 0; i < sorted.length; i += CHUNK) chunks.push(sorted.slice(i, i + CHUNK));
    await Promise.all(chunks.map(async (chunk) => {
      let got: { orders: BookOrder[]; failed: number[] } | null = null;
      try {
        got = await viaProxy(typeId, chunk);
      } catch {
        got = null;
      }
      if (!got) { await directAll(chunk); return; }
      orders.push(...got.orders);
      step(chunk.length - got.failed.length);
      if (got.failed.length) await directAll(got.failed);
    }));
  }
  if (failed === regions.length) throw new Error('ESI markets: no region answered');
  const book: OrderBook = { at: Date.now(), typeId, orders, failed };
  const key = bookKey(typeId, regions);
  books.delete(key);
  books.set(key, book);
  while (books.size > BOOKS_MAX) books.delete(books.keys().next().value!);
  return book;
}

const NAMES_KEY = 'eve-market:station-names';
const NAMES_MAX = 4000;
let names: Record<string, string> | null = null;
const nameStore = () => (names ??= loadJson<Record<string, string>>(NAMES_KEY, {}));

export const isStructure = (id: number) => id >= 1e12;
export const locationName = (id: number) => nameStore()[id] ?? '';
const tried = new Set<number>();

export async function resolveLocationNames(ids: number[]): Promise<boolean> {
  const store = nameStore();
  const missing = [...new Set(ids)].filter((id) => id > 0 && !store[id] && !tried.has(id));
  if (!missing.length) return false;
  missing.forEach((id) => tried.add(id));
  const got = await universeNames(missing).catch(() => new Map<number, string>());
  if (!got.size) return false;
  got.forEach((name, id) => { store[id] = name; });
  const keys = Object.keys(store);
  if (keys.length > NAMES_MAX) for (const k of keys.slice(0, keys.length - NAMES_MAX)) delete store[k];
  saveJson(NAMES_KEY, store);
  return true;
}
