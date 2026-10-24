import { loadJson, saveJson } from '../storage';
import { tx } from '../i18n';
import { esiFetch } from './esiClient';
export const JITA_REGION = 10000002;
export const PLEX_TYPE_ID = 44992;
export const GLOBAL_PLEX_REGION = 19000001;
export const isGlobalMarket = (typeId: number) => typeId === PLEX_TYPE_ID;

export interface Aggregates {
  sellMin: number;
  sellMedian: number;
  sellVolume: number;
  sellOrders: number;
  buyMax: number;
  buyVolume: number;
  buyOrders: number;
}

interface FuzzworkSide {
  min?: string;
  max?: string;
  median?: string;
  volume?: string;
  orderCount?: string;
}

export async function resolveType(itemName: string): Promise<{ typeId: number; name: string }> {
  const hit = (await resolveIds([itemName]).catch(() => null))?.inventory_types?.[0];
  if (hit) return { typeId: hit.id, name: hit.name };
  const res = await fetch(`https://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(itemName)}`);
  const data = await res.json();
  if (!data.typeID) throw new Error(tx('Nu am găsit itemul „{name}”.', { name: itemName }));
  return { typeId: Number(data.typeID), name: data.typeName };
}

const num = (v: string | undefined) => parseFloat(v || '0');

function toAggregates(d: { sell?: FuzzworkSide; buy?: FuzzworkSide } = {}): Aggregates {
  return {
    sellMin: num(d.sell?.min),
    sellMedian: num(d.sell?.median),
    sellVolume: num(d.sell?.volume),
    sellOrders: num(d.sell?.orderCount),
    buyMax: num(d.buy?.max),
    buyVolume: num(d.buy?.volume),
    buyOrders: num(d.buy?.orderCount),
  };
}

export async function fetchJitaAggregates(typeId: number): Promise<Aggregates> {
  return (await fetchPrices([typeId])).get(typeId) ?? toAggregates();
}

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<number, { at: number; value: Aggregates }>();

async function fuzzworkChunk(chunk: number[]): Promise<Record<string, { sell?: FuzzworkSide; buy?: FuzzworkSide }> | null> {
  try {
    const res = await fetch(`https://market.fuzzwork.co.uk/aggregates/?region=${JITA_REGION}&types=${chunk.join(',')}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function fetchPrices(typeIds: number[]): Promise<Map<number, Aggregates>> {
  const now = Date.now();
  const out = new Map<number, Aggregates>();
  const missing: number[] = [];
  for (const id of new Set(typeIds)) {
    const hit = cache.get(id);
    if (hit && now - hit.at < CACHE_MS) out.set(id, hit.value);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const json = await fuzzworkChunk(chunk);
    if (!json) {
      const values = await Promise.all(chunk.map((id) => esiAggregates(isGlobalMarket(id) ? GLOBAL_PLEX_REGION : JITA_REGION, id).catch(() => null)));
      if (values.every((v) => v === null)) throw new Error(tx('Nu pot încărca prețurile nici de la Fuzzwork, nici de la ESI.'));
      chunk.forEach((id, j) => {
        const value = values[j] ?? toAggregates();
        cache.set(id, { at: now, value });
        out.set(id, value);
      });
      continue;
    }
    for (const id of chunk) {
      let value = toAggregates(json[id]);
      if (isGlobalMarket(id) && !value.sellMin && !value.buyMax) value = await esiAggregates(GLOBAL_PLEX_REGION, id).catch(() => value);
      cache.set(id, { at: now, value });
      out.set(id, value);
    }
  }
  return out;
}

interface EsiOrder {
  price: number;
  volume_remain: number;
  is_buy_order: boolean;
  location_id: number;
}

export async function esiAggregates(regionId: number, typeId: number, locationId?: number): Promise<Aggregates> {
  const url = (page: number) => `https://esi.evetech.net/latest/markets/${regionId}/orders/?datasource=tranquility&order_type=all&type_id=${typeId}&page=${page}`;
  const first = await esiFetch(url(1));
  if (!first.ok) throw new Error(`ESI market orders: ${first.status}`);
  const pages = Number(first.headers.get('x-pages')) || 1;
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => esiFetch(url(i + 2)).then((r) => r.json() as Promise<EsiOrder[]>)));
  const orders = [...(await first.json() as EsiOrder[]), ...rest.flat()].filter((o) => locationId == null || o.location_id === locationId);
  const sell = orders.filter((o) => !o.is_buy_order).sort((a, b) => a.price - b.price);
  const buy = orders.filter((o) => o.is_buy_order);
  const volume = (list: EsiOrder[]) => list.reduce((a, o) => a + o.volume_remain, 0);
  let median = 0;
  for (let i = 0, acc = 0, half = volume(sell) / 2; i < sell.length; i++) {
    acc += sell[i].volume_remain;
    if (acc >= half) { median = sell[i].price; break; }
  }
  return {
    sellMin: sell[0]?.price ?? 0,
    sellMedian: median,
    sellVolume: volume(sell),
    sellOrders: sell.length,
    buyMax: buy.reduce((m, o) => Math.max(m, o.price), 0),
    buyVolume: volume(buy),
    buyOrders: buy.length,
  };
}

export const typeIconUrl = (typeId: number, size = 64) => `https://images.evetech.net/types/${typeId}/icon?size=${size}`;
export const typeRenderUrl = (typeId: number, size = 256) => `https://images.evetech.net/types/${typeId}/render?size=${size}`;

const LISTED_KEY = 'eve-market:listed-types';
const LISTED_MS = 60 * 60 * 1000;

export async function fetchListedTypes(): Promise<Set<number>> {
  const cached = loadJson<{ at: number; ids: number[] } | null>(LISTED_KEY, null);
  if (cached && Date.now() - cached.at < LISTED_MS) return new Set([...cached.ids, PLEX_TYPE_ID]);
  const url = (page: number) => `https://esi.evetech.net/latest/markets/${JITA_REGION}/types/?datasource=tranquility&page=${page}`;
  const first = await esiFetch(url(1));
  if (!first.ok) throw new Error(`ESI market types: ${first.status}`);
  const pages = Number(first.headers.get('x-pages')) || 1;
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => esiFetch(url(i + 2)).then((r) => r.json() as Promise<number[]>)));
  const ids = [...(await first.json() as number[]), ...rest.flat(), PLEX_TYPE_ID];
  saveJson(LISTED_KEY, { at: Date.now(), ids });
  return new Set(ids);
}

export interface HistoryDay {
  date: string;
  average: number;
  highest: number;
  lowest: number;
  volume: number;
  order_count: number;
}

const historyCache = new Map<string, { at: number; value: HistoryDay[] }>();

export async function fetchHistory(typeId: number, regionId = JITA_REGION): Promise<HistoryDay[]> {
  const region = isGlobalMarket(typeId) ? GLOBAL_PLEX_REGION : regionId;
  const key = `${region}:${typeId}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.value;
  const res = await esiFetch(`https://esi.evetech.net/latest/markets/${region}/history/?datasource=tranquility&type_id=${typeId}`);
  if (!res.ok) throw new Error(`ESI market history: ${res.status}`);
  const value = ((await res.json()) as HistoryDay[]).sort((a, b) => a.date.localeCompare(b.date));
  historyCache.set(key, { at: Date.now(), value });
  return value;
}

export async function resolveIds(names: string[]): Promise<Record<string, { id: number; name: string }[]>> {
  const res = await esiFetch('https://esi.evetech.net/latest/universe/ids/?datasource=tranquility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(names) });
  if (!res.ok) throw new Error(`ESI universe/ids: ${res.status}`);
  return res.json();
}

export interface LpOffer {
  offer_id: number;
  type_id: number;
  quantity: number;
  lp_cost: number;
  isk_cost: number;
  ak_cost?: number;
  required_items: { type_id: number; quantity: number }[];
}

export async function fetchLpOffers(corporationId: number): Promise<LpOffer[]> {
  const res = await esiFetch(`https://esi.evetech.net/latest/loyalty/stores/${corporationId}/offers/?datasource=tranquility`);
  if (!res.ok) throw new Error(`ESI LP store: ${res.status}`);
  return res.json();
}
