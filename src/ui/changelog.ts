import { CHANGELOG, type Release } from '../data/changelog';
import { esc, openModal } from './components';
import { tx, locale } from '../i18n';

const fmtDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });

export function release(r: Release, full: boolean) {
  return `<article class="log-entry">
    <div class="log-date">${esc(fmtDate(r.date))}</div>
    <div class="log-body">
      <h3>${esc(r.title)}</h3>
      <p class="log-lead">${esc(r.lead)}</p>
      <ul>${(full ? r.items : r.items.slice(0, 3)).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>
  </article>`;
}

export function openChangelog() {
  openModal(tx('Jurnal de schimbări'), `<div class="changelog">${CHANGELOG.map((r) => release(r, true)).join('')}</div>`, { wide: true });
}

