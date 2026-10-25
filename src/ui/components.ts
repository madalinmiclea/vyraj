import { icon, reticle } from './icons';
import { tx } from '../i18n';

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
  return `<span class="lore-std">${std}</span><span class="lore-vy">${vy}</span>`;
}

export function pageHead(title: string, sub = '', vy = '') {
  return `<div class="page-head"><h1>${vy ? lore(esc(title), esc(vy)) : esc(title)}</h1>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;
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

export function emptyState({ title, text = '', extra = '' }: { title: string; text?: string; extra?: string }) {
  return `<div class="empty">${reticle}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${extra}</div>`;
}

export function loader(text: string) {
  return `<div class="scan"><div class="scan-bar"></div><p>${esc(text)}</p></div>`;
}

export function alertBox(text: string, tone = '') {
  return `<div class="alert ${tone}">${icon('alert')}<span>${esc(text)}</span></div>`;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 1800);
}

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
  closeModal();
  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `<div class="panel modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="panel-head">${windowTitle(title)}<button class="btn ghost sm icon-only" data-close title="${tx('Închide')}">${icon('close')}</button></div>
    <div class="panel-body">${body}</div>
  </div>`;
  el.addEventListener('click', (e) => {
    if (e.target === el || (e.target as HTMLElement).closest('[data-close]')) closeModal();
  });
  document.body.appendChild(el);
  return el;
}

export function closeModal() {
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
}

export async function copyText(text: string, message = tx('Copiat în clipboard')) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast(tx('Nu am putut copia (clipboard blocat)'));
  }
}
