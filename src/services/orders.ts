import { accessToken, hasScope } from '../character/sso';
import { rosterCharacters } from '../character/roster';
import { esiFetch } from './esiClient';
import { loadJson, saveJson } from '../storage';
import { allEveItems } from '../data/items';
import { compactISK, formatISK, toast } from '../ui/components';
import { tx } from '../i18n';

export const ORDERS_SCOPE = 'esi-markets.read_character_orders.v1';
export const ORDERS_EVENT = 'vyraj-orders-updated';
export const MODIFY_COOLDOWN = 5 * 60 * 1000;

const ESI = 'https://esi.evetech.net/latest';
const STATUS_KEY = 'eve-orders:status';
const NOTIFY_KEY = 'eve-orders:notify';
const MARKET_MS = 5 * 60 * 1000;
const CHAR_MS = 5 * 60 * 1000;

export interface CharacterOrder {
  order_id: number;
  type_id: number;
  region_id: number;
  location_id: number;
  range: string;
  is_buy_order?: boolean;
  price: number;
  volume_total: number;
  volume_remain: number;
  min_volume?: number;
  issued: string;
  duration: number;
  escrow?: number;
  is_corporation: boolean;
  state?: 'cancelled' | 'expired';
}

export interface TrackedOrder extends CharacterOrder {
  characterId: number;
  characterName: string;
}

interface PublicOrder {
  order_id: number;
  type_id: number;
  location_id: number;
  system_id: number;
  price: number;
  volume_remain: number;
  is_buy_order: boolean;
  range: string;
}

export type OrderStatus = 'best' | 'tied' | 'beaten' | 'unknown';

export interface Competition {
  status: OrderStatus;
  best: number | null;
  next: number | null;
  competitors: number;
  ahead: number;
  target: number | null;
}

export interface OrdersScan {
  at: number;
  orders: TrackedOrder[];
  competition: Map<number, Competition>;
  missingScope: string[];
  errors: string[];
}

export const typeName = (id: number) => allEveItems.find((i) => i.t === id)?.n.trim() ?? `Type ${id}`;

export function priceTick(price: number): number {
  if (!(price > 0)) return 0.01;
  return Math.max(0.01, 10 ** (Math.floor(Math.log10(price)) - 3));
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function steps(price: number, tick: number) {
  const q = price / tick;
  return { q, exact: Math.abs(q - Math.round(q)) < 1e-6 };
}

export function undercutPrice(price: number): number {
  if (price <= 0.01) return price;
  const tick = priceTick(price * (1 - 1e-9));
  const { q, exact } = steps(price, tick);
  return round2(((exact ? Math.round(q) : Math.ceil(q)) - 1) * tick);
}

export function overbidPrice(price: number): number {
  const tick = priceTick(price);
  const { q, exact } = steps(price, tick);
  return round2(((exact ? Math.round(q) : Math.floor(q)) + 1) * tick);
}

export const expiresAt = (o: CharacterOrder) => Date.parse(o.issued) + o.duration * 86_400_000;
export const modifiableAt = (o: CharacterOrder) => Date.parse(o.issued) + MODIFY_COOLDOWN;

export const orderCharacters = () => rosterCharacters().filter((c) => c.characterId != null && hasScope(c.characterId, ORDERS_SCOPE));

async function authedPages<T>(characterId: number, path: string, maxPages = 5): Promise<T[]> {
  const token = await accessToken(characterId);
  const get = async (page: number) => {
    const res = await esiFetch(`${ESI}${path}?datasource=tranquility&page=${page}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`ESI ${path}: ${res.status}`);
    return res;
  };
  const first = await get(1);
  const pages = Math.min(maxPages, Number(first.headers.get('x-pages')) || 1);
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => get(i + 2).then((r) => r.json() as Promise<T[]>)));
  return [...((await first.json()) as T[]), ...rest.flat()];
}

const charCache = new Map<number, { at: number; value: CharacterOrder[] }>();

export async function characterOrders(characterId: number, force = false): Promise<CharacterOrder[]> {
  const hit = charCache.get(characterId);
  if (!force && hit && Date.now() - hit.at < CHAR_MS) return hit.value;
  const value = await authedPages<CharacterOrder>(characterId, `/characters/${characterId}/orders/`, 1);
  charCache.set(characterId, { at: Date.now(), value });
  return value;
}

export function orderHistory(characterId: number): Promise<CharacterOrder[]> {
  return authedPages<CharacterOrder>(characterId, `/characters/${characterId}/orders/history/`, 3);
}

const marketCache = new Map<string, { at: number; value: Promise<PublicOrder[]> }>();

function regionOrders(regionId: number, typeId: number, buy: boolean, force: boolean): Promise<PublicOrder[]> {
  const key = `${regionId}:${typeId}:${buy ? 'buy' : 'sell'}`;
  const hit = marketCache.get(key);
  if (!force && hit && Date.now() - hit.at < MARKET_MS) return hit.value;
  const url = (page: number) => `${ESI}/markets/${regionId}/orders/?datasource=tranquility&order_type=${buy ? 'buy' : 'sell'}&type_id=${typeId}&page=${page}`;
  const value = (async () => {
    const first = await esiFetch(url(1));
    if (!first.ok) throw new Error(`ESI market orders: ${first.status}`);
    const pages = Number(first.headers.get('x-pages')) || 1;
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => esiFetch(url(i + 2)).then((r) => r.json() as Promise<PublicOrder[]>)));
    return [...((await first.json()) as PublicOrder[]), ...rest.flat()];
  })();
  marketCache.set(key, { at: Date.now(), value });
  value.catch(() => marketCache.delete(key));
  return value;
}

function compete(mine: TrackedOrder, book: PublicOrder[], own: Set<number>): Competition {
  const buy = Boolean(mine.is_buy_order);
  const system = book.find((o) => o.order_id === mine.order_id)?.system_id;
  const rivals = book.filter((o) => {
    if (own.has(o.order_id)) return false;
    if (!buy) return o.location_id === mine.location_id;
    if (o.location_id === mine.location_id || o.range === 'region') return true;
    return o.range !== 'station' && system != null && o.system_id === system;
  });
  if (!rivals.length) return { status: 'best', best: null, next: null, competitors: 0, ahead: 0, target: null };
  const better = (p: number) => (buy ? p > mine.price : p < mine.price);
  const prices = rivals.map((o) => o.price);
  const best = buy ? Math.max(...prices) : Math.min(...prices);
  const worse = prices.filter((p) => (buy ? p < mine.price : p > mine.price));
  const next = worse.length ? (buy ? Math.max(...worse) : Math.min(...worse)) : null;
  const ahead = rivals.filter((o) => better(o.price)).length;
  const status: OrderStatus = better(best) ? 'beaten' : best === mine.price ? 'tied' : 'best';
  const target = status === 'best' ? null : buy ? overbidPrice(best) : undercutPrice(best);
  return { status, best, next, competitors: rivals.length, ahead, target };
}

let last: OrdersScan | null = null;
let running: Promise<OrdersScan> | null = null;

export const lastScan = () => last;

async function runScan(force: boolean): Promise<OrdersScan> {
  const all = rosterCharacters();
  const chars = orderCharacters();
  const ok = new Set(chars.map((c) => c.characterId));
  const missingScope = all.filter((c) => !ok.has(c.characterId)).map((c) => c.name);
  const errors: string[] = [];
  const orders: TrackedOrder[] = [];
  await Promise.all(chars.map(async (c) => {
    try {
      const list = await characterOrders(c.characterId!, force);
      for (const o of list) orders.push({ ...o, characterId: c.characterId!, characterName: c.name });
    } catch (err) {
      errors.push(`${c.name}: ${(err as Error).message}`);
    }
  }));
  const own = new Set(orders.map((o) => o.order_id));
  const competition = new Map<number, Competition>();
  await Promise.all(orders.map(async (o) => {
    try {
      competition.set(o.order_id, compete(o, await regionOrders(o.region_id, o.type_id, Boolean(o.is_buy_order), force), own));
    } catch {
      competition.set(o.order_id, { status: 'unknown', best: null, next: null, competitors: 0, ahead: 0, target: null });
    }
  }));
  orders.sort((a, b) => typeName(a.type_id).localeCompare(typeName(b.type_id)));
  last = { at: Date.now(), orders, competition, missingScope, errors };
  notifyChanges(last);
  window.dispatchEvent(new Event(ORDERS_EVENT));
  return last;
}

export function scanOrders(force = false): Promise<OrdersScan> {
  if (!running) running = runScan(force).finally(() => { running = null; });
  return running;
}

export const notifyEnabled = () => loadJson<boolean>(NOTIFY_KEY, true);

export function setNotify(on: boolean) {
  saveJson(NOTIFY_KEY, on);
  if (on && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

function notifyChanges(scan: OrdersScan) {
  const prev = loadJson<Record<string, OrderStatus>>(STATUS_KEY, {});
  const next: Record<string, OrderStatus> = {};
  const fired: TrackedOrder[] = [];
  for (const o of scan.orders) {
    const status = scan.competition.get(o.order_id)?.status ?? 'unknown';
    const before = prev[o.order_id];
    next[o.order_id] = status === 'unknown' && before ? before : status;
    if (status === 'beaten' && (before === 'best' || before === 'tied')) fired.push(o);
  }
  saveJson(STATUS_KEY, next);
  if (!fired.length || !notifyEnabled()) return;
  const line = (o: TrackedOrder) => {
    const c = scan.competition.get(o.order_id)!;
    return `${typeName(o.type_id)} (${o.is_buy_order ? 'buy' : 'sell'}) ${formatISK(o.price)} → ${compactISK(c.best ?? 0)}`;
  };
  const title = fired.length === 1
    ? (fired[0].is_buy_order ? tx('Ți-a dat cineva outbid') : tx('Ți-a dat cineva undercut'))
    : tx('{n} ordine depășite', { n: fired.length });
  const body = fired.slice(0, 5).map(line).join('\n') + (fired.length > 5 ? '\n…' : '');
  toast(`${title}: ${fired.map((o) => typeName(o.type_id)).slice(0, 3).join(', ')}`);
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag: 'vyraj-orders' });
}

export function startOrderWatcher() {
  const run = () => {
    if (!orderCharacters().length) return;
    const job = () => scanOrders().then(() => undefined);
    (navigator.locks ? navigator.locks.request('vyraj-order-watch', { ifAvailable: true }, (lock) => (lock ? job() : undefined)) : job()).catch(() => {});
  };
  run();
  setInterval(run, 5 * 60 * 1000);
}
