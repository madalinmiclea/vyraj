import type { AppContext } from '../app/context';
import { Category, type TypeInfo } from '../data/sde';
import {
  addToFit, droneLimit, ensureDroneLimits, newFitId, buildDogma, SLOT_KINDS, slotOf, canActivate, canLoadCharge, canOverheat, cloneFit, emptyFit, fitContents, slotCounts,
  type Fit, type FitModule, type SlotKind,
} from '../engine/fit';
import { isProjectable } from '../engine/projected';
import { isBoosterSideEffect, type Dogma, type DogmaItem, type ModuleState } from '../engine/dogma';
import { applyChecked, violations } from '../engine/rules';
import { computeStats, type FitStats } from '../engine/stats';
import { findProfile } from '../engine/profiles';
import { requirementsFor, fitTypeIds } from '../character/requirements';
import { allCharacters } from '../character/characters';
import { exportMultibuy } from '../io/eft';
import { shareUrl } from '../io/shareLink';
import { fetchPrices, typeIconUrl, typeRenderUrl } from '../services/market';
import { loadFits, saveFit } from '../fitting/savedFits';
import { loadJson, saveJson } from '../storage';
import { icon } from '../ui/icons';
import { alertBox, badge, button, compactISK, copyText, emptyState, esc, formatInt, formatISK, formatNum, lore, pageHead, panel, toast } from '../ui/components';
import { theme } from '../theme';

const proving = (message: string) => (theme === 'vyraj' ? `Proving failed · ${message}` : message);
import { showItemInfo, skillPlanText } from '../ui/itemInfo';
import { moduleName } from '../engine/mutation';
import { bindBreakdownTips } from '../ui/breakdown';
import { TARGETS } from '../engine/application';
import { addItemToPlan, loadPlan, savePlan } from '../character/skillPlan';
import { tx } from '../i18n';
import { allEveItems } from '../data/items';
import type { BrowserScope } from '../ui/sidebar';
import { CURRENT_KEY, EXTRAS_KEY, MAX_TABS, OPEN_KEY, PROFILE_KEY, TARGET_KEY, GROUPS, STATE_LABEL, capTime, type ExtrasTab, type TargetState, type FitEnv } from '../fitting/shared';
import { createStatsPanels } from '../fitting/stats';
import { createFitModals } from '../fitting/modals';
import { createSupportPanels } from '../fitting/support';
import { createImplantPanel } from '../fitting/implants';
import { createNpcPanel } from '../fitting/npc';

export const FITTING_CATEGORIES = ['Ships', 'Ship Equipment', 'Ship and Module Modifications', 'Ammunition & Charges', 'Drones', 'Implants & Boosters'];

export interface FittingView {
  selectItem(name: string, typeId: number | null): void;
  load(fit: Fit): void;
  clearSlot(): void;
}

export function createFittingView(el: HTMLElement, ctx: AppContext, onSlot: (scope: BrowserScope | null) => void = () => {}): FittingView {
  const sde = ctx.sde;
  const limitDrones = (f: Fit) => ensureDroneLimits(sde, f, droneLimit(sde, f, ctx.character.skills, ctx.character.implants));
  const usable = (f: Fit | null | undefined) => (f && sde.types.has(f.shipId) ? limitDrones(f) : null);
  const stored = loadJson<{ fits: (Fit | null)[]; active: number } | null>(OPEN_KEY, null);
  let tabs: (Fit | null)[] = stored?.fits?.length ? stored.fits.map(usable) : [usable(loadJson<Fit | null>(CURRENT_KEY, null))];
  let active = Math.min(Math.max(0, stored?.active ?? 0), tabs.length - 1);
  let fit: Fit | null = tabs[active];
  let extrasTab = loadJson<ExtrasTab>(EXTRAS_KEY, 'drones');
  let dragFrom = -1;
  let profileId = loadJson<string>(PROFILE_KEY, 'Generic/Uniform');
  let targetState = loadJson<TargetState>(TARGET_KEY, { id: 'cruiser', signature: 125, velocity: 200, distanceKm: 30 });
  let priceRequest = 0;
  let lastDogma: Dogma | null = null;

  const chargeCache = new Map<number, TypeInfo[]>();
  const charges = sde.typesInCategory(Category.Charge).sort((a, b) => a.name.localeCompare(b.name));
  const chargesFor = (moduleId: number) => {
    if (!chargeCache.has(moduleId)) chargeCache.set(moduleId, charges.filter((c) => canLoadCharge(sde, moduleId, c.id)));
    return chargeCache.get(moduleId)!;
  };
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

  el.innerHTML = `
    ${pageHead('Fitting', '', 'Proving')}
    <section class="panel fit-toolbar">
      <div class="panel-body">
        <input class="input plain fit-name" id="fitName" placeholder="${tx('Numele fit-ului')}" />
        <label class="select-field"><span>${tx('Caracter')}</span><select class="input plain" id="fitCharacter"></select></label>
        <div class="toolbar-actions">
          ${button(tx('Salvează'), { iconName: 'save', cls: 'sm', attrs: 'data-action="save"' })}
          ${button(tx('Fit-uri'), { iconName: 'fitting', cls: 'ghost sm', attrs: 'data-action="saved"' })}
          ${button(tx('Importă'), { iconName: 'upload', cls: 'ghost sm', attrs: 'data-action="import"' })}
          ${button(tx('Exportă'), { iconName: 'download', cls: 'ghost sm', attrs: 'data-action="export"' })}
          ${button(tx('Link'), { iconName: 'link', cls: 'ghost sm', attrs: `data-action="share" title="${tx('Copiază un link care deschide fit-ul direct în Vyraj')}"` })}
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
    setFit: (next) => { if (next) openFit(next); },
    change: (fn) => change(fn),
    profileId: () => profileId,
    targetState: () => targetState,
    name,
  };
  const { buildTips, statsPanels, requirementsPanel } = createStatsPanels(env, tips);
  const support = createSupportPanels(env);
  const implantPanel = createImplantPanel(env);
  const npc = createNpcPanel(env, tips);
  const { openSavedFits, openImport, openExport, openCompare, openMutation, openAdvice, openShips, openEsi } = createFitModals(env);
  const nameInput = el.querySelector<HTMLInputElement>('#fitName')!;
  const charSelect = el.querySelector<HTMLSelectElement>('#fitCharacter')!;
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.more-menu')) el.querySelectorAll<HTMLDetailsElement>('.more-menu[open]').forEach((d) => { d.open = false; });
  });

  function renderCharacters() {
    charSelect.innerHTML = allCharacters(sde).map((c) => `<option value="${esc(c.id)}" ${c.id === ctx.character.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  }

  function persist() {
    tabs[active] = fit;
    saveJson(OPEN_KEY, { fits: tabs, active });
    saveJson(CURRENT_KEY, fit);
  }

  function isDirty(f: Fit, saved: Map<string, string>) {
    const was = saved.get(f.id);
    if (was != null) return was !== JSON.stringify(f);
    return SLOT_KINDS.some((k) => f.slots[k].some(Boolean)) || f.drones.length > 0 || f.cargo.length > 0 || f.implants.length > 0 || !!f.notes?.trim();
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

  function openFit(next: Fit): boolean {
    const f = limitDrones(next);
    const same = tabs.findIndex((x) => x?.id === f.id);
    if (same < 0 && fit) return addTab(f);
    if (same >= 0) active = same;
    fit = f;
    tabs[active] = f;
    if (pickedSlot) pickSlot(null);
    render();
    return true;
  }

  function closeTab(i: number) {
    const f = tabs[i];
    if (f && isDirty(f, savedJson()) && !confirm(tx('„{name}” are modificări nesalvate. Închizi tab-ul?', { name: f.name }))) return;
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
    if (!fit) {
      left.innerHTML = panel({
        body: emptyState({
          title: tx('Alege o navă'),
          text: tx('Deschide „Ships” în browserul de iteme și apasă pe o navă. Apoi apasă pe module, muniție sau drone ca să le montezi. Poți și importa un fit EFT din joc sau din Pyfa.'),
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
    const d = buildDogma(sde, fit, ctx.character);
    lastDogma = d;
    const stats = computeStats(sde, fit, d, findProfile(profileId));
    const counts = slotCounts(sde, fit, d);
    left.innerHTML = shipHeader(fit, stats) + slotsPanel(fit, counts) + extrasPanel(fit, stats, d) + implantPanel.render(fit, d);
    buildTips(d);
    right.innerHTML = statsPanels(stats, d) + npc.render(stats, d) + support.heatPanel(stats.heat) + requirementsPanel(fit) + costPanel();
    persist();
    loadCost(fit);
  }

  function shipHeader(f: Fit, s: FitStats) {
    const t = sde.type(f.shipId);
    return `<section class="panel glow ship-head">
      <div class="ship-render"><img src="${typeRenderUrl(f.shipId, 256)}" alt="" /></div>
      <div class="ship-info">
        <h2><button class="link" data-info="${f.shipId}">${esc(t.name)}</button></h2>
        <div class="meta">${badge(t.groupName)}${support.modeSelect(f)}${s.warnings.length ? badge(tx('{n} probleme', { n: s.warnings.length }), 'danger', true) : ''}</div>
        <div class="ship-dps">
          <div class="ship-stat"><b class="num">${formatNum(s.offense.totalDps, 0)}</b><span>DPS</span></div>
          <div class="ship-stat"><b class="num">${compactISK(s.defense.ehp)}</b><span>EHP</span></div>
          <div class="ship-stat"><b class="num">${s.capacitor.stable ? formatNum((s.capacitor.stableAt ?? 1) * 100, 0) + '%' : capTime(s.capacitor.lastsSeconds ?? 0)}</b><span>Cap</span></div>
        </div>
      </div>
      <div class="ship-actions">${button('Show Info', { iconName: 'info', cls: 'ghost sm', attrs: `data-info="${f.shipId}"` })}${button(tx('Fit nou'), { iconName: 'plus', cls: 'ghost sm', attrs: 'data-action="clear"' })}</div>
    </section>`;
  }

  function moduleRow(kind: SlotKind, i: number, m: FitModule, over: boolean) {
    const options = chargesFor(m.typeId);
    const canCycle = canActivate(sde, m.typeId) || kind === 'high' || kind === 'mid' || kind === 'low';
    const chargeSelect = options.length
      ? `<select class="charge-select" data-charge="${kind}:${i}">
          <option value="">— ${tx('fără charge')} —</option>
          ${options.map((c) => `<option value="${c.id}" ${c.id === m.chargeId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>${m.chargeId ? `<button class="charge-info" data-info="${m.chargeId}" data-info-charge="${kind}${i}" title="${tx('Info muniție')}">i</button>` : ''}`
      : '';
    return `<div class="slot fitted state-${m.state} ${over ? 'over' : ''}" data-slot="${kind}:${i}" data-pick="${kind}">
      <img class="slot-img" src="${typeIconUrl(m.typeId, 32)}" alt="" loading="lazy" />
      <div class="slot-main">
        <button class="slot-name link ${m.mutation ? 'abyssal' : ''}" data-info="${m.typeId}">${esc(moduleName(sde, m))}</button>
        ${m.mutation ? `<div class="slot-base">${esc(name(m.typeId))}</div>` : ''}
        ${chargeSelect ? `<div class="charge-line">${chargeSelect}</div>` : ''}
      </div>
      ${kind === 'rig' || kind === 'subsystem' || !canCycle ? '' : `<button class="slot-state" data-state="${kind}:${i}" title="${STATE_LABEL[m.state]} (${tx('click: schimbă starea')})">${icon(m.state === 'overheated' ? 'fire' : 'power')}</button>`}
      ${sde.mutaplasmidsFor(m.typeId).length ? `<button class="slot-mutate ${m.mutation ? 'on' : ''}" data-mutate="${kind}:${i}" title="Mutaplasmid">${icon('mutate')}</button>` : ''}
      <button class="slot-info" data-info="${m.typeId}" title="Show Info">${icon('info')}</button>
      <button class="slot-remove" data-remove="${kind}:${i}" title="${tx('Scoate')}">${icon('close')}</button>
    </div>`;
  }

  function slotsPanel(f: Fit, counts: Record<SlotKind, number>) {
    const groups = GROUPS.filter((g) => counts[g.key] > 0 || f.slots[g.key].some(Boolean)).map((g) => {
      const list = f.slots[g.key];
      const total = Math.max(counts[g.key], list.length);
      const used = list.filter(Boolean).length;
      const rows: string[] = [];
      let free = 0;
      for (let i = 0; i < total; i++) {
        const m = list[i];
        if (m) rows.push(moduleRow(g.key, i, m, i >= counts[g.key]));
        else if (i < counts[g.key]) free++;
      }
      if (free) rows.push(`<div class="slot slot-empty" data-pick="${g.key}"><span class="slot-ico">${icon('plus')}</span><span>${free === 1 ? tx('1 slot liber') : tx('{n} sloturi libere', { n: free })}</span></div>`);
      const pips = Array.from({ length: Math.max(counts[g.key], 1) }, (_, i) => `<i class="${i < used ? 'on' : ''}"></i>`).join('');
      return `<div class="slot-group ${g.cls} ${pickedSlot === g.key ? 'picked' : ''}" data-group="${g.key}">
        <div class="slot-group-head"><div class="window-title">${g.label}<span class="count">${used}/${counts[g.key]}</span></div><span class="pips">${pips}</span></div>
        ${rows.join('')}
      </div>`;
    });
    return panel({ title: tx('Sloturi'), body: groups.join('') });
  }

  function droneRows(f: Fit, fighters: boolean) {
    const isFighter = (id: number) => sde.types.get(id)?.categoryId === Category.Fighter;
    return f.drones.map((dr, i) => ({ dr, i })).filter((x) => isFighter(x.dr.typeId) === fighters).map(({ dr, i }) => `<div class="slot fitted drone-row">
      <img class="slot-img" src="${typeIconUrl(dr.typeId, 32)}" alt="" loading="lazy" />
      <div class="slot-main"><button class="slot-name link" data-info="${dr.typeId}">${esc(name(dr.typeId))}</button>
        <span class="dim small">${fighters ? tx('{a} escadrile lansate din {n}', { a: dr.active, n: dr.count }) : tx('{a} lansate din {n}', { a: dr.active, n: dr.count })}</span></div>
      <div class="stepper" title="${fighters ? tx('Escadrile lansate') : tx('Drone lansate')}">
        <button data-drone="${i}:active:-1">−</button><span class="num">${dr.active}</span><button data-drone="${i}:active:1">+</button>
      </div>
      <div class="stepper" title="${fighters ? tx('Escadrile în bay') : tx('Drone în bay')}">
        <button data-drone="${i}:count:-1">−</button><span class="num">${dr.count}</span><button data-drone="${i}:count:1">+</button>
      </div>
      <button class="slot-info" data-info="${dr.typeId}" title="Show Info">${icon('info')}</button>
      <button class="slot-remove" data-drone="${i}:remove:0" title="${tx('Scoate')}">${icon('close')}</button>
    </div>`).join('');
  }

  function boosterSides(f: Fit, id: number): string {
    const on = f.boosterSides?.[id] ?? [];
    const sides = sde.type(id).effects.map((e) => sde.effects.get(e)).filter((e): e is NonNullable<typeof e> => !!e && isBoosterSideEffect(e.name));
    if (!sides.length) return '';
    const chips = sides.map((e) => {
      const from = e.modifiers[0]?.from;
      const a = from != null ? sde.attributes.get(from) : undefined;
      const value = from != null ? sde.baseAttr(id, from) : 0;
      const label = `${(a?.displayName || a?.name || e.name).replace(/\s*Penalty$/, '')} ${value > 0 ? '+' : ''}${formatNum(value, 0)}%`;
      return `<button class="chip-btn sm ${on.includes(e.name) ? 'active' : ''}" data-side="${id}:${esc(e.name)}">${esc(label)}</button>`;
    }).join('');
    return `<div class="booster-sides"><span class="dim small">${tx('Efecte secundare')}:</span>${chips}</div>`;
  }

  function extrasPanel(f: Fit, s: FitStats, d: Dogma) {
    const r = s.resources;
    const isFighter = (id: number) => sde.types.get(id)?.categoryId === Category.Fighter;
    const isBooster = (id: number) => sde.baseAttr(id, sde.attrId('boosterness')) > 0;
    const drones = f.drones.filter((x) => !isFighter(x.typeId));
    const fighters = f.drones.filter((x) => isFighter(x.typeId));
    const boosters = f.implants.map((id, i) => ({ id, i })).filter((x) => isBooster(x.id));
    const hasDrones = r.droneBay.total > 0 || drones.length > 0;
    const hasFighters = r.fighterBay.total > 0 || r.fighterTubes.total > 0 || fighters.length > 0;
    const sum = (list: { count: number }[]) => list.reduce((a, x) => a + x.count, 0);
    const tabsList: { key: ExtrasTab; label: string; n: number; show: boolean }[] = [
      { key: 'drones', label: 'Drones', n: sum(drones), show: hasDrones },
      { key: 'fighters', label: 'Fighters', n: fighters.length, show: hasFighters },
      { key: 'cargo', label: 'Cargo', n: f.cargo.length, show: true },
      { key: 'boosters', label: tx('Boostere'), n: boosters.length, show: true },
      { key: 'projected', label: tx('Proiectate'), n: sum(f.projected ?? []), show: true },
      { key: 'command', label: tx('Comandă'), n: f.fleet?.charges.length ?? 0, show: true },
      { key: 'notes', label: tx('Note'), n: f.notes?.trim() ? 1 : 0, show: true },
    ];
    const shown = tabsList.filter((x) => x.show);
    const current = shown.some((x) => x.key === extrasTab) ? extrasTab : shown[0].key;
    const list = (items: { id: number; label: string; sub?: string; set?: string; sides?: string; attr?: string; tag?: string; extra?: string }[]) => items.map((x) => `<div class="slot fitted">
      <img class="slot-img" src="${typeIconUrl(x.id, 32)}" alt="" loading="lazy" />
      <div class="slot-main"><button class="slot-name link" data-info="${x.id}">${esc(x.label)}</button>${x.sub ? `<span class="dim small">${esc(x.sub)}</span>` : ''}${x.set ? `<span class="small set-bonus">${esc(x.set)}</span>` : ''}${x.sides ?? ''}</div>
      ${x.tag ? badge(x.tag, 'accent') : ''}${x.extra ?? ''}
      <button class="slot-info" data-info="${x.id}" title="Show Info">${icon('info')}</button>
      ${x.attr ? `<button class="slot-remove" ${x.attr} title="${tx('Scoate')}">${icon('close')}</button>` : ''}
    </div>`).join('');
    const boosterRow = (id: number) => {
      const slot = sde.baseAttr(id, sde.attrId('boosterness'));
      return { id, label: `${slot ? `[B${slot}] ` : ''}${name(id)}`, sub: implantPanel.bonusLine(id), sides: boosterSides(f, id) };
    };
    const hint = (text: string) => `<p class="dim small extras-hint">${text}</p>`;
    const meta = (parts: string[]) => `<div class="extras-meta">${parts.filter(Boolean).map((x) => `<span>${x}</span>`).join('')}</div>`;
    const m3 = (x: { used: number; total: number }) => `<b class="num ${x.used > x.total + 1e-6 ? 'neg' : ''}">${formatNum(x.used, Number.isInteger(x.used) || x.used >= 10 ? 0 : 1)}</b> / ${formatNum(x.total, 0)} m³`;
    const volume = (id: number) => sde.baseAttr(id, sde.attrId('volume'));
    let body = '';
    switch (current) {
      case 'drones': {
        const launched = drones.reduce((a, x) => a + x.active, 0);
        body = meta([`Drone bay ${m3(r.droneBay)}`, `Bandwidth <b class="num">${formatNum(r.droneBandwidth.used, 0)}</b> / ${formatNum(r.droneBandwidth.total, 0)} Mbit/s`, `${tx('Lansate')} <b class="num">${launched}</b> / ${formatNum(d.character.get('maxActiveDrones'), 0)}`])
          + `<div class="slot-group drones">${droneRows(f, false)}</div>` + (drones.length ? '' : hint(tx('Apasă pe o dronă din browser ca s-o adaugi.')));
        break;
      }
      case 'fighters':
        body = meta([`Fighter bay ${m3(r.fighterBay)}`, `${tx('Tuburi')} <b class="num">${r.fighterTubes.used}</b> / ${r.fighterTubes.total}`,
          r.fighterLight.total ? `Light ${r.fighterLight.used}/${r.fighterLight.total}` : '', r.fighterSupport.total ? `Support ${r.fighterSupport.used}/${r.fighterSupport.total}` : '', r.fighterHeavy.total ? `Heavy ${r.fighterHeavy.used}/${r.fighterHeavy.total}` : ''])
          + `<div class="slot-group drones">${droneRows(f, true)}</div>` + (fighters.length ? '' : hint(tx('Apasă pe un fighter din browser ca să-l adaugi.')));
        break;
      case 'cargo':
        body = meta([`Cargo hold ${m3(r.cargo)}`])
          + `<div class="slot-group implants">${list(f.cargo.map((c, i) => ({ id: c.typeId, label: name(c.typeId), sub: `${formatNum(volume(c.typeId) * c.count, 2)} m³`, attr: `data-cargo="${i}"`,
            extra: `<input class="input plain sm cargo-count num" type="number" min="1" step="1" value="${c.count}" data-cargo-count="${i}" title="${tx('Cantitate')}" />` })))}</div>`
          + hint(tx('Cât timp tab-ul Cargo e deschis, orice item apăsat în browser intră în cargo.'));
        break;
      case 'boosters':
        body = `<div class="slot-group implants">${list(boosters.map((x) => ({ ...boosterRow(x.id), attr: `data-implant="${x.i}"` })))}</div>`
          + (boosters.length ? '' : hint(tx('Apasă pe un booster din browser ca să-l adaugi.')));
        break;
      case 'projected':
        body = support.projectedBody(f, d) + hint(tx('Cât timp tab-ul e deschis, modulele proiectabile apăsate în browser se adaugă aici.'));
        break;
      case 'command':
        body = support.fleetBody(f) + hint(tx('Cât timp tab-ul e deschis, burst charge-urile apăsate în browser se adaugă aici.'));
        break;
      case 'notes':
        body = `<textarea class="input area fit-notes" id="fitNotes" rows="8" spellcheck="false" placeholder="${tx('Note despre fit: rol, cum se zboară, ce mai trebuie în cargo…')}">${esc(f.notes ?? '')}</textarea>`;
        break;
    }
    return `<section class="panel fit-extras">
      <div class="tabs extras-tabs">${shown.map((x) => `<button class="tab ${x.key === current ? 'active' : ''}" data-extras="${x.key}">${x.label}${x.n ? ` <span class="tab-count neutral">${x.n}</span>` : ''}</button>`).join('')}</div>
      <div class="panel-body">${body}</div>
    </section>`;
  }

  function costPanel() {
    return panel({ title: tx('Cost Jita (sell min)'), id: 'fitCost', body: `<div class="dim small">${lore(tx('Se încarcă prețurile…'), 'Weaving the Flow…')}</div>` });
  }

  async function loadCost(f: Fit) {
    const id = ++priceRequest;
    const contents = fitContents(sde, f);
    const abyssal = new Map<number, number>();
    for (const k of SLOT_KINDS) for (const m of f.slots[k]) if (m?.mutation) abyssal.set(m.typeId, (abyssal.get(m.typeId) ?? 0) + 1);
    const req = requirementsFor(sde, fitTypeIds(f), ctx.character);
    const books = req.missing.filter((s) => s.current === 0).map((s) => s.skillId);
    try {
      const prices = await fetchPrices([...contents.keys(), ...abyssal.keys(), ...books]);
      if (id !== priceRequest) return;
      const lines = [...[...contents].map(([typeId, n]) => ({ typeId, n, abyssal: false })), ...[...abyssal].map(([typeId, n]) => ({ typeId, n, abyssal: true }))]
        .map((x) => ({ ...x, price: prices.get(x.typeId)?.sellMin ?? 0 }))
        .map((x) => ({ ...x, total: x.price * x.n }))
        .sort((a, b) => b.total - a.total);
      const total = lines.reduce((a, x) => a + x.total, 0);
      const noPrice = lines.filter((x) => x.price === 0).length;
      const target = el.querySelector('#fitCost .panel-body');
      if (!target) return;
      target.innerHTML = `
        <div class="cost-total">${abyssal.size ? '<span class="dim">min.</span> ' : ''}<span class="num">${formatISK(total, 0)}</span> ISK <span class="dim">(${compactISK(total)})</span></div>
        <table class="table compact"><tbody>${lines.map((x) => `<tr><td>${x.abyssal ? '<span class="abyssal-tag">Abyssal</span> ' : ''}${esc(name(x.typeId))}${x.n > 1 ? ` <span class="dim">×${formatInt(x.n)}</span>` : ''}</td><td class="r num">${x.price ? `${x.abyssal ? '<span class="dim">min.</span> ' : ''}${compactISK(x.total)}` : `<span class="dim">${tx('fără ordine')}</span>`}</td></tr>`).join('')}</tbody></table>
        ${noPrice ? `<p class="dim small">${tx('{n} iteme nu au ordine de vânzare în Jita.', { n: noPrice })}</p>` : ''}
        <div class="row-actions">${button(tx('Copiază Multibuy'), { iconName: 'copy', cls: 'ghost sm', attrs: 'data-action="multibuy"' })}</div>`;
      const booksEl = el.querySelector('#skillbookCost');
      if (booksEl && books.length) {
        const cost = books.reduce((a, b) => a + (prices.get(b)?.sellMin ?? 0), 0);
        booksEl.innerHTML = `${tx('Skillbook-uri de cumpărat')}: ${books.length} · <span class="num">${compactISK(cost)}</span> ISK`;
      }
    } catch {
      if (id !== priceRequest) return;
      const target = el.querySelector('#fitCost .panel-body');
      if (target) target.innerHTML = alertBox(tx('Nu am putut încărca prețurile din Jita (Fuzzwork).'));
    }
  }

  function fittedItem(button: HTMLElement): DogmaItem | undefined {
    const d = lastDogma;
    if (!d || !fit) return undefined;
    const typeId = Number(button.dataset.info);
    const chargeSlot = button.dataset.infoCharge;
    if (chargeSlot) return d.charges.find((c) => c.slotKey === chargeSlot);
    const row = button.closest<HTMLElement>('[data-slot]');
    if (row) return d.modules.find((m) => m.slotKey === row.dataset.slot!.replace(':', ''));
    if (typeId === fit.shipId && button.closest('.ship-head')) return d.ship;
    const droneRow = button.closest('.drone-row');
    if (droneRow) return d.drones.find((x) => x.item.typeId === typeId)?.item;
    return d.drones.find((x) => x.item.typeId === typeId)?.item ?? d.implants.find((x) => x.typeId === typeId);
  }

  function newFit(shipId: number) {
    return openFit(emptyFit(shipId, `${name(shipId)} PvE`));
  }

  function showExtras(key: ExtrasTab) {
    extrasTab = key;
    saveJson(EXTRAS_KEY, key);
  }

  function routeToExtras(t: TypeInfo): boolean {
    if (!fit) return false;
    if (extrasTab === 'cargo') {
      const result = applyChecked(sde, fit, ctx.character.skills, (draft) => {
        const same = draft.cargo.find((c) => c.typeId === t.id);
        if (same) same.count++; else draft.cargo.push({ typeId: t.id, count: 1 });
        return { ok: true, message: tx('{name} adăugat în cargo', { name: t.name }) };
      }, ctx.character.implants);
      toast(proving(result.message));
      if (result.ok) render();
      return true;
    }
    if (extrasTab === 'projected' && isProjectable(sde, t.id)) { support.addProjected(t.id); toast(tx('{name} proiectat pe navă', { name: t.name })); return true; }
    if (extrasTab === 'command' && support.isBurst(t.id)) { support.addBurst(t.id); toast(tx('{name} adăugat la boost-uri', { name: t.name })); return true; }
    return false;
  }

  function selectItem(itemName: string, typeId: number | null) {
    const t = typeId ? sde.types.get(typeId) : sde.findType(itemName);
    if (!t) { toast(tx('„{name}” nu se poate folosi în fitting', { name: itemName })); return; }
    if (t.categoryId === Category.Ship) {
      if (newFit(t.id)) toast(`${tx('Fit nou')}: ${t.name}`);
      return;
    }
    if (!fit) { toast(tx('Alege întâi o navă')); return; }
    if (routeToExtras(t)) return;
    let result = applyChecked(sde, fit, ctx.character.skills, (draft) => addToFit(sde, draft, t.id), ctx.character.implants);
    if (!result.ok && (t.categoryId === Category.Drone || t.categoryId === Category.Fighter)) {
      const bay = applyChecked(sde, fit, ctx.character.skills, (draft) => {
        const r = addToFit(sde, draft, t.id);
        const dr = draft.drones.find((x) => x.typeId === t.id);
        if (r.ok && dr && dr.active > 0) dr.active--;
        const why = result.message.charAt(0).toLowerCase() + result.message.slice(1);
        if (!r.ok) return r;
        return { ok: true, message: t.categoryId === Category.Fighter ? tx('{name} adăugat în fighter bay (nelansat: {why})', { name: t.name, why }) : tx('{name} adăugată în drone bay (nelansată: {why})', { name: t.name, why }) };
      }, ctx.character.implants);
      if (bay.ok) result = bay;
    }
    toast(proving(result.message));
    if (!result.ok) return;
    if (t.categoryId === Category.Drone) showExtras('drones');
    else if (t.categoryId === Category.Fighter) showExtras('fighters');
    else if (t.categoryId === Category.Implant && sde.baseAttr(t.id, sde.attrId('boosterness')) > 0) showExtras('boosters');
    render();
  }

  function change(fn: (draft: Fit) => void) {
    if (!fit) return;
    const result = applyChecked(sde, fit, ctx.character.skills, (draft) => { fn(draft); }, ctx.character.implants);
    if (!result.ok) toast(proving(result.message));
    render();
  }

  function parseSlot(v: string): [SlotKind, number] {
    const [k, i] = v.split(':');
    return [k as SlotKind, Number(i)];
  }

  function cycleState(m: FitModule) {
    const order: ModuleState[] = ['offline', 'online'];
    if (canActivate(sde, m.typeId)) order.push('active');
    if (canOverheat(sde, m.typeId)) order.push('overheated');
    m.state = order[(order.indexOf(m.state) + 1) % order.length];
  }

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const at = (sel: string) => target.closest<HTMLElement>(sel);
    if (npc.handleClick(target)) { render(); return; }

    const tabClose = at('[data-fit-close]');
    if (tabClose) { closeTab(Number(tabClose.dataset.fitClose)); return; }
    if (at('[data-fit-add]')) { addTab(null); return; }
    const fitTab = at('[data-fit-tab]');
    if (fitTab) { switchTab(Number(fitTab.dataset.fitTab)); return; }
    const extras = at('[data-extras]');
    if (extras) { showExtras(extras.dataset.extras as ExtrasTab); render(); return; }
    if (fit && support.handleClick(target)) return;
    const openSaved = at('[data-open-fit]');
    if (openSaved) { const f = loadFits().find((x) => x.id === openSaved.dataset.openFit); if (f) openFit(cloneFit(f)); return; }
    const quick = at('[data-quick]');
    if (quick) { selectItem(quick.dataset.quick!, null); return; }
    const info = at('[data-info]');
    if (info) { showItemInfo(ctx, Number(info.dataset.info), fittedItem(info)); return; }
    const action = at('[data-action]')?.dataset.action;
    if (action) { runAction(action); return; }
    if (!fit) return;

    const state = at('[data-state]');
    if (state) {
      const [k, i] = parseSlot(state.dataset.state!);
      const m = fit.slots[k][i];
      if (m) change((draft) => cycleState(draft.slots[k][i]!));
      return;
    }
    const mut = at('[data-mutate]');
    if (mut) { openMutation(...parseSlot(mut.dataset.mutate!)); return; }
    const remove = at('[data-remove]');
    if (remove) {
      const [k, i] = parseSlot(remove.dataset.remove!);
      change((draft) => {
        draft.slots[k][i] = null;
        if (k === 'subsystem') draft.slots[k] = draft.slots[k].filter(Boolean);
      });
      return;
    }
    const drone = at('[data-drone]');
    if (drone) {
      const [i, field, delta] = drone.dataset.drone!.split(':');
      change((draft) => {
        const dr = draft.drones[Number(i)];
        if (field === 'remove') draft.drones.splice(Number(i), 1);
        else if (field === 'count') { dr.count = Math.max(1, dr.count + Number(delta)); dr.active = Math.min(dr.active, dr.count); if (dr.wanted != null) dr.wanted = Math.min(dr.wanted, dr.count); }
        else { dr.active = Math.max(0, Math.min(dr.count, dr.active + Number(delta))); delete dr.wanted; }
      });
      return;
    }
    const pick = at('[data-pick]');
    if (pick && !at('select, button')) { pickSlot(pick.dataset.pick === pickedSlot ? null : (pick.dataset.pick as SlotKind)); return; }
    const side = at('[data-side]');
    if (side) {
      const [tid, effect] = side.dataset.side!.split(':');
      change((draft) => {
        const map = draft.boosterSides ?? (draft.boosterSides = {});
        const list = map[tid] ?? [];
        map[tid] = list.includes(effect) ? list.filter((x) => x !== effect) : [...list, effect];
      });
      return;
    }
    const implant = at('[data-implant]');
    if (implant) { change((draft) => { draft.implants.splice(Number(implant.dataset.implant), 1); }); return; }
    const cargo = at('[data-cargo]');
    if (cargo) change((draft) => { draft.cargo.splice(Number(cargo.dataset.cargo), 1); });
  });

  tabsEl.addEventListener('auxclick', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-fit-tab]');
    if (tab && e.button === 1) { e.preventDefault(); closeTab(Number(tab.dataset.fitTab)); }
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

  el.addEventListener('contextmenu', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
    if (!row || !fit) return;
    e.preventDefault();
    const [k, i] = parseSlot(row.dataset.slot!);
    const m = fit.slots[k][i];
    if (!m) return;
    change((draft) => {
      const dm = draft.slots[k][i]!;
      dm.state = dm.state === 'offline' ? (canActivate(sde, dm.typeId) ? 'active' : 'online') : 'offline';
    });
  });

  el.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    if (target === charSelect) { ctx.setCharacter(charSelect.value); return; }
    if (fit && support.handleChange(target)) return;
    if (npc.handleChange(target)) { render(); return; }
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
    if (target.dataset.cargoCount && fit) {
      const i = Number(target.dataset.cargoCount);
      const n = Math.max(1, Math.floor(Number(target.value) || 1));
      change((draft) => { if (draft.cargo[i]) draft.cargo[i].count = n; });
      return;
    }
    if (target.dataset.charge && fit) {
      const [k, i] = parseSlot(target.dataset.charge);
      const m = fit.slots[k][i];
      if (!m) return;
      const chargeId = Number(target.value) || undefined;
      change((draft) => { for (const other of draft.slots[k]) if (other && other.typeId === m.typeId) other.chargeId = chargeId; });
    }
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
        if (fit) newFit(fit.shipId);
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
      case 'saved':
        return openSavedFits();
      case 'import':
        return openImport();
      case 'export':
        return openExport();
      case 'share':
        if (!fit) return toast(tx('Nu ai niciun fit'));
        shareUrl(fit).then((url) => copyText(url, tx('Link copiat. Cine îl deschide primește fit-ul într-un tab nou.'))).catch(() => toast(tx('Browserul nu poate crea linkul de fit')));
        break;
      case 'compare':
        return openCompare();
      case 'esi':
        return openEsi();
      case 'ships':
        return openShips();
      case 'multibuy':
        if (fit) copyText(exportMultibuy(sde, fitContents(sde, fit)), tx('Lista Multibuy copiată'));
        break;
      case 'advice':
        openAdvice();
        return;
      case 'plan-fit':
        if (fit) {
          const c = ctx.character;
          savePlan(c.id, fitTypeIds(fit).reduce((p, id) => addItemToPlan(sde, p, c, id), loadPlan(c.id)));
          toast(tx('Adăugat în skill plan'));
        }
        break;
      case 'copy-plan':
        if (fit) copyText(skillPlanText(requirementsFor(sde, fitTypeIds(fit), ctx.character).missing), tx('Plan copiat (lipește-l în Skill Plans din joc)'));
        break;
    }
  }

  renderCharacters();
  let shownCharacter = ctx.character.id;
  ctx.onCharacterChange(() => {
    renderCharacters();
    if (fit && shownCharacter !== ctx.character.id) {
      limitDrones(fit);
      const problems = [...violations(sde, fit, ctx.character.skills, ctx.character.implants).values()];
      if (problems.length) toast(proving(tx('Fit-ul nu încape cu skill-urile lui {name}: {why}', { name: ctx.character.name, why: problems[0] })));
    }
    shownCharacter = ctx.character.id;
    render();
  });
  render();

  return {
    selectItem,
    load(f: Fit) { openFit(cloneFit(f)); },
    clearSlot() { if (pickedSlot) pickSlot(null); },
  };
}
