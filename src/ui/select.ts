import { icon } from './icons';
import { esc } from './components';
import { fold } from './fold';
import { tx } from '../i18n';

interface OpenMenu {
  select: HTMLSelectElement;
  menu: HTMLElement;
  search: HTMLInputElement | null;
  active: number;
}

const SEARCH_FROM = 12;
let open: OpenMenu | null = null;
const finePointer = matchMedia('(pointer: fine)');

const usable = (t: EventTarget | null): HTMLSelectElement | null => {
  const s = (t as HTMLElement | null)?.closest?.('select');
  return s && !s.multiple && s.size <= 1 && !s.disabled ? s : null;
};

function items(menu: HTMLElement) {
  return [...menu.querySelectorAll<HTMLElement>('.xsel-opt:not(.hidden):not(.disabled)')];
}

function highlight(index: number, scroll = true) {
  if (!open) return;
  const list = items(open.menu);
  if (!list.length) return;
  open.active = Math.max(0, Math.min(list.length - 1, index));
  open.menu.querySelectorAll('.xsel-opt.active').forEach((o) => o.classList.remove('active'));
  const el = list[open.active];
  el.classList.add('active');
  if (scroll) el.scrollIntoView({ block: 'nearest' });
}

function place(select: HTMLSelectElement, menu: HTMLElement) {
  const r = select.getBoundingClientRect();
  const below = innerHeight - r.bottom - 8;
  const above = r.top - 8;
  const up = below < 220 && above > below;
  menu.style.minWidth = `${Math.max(r.width, 140)}px`;
  menu.style.maxHeight = `${Math.min(360, Math.max(120, up ? above : below))}px`;
  const width = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`;
  if (up) { menu.style.top = ''; menu.style.bottom = `${innerHeight - r.top + 4}px`; } else { menu.style.bottom = ''; menu.style.top = `${r.bottom + 4}px`; }
}

function close(focus = false) {
  if (!open) return;
  const { select, menu } = open;
  open = null;
  menu.remove();
  select.classList.remove('xsel-open');
  if (focus) select.focus();
}

function choose(index: number) {
  if (!open) return;
  const { select } = open;
  close(true);
  if (select.selectedIndex === index) return;
  select.selectedIndex = index;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function filter(q: string) {
  if (!open) return;
  const needle = fold(q.trim());
  for (const o of open.menu.querySelectorAll<HTMLElement>('.xsel-opt')) o.classList.toggle('hidden', !!needle && !fold(o.textContent ?? '').includes(needle));
  for (const g of open.menu.querySelectorAll<HTMLElement>('.xsel-group')) g.classList.toggle('hidden', !g.querySelector('.xsel-opt:not(.hidden)'));
  highlight(0);
}

function openMenu(select: HTMLSelectElement) {
  close();
  const option = (o: HTMLOptionElement) => `<div class="xsel-opt ${o.selected ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}" role="option" data-i="${o.index}" aria-selected="${o.selected}">${icon('check', 'xsel-check')}<span>${esc(o.text)}</span></div>`;
  const body = [...select.children].map((c) => {
    if (c instanceof HTMLOptGroupElement) return `<div class="xsel-group"><div class="xsel-group-label">${esc(c.label)}</div>${[...c.children].filter((o): o is HTMLOptionElement => o instanceof HTMLOptionElement).map(option).join('')}</div>`;
    return c instanceof HTMLOptionElement ? option(c) : '';
  }).join('');
  const withSearch = select.options.length > SEARCH_FROM;
  const menu = document.createElement('div');
  menu.className = 'xsel-menu';
  menu.setAttribute('role', 'listbox');
  menu.innerHTML = `${withSearch ? `<input class="xsel-search" placeholder="${tx('Caută...')}" spellcheck="false" />` : ''}<div class="xsel-list">${body}</div>`;
  document.body.appendChild(menu);
  select.classList.add('xsel-open');
  const search = menu.querySelector<HTMLInputElement>('.xsel-search');
  open = { select, menu, search, active: 0 };
  place(select, menu);
  const list = items(menu);
  highlight(Math.max(0, list.findIndex((o) => Number(o.dataset.i) === select.selectedIndex)));
  if (search) {
    search.focus();
    search.addEventListener('input', () => filter(search.value));
  }
  menu.addEventListener('mousedown', (e) => { if (e.target !== search) e.preventDefault(); });
  menu.addEventListener('mousemove', (e) => {
    const o = (e.target as HTMLElement).closest<HTMLElement>('.xsel-opt:not(.disabled)');
    if (o && !o.classList.contains('active')) highlight(items(menu).indexOf(o), false);
  });
  menu.addEventListener('click', (e) => {
    const o = (e.target as HTMLElement).closest<HTMLElement>('.xsel-opt:not(.disabled)');
    if (o) choose(Number(o.dataset.i));
  });
}

function typeAhead(key: string) {
  if (!open) return;
  const list = items(open.menu);
  const k = fold(key);
  const start = open.active + 1;
  for (let n = 0; n < list.length; n++) {
    const o = list[(start + n) % list.length];
    if (fold(o.textContent ?? '').trim().startsWith(k)) { highlight((start + n) % list.length); return; }
  }
}

export function initSelects() {
  document.addEventListener('mousedown', (e) => {
    if (open && !open.menu.contains(e.target as Node)) {
      const same = usable(e.target) === open.select;
      close();
      if (same) { e.preventDefault(); return; }
    }
    if (e.button !== 0 || !finePointer.matches) return;
    const select = usable(e.target);
    if (!select) return;
    e.preventDefault();
    select.focus();
    openMenu(select);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (open) {
      const list = items(open.menu);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
      if (e.key === 'Tab') { close(true); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(open.active + 1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); highlight(open.active - 1); return; }
      if (e.key === 'Home' && !open.search) { e.preventDefault(); highlight(0); return; }
      if (e.key === 'End' && !open.search) { e.preventDefault(); highlight(list.length - 1); return; }
      if (e.key === 'PageDown') { e.preventDefault(); highlight(open.active + 8); return; }
      if (e.key === 'PageUp') { e.preventDefault(); highlight(open.active - 8); return; }
      if (e.key === 'Enter' || (e.key === ' ' && !open.search)) {
        e.preventDefault();
        const o = list[open.active];
        if (o) choose(Number(o.dataset.i)); else close(true);
        return;
      }
      if (!open.search && e.key.length === 1 && !e.ctrlKey && !e.metaKey) { e.preventDefault(); typeAhead(e.key); }
      return;
    }
    const select = usable(e.target);
    if (!select || !finePointer.matches) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu(select);
    }
  }, true);

  document.addEventListener('scroll', (e) => {
    if (!open || open.menu.contains(e.target as Node)) return;
    const r = open.select.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) close(); else place(open.select, open.menu);
  }, true);
  addEventListener('resize', () => close());
  addEventListener('blur', () => close());
}
