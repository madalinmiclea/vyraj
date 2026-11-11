import { esc } from '../ui/components';
import { lang } from '../i18n';
import { EN } from '../i18n/en';
import { pathSegment, subSegment, viewHref } from './route';

const slug = (text: string) => (lang === 'ro' ? EN[text] ?? text : text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function initSubnav() {
  const subnav = document.getElementById('subnav')!;
  let subLinks: HTMLElement[] = [];
  let pending = subSegment() ? { view: pathSegment(), sub: subSegment() } : null;
  let push = false;
  document.addEventListener('click', (e) => {
    if (e.isTrusted && (e.target as HTMLElement).closest('.side-pane.active .side-nav:not(.skill-tree) > .side-link, .subnav-btn')) push = true;
  }, true);
  window.addEventListener('popstate', () => {
    push = false;
    pending = { view: pathSegment(), sub: subSegment() };
    syncSubnav();
  });
  function syncUrl(pane: HTMLElement | null, labels: string[]) {
    const view = pathSegment();
    if (push || (pending && pending.view !== view)) pending = null;
    if (!view || pane?.id !== `pane-${view}` || subLinks.length < 2 || location.search || location.hash) return;
    const slugs = labels.map(slug);
    if (pending) {
      const i = slugs.indexOf(pending.sub ?? '');
      if (i < 0) return;
      pending = null;
      if (!subLinks[i].classList.contains('active')) { subLinks[i].click(); return; }
    }
    const active = subLinks.findIndex((l) => l.classList.contains('active'));
    if (active < 0) return;
    const target = `${viewHref(view)}/${slugs[active]}`;
    if (location.pathname !== target) history[push ? 'pushState' : 'replaceState'](null, '', target);
    push = false;
  }
  function syncSubnav() {
    const pane = document.querySelector<HTMLElement>('.side-pane.active');
    subLinks = pane ? [...pane.querySelectorAll<HTMLElement>('.side-nav:not(.skill-tree) > .side-link')] : [];
    subnav.hidden = subLinks.length < 2;
    const labels = subLinks.map((l) => {
      const c = l.cloneNode(true) as HTMLElement;
      c.querySelectorAll('.count, .ord-count, img, svg').forEach((x) => x.remove());
      return c.textContent?.trim() ?? '';
    });
    subnav.innerHTML = subLinks.map((l, i) => `<button class="subnav-btn ${l.classList.contains('active') ? 'active' : ''}" data-sub="${i}">${esc(labels[i])}</button>`).join('');
    subnav.querySelector('.subnav-btn.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    syncUrl(pane, labels);
  }
  subnav.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sub]');
    if (b) subLinks[Number(b.dataset.sub)]?.click();
  });
  const subObserver = new MutationObserver(() => syncSubnav());
  document.querySelectorAll('.side-pane').forEach((p) => subObserver.observe(p, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }));
  return syncSubnav;
}
