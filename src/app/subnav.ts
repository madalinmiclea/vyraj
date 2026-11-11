import { esc } from '../ui/components';

export function initSubnav() {
  const subnav = document.getElementById('subnav')!;
  let subLinks: HTMLElement[] = [];
  function syncSubnav() {
    const pane = document.querySelector<HTMLElement>('.side-pane.active');
    subLinks = pane ? [...pane.querySelectorAll<HTMLElement>('.side-nav:not(.skill-tree) > .side-link')] : [];
    subnav.hidden = subLinks.length < 2;
    subnav.innerHTML = subLinks.map((l, i) => {
      const c = l.cloneNode(true) as HTMLElement;
      c.querySelectorAll('.count, .ord-count, img, svg').forEach((x) => x.remove());
      return `<button class="subnav-btn ${l.classList.contains('active') ? 'active' : ''}" data-sub="${i}">${esc(c.textContent?.trim() ?? '')}</button>`;
    }).join('');
    subnav.querySelector('.subnav-btn.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  subnav.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sub]');
    if (b) subLinks[Number(b.dataset.sub)]?.click();
  });
  const subObserver = new MutationObserver(() => syncSubnav());
  document.querySelectorAll('.side-pane').forEach((p) => subObserver.observe(p, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }));
  return syncSubnav;
}
