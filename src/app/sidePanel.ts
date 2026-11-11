import { loadJson, saveJson } from '../storage';

const SIDEBAR_KEY = 'eve-fit:ui:sidebar-scale';

export function initSidePanel(shell: HTMLElement) {
  const mobile = matchMedia('(max-width: 760px)');
  const rootStyle = document.documentElement.style;
  const setSidebarScale = (scale: number) => {
    const v = Math.min(2, Math.max(1, scale || 1));
    rootStyle.setProperty('--sidebar-scale', v.toFixed(3));
    return v;
  };
  setSidebarScale(loadJson<number>(SIDEBAR_KEY, 1));
  const resizer = document.getElementById('sideResizer')!;
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-base')) || 320;
    const startX = e.clientX;
    const startW = (resizer.parentElement as HTMLElement).getBoundingClientRect().width;
    let scale = startW / base;
    shell.classList.add('resizing');
    const move = (ev: PointerEvent) => { scale = setSidebarScale((startW + ev.clientX - startX) / base); };
    const up = () => {
      shell.classList.remove('resizing');
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', up);
      resizer.removeEventListener('pointercancel', up);
      saveJson(SIDEBAR_KEY, scale);
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
    resizer.addEventListener('pointercancel', up);
  });
  resizer.addEventListener('dblclick', () => saveJson(SIDEBAR_KEY, setSidebarScale(1)));
  const setSide = (open: boolean) => shell.classList.toggle('side-open', open && mobile.matches);
  document.getElementById('sideToggle')!.addEventListener('click', () => setSide(!shell.classList.contains('side-open')));
  document.getElementById('sideScrim')!.addEventListener('click', () => setSide(false));
  document.querySelector('.sidebar')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.tree-item, .side-link, .tree-scope-clear')) setSide(false);
  });
  mobile.addEventListener('change', () => setSide(false));
  return setSide;
}
