import type { AppContext } from '../app/context';
import { windowTitle, esc, pageHead } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { loadCosmos, loadDone, doneKey, type CosmosData } from '../services/cosmos';
import { createCosmosPanel, type CosmosLineSummary } from './pveCosmos';
import { cosmosGuide } from './cosmosGuide';
import { tx } from '../i18n';

const STATE_KEY = 'eve-cosmos:view';

type Page = 'guide' | 'line';

export interface CosmosView { show(): void; hide(): void }

export function createCosmosView(el: HTMLElement, ctx: AppContext, side: HTMLElement): CosmosView {
  const state: { page: Page } = { page: 'line', ...loadJson<{ page?: Page }>(STATE_KEY, {}) };
  if (state.page !== 'guide' && state.page !== 'line') state.page = 'line';
  let visible = false;
  let data: CosmosData | null = null;
  let lines: CosmosLineSummary[] = [];
  let active = loadJson<{ line?: string }>('eve-pve:cosmos', {}).line ?? 'caldari';

  el.innerHTML = `${pageHead('COSMOS', tx('Agenți cu misiuni unice, site-uri fixe și iteme pentru fiecare linie'), 'Zvezdy')}<div class="mis-help" data-cos-view="guide" hidden>${cosmosGuide()}</div><div data-cos-view="line" hidden></div>`;
  const guideBox = el.querySelector<HTMLElement>('[data-cos-view="guide"]')!;
  const lineBox = el.querySelector<HTMLElement>('[data-cos-view="line"]')!;
  const panel = createCosmosPanel(lineBox, ctx, {
    openGuide: () => open('guide'),
    onRender: (l, id) => { lines = l; active = id; renderSide(); },
  });

  const save = () => saveJson(STATE_KEY, state);

  function summarize() {
    if (!data) return;
    const done = loadDone(ctx.character.id);
    lines = data.lines.map((l) => {
      const a = l.agents.filter((x) => done.a.has(doneKey(l.id, x.n))).length;
      const s = l.sites.filter((x) => done.s.has(doneKey(l.id, x.n))).length;
      const i = l.items.filter((x) => done.i.has(doneKey(l.id, x.n))).length;
      return { id: l.id, name: l.name, kind: l.kind, sum: a + s + i, total: l.agents.length + l.sites.length + l.items.length };
    });
  }

  function renderSide() {
    const group = (kind: 'empire' | 'pirate', label: string) => `<div class="ord-side-label">${label}</div>${lines.filter((x) => x.kind === kind).map((x) => `<button class="side-link ${state.page === 'line' && x.id === active ? 'active' : ''}" data-cos-side-line="${esc(x.id)}">${esc(x.name)}<span class="count">${x.sum}/${x.total}</span></button>`).join('')}`;
    side.innerHTML = `<div class="sidebar-head">${windowTitle('COSMOS')}</div>
      <div class="side-nav"><div class="ord-side-label">${tx('Începe aici')}</div><button class="side-link ${state.page === 'guide' ? 'active' : ''}" data-cos-page="guide">${tx('Ghid pas cu pas')}</button>
        ${lines.length ? `${group('empire', tx('Imperii'))}${group('pirate', tx('Pirați'))}` : ''}</div>`;
  }

  function showPage() {
    guideBox.hidden = state.page !== 'guide';
    lineBox.hidden = state.page !== 'line';
    if (visible && state.page === 'line') panel.show(); else panel.hide();
  }

  function open(page: Page, line?: string) {
    state.page = page;
    save();
    if (line) { active = line; panel.setLine(line); }
    showPage();
    renderSide();
    el.closest('.main')?.scrollTo({ top: 0 });
  }

  async function loadSide() {
    try {
      data = await loadCosmos();
      if (state.page === 'guide' || !lines.length) { summarize(); renderSide(); }
    } catch {
      renderSide();
    }
  }

  side.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const l = t.closest<HTMLElement>('[data-cos-side-line]');
    if (l) { open('line', l.dataset.cosSideLine!); return; }
    if (t.closest('[data-cos-page="guide"]')) open('guide');
  });
  guideBox.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-open-tool]')) open('line');
  });
  ctx.onCharacterChange(() => { if (data) { summarize(); renderSide(); } });

  renderSide();

  return {
    show() {
      visible = true;
      showPage();
      if (!data) loadSide(); else if (state.page === 'guide') { summarize(); renderSide(); }
    },
    hide() { visible = false; panel.hide(); },
  };
}
