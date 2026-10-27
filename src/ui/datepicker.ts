import { icon } from './icons';
import { esc } from './components';
import { tx, locale } from '../i18n';

interface OpenPicker {
  input: HTMLInputElement;
  menu: HTMLElement;
  year: number;
  month: number;
}

let open: OpenPicker | null = null;

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const today = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth(), n.getDate()); };
const target = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return el instanceof HTMLInputElement && el.hasAttribute('data-date') && !el.disabled ? el : null;
};

function close(focus = false) {
  if (!open) return;
  const { input, menu } = open;
  open = null;
  menu.remove();
  input.classList.remove('xsel-open');
  if (focus) input.focus();
}

function place() {
  if (!open) return;
  const { input, menu } = open;
  const r = input.getBoundingClientRect();
  const h = menu.offsetHeight;
  const up = innerHeight - r.bottom < h + 12 && r.top > h + 12;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  if (up) { menu.style.top = ''; menu.style.bottom = `${innerHeight - r.top + 4}px`; } else { menu.style.bottom = ''; menu.style.top = `${r.bottom + 4}px`; }
}

function pick(value: string) {
  if (!open) return;
  const { input } = open;
  close(true);
  if (input.value === value) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function render() {
  if (!open) return;
  const { year, month, input, menu } = open;
  const title = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
  const days = Array.from({ length: 7 }, (_, i) => weekday.format(new Date(2024, 0, 1 + i)));
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const now = today();
  const cells = Array.from({ length: lead }, () => '<span></span>').concat(Array.from({ length: count }, (_, i) => {
    const v = iso(year, month, i + 1);
    return `<button type="button" class="xdate-day ${v === input.value ? 'selected' : ''} ${v === now ? 'today' : ''}" data-day="${v}">${i + 1}</button>`;
  }));
  menu.innerHTML = `<div class="xdate-head">
      <button type="button" class="xdate-nav" data-step="-1" aria-label="${esc(tx('Luna anterioară'))}">${icon('chevron')}</button>
      <b>${esc(title)}</b>
      <button type="button" class="xdate-nav" data-step="1" aria-label="${esc(tx('Luna următoare'))}">${icon('chevron')}</button>
    </div>
    <div class="xdate-grid">${days.map((d) => `<span class="xdate-wd">${esc(d)}</span>`).join('')}${cells.join('')}</div>
    <div class="xdate-foot"><button type="button" class="btn ghost sm" data-day="${now}">${esc(tx('Azi'))}</button></div>`;
  place();
}

function step(n: number) {
  if (!open) return;
  const d = new Date(open.year, open.month + n, 1);
  open.year = d.getFullYear();
  open.month = d.getMonth();
  render();
}

function openPicker(input: HTMLInputElement) {
  close();
  const base = /^\d{4}-\d{2}-\d{2}$/.test(input.value) ? new Date(input.value + 'T12:00:00') : new Date();
  const menu = document.createElement('div');
  menu.className = 'xsel-menu xdate';
  menu.setAttribute('role', 'dialog');
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  menu.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const nav = t.closest<HTMLElement>('[data-step]');
    if (nav) { step(Number(nav.dataset.step)); return; }
    const day = t.closest<HTMLElement>('[data-day]');
    if (day) pick(day.dataset.day!);
  });
  document.body.appendChild(menu);
  input.classList.add('xsel-open');
  open = { input, menu, year: base.getFullYear(), month: base.getMonth() };
  render();
}

export function initDatePicker() {
  document.addEventListener('mousedown', (e) => {
    if (open && !open.menu.contains(e.target as Node)) {
      const same = target(e.target) === open.input;
      close();
      if (same) return;
    }
    const input = target(e.target);
    if (input && e.button === 0) openPicker(input);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (open && (e.key === 'PageUp' || e.key === 'PageDown')) { e.preventDefault(); step(e.key === 'PageUp' ? -1 : 1); return; }
    if (open && e.key === 'Tab') { close(); return; }
    const input = target(e.target);
    if (input && !open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); openPicker(input); }
  }, true);

  document.addEventListener('scroll', (e) => {
    if (open && !open.menu.contains(e.target as Node)) place();
  }, true);
  addEventListener('resize', () => close());
}
