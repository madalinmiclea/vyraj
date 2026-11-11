import type { AppContext } from '../app/context';
import {
  droneLimit, ensureDroneLimits, newFitId, buildDogma, SLOT_KINDS, slotOf, cloneFit, emptyFit, fitContents, slotCounts,
  type Fit, type SlotKind,
} from '../engine/fit';
import type { Dogma } from '../engine/dogma';
import { applyChecked, violations } from '../engine/rules';
import { computeStats } from '../engine/stats';
import { findProfile } from '../engine/profiles';
import { requirementsFor, fitTypeIds } from '../character/requirements';
import { allCharacters, allLevels, findCharacter } from '../character/characters';
import { exportMultibuy } from '../io/eft';
import { shareUrl } from '../io/shareLink';
import { openShareModal } from '../ui/shareModal';
import { typeIconUrl } from '../services/market';
import { loadFits, saveFit } from '../fitting/savedFits';
import { loadJson, saveJson } from '../storage';
import { icon } from '../ui/icons';
import { button, confirmDialog, copyText, emptyState, esc, pageHead, panel, toast } from '../ui/components';
import { CURRENT_KEY, EXTRAS_KEY, MAX_TABS, OPEN_KEY, PROFILE_KEY, TARGET_KEY, GROUPS, parseSlot, proving, type ExtrasTab, type TargetState, type FitEnv } from '../fitting/shared';
import { showItemInfo, skillPlanText } from '../ui/itemInfo';
import { bindBreakdownTips } from '../ui/breakdown';
import { TARGETS } from '../engine/application';
import { addItemToPlan, loadPlan, savePlan } from '../character/skillPlan';
import { tx } from '../i18n';
import { allEveItems } from '../data/items';
import type { BrowserScope } from '../ui/sidebar';
import { createStatsPanels } from '../fitting/stats';
import { createFitModals } from '../fitting/modals';
import { openTracking } from '../fitting/tracking';
import { createSupportPanels } from '../fitting/support';
import { createImplantPanel } from '../fitting/implants';
import { fitCharacter } from '../fitting/implantSets';
import { createImprovementPanel } from '../fitting/improvement';
import { createNpcPanel } from '../fitting/npc';
import { createFitLayout } from '../fitting/layout';
import { createCostPanel } from '../fitting/cost';
import { createFitSwap } from '../fitting/swap';
import { createFitEdit } from '../fitting/edit';
import { findRealFit, type RealFitKind } from '../services/realFits';
import { buildStarterFit } from '../engine/starter';

export const FITTING_CATEGORIES = ['Ships', 'Ship Equipment', 'Ship and Module Modifications', 'Ammunition & Charges', 'Drones', 'Implants & Boosters'];

export interface FittingView {
  selectItem(name: string, typeId: number | null): void;
  load(fit: Fit): void;
  loadIncoming(fit: Fit): Promise<boolean>;
  clearSlot(): void;
  setNpc(site: string, faction: string): void;
  current(): Fit | null;
}

export function createFittingView(el: HTMLElement, app: AppContext, onSlot: (scope: BrowserScope | null) => void = () => {}): FittingView {
  let fitChar = app.character;
  const ctx: AppContext = Object.create(app, { character: { get: () => fitChar } });
  const sde = ctx.sde;
  const limitDrones = (f: Fit) => ensureDroneLimits(sde, f, droneLimit(sde, f, ctx.character.skills, fitCharacter(ctx.character).implants));
  const usable = (f: Fit | null | undefined) => (f && sde.types.has(f.shipId) ? limitDrones(f) : null);
  const stored = loadJson<{ fits: (Fit | null)[]; active: number } | null>(OPEN_KEY, null);
  let tabs: (Fit | null)[] = stored?.fits?.length ? stored.fits.map(usable) : [usable(loadJson<Fit | null>(CURRENT_KEY, null))];
  let active = Math.min(Math.max(0, stored?.active ?? 0), tabs.length - 1);
  let fit: Fit | null = tabs[active];
  let extrasTab = loadJson<ExtrasTab>(EXTRAS_KEY, 'drones');
  let dragFrom = -1;
  let profileId = loadJson<string>(PROFILE_KEY, 'Generic/Uniform');
  let targetState = loadJson<TargetState>(TARGET_KEY, { id: 'cruiser', signature: 125, velocity: 200, distanceKm: 30 });
  let lastDogma: Dogma | null = null;

  const name = (id: number) => sde.types.get(id)?.name ?? `Type ${id}`;
  let pickedSlot: SlotKind | null = null;
  const slotIds = new Map<SlotKind, Set<number>>();
  const idsForSlot = (kind: SlotKind) => {
    if (!slotIds.has(kind)) slotIds.set(kind, new Set(allEveItems.filter((it) => slotOf(sde, it.t) === kind).map((it) => it.t)));
    return slotIds.get(kind)!;
  };
  function pickSlot(kind: SlotKind | null) {
    pickedSlot = kind;
    el.querySelectorAll<HTMLElement>('.slot-group').forEach((g) => g.classList.toggle('picked', g.dataset.group === kind));
    onSlot(kind ? { label: GROUPS.find((g) => g.key === kind)!.label, ids: idsForSlot(kind) } : null);
  }

  el.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.classList.contains('slot-empty')) { e.preventDefault(); t.click(); }
  });

  el.innerHTML = `
    ${pageHead(tx('Fitting'), tx('Hangar · simulare pe skill-urile pilotului'), 'Proving')}
    <section class="panel fit-toolbar">
      <div class="panel-body">
        <input class="input plain fit-name" id="fitName" placeholder="${tx('Numele fit-ului')}" />
        <label class="select-field"><span>${tx('Caracter')}</span><select class="input plain" id="fitCharacter"></select></label>
        <div class="toolbar-actions">
          ${button(tx('Salvează'), { iconName: 'save', cls: 'sm', attrs: 'data-action="save"' })}
          ${button(tx('Fit-uri'), { iconName: 'fitting', cls: 'ghost sm', attrs: 'data-action="saved"' })}
          ${button(tx('Importă'), { iconName: 'upload', cls: 'ghost sm', attrs: 'data-action="import"' })}
          ${button(tx('Exportă'), { iconName: 'download', cls: 'ghost sm', attrs: 'data-action="export"' })}
          ${button(tx('Share'), { iconName: 'link', cls: 'sm', attrs: `data-action="share" title="${tx('Trimite un link care deschide fit-ul direct în Vyraj')}"` })}
          <details class="more-menu">
            <summary class="btn ghost sm">${icon('chevron')}${tx('Mai mult')}</summary>
            <div class="more-list">
              ${button(tx('Salvează ca nou'), { iconName: 'plus', cls: 'ghost sm', attrs: `data-action="save-as" title="${tx('Păstrează fit-ul salvat și creează o copie nouă')}"` })}
              ${button(tx('Compară'), { iconName: 'compare', cls: 'ghost sm', attrs: 'data-action="compare"' })}
              ${button('EVE', { iconName: 'login', cls: 'ghost sm', attrs: `data-action="esi" title="${tx('Fit-urile salvate în joc')}"` })}
              ${button(tx('Navele mele'), { iconName: 'ship', cls: 'ghost sm', attrs: `data-action="ships" title="${tx('Navele asamblate din hangare, cu ce au montat')}"` })}
            </div>
          </details>
        </div>
      </div>
    </section>
    <div class="fit-tabs" id="fitTabs"></div>
    <div class="fit-layout">
      <div class="stack" id="fitLeft"></div>
      <div class="stack" id="fitRight"></div>
    </div>
  `;
  const left = el.querySelector<HTMLElement>('#fitLeft')!;
  const tabsEl = el.querySelector<HTMLElement>('#fitTabs')!;
  const right = el.querySelector<HTMLElement>('#fitRight')!;
  const tips = new Map<string, string>();
  bindBreakdownTips(right, (k) => tips.get(k));
  const env: FitEnv = {
    sde,
    ctx,
    getFit: () => fit,
    setFit: (next, clean) => {
      if (!next) return Promise.resolve(false);
      return openFit(next).then((ok) => { if (ok && clean && fit) { pristine.set(fit.id, JSON.stringify(fit)); render(); } return ok; });
    },
    change: (fn) => change(fn),
    profileId: () => profileId,
    targetState: () => targetState,
    name,
  };
  const { buildTips, statsPanels, requirementsPanel, handleAmmo } = createStatsPanels(env, tips);
  const support = createSupportPanels(env);
  const implantPanel = createImplantPanel(env);
  const improvement = createImprovementPanel(env);
  const npc = createNpcPanel(env, tips);
  const { openSavedFits, openImport, openExport, openCompare, openMutation, openShips, openEsi } = createFitModals(env);
  const layout = createFitLayout(env, { support, implantPanel, pickedSlot: () => pickedSlot, extrasTab: () => extrasTab });
  const cost = createCostPanel(env, el);
  const swap = createFitSwap(env, { dogma: () => lastDogma, render });
  const nameInput = el.querySelector<HTMLInputElement>('#fitName')!;
  const charSelect = el.querySelector<HTMLSelectElement>('#fitCharacter')!;
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.more-menu')) el.querySelectorAll<HTMLDetailsElement>('.more-menu[open]').forEach((d) => { d.open = false; });
  });

  function renderCharacters() {
    charSelect.innerHTML = allCharacters(sde).map((c) => `<option value="${esc(c.id)}" ${c.id === ctx.character.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  }

  const pristine = new Map<string, string>();

  function persist() {
    tabs[active] = fit;
    saveJson(OPEN_KEY, { fits: tabs, active });
    saveJson(CURRENT_KEY, fit);
  }

  function isDirty(f: Fit, saved: Map<string, string>) {
    const was = saved.get(f.id) ?? pristine.get(f.id);
    if (was != null) return was !== JSON.stringify(f);
    return SLOT_KINDS.some((k) => f.slots[k].some(Boolean)) || f.drones.length > 0 || f.cargo.length > 0 || f.implants.length > 0 || !!f.notes?.trim();
  }

  function markClean() {
    if (!fit) return;
    pristine.set(fit.id, JSON.stringify(fit));
    renderTabs();
  }

  function savedJson() {
    return new Map(loadFits().map((f) => [f.id, JSON.stringify(f)]));
  }

  function renderTabs() {
    const saved = savedJson();
    tabsEl.innerHTML = tabs.map((f, i) => `<div class="fit-tab ${i === active ? 'active' : ''}" data-fit-tab="${i}" draggable="true" title="${f ? esc(`${f.name} · ${name(f.shipId)}`) : ''}">
        ${f ? `<img src="${typeIconUrl(f.shipId, 32)}" alt="" />` : `<span class="fit-tab-ico">${icon('ship')}</span>`}
        <span class="fit-tab-name">${f ? esc(f.name) : tx('Tab gol')}</span>
        ${f && isDirty(f, saved) ? `<span class="fit-tab-dirty" title="${tx('Modificări nesalvate')}"></span>` : ''}
        <button class="fit-tab-close" data-fit-close="${i}" title="${tx('Închide tab-ul')}">${icon('close')}</button>
      </div>`).join('') + `<button class="fit-tab-add" data-fit-add="1" title="${tx('Tab nou')}">${icon('plus')}</button>`;
  }

  function switchTab(i: number) {
    if (i === active || i < 0 || i >= tabs.length) return;
    tabs[active] = fit;
    active = i;
    fit = tabs[i];
    if (fit) limitDrones(fit);
    if (pickedSlot) pickSlot(null);
    render();
  }

  function addTab(next: Fit | null): boolean {
    if (tabs.length >= MAX_TABS) { toast(tx('Poți avea maxim {n} fit-uri deschise. Închide un tab ca să deschizi altul.', { n: MAX_TABS })); return false; }
    tabs[active] = fit;
    tabs.push(next);
    active = tabs.length - 1;
    fit = next;
    if (pickedSlot) pickSlot(null);
    render();
    return true;
  }

  async function replaceCurrent(f: Fit, incoming = false): Promise<boolean> {
    if (incoming && fit && fit.id !== f.id && isDirty(fit, savedJson())) {
      if (await confirmDialog(tx('„{name}” are modificări nesalvate. Îl salvez și deschid „{next}” din link?', { name: fit.name, next: f.name }), { ok: tx('Salvează și deschide'), cancel: tx('Rămân pe fitul curent') })) {
        saveFit(fit);
      } else {
        saveFit(f);
        renderTabs();
        toast(tx('„{name}” din link a fost pus în Fituri salvate.', { name: f.name }));
        return false;
      }
    }
    if (!incoming && fit && fit.id !== f.id && isDirty(fit, savedJson()) && !(await confirmDialog(tx('„{name}” are modificări nesalvate. Le pierzi și încarci „{next}” în tab-ul ăsta?', { name: fit.name, next: f.name }), { ok: tx('Pierde modificările'), danger: true }))) return false;
    fit = f;
    tabs[active] = f;
    if (pickedSlot) pickSlot(null);
    render();
    return true;
  }

  async function openFit(next: Fit, incoming = false): Promise<boolean> {
    const f = limitDrones(next);
    const same = tabs.findIndex((x) => x?.id === f.id);
    if (same < 0) return replaceCurrent(f, incoming);
    tabs[active] = fit;
    active = same;
    fit = f;
    tabs[active] = f;
    if (pickedSlot) pickSlot(null);
    render();
    return true;
  }

  async function closeTab(i: number) {
    const f = tabs[i];
    if (f && isDirty(f, savedJson())) {
      if (!(await confirmDialog(tx('„{name}” are modificări nesalvate. Închizi tab-ul?', { name: f.name }), { ok: tx('Închide tab-ul'), danger: true }))) return;
      tabs[active] = fit;
      i = tabs.findIndex((x) => x?.id === f.id);
      if (i < 0) return;
    }
    tabs[active] = fit;
    tabs.splice(i, 1);
    if (!tabs.length) tabs = [null];
    if (i < active || active >= tabs.length) active = Math.max(0, active - 1);
    fit = tabs[active];
    if (fit) limitDrones(fit);
    if (pickedSlot) pickSlot(null);
    render();
  }

  function moveTab(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) return;
    tabs[active] = fit;
    const current = tabs[active];
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    active = tabs.indexOf(current);
    persist();
    renderTabs();
  }

  function render() {
    renderTabs();
    nameInput.value = fit?.name ?? '';
    nameInput.disabled = !fit;
    el.querySelectorAll<HTMLButtonElement>('.fit-toolbar [data-action="save"], .fit-toolbar [data-action="export"], .fit-toolbar [data-action="share"], .fit-toolbar [data-action="save-as"], .fit-toolbar [data-action="compare"]').forEach((b) => { b.disabled = !fit; });
    if (!fit) {
      left.innerHTML = panel({
        body: emptyState({
          title: tx('Alege o navă'),
          text: tx('Deschide „Nave” în browserul de iteme și apasă pe o navă. Apoi apasă pe module, muniție sau drone ca să le montezi. Poți și importa un fit EFT din joc sau din Pyfa.'),
          vy: 'Choose the Hull to Prove',
          vyText: 'Open “Ships” in the item browser and select a hull. Then bind modules, charges or drones to it. A fit from the game or from Pyfa may also be woven in through EFT import.',
          extra: `<div class="chips">${['Rifter', 'Drake', 'Gila', 'Ishtar', 'Golem'].map((n) => button(n, { cls: 'ghost sm', attrs: `data-quick="${n}"` })).join('')}</div>`,
        }),
      });
      const saved = loadFits().slice(0, 12);
      right.innerHTML = saved.length ? panel({
        title: tx('Fit-uri salvate'),
        count: loadFits().length,
        actions: button(tx('Toate'), { cls: 'ghost sm', attrs: 'data-action="saved"' }),
        body: `<div class="item-tiles one-col">${saved.map((f) => `<button class="item-tile" data-open-fit="${esc(f.id)}"><img src="${typeIconUrl(f.shipId, 32)}" alt="" loading="lazy" /><span class="tile-text"><span>${esc(f.name)}</span><small>${esc(name(f.shipId))}</small></span></button>`).join('')}</div>`,
      }) : '';
      persist();
      return;
    }
    support.ensureMode(fit);
    const d = buildDogma(sde, fit, fitCharacter(ctx.character));
    lastDogma = d;
    const stats = computeStats(sde, fit, d, findProfile(profileId));
    const counts = slotCounts(sde, fit, d);
    left.innerHTML = layout.shipHeader(fit, stats) + layout.slotsPanel(fit, counts, stats.resources) + layout.extrasPanel(fit, stats, d) + implantPanel.render(fit, d) + improvement.render(fit) + cost.render();
    buildTips(d);
    right.innerHTML = statsPanels(stats, d) + npc.render(stats, d) + support.heatPanel(stats.heat) + requirementsPanel(fit);
    persist();
    cost.load(fit);
    improvement.refresh(fit);
  }

  async function newFit(shipId: number): Promise<boolean> {
    if (fit && isDirty(fit, savedJson()) && !(await confirmDialog(tx('„{name}” are modificări nesalvate. Le pierzi și începi un fit nou pe {ship}?', { name: fit.name, ship: name(shipId) }), { ok: tx('Pierde modificările'), danger: true }))) return false;
    fit = limitDrones(emptyFit(shipId, name(shipId)));
    tabs[active] = fit;
    if (pickedSlot) pickSlot(null);
    render();
    return true;
  }

  function openStarter(shipId: number, kind: RealFitKind, trigger: HTMLElement) {
    const label = kind === 'pve' ? 'PvE' : 'PvP';
    const done = () => { trigger.classList.remove('busy'); trigger.removeAttribute('disabled'); };
    trigger.classList.add('busy');
    trigger.setAttribute('disabled', '');
    const open = async (f: Fit, published: boolean) => {
      f.id = newFitId();
      if (!(await replaceCurrent(limitDrones(f)))) { done(); return; }
      markClean();
      const problems = violations(sde, f, ctx.character.skills, fitCharacter(ctx.character).implants).size;
      const what = published ? tx('Fit {kind} publicat încărcat în tab-ul curent', { kind: label }) : tx('Nu există fit {kind} publicat pentru nava asta, am deschis unul generat din bonusurile și statisticile ei', { kind: label });
      toast(problems ? `${what}. ${tx('Ce nu încape cu skill-urile caracterului apare cu roșu.')}` : what);
    };
    findRealFit(sde, shipId, kind).catch(() => null).then((found) => {
      if (found) { void open(cloneFit(found.fit), !found.generated); return; }
      setTimeout(() => {
        const note = tx('Fit {kind} generat din bonusurile, sloturile, punctele de montaj, CPU și powergrid ale navei, cu module T2, pentru că nu am găsit un fit publicat. Modifică-l după cum zbori.', { kind: label });
        void open(buildStarterFit(sde, shipId, kind, allLevels(sde, 5), `${name(shipId)} ${label}`, note), false);
      }, 30);
    });
  }

  function showExtras(key: ExtrasTab) {
    extrasTab = key;
    saveJson(EXTRAS_KEY, key);
  }

  function change(fn: (draft: Fit) => void) {
    if (!fit) return;
    const result = applyChecked(sde, fit, ctx.character.skills, (draft) => { fn(draft); }, fitCharacter(ctx.character).implants);
    if (!result.ok) toast(proving(result.message));
    render();
  }

  const edit = createFitEdit(env, { el, left, support, openMutation, render, newFit, extrasTab: () => extrasTab, showExtras, pickedSlot: () => pickedSlot, pickSlot });
  const selectItem = edit.selectItem;

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const at = (sel: string) => target.closest<HTMLElement>(sel);
    if (npc.handleClick(target)) { render(); return; }
    if (target.closest('[data-ammo-del]') && handleAmmo(target)) { render(); return; }
    if (improvement.handleClick(target)) return;
    if (implantPanel.handleClick(target, render)) return;

    const tabClose = at('[data-fit-close]');
    if (tabClose) { void closeTab(Number(tabClose.dataset.fitClose)); return; }
    if (at('[data-fit-add]')) { addTab(null); return; }
    const fitTab = at('[data-fit-tab]');
    if (fitTab) { switchTab(Number(fitTab.dataset.fitTab)); return; }
    const extras = at('[data-extras]');
    if (extras) { showExtras(extras.dataset.extras as ExtrasTab); render(); return; }
    if (fit && support.handleClick(target)) return;
    const openSaved = at('[data-open-fit]');
    if (openSaved) { const f = loadFits().find((x) => x.id === openSaved.dataset.openFit); if (f) void openFit(cloneFit(f)); return; }
    const quick = at('[data-quick]');
    if (quick) { selectItem(quick.dataset.quick!, null); return; }
    const info = at('[data-info]');
    if (info) {
      const row = info.dataset.infoCharge ? null : info.closest<HTMLElement>('.slot.fitted[data-slot]');
      showItemInfo(ctx, Number(info.dataset.info), swap.fittedItem(info), row ? swap.swapContext(...parseSlot(row.dataset.slot!)) : undefined);
      return;
    }
    const starter = at('[data-starter]');
    if (starter) { if (fit) openStarter(fit.shipId, starter.dataset.starter as RealFitKind, starter); return; }
    const action = at('[data-action]')?.dataset.action;
    if (action) { runAction(action); return; }
    edit.click(at);
  });

  tabsEl.addEventListener('auxclick', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-fit-tab]');
    if (tab && e.button === 1) { e.preventDefault(); void closeTab(Number(tab.dataset.fitTab)); }
  });
  tabsEl.addEventListener('mousedown', (e) => { if (e.button === 1 && (e.target as HTMLElement).closest('[data-fit-tab]')) e.preventDefault(); });
  tabsEl.addEventListener('dragstart', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-fit-tab]');
    if (!tab) return;
    dragFrom = Number(tab.dataset.fitTab);
    e.dataTransfer?.setData('text/plain', String(dragFrom));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  tabsEl.addEventListener('dragover', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-fit-tab]');
    if (tab && dragFrom >= 0) e.preventDefault();
  });
  tabsEl.addEventListener('drop', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-fit-tab]');
    if (!tab || dragFrom < 0) return;
    e.preventDefault();
    moveTab(dragFrom, Number(tab.dataset.fitTab));
    dragFrom = -1;
  });
  tabsEl.addEventListener('dragend', () => { dragFrom = -1; });

  el.addEventListener('input', (e) => {
    const target = e.target as HTMLTextAreaElement;
    if (target.id !== 'fitNotes' || !fit) return;
    fit.notes = target.value;
    persist();
    renderTabs();
  });

  el.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    if (target === charSelect) { fitChar = findCharacter(sde, charSelect.value); onCharacter(); return; }
    if (target.matches('[data-ammo-add]') && handleAmmo(target)) { render(); return; }
    if (fit && support.handleChange(target)) return;
    if (npc.handleChange(target)) { render(); return; }
    if (implantPanel.handleChange(target)) { render(); return; }
    if (target.id === 'fitProfile') { profileId = target.value; saveJson(PROFILE_KEY, profileId); render(); return; }
    if (target.id === 'fitTarget') {
      const preset = TARGETS.find((t) => t.id === target.value);
      targetState = { ...targetState, id: target.value, ...(preset ? { signature: preset.signature, velocity: preset.velocity } : {}) };
      saveJson(TARGET_KEY, targetState);
      render();
      return;
    }
    if (target.dataset.targetField) {
      const v = Math.max(0, Number(target.value) || 0);
      targetState = { ...targetState, [target.dataset.targetField]: v };
      saveJson(TARGET_KEY, targetState);
      render();
      return;
    }
    edit.change(target);
  });

  nameInput.addEventListener('change', () => {
    if (!fit) return;
    fit.name = nameInput.value.trim() || name(fit.shipId);
    persist();
    renderTabs();
  });

  function runAction(action: string) {
    el.querySelectorAll<HTMLDetailsElement>('.more-menu[open]').forEach((d) => { d.open = false; });
    switch (action) {
      case 'clear':
        if (fit) void newFit(fit.shipId);
        break;
      case 'save':
        if (!fit) return toast(tx('Nu ai niciun fit de salvat'));
        saveFit(fit);
        renderTabs();
        toast(tx('Fit salvat'));
        break;
      case 'save-as':
        if (!fit) return toast(tx('Nu ai niciun fit de salvat'));
        fit.id = newFitId();
        {
          const names = new Set(loadFits().map((f) => f.name));
          const base = fit.name.replace(/ \(\d+\)$/, '');
          let n = 2;
          if (names.has(fit.name)) { while (names.has(`${base} (${n})`)) n++; fit.name = `${base} (${n})`; }
        }
        saveFit(fit);
        render();
        toast(tx('Salvat ca fit nou: {name}', { name: fit.name }));
        break;
      case 'show-problems': {
        const box = el.querySelector<HTMLElement>('#fitWarnings');
        if (!box) break;
        box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        box.classList.remove('flash');
        void box.offsetWidth;
        box.classList.add('flash');
        break;
      }
      case 'saved':
        return openSavedFits();
      case 'import':
        return openImport();
      case 'export':
        return openExport();
      case 'share': {
        if (!fit) return toast(tx('Nu ai niciun fit'));
        const shared = fit;
        shareUrl(shared).then(({ long, shorten }) => openShareModal(long, {
          title: tx('Share fit'),
          text: tx('Fit {name} ({ship}) în Vyraj', { name: shared.name, ship: sde.types.get(shared.shipId)?.name ?? '' }),
          hint: shared.notes?.trim() ? tx('Linkul scurt se salvează pe serverul Vyraj, cu tot cu notițele fitului.') : tx('Linkul scurt se salvează pe serverul Vyraj.'),
          shorten,
        })).catch(() => toast(tx('Browserul nu poate crea linkul de fit')));
        break;
      }
      case 'compare':
        return openCompare();
      case 'esi':
        return openEsi();
      case 'tracking':
        return openTracking(env);
      case 'ships':
        return openShips();
      case 'cost-refresh':
        cost.refresh();
        break;
      case 'multibuy':
        if (fit) copyText(exportMultibuy(sde, fitContents(sde, fit, true)), tx('Lista Multibuy copiată'));
        break;
      case 'plan-fit':
        if (fit) {
          const c = ctx.character;
          savePlan(c.id, fitTypeIds(fit).reduce((p, id) => addItemToPlan(sde, p, c, id), loadPlan(c.id)));
          toast(tx('Adăugat în planul de skill-uri'));
        }
        break;
      case 'copy-plan':
        if (fit) copyText(skillPlanText(requirementsFor(sde, fitTypeIds(fit), ctx.character).missing), tx('Plan copiat (lipește-l în Skill Plans din joc)'));
        break;
    }
  }

  renderCharacters();
  let shownCharacter = ctx.character.id;
  let globalCharacter = app.character.id;
  app.onCharacterChange(() => {
    fitChar = app.character.id !== globalCharacter ? app.character : findCharacter(sde, fitChar.id);
    globalCharacter = app.character.id;
    onCharacter();
  });
  function onCharacter() {
    renderCharacters();
    if (fit && shownCharacter !== ctx.character.id) {
      limitDrones(fit);
      const problems = [...violations(sde, fit, ctx.character.skills, fitCharacter(ctx.character).implants).values()];
      if (problems.length) toast(proving(tx('Fit-ul nu încape cu skill-urile lui {name}: {why}', { name: ctx.character.name, why: problems[0] })));
    }
    shownCharacter = ctx.character.id;
    render();
  }
  render();

  return {
    selectItem,
    load(f: Fit) {
      const wasOpen = tabs.some((x) => x?.id === f.id);
      void openFit(cloneFit(f)).then((ok) => { if (ok && !wasOpen) markClean(); });
    },
    loadIncoming(f: Fit) { return openFit(cloneFit(f), true); },
    clearSlot() { if (pickedSlot) pickSlot(null); },
    setNpc(site: string, faction: string) { npc.setScenario(site, faction); render(); },
    current() { return fit && fit.shipId ? cloneFit(fit) : null; },
  };
}
