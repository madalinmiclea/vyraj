import { icon, reticle } from './icons';
import { tx, locale } from '../i18n';
import { isDemo } from '../storage';
import { loreText } from '../i18n/lore';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

export function windowTitle(text: string, count?: string | number | null) {
  return `<div class="window-title">${esc(text)}${count != null ? `<span class="count">${count}</span>` : ''}</div>`;
}

export interface PanelOptions { title?: string; count?: string | number; body?: string; cls?: string; bodyCls?: string; id?: string; actions?: string }

export function panel({ title, count, body = '', cls = '', bodyCls = 'panel-body', id = '', actions = '' }: PanelOptions = {}) {
  return `<section class="panel ${cls}" ${id ? `id="${id}"` : ''}>
    ${title ? `<div class="panel-head">${windowTitle(title, count)}${actions ? `<div class="panel-actions">${actions}</div>` : ''}</div>` : ''}
    <div class="${bodyCls}">${body}</div>
  </section>`;
}

export function lore(std: string, vy: string) {
  return `<span class="lore-std">${std}</span><span class="lore-vy">${loreText(vy)}</span>`;
}

export function hubChip() {
  return `<span class="hub-chip" data-tip="Jita IV - Moon 4 · Caldari Navy Assembly Plant">${icon('market')}<span>${tx('Hub principal')}</span><b>Jita 4-4</b></span>`;
}

export function pageHead(title: string, sub = '', vy = '', { hub = false } = {}) {
  return `<div class="page-head"><h1>${vy ? lore(esc(title), esc(vy)) : esc(title)}</h1>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}${hub ? hubChip() : ''}</div>`;
}

export function stampTime(at: number) {
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function dataStamp(at: number, attrs: string, { label = tx('Prețuri Jita din {time}'), title = tx('Prețurile Jita sunt păstrate până le reîmprospătezi. Click pentru a le citi din nou.') }: { label?: string; title?: string } = {}) {
  if (!at) return '';
  return `<button class="btn ghost sm data-stamp" ${attrs} title="${esc(title)}"><i class="data-stamp-dot"></i>${esc(tx(label, { time: stampTime(at) }))}${icon('refresh')}</button>`;
}

export function searchField({ id, placeholder = tx('Caută...'), large = false, hint = '' }: { id: string; placeholder?: string; large?: boolean; hint?: string }) {
  return `<label class="field ${large ? 'lg' : ''}">
    ${icon('search')}
    <input id="${id}" class="input" type="text" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" />
    ${hint ? `<kbd>${esc(hint)}</kbd>` : ''}
  </label>`;
}

export function badge(text: string, tone = '', dot = false) {
  return `<span class="badge ${tone}">${dot ? '<span class="dot"></span>' : ''}${esc(text)}</span>`;
}

export function badgeHtml(html: string, tone = '', dot = false) {
  return `<span class="badge ${tone}">${dot ? '<span class="dot"></span>' : ''}<span>${html}</span></span>`;
}

export function button(text: string, { iconName, cls = '', attrs = '' }: { iconName?: string; cls?: string; attrs?: string } = {}) {
  return `<button class="btn ${cls}" ${attrs}>${iconName ? icon(iconName) : ''}${esc(text)}</button>`;
}

export function statCard({ label, id, tone = '', meta = '' }: { label: string; id: string; tone?: string; meta?: string }) {
  return `<div class="panel stat ${tone}">
    <div class="stat-label"><i></i>${esc(label)}</div>
    <div class="stat-value" id="${id}">—</div>
    <div class="stat-meta" id="${id}Meta">${meta}</div>
  </div>`;
}

export function emptyState({ title, text = '', extra = '', vy = '', vyText = '' }: { title: string; text?: string; extra?: string; vy?: string; vyText?: string }) {
  const h = vy ? lore(esc(title), esc(vy)) : esc(title);
  const p = text && vyText ? lore(esc(text), esc(vyText)) : esc(text);
  return `<div class="empty">${reticle}<h3>${h}</h3>${text ? `<p>${p}</p>` : ''}${extra}</div>`;
}

export function loginEmpty(text: string, vyText = '') {
  const demo = isDemo() ? '' : button(tx('Încearcă cu date demo'), { iconName: 'play', cls: 'ghost', attrs: 'data-demo-start' });
  return panel({ body: emptyState({ title: tx('Niciun caracter logat'), text, vy: vyText ? 'No Capsuleer Bound' : '', vyText, extra: `<div class="row-actions empty-actions">${button(tx('Login cu EVE'), { iconName: 'login', attrs: 'data-login-open' })}${demo}</div>` }) });
}

export function loader(text: string) {
  return `<div class="scan"><div class="scan-bar"></div><p>${esc(text)}</p></div>`;
}

export function alertBox(text: string, tone = '') {
  return `<div class="alert ${tone}">${icon('alert')}<span>${esc(text)}</span></div>`;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, ms = Math.max(2200, Math.min(7000, text.length * 60))) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  let live = document.getElementById('toastLive');
  if (!live) {
    live = document.createElement('div');
    live.id = 'toastLive';
    live.className = 'sr-only';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
  }
  live.textContent = '';
  const region = live;
  requestAnimationFrame(() => { region.textContent = text; });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(root: HTMLElement, e: KeyboardEvent) {
  if (e.key !== 'Tab') return;
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
}

const titled = (title: string, id: string) => windowTitle(title).replace('<div class="window-title"', `<div id="${id}" class="window-title"`);

let modalSeq = 0;
let modalReturn: HTMLElement | null = null;

export function formatISK(amount: number, digits = 2) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
}

export function compactISK(amount: number) {
  const a = Math.abs(amount);
  if (a >= 1e12) return (amount / 1e12).toFixed(2) + 't';
  if (a >= 1e9) return (amount / 1e9).toFixed(2) + 'b';
  if (a >= 1e6) return (amount / 1e6).toFixed(2) + 'm';
  if (a >= 1e3) return (amount / 1e3).toFixed(1) + 'k';
  return amount.toFixed(2);
}

export function shortNum(n: number, small = 0) {
  const a = Math.abs(n);
  if (Number(a.toFixed(small)) < 1000) return small ? n.toFixed(small) : formatInt(n);
  const units = ['k', 'm', 'b', 't'];
  let v = a;
  let i = -1;
  while ((i < 0 || v >= 999.95) && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const r = Math.round(v * 10) / 10;
  return `${n < 0 ? '-' : ''}${Number.isInteger(r) ? r : r.toFixed(1)}${units[i]}`;
}

export function formatInt(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

export function formatNum(n: number, digits = 1) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function meter(label: string, used: number, total: number, unit = '', digits = 1) {
  const pct = total > 0 ? (used / total) * 100 : used > 0 ? 100 : 0;
  const tone = pct > 100 ? 'over' : pct > 90 ? 'high' : '';
  return `<div class="meter ${tone}">
    <div class="meter-row"><span class="meter-label">${esc(label)}</span><span class="num">${formatNum(used, digits)} / ${formatNum(total, digits)}${unit ? ' ' + esc(unit) : ''}</span></div>
    <div class="meter-track"><span style="width:${Math.min(100, pct)}%"></span></div>
  </div>`;
}

export function openModal(title: string, body: string, { wide = false } = {}): HTMLElement {
  const back = modalReturn ?? (document.activeElement as HTMLElement | null);
  closeModal(false);
  modalReturn = back;
  const id = `modalTitle${++modalSeq}`;
  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `<div class="panel modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}">
    <div class="panel-head">${titled(title, id)}<button class="btn ghost sm icon-only" data-close title="${tx('Închide')}" aria-label="${tx('Închide')}">${icon('close')}</button></div>
    <div class="panel-body">${body}</div>
  </div>`;
  el.addEventListener('click', (e) => {
    if (e.target === el || (e.target as HTMLElement).closest('[data-close]')) closeModal();
  });
  el.addEventListener('keydown', (e) => trapFocus(el, e));
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    if (el.contains(document.activeElement)) return;
    const first = el.querySelector<HTMLElement>('.panel-body textarea:not([readonly]), .panel-body input:not([type="hidden"]):not([readonly]), .panel-body select') ?? el.querySelector<HTMLElement>('[data-close]');
    first?.focus();
  });
  return el;
}

export function closeModal(restore = true) {
  const open = document.querySelectorAll('.modal-backdrop:not(.confirm-backdrop)');
  open.forEach((m) => m.remove());
  if (!restore) return;
  const back = modalReturn;
  modalReturn = null;
  if (open.length && back?.isConnected) back.focus?.();
}

export interface ConfirmOptions { title?: string; ok?: string; cancel?: string; danger?: boolean }

export function confirmDialog(message: string, { title = tx('Confirmare'), ok = tx('Continuă'), cancel = tx('Anulează'), danger = false }: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const back = document.activeElement as HTMLElement | null;
    const el = document.createElement('div');
    el.className = 'modal-backdrop confirm-backdrop';
    const id = `confirmTitle${++modalSeq}`;
    el.innerHTML = `<div class="panel modal confirm-dialog ${danger ? 'danger' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="${id}" aria-describedby="${id}m">
      <div class="panel-head">${titled(title, id)}</div>
      <div class="panel-body">
        <div class="confirm-message">${icon(danger ? 'alert' : 'info')}<p id="${id}m">${esc(message)}</p></div>
        <div class="confirm-actions"><button class="btn ghost" data-answer="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : ''}" data-answer="1">${esc(ok)}</button></div>
      </div>
    </div>`;
    const finish = (answer: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      el.remove();
      back?.focus?.();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return trapFocus(el, e);
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return finish(false);
      const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-answer]');
      finish(focused ? focused.dataset.answer === '1' : true);
    };
    el.addEventListener('click', (e) => {
      if (e.target === el) return finish(false);
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-answer]');
      if (b) finish(b.dataset.answer === '1');
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(el);
    el.querySelector<HTMLElement>('[data-answer="1"]')?.focus();
  });
}

export async function copyText(text: string, message = tx('Copiat în clipboard')) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast(tx('Nu am putut copia (clipboard blocat)'));
  }
}
