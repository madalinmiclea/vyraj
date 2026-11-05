import { loadJson, saveJson } from '../storage';
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

export async function fetchOrderBook(typeId: number, regions: number[], onStep: (done: number) => void): Promise<OrderBook> {
  const orders: BookOrder[] = [];
  let done = 0;
  let failed = 0;
  const queue = [...regions];
  const worker = async () => {
    for (let region = queue.shift(); region != null; region = queue.shift()) {
      try {
        const rows = await esiPages<EsiBookOrder>((page) => `${ESI}/markets/${region}/orders/?order_type=all&type_id=${typeId}&page=${page}`);
        for (const o of rows) orders.push({
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
        });
      } catch {
        failed++;
      }
      onStep(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, regions.length) }, worker));
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
