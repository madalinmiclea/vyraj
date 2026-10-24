import type { AppContext } from '../app/context';
import { Category, type TypeInfo } from '../data/sde';
import {
  addToFit, buildDogma, SLOT_KINDS, slotOf, canActivate, canLoadCharge, canOverheat, cloneFit, emptyFit, fitContents, slotCounts,
  type Fit, type FitModule, type SlotKind,
} from '../engine/fit';
import { isBoosterSideEffect, type Dogma, type DogmaItem, type ModuleState } from '../engine/dogma';
import { applyChecked } from '../engine/rules';
import { computeStats, type FitStats } from '../engine/stats';
import { findProfile } from '../engine/profiles';
import { requirementsFor, fitTypeIds } from '../character/requirements';
import { allCharacters } from '../character/characters';
import { exportMultibuy } from '../io/eft';
import { fetchPrices, typeIconUrl, typeRenderUrl } from '../services/market';
import { saveFit } from '../fitting/savedFits';
import { loadJson, saveJson } from '../storage';
import { icon } from '../ui/icons';
import { alertBox, badge, button, compactISK, copyText, emptyState, esc, formatInt, formatISK, formatNum, lore, pageHead, panel, toast } from '../ui/components';
import { theme } from '../theme';

const proving = (message: string) => (theme === 'vyraj' ? `Proving failed · ${message}` : message);
import { showItemInfo, skillPlanText } from '../ui/itemInfo';
import { attributeSections } from '../ui/attributes';
import { moduleName } from '../engine/mutation';
import { bindBreakdownTips } from '../ui/breakdown';
import { TARGETS } from '../engine/application';
import { addItemToPlan, loadPlan, savePlan } from '../character/skillPlan';
import { tx } from '../i18n';
import { allEveItems } from '../data/items';
import type { BrowserScope } from '../ui/sidebar';
import { CURRENT_KEY, PROFILE_KEY, TARGET_KEY, GROUPS, STATE_LABEL, capTime, type TargetState, type FitEnv } from '../fitting/shared';
import { createStatsPanels } from '../fitting/stats';
import { createFitModals } from '../fitting/modals';

export const FITTING_CATEGORIES = ['Ships', 'Ship Equipment', 'Ship and Module Modifications', 'Ammunition & Charges', 'Drones', 'Implants & Boosters'];

export interface FittingView {
  selectItem(name: string, typeId: number | null): void;
  load(fit: Fit): void;
  clearSlot(): void;
}

export function createFittingView(el: HTMLElement, ctx: AppContext, onSlot: (scope: BrowserScope | null) => void = () => {}): FittingView {
  const sde = ctx.sde;
  let fit: Fit | null = loadJson<Fit | null>(CURRENT_KEY, null);
  if (fit && !sde.types.has(fit.shipId)) fit = null;
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
          ${button(tx('Compară'), { iconName: 'compare', cls: 'ghost sm', attrs: 'data-action="compare"' })}
          ${button('EVE', { iconName: 'login', cls: 'ghost sm', attrs: `data-action="esi" title="${tx('Fit-urile salvate în joc')}"` })}
          ${button(tx('Navele mele'), { iconName: 'ship', cls: 'ghost sm', attrs: `data-action="ships" title="${tx('Navele asamblate din hangare, cu ce au montat')}"` })}
        </div>
      </div>
    </section>
    <div class="fit-layout">
      <div class="stack" id="fitLeft"></div>
      <div class="stack" id="fitRight"></div>
    </div>
  `;
  const left = el.querySelector<HTMLElement>('#fitLeft')!;
  const right = el.querySelector<HTMLElement>('#fitRight')!;
  const tips = new Map<string, string>();
  bindBreakdownTips(right, (k) => tips.get(k));
  const env: FitEnv = {
    sde,
    ctx,
    getFit: () => fit,
    setFit: (next) => { fit = next; render(); },
    change: (fn) => change(fn),
    profileId: () => profileId,
    targetState: () => targetState,
    name,
  };
  const { buildTips, statsPanels, requirementsPanel } = createStatsPanels(env, tips);
  const { openSavedFits, openImport, openExport, openCompare, openMutation, openAdvice, openShips, openEsi } = createFitModals(env);
  const nameInput = el.querySelector<HTMLInputElement>('#fitName')!;
  const charSelect = el.querySelector<HTMLSelectElement>('#fitCharacter')!;

  function renderCharacters() {
    charSelect.innerHTML = allCharacters(sde).map((c) => `<option value="${esc(c.id)}" ${c.id === ctx.character.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  }

  function render() {
    nameInput.value = fit?.name ?? '';
    nameInput.disabled = !fit;
    if (!fit) {
      left.innerHTML = panel({
        body: emptyState({
          title: tx('Alege o navă'),
          text: tx('Deschide „Ships” în browserul din stânga și apasă pe o navă. Apoi apasă pe module, muniție sau drone ca să le montezi. Poți și importa un fit EFT din joc sau din Pyfa.'),
          extra: `<div class="chips">${['Rifter', 'Drake', 'Gila', 'Ishtar', 'Golem'].map((n) => button(n, { cls: 'ghost sm', attrs: `data-quick="${n}"` })).join('')}</div>`,
        }),
      });
      right.innerHTML = '';
      return;
    }
    const d = buildDogma(sde, fit, ctx.character);
    lastDogma = d;
    const stats = computeStats(sde, fit, d, findProfile(profileId));
    const counts = slotCounts(sde, fit, d);
    left.innerHTML = shipHeader(fit, stats) + slotsPanel(fit, counts) + dronesPanel(fit, stats) + extrasPanel(fit);
    buildTips(d);
    right.innerHTML = statsPanels(stats, d) + requirementsPanel(fit) + costPanel();
    saveJson(CURRENT_KEY, fit);
    loadCost(fit);
  }

  function shipHeader(f: Fit, s: FitStats) {
    const t = sde.type(f.shipId);
    return `<section class="panel glow ship-head">
      <div class="ship-render"><img src="${typeRenderUrl(f.shipId, 256)}" alt="" /></div>
      <div class="ship-info">
        <h2><button class="link" data-info="${f.shipId}">${esc(t.name)}</button></h2>
        <div class="meta">${badge(t.groupName)}${s.warnings.length ? badge(tx('{n} probleme', { n: s.warnings.length }), 'danger', true) : ''}</div>
        <div class="ship-dps"><span class="big num">${formatNum(s.offense.totalDps, 0)}</span><span class="dim">DPS</span>
          <span class="big num">${compactISK(s.defense.ehp)}</span><span class="dim">EHP</span>
          <span class="big num">${s.capacitor.stable ? formatNum((s.capacitor.stableAt ?? 1) * 100, 0) + '%' : capTime(s.capacitor.lastsSeconds ?? 0)}</span><span class="dim">Cap</span></div>
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
      for (let i = 0; i < total; i++) {
        const m = list[i];
        if (m) rows.push(moduleRow(g.key, i, m, i >= counts[g.key]));
        else if (i < counts[g.key]) rows.push(`<div class="slot slot-empty" data-pick="${g.key}"><span class="slot-ico">${icon('plus')}</span><span>${tx('Slot liber')}</span></div>`);
      }
      const pips = Array.from({ length: Math.max(counts[g.key], 1) }, (_, i) => `<i class="${i < used ? 'on' : ''}"></i>`).join('');
      return `<div class="slot-group ${g.cls} ${pickedSlot === g.key ? 'picked' : ''}" data-group="${g.key}">
        <div class="slot-group-head"><div class="window-title">${g.label}<span class="count">${used}/${counts[g.key]}</span></div><span class="pips">${pips}</span></div>
        ${rows.join('')}
      </div>`;
    });
    return panel({ title: tx('Sloturi'), body: groups.join('') });
  }

  function dronesPanel(f: Fit, s: FitStats) {
    if (!f.drones.length && s.resources.droneBay.total <= 0) return '';
    const rows = f.drones.map((dr, i) => `<div class="slot fitted drone-row">
      <img class="slot-img" src="${typeIconUrl(dr.typeId, 32)}" alt="" loading="lazy" />
      <div class="slot-main"><button class="slot-name link" data-info="${dr.typeId}">${esc(name(dr.typeId))}</button>
        <span class="dim small">${tx('{a} lansate din {n}', { a: dr.active, n: dr.count })}</span></div>
      <div class="stepper" title="${tx('Drone lansate')}">
        <button data-drone="${i}:active:-1">−</button><span class="num">${dr.active}</span><button data-drone="${i}:active:1">+</button>
      </div>
      <div class="stepper" title="${tx('Drone în bay')}">
        <button data-drone="${i}:count:-1">−</button><span class="num">${dr.count}</span><button data-drone="${i}:count:1">+</button>
      </div>
      <button class="slot-info" data-info="${dr.typeId}" title="Show Info">${icon('info')}</button>
      <button class="slot-remove" data-drone="${i}:remove:0" title="${tx('Scoate')}">${icon('close')}</button>
    </div>`);
    return panel({
      title: 'Drone bay',
      count: `${formatNum(s.resources.droneBay.used, 0)} / ${formatNum(s.resources.droneBay.total, 0)} m³`,
      body: `<div class="slot-group drones">${rows.join('') || `<p class="dim small">${tx('Apasă pe o dronă din browser ca s-o adaugi.')}</p>`}</div>`,
    });
  }

  function implantBonus(id: number) {
    const PERCENT_UNITS = [105, 109, 111, 121, 124, 127];
    const rows = attributeSections(sde, id).flatMap((sec) => sec.rows).filter((r) => {
      const a = sde.attributes.get(r.id);
      return a && (/bonus/i.test(a.name) || PERCENT_UNITS.includes(a.unitId ?? 0)) && a.name !== 'implantness';
    });
    return rows.slice(0, 2).map((r) => `${r.name} ${signed(r.base ?? r.value)}`).join(' · ');
  }

  function implantSetLine(id: number): string {
    const setAttr = [...sde.type(id).attrs.keys()].find((a) => /^implantSet/.test(sde.attributes.get(a)?.name ?? ''));
    const item = lastDogma?.implants.find((i) => i.typeId === id);
    if (!setAttr || !item) return '';
    const pieces = lastDogma!.implants.filter((i) => sde.type(i.typeId).attrs.has(setAttr)).length;
    const PERCENT_UNITS = [105, 109, 111, 121, 124, 127];
    const changed = attributeSections(sde, id, item).flatMap((sec) => sec.rows).filter((r) => {
      const a = sde.attributes.get(r.id);
      return r.base && a && (/bonus/i.test(a.name) || PERCENT_UNITS.includes(a.unitId ?? 0));
    });
    if (!changed.length) return '';
    const setName = name(id).replace(/\s+\S+$/, '');
    return `${tx('Set {name}', { name: setName })} · ${pieces === 1 ? tx('{n} piesă', { n: pieces }) : tx('{n} piese', { n: pieces })}: ${changed.map((r) => `${r.name} ${signed(r.value)}`).join(' · ')}`;
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

  function signed(v: string) {
    return v.startsWith('-') || v.startsWith('+') ? v : '+' + v;
  }

  function extrasPanel(f: Fit) {
    const own = ctx.character.implants.filter((id) => sde.types.has(id) && !f.implants.includes(id));
    if (!f.implants.length && !f.cargo.length && !own.length) return '';
    const slotOfImplant = (id: number) => sde.baseAttr(id, sde.attrId('implantness'));
    const list = (items: { id: number; label: string; sub?: string; set?: string; sides?: string; attr?: string; tag?: string }[]) => items.map((x) => `<div class="slot fitted">
      <img class="slot-img" src="${typeIconUrl(x.id, 32)}" alt="" loading="lazy" />
      <div class="slot-main"><button class="slot-name link" data-info="${x.id}">${esc(x.label)}</button>${x.sub ? `<span class="dim small">${esc(x.sub)}</span>` : ''}${x.set ? `<span class="small set-bonus">${esc(x.set)}</span>` : ''}${x.sides ?? ''}</div>
      ${x.tag ? badge(x.tag, 'accent') : ''}
      <button class="slot-info" data-info="${x.id}" title="Show Info">${icon('info')}</button>
      ${x.attr ? `<button class="slot-remove" ${x.attr} title="${tx('Scoate')}">${icon('close')}</button>` : ''}
    </div>`).join('');
    const isBooster = (id: number) => sde.baseAttr(id, sde.attrId('boosterness')) > 0;
    const implantRow = (id: number) => {
      const booster = sde.baseAttr(id, sde.attrId('boosterness'));
      const slot = booster || slotOfImplant(id);
      return { id, label: `${slot ? `[${booster ? 'B' : ''}${slot}] ` : ''}${name(id)}`, sub: implantBonus(id), set: implantSetLine(id), sides: booster ? boosterSides(f, id) : '' };
    };
    return panel({
      title: tx('Implanturi, boostere și cargo'),
      body: `<div class="slot-group implants">
        ${list([...own].sort((a, b) => slotOfImplant(a) - slotOfImplant(b)).map((id) => ({ ...implantRow(id), tag: tx('caracter') })))}
        ${list(f.implants.map((id, i) => ({ id, i })).filter((x) => !isBooster(x.id)).map((x) => ({ ...implantRow(x.id), attr: `data-implant="${x.i}"` })))}
        ${list(f.implants.map((id, i) => ({ id, i })).filter((x) => isBooster(x.id)).map((x) => ({ ...implantRow(x.id), attr: `data-implant="${x.i}"` })))}
        ${list(f.cargo.map((c, i) => ({ id: c.typeId, label: `${name(c.typeId)} × ${c.count}`, attr: `data-cargo="${i}"` })))}
      </div>`,
    });
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
    fit = emptyFit(shipId, `${name(shipId)} PvE`);
    if (pickedSlot) pickSlot(null);
    render();
  }

  function selectItem(itemName: string, typeId: number | null) {
    const t = typeId ? sde.types.get(typeId) : sde.findType(itemName);
    if (!t) { toast(tx('„{name}” nu se poate folosi în fitting', { name: itemName })); return; }
    if (t.categoryId === Category.Ship) {
      newFit(t.id);
      toast(`${tx('Fit nou')}: ${t.name}`);
      return;
    }
    if (!fit) { toast(tx('Alege întâi o navă')); return; }
    let result = applyChecked(sde, fit, ctx.character.skills, (draft) => addToFit(sde, draft, t.id), ctx.character.implants);
    if (!result.ok && (t.categoryId === Category.Drone || t.categoryId === Category.Fighter)) {
      const bay = applyChecked(sde, fit, ctx.character.skills, (draft) => {
        const r = addToFit(sde, draft, t.id);
        const dr = draft.drones.find((x) => x.typeId === t.id);
        if (r.ok && dr) dr.active--;
        return r.ok ? { ok: true, message: tx('{name} adăugată în drone bay (nelansată: {why})', { name: t.name, why: result.message.toLowerCase() }) } : r;
      }, ctx.character.implants);
      if (bay.ok) result = bay;
    }
    toast(proving(result.message));
    if (result.ok) render();
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
      fit.slots[k][i] = null;
      if (k === 'subsystem') fit.slots[k] = fit.slots[k].filter(Boolean);
      render();
      return;
    }
    const drone = at('[data-drone]');
    if (drone) {
      const [i, field, delta] = drone.dataset.drone!.split(':');
      change((draft) => {
        const dr = draft.drones[Number(i)];
        if (field === 'remove') draft.drones.splice(Number(i), 1);
        else if (field === 'count') { dr.count = Math.max(1, dr.count + Number(delta)); dr.active = Math.min(dr.active, dr.count); }
        else dr.active = Math.max(0, Math.min(dr.count, dr.active + Number(delta)));
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
    if (implant) { fit.implants.splice(Number(implant.dataset.implant), 1); render(); return; }
    const cargo = at('[data-cargo]');
    if (cargo) { fit.cargo.splice(Number(cargo.dataset.cargo), 1); render(); }
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
    if (target.dataset.charge && fit) {
      const [k, i] = parseSlot(target.dataset.charge);
      const m = fit.slots[k][i];
      if (!m) return;
      const chargeId = Number(target.value) || undefined;
      for (const other of fit.slots[k]) if (other && other.typeId === m.typeId) other.chargeId = chargeId;
      render();
    }
  });

  nameInput.addEventListener('change', () => {
    if (!fit) return;
    fit.name = nameInput.value.trim() || name(fit.shipId);
    saveJson(CURRENT_KEY, fit);
  });

  function runAction(action: string) {
    switch (action) {
      case 'clear':
        if (fit) newFit(fit.shipId);
        break;
      case 'save':
        if (!fit) return toast(tx('Nu ai niciun fit de salvat'));
        saveFit(fit);
        toast(tx('Fit salvat'));
        break;
      case 'saved':
        return openSavedFits();
      case 'import':
        return openImport();
      case 'export':
        return openExport();
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
  ctx.onCharacterChange(() => { renderCharacters(); render(); });
  render();

  return {
    selectItem,
    load(f: Fit) { fit = cloneFit(f); render(); },
    clearSlot() { if (pickedSlot) pickSlot(null); },
  };
}
