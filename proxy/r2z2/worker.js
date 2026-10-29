const UPSTREAM = 'https://r2z2.zkillboard.com/ephemeral/';
const PATH = /^\/ephemeral\/(sequence|\d{1,12})\.json$/;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-max-age': '86400',
};

const reply = (status, body = null, extra = {}) => new Response(body, { status, headers: { ...CORS, ...extra } });

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return reply(204);
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply(405);
    const url = new URL(request.url);
    const match = url.pathname.match(PATH);
    if (!match) return reply(404, null, { 'cache-control': 'no-store' });
    const kill = match[1] !== 'sequence';
    const key = new Request(`${url.origin}${url.pathname}`);
    if (kill) {
      const hit = await caches.default.match(key);
      if (hit) return hit;
    }
    let upstream;
    try {
      upstream = await fetch(`${UPSTREAM}${match[1]}.json`, {
        headers: { 'user-agent': 'Vyraj R2Z2 proxy', accept: 'application/json', 'accept-encoding': 'gzip' },
        cf: { cacheTtlByStatus: kill ? { '200-299': 86400, '400-599': 0 } : { '200-299': 5, '400-599': 0 } },
      });
    } catch {
      return reply(502, null, { 'cache-control': 'no-store' });
    }
    const ok = upstream.status === 200;
    const headers = {
      'content-type': 'application/json',
      'cache-control': ok && kill ? 'public, max-age=86400, immutable' : 'no-store',
    };
    const retry = upstream.headers.get('retry-after');
    if (retry) headers['retry-after'] = retry;
    const res = reply(upstream.status, ok ? await upstream.arrayBuffer() : null, headers);
    if (ok && kill) ctx.waitUntil(caches.default.put(key, res.clone()));
    return res;
  },
};
