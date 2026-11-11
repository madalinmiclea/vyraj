const BASE = import.meta.env.BASE_URL;
const MAX_QUERY = 6000;

export type ShareKey = 'fit' | 'doctrine' | 'build' | 'profile';
const SHARE_VIEW: Record<ShareKey, string> = { fit: 'fitting', doctrine: 'doctrines', build: 'industry', profile: 'character' };
const SHARE_KEYS = Object.keys(SHARE_VIEW) as ShareKey[];
const CODE = /^[A-Za-z0-9_-]+$/;

export const viewHref = (id: string) => (id === 'home' ? BASE : `${BASE}${id}`);

export function pathSegment(pathname = location.pathname): string | null {
  if (!pathname.startsWith(BASE)) return null;
  const seg = pathname.slice(BASE.length).split('/')[0].replace(/\.html$/, '');
  return seg && seg !== 'index' ? seg : null;
}

export function subSegment(pathname = location.pathname): string | null {
  if (!pathname.startsWith(BASE)) return null;
  return pathname.slice(BASE.length).split('/')[1]?.toLowerCase() || null;
}

export function linkView(href: string): string | null {
  const legacy = href.match(/^#\/([a-z]+)$/);
  if (legacy) return legacy[1];
  if (href.startsWith('#')) return null;
  let url: URL;
  try { url = new URL(href, location.href); } catch { return null; }
  if (url.origin !== location.origin || url.search || url.hash) return null;
  if (url.pathname === BASE) return 'home';
  return pathSegment(url.pathname);
}

export function shareHref(key: ShareKey, code: string): string {
  const path = viewHref(SHARE_VIEW[key]);
  return code.length <= MAX_QUERY ? `${path}?${key}=${code}` : `${path}#${key}=${code}`;
}

export const shareLinkUrl = (key: ShareKey, code: string) => `${location.origin}${shareHref(key, code)}`;

export function sharedCode(key: ShareKey): string | null {
  const q = new URLSearchParams(location.search).get(key);
  if (q && CODE.test(q)) return q;
  const h = location.hash.match(new RegExp(`^#${key}=([A-Za-z0-9_-]+)`));
  return h ? h[1] : null;
}

export const hasSharedLink = () => SHARE_KEYS.some((k) => sharedCode(k)) || new URLSearchParams(location.search).has('s');

export function clearShared(key: ShareKey) {
  const params = new URLSearchParams(location.search);
  params.delete(key);
  const rest = params.toString();
  const hash = location.hash.startsWith(`#${key}=`) ? '' : location.hash;
  history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${hash}`);
}

export function migrateLegacyHash(): boolean {
  const h = location.hash;
  const view = h.match(/^#\/([a-z]+)/)?.[1];
  if (view) {
    history.replaceState(history.state, '', viewHref(view));
    return true;
  }
  const share = h.match(/^#(fit|doctrine|build)=([A-Za-z0-9_-]+)/);
  if (share && !location.pathname.endsWith(`/${SHARE_VIEW[share[1] as ShareKey]}`)) {
    history.replaceState(null, '', shareHref(share[1] as ShareKey, share[2]));
    return true;
  }
  return false;
}
