const CODE = import.meta.env.PROD ? (import.meta.env.VITE_GOATCOUNTER_CODE || '').trim().toLowerCase() : '';

type GoatCounter = { count: (vars: { path: string; title?: string; event?: boolean }) => void };

let state: 'idle' | 'loading' | 'ready' = 'idle';
let pending: string | null = null;
let last = '';

const send = (path: string) => {
  const gc = (window as unknown as { goatcounter?: GoatCounter }).goatcounter;
  if (!gc?.count) return;
  last = path;
  gc.count({ path, title: path.slice(1) || 'vyraj', event: false });
};

const load = () => {
  state = 'loading';
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`;
  s.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
  s.addEventListener('load', () => {
    state = 'ready';
    if (pending) send(pending);
    pending = null;
  });
  s.addEventListener('error', () => { state = 'idle'; });
  document.head.append(s);
};

export function trackView(view: string) {
  if (!/^[a-z0-9-]+$/.test(CODE)) return;
  const path = `/${view}`;
  if (path === last) return;
  if (state === 'ready') return send(path);
  pending = path;
  if (state === 'idle') load();
}
