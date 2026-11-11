import { Category, type TypeInfo } from '../data/sde';
import { canActivate, canLoadCharge, type Fit, type FitModule, type SlotKind } from '../engine/fit';
import { isBoosterSideEffect, type Dogma } from '../engine/dogma';
import type { FitStats, Resource, Resources } from '../engine/stats';
import { typeIconUrl, typeRenderUrl } from '../services/market';
import { icon } from '../ui/icons';
import { badge, button, compactISK, esc, formatNum, panel } from '../ui/components';
import { moduleName } from '../engine/mutation';
import { tx } from '../i18n';
import { attrLabel } from '../i18n/attributes';
import { hasFittingSlots } from '../services/realFits';
import { GROUPS, STATE_LABEL, capTime, type ExtrasTab, type FitEnv } from './shared';
import type { createSupportPanels } from './support';
import type { createImplantPanel } from './implants';

interface LayoutDeps {
  support: ReturnType<typeof createSupportPanels>;
  implantPanel: ReturnType<typeof createImplantPanel>;
  pickedSlot(): SlotKind | null;
  extrasTab(): ExtrasTab;
}

export function createFitLayout(env: FitEnv, deps: LayoutDeps) {
  const { sde, name } = env;
  const { support, implantPanel } = deps;
  const chargeCache = new Map<number, TypeInfo[]>();
  const charges = sde.typesInCategory(Category.Charge).sort((a, b) => a.name.localeCompare(b.name));
  const chargesFor = (moduleId: number) => {
    if (!chargeCache.has(moduleId)) chargeCache.set(moduleId, charges.filter((c) => canLoadCharge(sde, moduleId, c.id)));
    return chargeCache.get(moduleId)!;
  };

  function shipHeader(f: Fit, s: FitStats) {
    const t = sde.type(f.shipId);
    return `<section class="panel glow ship-head">
      <div class="ship-render"><img src="${typeRenderUrl(f.shipId, 256)}" alt="" /></div>
      <div class="ship-info">
        <h2><button class="link" data-info="${f.shipId}">${esc(t.name)}</button></h2>
        <div class="meta">${badge(t.groupName)}${support.modeSelect(f)}${s.warnings.length ? `<button type="button" class="badge danger badge-btn" data-action="show-problems" data-tip="${esc(s.warnings.join(' · '))}"><span class="dot"></span>${esc(s.warnings.length === 1 ? tx('1 problemă') : tx('{n} probleme', { n: s.warnings.length }))}</button>` : ''}</div>
        <div class="ship-dps">
          <div class="ship-stat"><b class="num">${formatNum(s.offense.totalDps, 0)}</b><span>DPS</span></div>
          <div class="ship-stat"><b class="num">${compactISK(s.defense.ehp)}</b><span>EHP</span></div>
          <div class="ship-stat"><b class="num">${s.capacitor.stable ? formatNum((s.capacitor.stableAt ?? 1) * 100, 0) + '%' : capTime(s.capacitor.lastsSeconds ?? 0)}</b><span>${tx('Capacitor')}</span></div>
        </div>
      </div>
      <div class="ship-actions">
        ${button(tx('Informații'), { iconName: 'info', cls: 'ghost sm', attrs: `data-info="${f.shipId}"` })}
        ${button(tx('Fit nou'), { iconName: 'plus', cls: 'ghost sm', attrs: 'data-action="clear"' })}
        ${hasFittingSlots(sde, f.shipId) ? `<div class="starter-group"><span class="starter-note">${tx('Doar orientativ, adaptează-l nevoilor tale')}</span><span class="starter-brace" aria-hidden="true"><svg viewBox="0 0 10 100" preserveAspectRatio="none"><path d="M9 1C5 1 5 3 5 8v34c0 5-1 8-4 8 3 0 4 3 4 8v34c0 5 0 7 4 7" vector-effect="non-scaling-stroke"/></svg></span><div class="starter-buttons">${button(tx('Fit PvE'), { iconName: 'shield', cls: 'ghost sm', attrs: `data-starter="pve" title="${tx('Încarcă în tab-ul curent un fit PvE publicat, cu module T2')}"` })}${button(tx('Fit PvP'), { iconName: 'target', cls: 'ghost sm', attrs: `data-starter="pvp" title="${tx('Încarcă în tab-ul curent un fit PvP publicat, cu module T2')}"` })}</div></div>` : ''}
      </div>
    </section>`;
  }

  function moduleRow(kind: SlotKind, i: number, m: FitModule, over: boolean) {
    const options = chargesFor(m.typeId);
    const canCycle = canActivate(sde, m.typeId) || kind === 'high' || kind === 'mid' || kind === 'low';
    const chargeSelect = options.length
      ? `<select class="charge-select" data-charge="${kind}:${i}">
          <option value="">— ${tx('fără muniție')} —</option>
          ${options.map((c) => `<option value="${c.id}" ${c.id === m.chargeId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>${m.chargeId ? `<button class="charge-info" data-info="${m.chargeId}" data-info-charge="${kind}${i}" title="${tx('Info muniție')}">i</button>` : ''}`
      : '';
    return `<div class="slot fitted state-${m.state} ${over ? 'over' : ''}" data-slot="${kind}:${i}" data-pick="${kind}"${kind === 'subsystem' ? '' : ` draggable="true" data-drop="${kind}:${i}"`}>
      <img class="slot-img" src="${typeIconUrl(m.typeId, 32)}" alt="" loading="lazy" />
      <div class="slot-main">
        <button class="slot-name link ${m.mutation ? 'abyssal' : ''}" data-info="${m.typeId}">${esc(moduleName(sde, m))}</button>
        ${m.mutation ? `<div class="slot-base">${esc(name(m.typeId))}</div>` : ''}
        ${chargeSelect ? `<div class="charge-line">${chargeSelect}</div>` : ''}
      </div>
      ${kind === 'rig' || kind === 'subsystem' || !canCycle ? '' : `<button class="slot-state" data-state="${kind}:${i}" title="${STATE_LABEL[m.state]} (${tx('click: schimbă starea')})">${icon(m.state === 'overheated' ? 'fire' : 'power')}</button>`}
      ${sde.mutaplasmidsFor(m.typeId).length ? `<button class="slot-mutate ${m.mutation ? 'on' : ''}" data-mutate="${kind}:${i}" title="${tx('Mutaplasmid')}">${icon('mutate')}</button>` : ''}
      <button class="slot-info" data-info="${m.typeId}" title="${tx('Informații')}">${icon('info')}</button>
      <button class="slot-remove" data-remove="${kind}:${i}" title="${tx('Scoate')}">${icon('close')}</button>
    </div>`;
  }

  function slotsPanel(f: Fit, counts: Record<SlotKind, number>, r: Resources) {
    const hardpoint = (label: string, x: Resource) => (x.total || x.used ? `<span class="${x.used > x.total ? 'over' : ''}">${label} <b class="num">${x.used}/${x.total}</b></span>` : '');
    const groups = GROUPS.filter((g) => counts[g.key] > 0 || f.slots[g.key].some(Boolean)).map((g) => {
      const list = f.slots[g.key];
      const total = Math.max(counts[g.key], list.length);
      const used = list.filter(Boolean).length;
      const rows: string[] = [];
      for (let i = 0; i < total; i++) {
        const m = list[i];
        if (m) rows.push(moduleRow(g.key, i, m, i >= counts[g.key]));
        else if (i < counts[g.key]) rows.push(`<div class="slot slot-empty" data-pick="${g.key}"${g.key === 'subsystem' ? '' : ` data-drop="${g.key}:${i}"`} role="button" tabindex="0" aria-label="${esc(`${tx('Slot liber')} · ${g.label}`)}"><span class="slot-ico">${icon('plus')}</span><span>${tx('Slot liber')}</span></div>`);
      }
      const pips = Array.from({ length: Math.max(counts[g.key], 1) }, (_, i) => `<i class="${i < used ? 'on' : ''}"></i>`).join('');
      return `<div class="slot-group ${g.cls} ${deps.pickedSlot() === g.key ? 'picked' : ''}" data-group="${g.key}">
        <div class="slot-group-head"><div class="window-title">${g.label}<span class="count">${used}/${counts[g.key]}</span></div>${g.key === 'high' ? `<span class="hardpoints">${hardpoint(tx('Turele'), r.turrets)}${hardpoint(tx('Lansatoare'), r.launchers)}</span>` : ''}<span class="pips">${pips}</span></div>
        ${rows.join('')}
      </div>`;
    });
    return panel({ title: tx('Sloturi'), body: groups.join('') });
  }

  function droneRows(f: Fit, fighters: boolean) {
    const isFighter = (id: number) => sde.types.get(id)?.categoryId === Category.Fighter;
    return f.drones.map((dr, i) => ({ dr, i })).filter((x) => isFighter(x.dr.typeId) === fighters).map(({ dr, i }) => `<div class="slot fitted drone-row" data-drone-row="${i}">
      <img class="slot-img" src="${typeIconUrl(dr.typeId, 32)}" alt="" loading="lazy" />
      <div class="slot-main"><button class="slot-name link ${dr.mutation ? 'abyssal' : ''}" data-info="${dr.typeId}">${esc(moduleName(sde, dr))}</button>${dr.mutation ? `<div class="slot-base">${esc(name(dr.typeId))}</div>` : ''}</div>
      <span class="dim small drone-total">${tx('{n} în total', { n: dr.count })}</span>
      <div class="drone-step" title="${fighters ? tx('Escadrile lansate din hangarul de fighteri, cele care contează la DPS') : tx('Drone lansate în spațiu, cele care contează la DPS și la lățimea de bandă')}">
        <span class="drone-step-label">${tx('În spațiu')}</span>
        <div class="stepper"><button data-drone="${i}:space:-1" ${dr.active ? '' : 'disabled'}>−</button><span class="num">${dr.active}</span><button data-drone="${i}:space:1">+</button></div>
      </div>
      <div class="drone-step" title="${fighters ? tx('Escadrile de rezervă, rămase în hangarul de fighteri') : tx('Drone de rezervă, rămase în hangarul de drone')}">
        <span class="drone-step-label">${tx('În hangar')}</span>
        <div class="stepper"><button data-drone="${i}:bay:-1" ${dr.count - dr.active ? '' : 'disabled'}>−</button><span class="num">${dr.count - dr.active}</span><button data-drone="${i}:bay:1">+</button></div>
      </div>
      ${sde.mutaplasmidsFor(dr.typeId).length ? `<button class="slot-mutate ${dr.mutation ? 'on' : ''}" data-mutate-drone="${i}" title="${tx('Mutaplasmid')}">${icon('mutate')}</button>` : ''}
      <button class="slot-info" data-info="${dr.typeId}" title="${tx('Informații')}">${icon('info')}</button>
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
      const raw = a?.displayName || a?.name || e.name;
      const label = `${attrLabel(raw) !== raw ? attrLabel(raw) : raw.replace(/\s*Penalty$/, '')} ${value > 0 ? '+' : ''}${formatNum(value, 0)}%`;
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
      { key: 'drones', label: tx('Drone'), n: sum(drones), show: hasDrones },
      { key: 'fighters', label: tx('Fighteri'), n: fighters.length, show: hasFighters },
      { key: 'cargo', label: 'Cargo', n: f.cargo.length, show: true },
      { key: 'boosters', label: tx('Boostere'), n: boosters.length, show: true },
      { key: 'projected', label: tx('Proiectate'), n: sum(f.projected ?? []), show: true },
      { key: 'command', label: tx('Comandă'), n: f.fleet?.charges.length ?? 0, show: true },
      { key: 'notes', label: tx('Note'), n: f.notes?.trim() ? 1 : 0, show: true },
    ];
    const shown = tabsList.filter((x) => x.show);
    const current = shown.some((x) => x.key === deps.extrasTab()) ? deps.extrasTab() : shown[0].key;
    const list = (items: { id: number; label: string; sub?: string; set?: string; sides?: string; attr?: string; tag?: string; extra?: string }[]) => items.map((x) => `<div class="slot fitted">
      <img class="slot-img" src="${typeIconUrl(x.id, 32)}" alt="" loading="lazy" />
      <div class="slot-main"><button class="slot-name link" data-info="${x.id}">${esc(x.label)}</button>${x.sub ? `<span class="dim small">${esc(x.sub)}</span>` : ''}${x.set ? `<span class="small set-bonus">${esc(x.set)}</span>` : ''}${x.sides ?? ''}</div>
      ${x.tag ? badge(x.tag, 'accent') : ''}${x.extra ?? ''}
      <button class="slot-info" data-info="${x.id}" title="${tx('Informații')}">${icon('info')}</button>
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
        body = meta([`${tx('Hangar drone')} ${m3(r.droneBay)}`, `${tx('Lățime de bandă')} <b class="num">${formatNum(r.droneBandwidth.used, 0)}</b> / ${formatNum(r.droneBandwidth.total, 0)} Mbit/s`, `${tx('În spațiu')} <b class="num">${launched}</b> / ${formatNum(d.character.get('maxActiveDrones'), 0)}`])
          + `<div class="slot-group drones">${droneRows(f, false)}</div>` + (drones.length ? '' : hint(tx('Apasă pe o dronă din browser ca s-o adaugi.')));
        break;
      }
      case 'fighters':
        body = meta([`${tx('Hangar fighteri')} ${m3(r.fighterBay)}`, `${tx('Tuburi')} <b class="num">${r.fighterTubes.used}</b> / ${r.fighterTubes.total}`,
          r.fighterLight.total ? `${tx('Ușori')} ${r.fighterLight.used}/${r.fighterLight.total}` : '', r.fighterSupport.total ? `${tx('Suport')} ${r.fighterSupport.used}/${r.fighterSupport.total}` : '', r.fighterHeavy.total ? `${tx('Grei')} ${r.fighterHeavy.used}/${r.fighterHeavy.total}` : ''])
          + `<div class="slot-group drones">${droneRows(f, true)}</div>` + (fighters.length ? '' : hint(tx('Apasă pe un fighter din browser ca să-l adaugi.')));
        break;
      case 'cargo':
        body = meta([`${tx('Cargo')} ${m3(r.cargo)}`])
          + `<div class="slot-group implants">${list(f.cargo.map((c, i) => ({ id: c.typeId, label: name(c.typeId), sub: `${formatNum(volume(c.typeId) * c.count, 2)} m³`, attr: `data-cargo="${i}"`,
            extra: `<input class="input plain sm cargo-count num" type="number" min="1" step="1" value="${c.count}" data-cargo-count="${i}" title="${tx('Cantitate')}" />` })))}</div>`
          + hint(tx('Cât timp tab-ul Cargo e deschis, orice item apăsat în browser intră în cargo.'));
        break;
      case 'boosters':
        body = `<div class="slot-group implants">${list(boosters.map((x) => ({ ...boosterRow(x.id), attr: `data-implant="${x.i}"` })))}</div>`
          + (boosters.length ? '' : hint(tx('Apasă pe un booster din browser ca să-l adaugi.')));
        break;
      case 'projected':
        body = support.projectedBody(f, d) + hint(tx('Cât timp tab-ul e deschis, modulele și dronele proiectabile apăsate în browser se adaugă aici.'));
        break;
      case 'command':
        body = support.fleetBody(f) + hint(tx('Cât timp tab-ul e deschis, încărcăturile de burst apăsate în browser se adaugă aici.'));
        break;
      case 'notes':
        body = `<textarea class="input area fit-notes" id="fitNotes" rows="8" spellcheck="false" placeholder="${tx('Note despre fit: rol, cum se zboară, ce mai trebuie în cargo…')}">${esc(f.notes ?? '')}</textarea>`;
        break;
    }
    return `<section class="panel fit-extras">
      <div class="tabs extras-tabs">${shown.map((x) => `<button class="tab ${x.key === current ? 'active' : ''}" data-extras="${x.key}">${x.label}${x.n ? `<span class="tab-count">${x.n}</span>` : ''}</button>`).join('')}</div>
      <div class="panel-body">${body}</div>
    </section>`;
  }

  return { shipHeader, slotsPanel, extrasPanel };
}
