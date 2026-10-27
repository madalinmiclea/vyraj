const DELAY = 350;
const OWN_TIP = '.theme-switch button, .neocom-btn';

let tip: HTMLElement | null = null;
let host: Element | null = null;
let timer = 0;

function element() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'xtip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function textOf(el: Element) {
  return el.getAttribute('data-xtitle') ?? el.getAttribute('data-tip') ?? '';
}

function position(el: Element) {
  const t = element();
  const r = el.getBoundingClientRect();
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  const above = r.top - h - 8 >= 4;
  t.classList.toggle('below', !above);
  t.style.top = `${above ? r.top - h - 8 : r.bottom + 8}px`;
  t.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2))}px`;
}

function show(el: Element) {
  const text = textOf(el);
  if (!text || !el.isConnected) return;
  const t = element();
  t.textContent = text;
  t.classList.add('show');
  position(el);
}

function release() {
  clearTimeout(timer);
  tip?.classList.remove('show');
  if (host?.hasAttribute('data-xtitle')) {
    if (!host.hasAttribute('title')) host.setAttribute('title', host.getAttribute('data-xtitle')!);
    host.removeAttribute('data-xtitle');
  }
  host = null;
}

function grab(el: Element) {
  if (el === host) return;
  release();
  host = el;
  const title = el.getAttribute('title');
  if (title) {
    el.setAttribute('data-xtitle', title);
    el.removeAttribute('title');
  }
  timer = window.setTimeout(() => show(el), DELAY);
}

export function initTooltips() {
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  document.addEventListener('mouseover', (e) => {
    if (!fine.matches) return;
    const el = (e.target as Element).closest?.('[title], [data-xtitle], [data-tip]');
    if (!el || (el.matches(OWN_TIP) && !el.hasAttribute('title'))) { if (host && !host.contains(e.target as Node)) release(); return; }
    grab(el);
  });
  document.addEventListener('mouseout', (e) => {
    if (host && !host.contains(e.relatedTarget as Node)) release();
  });
  document.addEventListener('mousedown', release, true);
  document.addEventListener('scroll', release, true);
  addEventListener('blur', release);
}
