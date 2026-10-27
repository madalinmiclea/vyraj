const ZONE = 22;
const DELAY = 400;
const RATE = 70;

let timer = 0;
let held: { x: number; y: number; dir: 1 | -1 } | null = null;

const spinInput = (t: EventTarget | null): HTMLInputElement | null =>
  t instanceof HTMLInputElement && t.type === 'number' && !t.disabled && !t.readOnly ? t : null;

function mark() {
  if (!held) return;
  const el = spinInput(document.elementFromPoint(held.x, held.y));
  if (el) el.dataset.spin = held.dir > 0 ? 'up' : 'down';
}

function zone(el: HTMLInputElement, x: number, y: number): 1 | -1 | 0 {
  const r = el.getBoundingClientRect();
  if (x < r.right - ZONE || x > r.right || y < r.top || y > r.bottom) return 0;
  return y < r.top + r.height / 2 ? 1 : -1;
}

function step(el: HTMLInputElement, dir: 1 | -1) {
  const before = el.value;
  try {
    if (dir > 0) el.stepUp(); else el.stepDown();
  } catch {
    const s = Number(el.step) || 1;
    el.value = String((Number(el.value) || 0) + dir * s);
  }
  if (el.value === before) return;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function tick() {
  if (!held) return;
  const el = spinInput(document.elementFromPoint(held.x, held.y));
  if (el) step(el, held.dir);
  mark();
}

function stop() {
  held = null;
  clearTimeout(timer);
  clearInterval(timer);
}

export function initNumberSpin() {
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = spinInput(e.target);
    if (!el) return;
    const dir = zone(el, e.clientX, e.clientY);
    if (!dir) return;
    e.preventDefault();
    stop();
    held = { x: e.clientX, y: e.clientY, dir };
    step(el, dir);
    mark();
    timer = window.setTimeout(() => { timer = window.setInterval(tick, RATE); }, DELAY);
  });
  document.addEventListener('mousedown', (e) => {
    const el = spinInput(e.target);
    if (el && zone(el, e.clientX, e.clientY)) e.preventDefault();
  });
  document.addEventListener('dblclick', (e) => {
    const el = spinInput(e.target);
    if (el && zone(el, e.clientX, e.clientY)) e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => {
    const el = spinInput(e.target);
    if (held && (!el || zone(el, e.clientX, e.clientY) !== held.dir)) stop();
    if (!el) return;
    const dir = zone(el, e.clientX, e.clientY);
    const v = dir > 0 ? 'up' : dir < 0 ? 'down' : '';
    if ((el.dataset.spin ?? '') !== v) { if (v) el.dataset.spin = v; else delete el.dataset.spin; }
  });
  document.addEventListener('pointerout', (e) => {
    const el = spinInput(e.target);
    if (el) delete el.dataset.spin;
  });
  for (const ev of ['pointerup', 'pointercancel', 'blur'] as const) window.addEventListener(ev, stop);
}
