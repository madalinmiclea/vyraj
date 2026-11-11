import type { ViewId } from './views';
import { canInstall, installApp, INSTALL_EVENT } from '../services/pwa';

export function initNeocom(switchView: (id: ViewId) => void) {
  document.getElementById('neocomMore')!.addEventListener('click', (e) => {
    e.stopPropagation();
    const sheet = document.getElementById('neocomSheet')!;
    sheet.hidden = !sheet.hidden;
  });
  document.getElementById('neocomSheet')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.sheet-btn[data-view]');
    const me = e as MouseEvent;
    if (btn && !(me.metaKey || me.ctrlKey || me.shiftKey || me.altKey || me.button !== 0)) { e.preventDefault(); switchView(btn.dataset.view as ViewId); }
    if ((e.target as HTMLElement).closest('#sheetInstall')) { e.stopPropagation(); document.getElementById('neocomSheet')!.hidden = true; installApp(); }
  });
  const syncInstall = () => { document.getElementById('sheetInstall')!.hidden = !canInstall(); };
  syncInstall();
  window.addEventListener(INSTALL_EVENT, syncInstall);
  document.addEventListener('click', (e) => {
    const sheet = document.getElementById('neocomSheet')!;
    if (!sheet.hidden && !sheet.contains(e.target as Node)) sheet.hidden = true;
  });

  document.querySelector<HTMLElement>('.neocom')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.neocom-btn[data-view]');
    if (!btn || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    switchView(btn.dataset.view as ViewId);
  });
}
