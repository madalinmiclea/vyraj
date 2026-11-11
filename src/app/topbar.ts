import { formatInt } from '../ui/components';
import { unreadCount, LOG_EVENT } from '../services/notices';
import { esiHealth } from '../services/operations';
import { ESI, esiFetch, repeatAfter } from '../services/esiClient';
import { tx, setLang, type Lang } from '../i18n';
import { setTheme, type Theme } from '../theme';

export function initSwitches() {
  document.querySelector('.theme-switch')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-theme-set]');
    if (!btn) return;
    setTheme(btn.dataset.themeSet as Theme);
    document.querySelectorAll<HTMLButtonElement>('[data-theme-set]').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  });

  document.querySelector('.lang-switch:not(.theme-switch)')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-lang]');
    if (btn) setLang(btn.dataset.lang as Lang);
  });
}

export function initStatus() {
  const clock = document.getElementById('eveClock')!;
  const tick = () => { clock.textContent = new Date().toISOString().slice(11, 16); };
  tick();
  setInterval(tick, 10_000);

  const online = document.getElementById('onlinePlayers')!;
  const pollStatus = async () => {
    try {
      const res = await esiFetch(`${ESI}/status/`);
      if (!res.ok) throw new Error();
      const status = await res.json() as { players: number; vip?: boolean };
      online.textContent = status.vip ? 'VIP' : formatInt(status.players);
    } catch {
      online.textContent = '—';
    }
  };
  pollStatus();
  repeatAfter(pollStatus, 60_000, { visibleOnly: true });

  const health = document.getElementById('esiHealth')!;
  const pollHealth = async () => {
    try {
      const routes = await esiHealth();
      const bad = routes.filter((r) => r.status === 'Degraded' || r.status === 'Down' || r.status === 'Recovering');
      const down = bad.filter((r) => r.status === 'Down');
      health.className = `value esi-health ${down.length ? 'down' : bad.length ? 'warn' : ''}`;
      health.querySelector('span')!.textContent = down.length ? tx('{n} rute căzute', { n: down.length }) : bad.length ? tx('{n} rute lente', { n: bad.length }) : 'OK';
      health.title = bad.length ? bad.slice(0, 25).map((r) => `${r.status} · ${r.method} ${r.path}`).join('\n') : tx('Toate rutele ESI funcționează normal.');
    } catch {
      health.className = 'value esi-health down';
      health.querySelector('span')!.textContent = tx('indisponibil');
      health.title = tx('ESI nu răspunde acum.');
    }
  };
  pollHealth();
  repeatAfter(pollHealth, 5 * 60_000, { visibleOnly: true });
}

export function initNotifyBadge() {
  const syncBadge = () => {
    const n = unreadCount();
    for (const b of document.querySelectorAll<HTMLElement>('[data-view="notifications"]')) {
      let el = b.querySelector<HTMLElement>('.nc-badge');
      if (!n) { el?.remove(); continue; }
      if (!el) { el = document.createElement('span'); el.className = 'nc-badge'; b.append(el); }
      el.textContent = n > 99 ? '99+' : String(n);
    }
  };
  window.addEventListener(LOG_EVENT, syncBadge);
  window.addEventListener('storage', (e) => { if (e.key?.endsWith('eve-notify:log')) syncBadge(); });
  syncBadge();
}
