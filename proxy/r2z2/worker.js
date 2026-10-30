const UPSTREAM = 'https://r2z2.zkillboard.com/ephemeral/';
const PATH = /^\/ephemeral\/(sequence|\d{1,12})\.json$/;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return reply(204);
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply(405);
    const url = new URL(request.url);
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
