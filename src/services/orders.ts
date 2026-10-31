import { accessToken, hasScope } from '../character/sso';
import { rosterCharacters } from '../character/roster';
import { ESI, esiPages, repeatAfter } from './esiClient';
import { loadJson, saveJson } from '../storage';
import { typeName, resolveTypeNames } from './typeNames';
import { compactISK, formatISK, formatInt } from '../ui/components';
import { tx } from '../i18n';
import { deliver, kindOn, setKind } from './notices';

export const ORDERS_SCOPE = 'esi-markets.read_character_orders.v1';
export const ORDERS_EVENT = 'vyraj-orders-updated';
export const MODIFY_COOLDOWN = 5 * 60 * 1000;

const STATUS_KEY = 'eve-orders:status';
const SNAP_KEY = 'eve-orders:snapshot';
const PENDING_MS = 3 * 3_600_000;
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

export { typeName };

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
  return esiPages<T>((page) => `${ESI}${path}?page=${page}`, { headers: { Authorization: `Bearer ${token}` } }, maxPages);
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
  const url = (page: number) => `${ESI}/markets/${regionId}/orders/?order_type=${buy ? 'buy' : 'sell'}&type_id=${typeId}&page=${page}`;
  const value = esiPages<PublicOrder>(url);
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
  const read = new Set<number>();
  await Promise.all(chars.map(async (c) => {
    try {
      const list = await characterOrders(c.characterId!, force);
      read.add(c.characterId!);
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
  await detectFills(orders, read).catch(() => {});
  window.dispatchEvent(new Event(ORDERS_EVENT));
  return last;
}

export function scanOrders(force = false): Promise<OrdersScan> {
  if (!running) running = runScan(force).finally(() => { running = null; });
  return running;
}

export const notifyEnabled = () => kindOn('outbid');

export const setNotify = (on: boolean) => setKind('outbid', on);

interface Snap { c: number; n: string; t: number; b: 0 | 1; p: number; r: number; gone?: number }

interface Fill { o: Snap; qty: number; done: boolean }

async function detectFills(orders: TrackedOrder[], read: Set<number>) {
  const prev = loadJson<Record<string, Snap> | null>(SNAP_KEY, null);
  const now = Date.now();
  const next: Record<string, Snap> = {};
  for (const o of orders) next[o.order_id] = { c: o.characterId, n: o.characterName, t: o.type_id, b: o.is_buy_order ? 1 : 0, p: o.price, r: o.volume_remain };
  for (const [id, o] of Object.entries(prev ?? {})) if (!next[id] && !read.has(o.c) && now - (o.gone ?? now) < PENDING_MS) next[id] = o;
  if (!prev) { saveJson(SNAP_KEY, next); return; }
  const fills: Fill[] = [];
  const expired: Snap[] = [];
  for (const o of orders) {
    const before = prev[o.order_id];
    if (before && o.volume_remain < before.r) fills.push({ o: { ...before, p: o.price }, qty: before.r - o.volume_remain, done: false });
  }
  const vanished = Object.entries(prev).filter(([id, o]) => !next[id] && read.has(o.c));
  const byChar = new Map<number, [string, Snap][]>();
  for (const v of vanished) (byChar.get(v[1].c) ?? byChar.set(v[1].c, []).get(v[1].c)!).push(v);
  for (const [charId, list] of byChar) {
    let history: CharacterOrder[] = [];
    try { history = await orderHistory(charId); } catch { }
    const found = new Map(history.map((h) => [String(h.order_id), h]));
    for (const [id, o] of list) {
      const h = found.get(id);
      if (!h) { if (now - (o.gone ?? now) < PENDING_MS) next[id] = { ...o, gone: o.gone ?? now }; continue; }
      if (h.volume_remain < o.r) fills.push({ o, qty: o.r - h.volume_remain, done: h.volume_remain === 0 });
      if (h.volume_remain > 0 && h.state === 'expired') expired.push({ ...o, r: h.volume_remain });
    }
  }
  saveJson(SNAP_KEY, next);
  if (!fills.length && !expired.length) return;
  await resolveTypeNames([...fills.map((f) => f.o.t), ...expired.map((o) => o.t)]).catch(() => {});
  const fillLine = (f: Fill) => `${typeName(f.o.t)}: ${formatInt(f.qty)} × ${formatISK(f.o.p)} = ${compactISK(f.qty * f.o.p)} ISK${f.done ? ` · ${tx('ordin încheiat')}` : ''}`;
  if (fills.length <= 3) {
    for (const f of fills) deliver('filled', {
      title: f.o.b ? tx('Ordin de cumpărare umplut · {name}', { name: f.o.n }) : tx('Ți s-a vândut din ordin · {name}', { name: f.o.n }),
      body: fillLine(f), url: '#/orders', charId: f.o.c,
    });
  } else {
    const sold = fills.filter((f) => !f.o.b).reduce((a, f) => a + f.qty * f.o.p, 0);
    const bought = fills.filter((f) => f.o.b).reduce((a, f) => a + f.qty * f.o.p, 0);
    deliver('filled', {
      title: tx('{n} ordine executate', { n: fills.length }),
      body: [sold ? tx('Vândut: {isk} ISK', { isk: compactISK(sold) }) : '', bought ? tx('Cumpărat: {isk} ISK', { isk: compactISK(bought) }) : '', ...fills.slice(0, 5).map(fillLine)].filter(Boolean).join('\n'),
      url: '#/orders',
    });
  }
  for (const o of expired.slice(0, 5)) deliver('expired', {
    title: tx('Ordin expirat · {name}', { name: o.n }),
    body: `${typeName(o.t)} (${o.b ? 'buy' : 'sell'}) · ${tx('rămase {n} la {price}', { n: formatInt(o.r), price: formatISK(o.p) })}`,
    url: '#/orders', charId: o.c,
  });
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
  if (!fired.length) return;
  const line = (o: TrackedOrder) => {
    const c = scan.competition.get(o.order_id)!;
    return `${typeName(o.type_id)} (${o.is_buy_order ? 'buy' : 'sell'}) ${formatISK(o.price)} → ${compactISK(c.best ?? 0)}`;
  };
  const title = fired.length === 1
    ? (fired[0].is_buy_order ? tx('Ți-a dat cineva outbid') : tx('Ți-a dat cineva undercut'))
    : tx('{n} ordine depășite', { n: fired.length });
  const body = fired.slice(0, 5).map(line).join('\n') + (fired.length > 5 ? '\n…' : '');
  deliver('outbid', { title, body, short: `${title}: ${fired.map((o) => typeName(o.type_id)).slice(0, 3).join(', ')}`, tag: 'vyraj-orders', url: '#/orders', charId: fired.length === 1 ? fired[0].characterId : undefined });
}

export function startOrderWatcher() {
  const run = () => {
    if (!orderCharacters().length) return;
    const job = () => scanOrders().then(() => undefined);
    return (navigator.locks ? navigator.locks.request('vyraj-order-watch', { ifAvailable: true }, (lock) => (lock ? job() : undefined)) : job()).catch(() => {});
  };
  run();
  repeatAfter(run, 5 * 60 * 1000);
}
