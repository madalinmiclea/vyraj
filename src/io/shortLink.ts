import { shareHref, shareLinkUrl, type ShareKey } from '../app/route';

const API = `${(import.meta.env.VITE_R2Z2_URL || 'https://vyraj-r2z2.vyraj.workers.dev').replace(/\/+$/, '')}/s`;
const ID = /^[A-Za-z0-9]{6,12}$/;
const KEYS: ShareKey[] = ['fit', 'doctrine', 'build'];
const CODE = /^[A-Za-z0-9_-]+$/;

export function shortId(): string | null {
  const id = new URLSearchParams(location.search).get('s');
  return id && ID.test(id) ? id : null;
}

export async function shortLink(key: ShareKey, code: string): Promise<string> {
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ k: key, c: code }), signal: AbortSignal.timeout(6000) });
    const id = res.ok ? (await res.json())?.id : null;
    if (typeof id === 'string' && ID.test(id)) return `${location.origin}${import.meta.env.BASE_URL}?s=${id}`;
  } catch {
    return shareLinkUrl(key, code);
  }
  return shareLinkUrl(key, code);
}

export async function resolveShortLink(): Promise<boolean> {
  const id = shortId();
  if (!id) return false;
  try {
    const res = await fetch(`${API}/${id}`, { signal: AbortSignal.timeout(8000) });
    const data = res.ok ? await res.json() : null;
    if (!data || !KEYS.includes(data.k) || typeof data.c !== 'string' || !CODE.test(data.c)) throw new Error('invalid');
    history.replaceState(null, '', shareHref(data.k, data.c));
    return true;
  } catch {
    const params = new URLSearchParams(location.search);
    params.delete('s');
    const rest = params.toString();
    history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
    throw new Error('invalid');
  }
}
