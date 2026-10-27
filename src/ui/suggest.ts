import { esc } from './components';
import { fold } from './fold';

interface OpenSuggest {
  input: HTMLInputElement;
  menu: HTMLElement;
  values: string[];
  active: number;
}

const LIMIT = 60;
let open: OpenSuggest | null = null;
let quiet = false;

const target = (t: EventTarget | null): HTMLInputElement | null => {
  const el = t as HTMLElement | null;
  return el instanceof HTMLInputElement && el.dataset.list && !el.disabled && !el.readOnly ? el : null;
};

function close() {
  if (!open) return;
  open.menu.remove();
  open.input.classList.remove('xsel-open');
  open.input.removeAttribute('aria-expanded');
  open = null;
}

function place(input: HTMLInputElement, menu: HTMLElement) {
  const r = input.getBoundingClientRect();
  const below = innerHeight - r.bottom - 8;
  const above = r.top - 8;
  const up = below < 200 && above > below;
  menu.style.minWidth = `${Math.max(r.width, 180)}px`;
  menu.style.maxHeight = `${Math.min(320, Math.max(120, up ? above : below))}px`;
  const width = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`;
  if (up) { menu.style.top = ''; menu.style.bottom = `${innerHeight - r.top + 4}px`; } else { menu.style.bottom = ''; menu.style.top = `${r.bottom + 4}px`; }
}

function highlight(index: number) {
  if (!open) return;
  const opts = [...open.menu.querySelectorAll<HTMLElement>('.xsel-opt')];
  if (!opts.length) return;
  open.active = (index + opts.length) % opts.length;
  opts.forEach((o, i) => o.classList.toggle('active', i === open!.active));
  opts[open.active].scrollIntoView({ block: 'nearest' });
}

function choose(index: number) {
  if (!open) return;
  const { input, values } = open;
  const value = values[index];
  close();
  if (value == null) return;
  input.value = value;
  quiet = true;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  quiet = false;
}

function show(input: HTMLInputElement, all = false) {
  const list = document.getElementById(input.dataset.list!);
  const q = fold(input.value.trim());
  const options = list ? [...list.querySelectorAll('option')].map((o) => ({ value: o.value, label: o.label && o.label !== o.value ? o.label : o.textContent?.trim() && o.textContent.trim() !== o.value ? o.textContent.trim() : '' })) : [];
  const ranked = all || !q ? options : options
    .map((o) => ({ o, at: fold(o.value).indexOf(q), hit: fold(o.label).includes(q) }))
    .filter((x) => x.at >= 0 || x.hit)
    .sort((a, b) => (a.at < 0 ? 1e6 : a.at) - (b.at < 0 ? 1e6 : b.at))
    .map((x) => x.o);
  const shown = ranked.slice(0, LIMIT);
  if (!shown.length || (shown.length === 1 && fold(shown[0].value) === q)) { close(); return; }
  if (!open || open.input !== input) {
    close();
    const menu = document.createElement('div');
    menu.className = 'xsel-menu xsug-menu';
    menu.setAttribute('role', 'listbox');
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    menu.addEventListener('mousemove', (e) => {
      const o = (e.target as HTMLElement).closest<HTMLElement>('.xsel-opt');
      if (o && open && !o.classList.contains('active')) {
        open.menu.querySelectorAll('.xsel-opt.active').forEach((x) => x.classList.remove('active'));
        o.classList.add('active');
        open.active = Number(o.dataset.i);
      }
    });
    menu.addEventListener('click', (e) => {
      const o = (e.target as HTMLElement).closest<HTMLElement>('.xsel-opt');
      if (o) choose(Number(o.dataset.i));
    });
    document.body.appendChild(menu);
    open = { input, menu, values: [], active: -1 };
    input.classList.add('xsel-open');
    input.setAttribute('aria-expanded', 'true');
  }
  open.values = shown.map((o) => o.value);
  open.active = -1;
  open.menu.innerHTML = `<div class="xsel-list">${shown.map((o, i) => `<div class="xsel-opt" role="option" data-i="${i}"><span>${esc(o.value)}</span>${o.label ? `<small>${esc(o.label)}</small>` : ''}</div>`).join('')}</div>`;
  place(input, open.menu);
}

export function initSuggest() {
  document.addEventListener('focusin', (e) => {
    const input = target(e.target);
    if (input) input.setAttribute('autocomplete', 'off');
  });

  document.addEventListener('input', (e) => {
    if (quiet) return;
    const input = target(e.target);
    if (input && document.activeElement === input) show(input);
  });

  document.addEventListener('mousedown', (e) => {
    if (open && !open.menu.contains(e.target as Node) && e.target !== open.input) close();
  }, true);

  document.addEventListener('click', (e) => {
    const input = target(e.target);
    if (input && !open) show(input, !input.value.trim());
  });

  document.addEventListener('focusout', (e) => {
    if (open && e.target === open.input) close();
  });

  document.addEventListener('keydown', (e) => {
    const input = target(e.target);
    if (!input) return;
    if (!open) {
      if (e.key === 'ArrowDown' || (e.key === ' ' && e.ctrlKey)) { e.preventDefault(); show(input, !input.value.trim()); highlight(0); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(open.active + 1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); highlight(open.active - 1); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { close(); return; }
    if (e.key === 'Enter' && open.active >= 0) { e.preventDefault(); e.stopPropagation(); choose(open.active); }
  }, true);

  document.addEventListener('scroll', (e) => {
    if (!open || open.menu.contains(e.target as Node)) return;
    const r = open.input.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) close(); else place(open.input, open.menu);
  }, true);
  addEventListener('resize', () => { if (open) place(open.input, open.menu); });
}
