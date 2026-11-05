const UPSTREAM = 'https://r2z2.zkillboard.com/ephemeral/';
const PATH = /^\/ephemeral\/(sequence|\d{1,12})\.json$/;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};
const HEADERS = { 'user-agent': 'Vyraj R2Z2 proxy', accept: 'application/json', 'accept-encoding': 'gzip' };
const WINDOW_MS = 60 * 60 * 1000;
const BUDGET = 40;
const CATCH_UP_MS = 4000;
const IDLE_MS = 6000;
const SLEEP_AFTER_MS = 10 * 60 * 1000;
const MAX_BACK = 3000;
const SAVE_MS = 60 * 1000;

const LINK_KEYS = ['fit', 'doctrine', 'build'];
const LINK_CODE = /^[A-Za-z0-9_-]{1,16000}$/;
const LINK_ID = /^[A-Za-z0-9]{6,12}$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ORIGINS = ['https://madalinmiclea.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'];
const MAX_JSON = 200_000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 30;
const LINK_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const TOUCH_MS = 24 * 60 * 60 * 1000;
const SWEEP_MS = 24 * 60 * 60 * 1000;

const ESI = 'https://esi.evetech.net';
const ESI_DATE = '2026-08-18';
const ESI_HEADERS = { 'user-agent': 'Vyraj order book proxy (+https://github.com/madalinmiclea/vyraj)', accept: 'application/json' };
const BOOK_REGIONS = 25;
const BOOK_SUBREQUESTS = 45;
const BOOK_TTL = 300;

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  const extra = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  return !!origin && (ORIGINS.includes(origin) || extra.includes(origin));
}

async function decodeCode(code) {
  const raw = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_JSON) { await reader.cancel(); throw new Error('too large'); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return JSON.parse(new TextDecoder().decode(out));
}

async function validPayload(k, c) {
  let data;
  try { data = await decodeCode(c); } catch { return false; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (k !== 'fit') return true;
  return data.v === 1 && Number.isInteger(data.s) && data.s > 0 && (data.n === undefined || typeof data.n === 'string') && !!data.sl && typeof data.sl === 'object';
}

async function linkId(text, size) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let out = '';
  for (let i = 0; i < size; i++) out += ALPHABET[bytes[i] % 62];
  return out;
}

const reply = (status, body = null, extra = {}) => new Response(body, { status, headers: { ...CORS, ...extra } });

function compact(seq, r) {
  const e = r.esi;
  const z = r.zkb;
  return [
    seq,
    r.killmail_id,
    r.hash ?? z.hash,
    e.killmail_time,
    e.solar_system_id,
    [e.victim.ship_type_id, e.victim.character_id ?? 0, e.victim.alliance_id ?? 0, e.victim.corporation_id ?? 0],
    e.attackers.map((a) => [a.character_id ?? 0, a.ship_type_id ?? 0, a.alliance_id ?? 0, a.corporation_id ?? 0, a.final_blow ? 1 : 0, a.weapon_type_id ?? 0]),
    [Math.round(z.totalValue ?? 0), z.npc ? 1 : 0, z.solo ? 1 : 0, z.locationID ?? 0],
  ];
}

export class Feed {
  constructor(ctx) {
    this.ctx = ctx;
    this.rows = [];
    this.head = 0;
    this.low = 0;
    this.lastServe = 0;
    this.used = 0;
    this.saved = 0;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('state');
      if (saved) Object.assign(this, saved);
    });
  }

  async fetch(request) {
    await this.ready;
    this.lastServe = Date.now();
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 100);
    const since = Number(new URL(request.url).searchParams.get('since')) || 0;
    const cut = Date.now() - WINDOW_MS;
    const kills = this.rows.filter((r) => r[0] > since && Date.parse(r[3]) >= cut);
    return Response.json({ head: this.head, ready: this.head > 0 && this.low === 0, kills });
  }

  async get(seq) {
    this.used++;
    const res = await fetch(`${UPSTREAM}${seq}.json`, { headers: HEADERS });
    if (res.status === 429) throw new Error('limited');
    if (!res.ok) return null;
    const r = await res.json();
    return r?.esi ? r : null;
  }

  async alarm() {
    await this.ready;
    if (Date.now() - this.lastServe > SLEEP_AFTER_MS) return;
    this.used = 0;
    let busy = false;
    try {
      if (!this.head) {
        this.used++;
        const res = await fetch(`${UPSTREAM}sequence.json`, { headers: HEADERS });
        const start = res.ok ? (await res.json()).sequence : 0;
        if (start) {
          this.head = start - 1;
          this.low = start;
          this.rows = [];
        }
      }
      while (this.head && this.used < BUDGET) {
        const r = await this.get(this.head + 1);
        if (!r) break;
        this.head++;
        this.rows.push(compact(this.head, r));
      }
      busy = this.used >= BUDGET;
      const cut = Date.now() - WINDOW_MS;
      while (this.low && this.used < BUDGET) {
        const seq = this.low - 1;
        const r = await this.get(seq);
        this.low = seq;
        if (r) {
          if (Date.parse(r.esi.killmail_time) >= cut) this.rows.unshift(compact(seq, r));
          if ((r.uploaded_at ?? 0) * 1000 < cut) { this.low = 0; break; }
        }
        if (this.head - this.low > MAX_BACK) this.low = 0;
      }
      busy ||= this.low > 0;
      this.rows = this.rows.filter((r) => Date.parse(r[3]) >= cut).sort((a, b) => a[0] - b[0]);
      if (Date.now() - this.saved > SAVE_MS) {
        this.saved = Date.now();
        await this.ctx.storage.put('state', { rows: this.rows, head: this.head, low: this.low, lastServe: this.lastServe });
      }
    } catch {
      busy = false;
    }
    await this.ctx.storage.setAlarm(Date.now() + (busy ? CATCH_UP_MS : IDLE_MS));
  }
}

export class Links {
  constructor(ctx) {
    this.ctx = ctx;
    this.hits = new Map();
  }

  limited(ip) {
    const now = Date.now();
    const recent = (this.hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) {
      this.hits.set(ip, recent);
      return true;
    }
    recent.push(now);
    this.hits.set(ip, recent);
    if (this.hits.size > 5000) for (const [key, list] of this.hits) if (!list.some((t) => now - t < RATE_WINDOW_MS)) this.hits.delete(key);
    return false;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    if (request.method === 'POST') {
      if (this.limited(url.searchParams.get('ip') || '')) return new Response(null, { status: 429, headers: { 'retry-after': '600' } });
      const { k, c } = await request.json();
      for (let size = 8; size <= 12; size += 2) {
        const id = await linkId(`${k}=${c}`, size);
        const found = await this.ctx.storage.get(id);
        if (found && (found.k !== k || found.c !== c)) continue;
        if (!found) await this.ctx.storage.put(id, { k, c, t: Date.now(), a: Date.now() });
        else if (Date.now() - (found.a ?? found.t) > TOUCH_MS) await this.ctx.storage.put(id, { ...found, a: Date.now() });
        return Response.json({ id });
      }
      return new Response(null, { status: 409 });
    }
    const id = url.searchParams.get('id');
    const found = await this.ctx.storage.get(id);
    if (!found) return new Response(null, { status: 404 });
    if (Date.now() - (found.a ?? found.t) > TOUCH_MS) await this.ctx.storage.put(id, { ...found, a: Date.now() });
    return Response.json({ k: found.k, c: found.c });
  }

  async alarm() {
    const cut = Date.now() - LINK_TTL_MS;
    let start;
    for (;;) {
      const page = await this.ctx.storage.list({ start, limit: 500 });
      if (!page.size) break;
      const old = [];
      let last;
      for (const [key, value] of page) {
        last = key;
        if ((value?.a ?? value?.t ?? 0) < cut) old.push(key);
      }
      if (old.length) await this.ctx.storage.delete(old);
      if (page.size < 500) break;
      start = `${last}\u0000`;
    }
    await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }
}

async function links(request, env, url) {
  const store = env.LINKS.get(env.LINKS.idFromName('main'));
  const json = { 'content-type': 'application/json' };
  if (request.method === 'POST') {
    if (!allowedOrigin(request, env)) return reply(403, null, { 'cache-control': 'no-store' });
    const body = await request.text();
    if (body.length > 16100) return reply(413, null, { 'cache-control': 'no-store' });
    let data;
    try { data = JSON.parse(body); } catch { return reply(400, null, { 'cache-control': 'no-store' }); }
    if (!LINK_KEYS.includes(data?.k) || typeof data.c !== 'string' || !LINK_CODE.test(data.c)) return reply(400, null, { 'cache-control': 'no-store' });
    if (!(await validPayload(data.k, data.c))) return reply(422, null, { 'cache-control': 'no-store' });
    const ip = request.headers.get('cf-connecting-ip') || '';
    const res = await store.fetch(`https://links/?ip=${encodeURIComponent(ip)}`, { method: 'POST', body: JSON.stringify({ k: data.k, c: data.c }) });
    const extra = res.headers.get('retry-after') ? { 'retry-after': res.headers.get('retry-after') } : {};
    return reply(res.status, res.ok ? await res.text() : null, { ...json, ...extra, 'cache-control': 'no-store' });
  }
  const id = url.pathname.slice(3);
  if (!LINK_ID.test(id)) return reply(404, null, { 'cache-control': 'no-store' });
  const res = await store.fetch(`https://links/?id=${id}`);
  return reply(res.status, res.ok ? await res.text() : null, { ...json, 'cache-control': res.ok ? 'public, max-age=86400, immutable' : 'no-store' });
}

const validRegion = (id) => (id >= 10000001 && id <= 10999999) || id === 19000001;

async function bookRegion(region, type, budget) {
  const url = (page) => `${ESI}/markets/${region}/orders/?order_type=all&type_id=${type}&page=${page}&compatibility_date=${ESI_DATE}`;
  budget.left--;
  const first = await fetch(url(1), { headers: ESI_HEADERS });
  if (!first.ok) throw new Error(String(first.status));
  const pages = Number(first.headers.get('x-pages')) || 1;
  const rows = await first.json();
  for (let page = 2; page <= pages; page++) {
    if (budget.left <= 0) throw new Error('budget');
    budget.left--;
    const res = await fetch(url(page), { headers: ESI_HEADERS });
    if (!res.ok) throw new Error(String(res.status));
    rows.push(...(await res.json()));
  }
  return rows.map((o) => [o.order_id, o.is_buy_order ? 1 : 0, o.price, o.volume_remain, o.volume_total, o.min_volume, o.location_id, o.system_id, region, o.range, o.issued, o.duration]);
}

async function book(request, ctx, url) {
  const type = Number(url.searchParams.get('type'));
  const regions = (url.searchParams.get('r') || '').split(',').map(Number);
  if (!Number.isInteger(type) || type <= 0 || type > 1e9 || !regions.length || regions.length > BOOK_REGIONS || !regions.every((r) => Number.isInteger(r) && validRegion(r))) return reply(400, null, { 'cache-control': 'no-store' });
  const key = new Request(`https://book.vyraj/${type}?r=${regions.join(',')}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return reply(200, await hit.text(), { 'content-type': 'application/json', 'cache-control': hit.headers.get('cache-control') || `public, max-age=${BOOK_TTL}` });
  const budget = { left: BOOK_SUBREQUESTS };
  const orders = [];
  const failed = [];
  await Promise.all(regions.map(async (region) => {
    try {
      orders.push(...(await bookRegion(region, type, budget)));
    } catch {
      failed.push(region);
    }
  }));
  if (failed.length === regions.length) return reply(502, null, { 'cache-control': 'no-store' });
  const body = JSON.stringify({ at: Date.now(), failed, orders });
  const age = failed.length ? 30 : BOOK_TTL;
  ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${age}` } })));
  return reply(200, body, { 'content-type': 'application/json', 'cache-control': `public, max-age=${age}` });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return reply(204);
    const url = new URL(request.url);
    if (url.pathname === '/s' && request.method === 'POST') return links(request, env, url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply(405);
    if (url.pathname.startsWith('/s/')) return links(request, env, url);
    if (url.pathname === '/book') return book(request, ctx, url);
    if (url.pathname === '/recent') {
      const since = Number(url.searchParams.get('since')) || 0;
      const feed = env.FEED.get(env.FEED.idFromName('main'));
      const res = await feed.fetch(`https://feed/recent?since=${since}`);
      return reply(res.status, await res.text(), { 'content-type': 'application/json', 'cache-control': 'no-store' });
    }
    const match = url.pathname.match(PATH);
    if (!match) return reply(404, null, { 'cache-control': 'no-store' });
    let upstream;
    try {
      upstream = await fetch(`${UPSTREAM}${match[1]}.json`, { headers: HEADERS });
    } catch {
      return reply(502, null, { 'cache-control': 'no-store' });
    }
    const ok = upstream.status === 200;
    const headers = {
      'content-type': 'application/json',
      'cache-control': ok && match[1] !== 'sequence' ? 'public, max-age=86400, immutable' : 'no-store',
    };
    const retry = upstream.headers.get('retry-after');
    if (retry) headers['retry-after'] = retry;
    return reply(upstream.status, ok ? await upstream.arrayBuffer() : null, headers);
  },
};
