import { version } from '../../package.json';
import { isDemo } from '../storage';

export const ESI = 'https://esi.evetech.net';
export const COMPATIBILITY_DATE = '2026-08-18';

const MAX_CONCURRENT = 6;
const MAX_RETRIES = 3;
const ERROR_FLOOR = 15;
const RATE_FLOOR = 0.1;

let active = 0;
const queue: (() => void)[] = [];
let pausedUntil = 0;

interface Bucket { remaining: number; limit: number; windowMs: number; nextAt: number }
const buckets = new Map<string, Bucket>();
const groupOf = new Map<string, string>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const USER_AGENT = `Vyraj/${version} (+https://github.com/madalinmiclea/vyraj)`;

const routeKey = (url: URL) => `${url.pathname.replace(/\/\d+(?=\/|$)/g, '/#').replace(/\/$/, '')}`;

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
}

function release() {
  const next = queue.shift();
  if (next) next();
  else active--;
}

function parseWindow(limit: string): { tokens: number; ms: number } | null {
  const m = limit.match(/^(\d+)\/(\d+)([smh])$/);
  if (!m) return null;
  const unit = m[3] === 'h' ? 3_600_000 : m[3] === 'm' ? 60_000 : 1000;
  return { tokens: Number(m[1]), ms: Number(m[2]) * unit };
}

function noteLimits(res: Response, key: string) {
  const remain = Number(res.headers.get('x-esi-error-limit-remain'));
  const reset = Number(res.headers.get('x-esi-error-limit-reset'));
  if (res.headers.has('x-esi-error-limit-remain') && remain < ERROR_FLOOR && reset > 0) pausedUntil = Math.max(pausedUntil, Date.now() + reset * 1000);
  const group = res.headers.get('x-ratelimit-group');
  const window = parseWindow(res.headers.get('x-ratelimit-limit') ?? '');
  if (!group || !window) return;
  groupOf.set(key, group);
  const previous = buckets.get(group);
  buckets.set(group, { remaining: Number(res.headers.get('x-ratelimit-remaining')) || 0, limit: window.tokens, windowMs: window.ms, nextAt: previous?.nextAt ?? 0 });
}

async function pace(key: string) {
  const group = groupOf.get(key);
  const bucket = group ? buckets.get(group) : undefined;
  if (!bucket || bucket.remaining > bucket.limit * RATE_FLOOR) return;
  const step = bucket.windowMs / Math.max(1, bucket.limit / 2);
  const at = Math.max(Date.now(), bucket.nextAt);
  bucket.nextAt = at + step;
  const wait = at - Date.now();
  if (wait > 0) await sleep(wait);
}

function prepare(input: string, init?: RequestInit): [string, RequestInit | undefined] {
  const url = new URL(input);
  if (url.origin !== ESI) return [input, init];
  const headers = new Headers(init?.headers);
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'GET' && !headers.has('authorization')) {
    url.searchParams.set('compatibility_date', COMPATIBILITY_DATE);
    url.searchParams.set('user_agent', USER_AGENT);
    return [url.href, init];
  }
  headers.set('X-Compatibility-Date', COMPATIBILITY_DATE);
  headers.set('X-User-Agent', USER_AGENT);
  return [url.href, { ...init, headers }];
}

export async function esiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isDemo()) {
    const demo = await (await import('../demo/fixtures')).demoResponse(input, init);
    if (demo) return demo;
  }
  const [target, options] = prepare(input, init);
  const key = new URL(target).origin === ESI ? `${(options?.method ?? 'GET').toUpperCase()} ${routeKey(new URL(target))}` : '';
  for (let attempt = 0; ; attempt++) {
    const wait = pausedUntil - Date.now();
    if (wait > 0) await sleep(wait);
    if (key) await pace(key);
    await acquire();
    let res: Response | null = null;
    let failure: unknown = null;
    try {
      res = await fetch(target, options);
    } catch (e) {
      failure = e;
    } finally {
      release();
    }
    if (res && key) noteLimits(res, key);
    const retryable = !res || res.status === 420 || res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
    if (!retryable || attempt >= MAX_RETRIES) {
      if (res) return res;
      throw failure;
    }
    const after = Number(res?.headers.get('retry-after') || (res?.status === 420 ? res.headers.get('x-esi-error-limit-reset') : 0));
    await sleep(after > 0 ? after * 1000 : 500 * 2 ** attempt);
  }
}

export async function esiPages<T>(url: (page: number) => string, init?: RequestInit, maxPages = Infinity): Promise<T[]> {
  const label = new URL(url(1)).pathname;
  const get = async (page: number) => {
    const res = await esiFetch(url(page), init);
    if (!res.ok) throw new Error(`ESI ${label}: ${res.status} ${await res.text()}`);
    return { stamp: res.headers.get('last-modified') ?? '', pages: Number(res.headers.get('x-pages')) || 1, rows: (await res.json()) as T[] };
  };
  for (let attempt = 0; ; attempt++) {
    const first = await get(1);
    const pages = Math.min(maxPages, first.pages);
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => get(i + 2)));
    const mixed = rest.some((r) => r.stamp && first.stamp && r.stamp !== first.stamp);
    if (!mixed || attempt >= 1) return [...first.rows, ...rest.flatMap((r) => r.rows)];
  }
}

export function repeatAfter(run: () => unknown, ms: number): void {
  const next = () => setTimeout(async () => {
    await Promise.resolve().then(run).catch(() => undefined);
    next();
  }, ms + Math.random() * ms * 0.1);
  next();
}
