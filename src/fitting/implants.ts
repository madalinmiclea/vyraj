import { addToFit, mergeImplants, type Fit } from '../engine/fit';
import { Op, type Dogma, type DogmaItem } from '../engine/dogma';
import { Category, type TypeInfo } from '../data/sde';
import { typeIconUrl } from '../services/market';
import { attributeSections } from '../ui/attributes';
import { icon } from '../ui/icons';
import { badge, esc, formatNum, toast } from '../ui/components';
import { tx } from '../i18n';
import type { FitEnv } from './shared';

const SLOTS = 10;
const PERCENT_UNITS = [105, 108, 109, 111, 121, 124, 127];
const SET_ATTR = /^(implantSet|setBonus)/i;
const PIECE = /\s+(Alpha|Beta|Gamma|Delta|Epsilon|Omega)$/;

interface ImplantSet {
  key: string;
  name: string;
  pieces: TypeInfo[];
}

export function createImplantPanel(env: FitEnv) {
  const { sde } = env;
  const implantness = sde.attrId('implantness');
  const boosterness = sde.attrId('boosterness');
  let bySlot: Map<number, TypeInfo[]> | null = null;
  let sets: ImplantSet[] | null = null;

  const slotOf = (id: number) => sde.baseAttr(id, implantness);
  const isBooster = (id: number) => sde.baseAttr(id, boosterness) > 0;
  const signed = (v: string) => (v.startsWith('-') || v.startsWith('+') ? v : '+' + v);
  const attrLabel = (id: number) => { const a = sde.attributes.get(id); return a?.displayName || a?.name || String(id); };

  function implantsBySlot() {
    if (bySlot) return bySlot;
    bySlot = new Map();
    for (const t of sde.typesInCategory(Category.Implant)) {
      if (!t.marketGroupId || isBooster(t.id)) continue;
      const slot = slotOf(t.id);
      if (slot < 1 || slot > SLOTS) continue;
      const list = bySlot.get(slot);
      if (list) list.push(t); else bySlot.set(slot, [t]);
    }
    for (const list of bySlot.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return bySlot;
  }

  function setAttrOf(id: number): number | undefined {
    const attrs = sde.types.get(id)?.attrs;
    if (!attrs) return undefined;
    return [...attrs.keys()].find((a) => { const n = sde.attributes.get(a)?.name ?? ''; return SET_ATTR.test(n) && !/Modifier$|FAKE$/i.test(n); });
  }

  function allSets(): ImplantSet[] {
    if (sets) return sets;
    const map = new Map<string, TypeInfo[]>();
    for (const list of implantsBySlot().values()) {
      for (const t of list) {
        if (!PIECE.test(t.name) || setAttrOf(t.id) == null) continue;
        const key = t.name.replace(PIECE, '');
        const pieces = map.get(key);
        if (pieces) pieces.push(t); else map.set(key, [t]);
      }
    }
    sets = [...map].filter(([, p]) => p.length > 1)
      .map(([key, pieces]) => ({ key, name: key, pieces: pieces.sort((a, b) => slotOf(a.id) - slotOf(b.id)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return sets;
  }

  function bonusLine(id: number): string {
    const rows = attributeSections(sde, id).flatMap((sec) => sec.rows).filter((r) => {
      const a = sde.attributes.get(r.id);
      return a && (/bonus/i.test(a.name) || PERCENT_UNITS.includes(a.unitId ?? 0)) && a.name !== 'implantness' && !SET_ATTR.test(a.name);
    });
    return rows.slice(0, 2).map((r) => `${r.name} ${signed(r.base ?? r.value)}`).join(' · ');
  }

  function setTargets(item: DogmaItem): number[] {
    const out = new Set<number>();
    for (const e of item.type.effects) {
      const effect = sde.effects.get(e);
      if (!effect) continue;
      for (const m of effect.modifiers) if (SET_ATTR.test(sde.attributes.get(m.from)?.name ?? '') && m.d === 'charID' && m.f !== 'ItemModifier') out.add(m.to);
    }
    return [...out];
  }

  function consumerOp(item: DogmaItem, attrId: number): number | undefined {
    for (const e of item.type.effects) {
      const effect = sde.effects.get(e);
      const m = effect?.modifiers.find((x) => x.from === attrId && !SET_ATTR.test(sde.attributes.get(x.to)?.name ?? ''));
      if (m) return m.op;
    }
    return undefined;
  }

  function activeSets(d: Dogma) {
    const out: { set: ImplantSet; items: DogmaItem[]; mult: number; totals: { attr: number; value: number; percent: boolean }[] }[] = [];
    for (const set of allSets()) {
      const items = d.implants.filter((i) => set.pieces.some((p) => p.id === i.typeId));
      if (!items.length) continue;
      const mult = items.reduce((a, i) => { const s = setAttrOf(i.typeId); return s == null ? a : a * i.attr(s); }, 1);
      const targets = [...new Set(items.flatMap(setTargets))];
      const totals = targets.map((attr) => {
        const holders = d.implants.filter((i) => i.has(attr) && i.attr(attr) !== 0);
        const op = holders.map((i) => consumerOp(i, attr)).find((x) => x != null);
        const percent = op === Op.PostPercent;
        const value = percent
          ? (holders.reduce((a, i) => a * (1 + i.attr(attr) / 100), 1) - 1) * 100
          : holders.reduce((a, i) => a + i.attr(attr), 0);
        return { attr, value, percent };
      }).filter((x) => x.value !== 0);
      out.push({ set, items, mult, totals });
    }
    return out;
  }

  function setLine(d: Dogma, id: number): string {
    const item = d.implants.find((i) => i.typeId === id);
    if (!item) return '';
    const parts: string[] = [];
    const s = setAttrOf(id);
    if (s != null) parts.push(`${attrLabel(s)} ×${formatNum(sde.baseAttr(id, s), 2)}`);
    for (const set of activeSets(d)) {
      for (const t of set.totals) {
        if (!item.has(t.attr) || item.attr(t.attr) === item.base(t.attr)) continue;
        parts.push(`${attrLabel(t.attr)} ${formatNum(item.base(t.attr), 2)} → ${signed(formatNum(item.attr(t.attr), 2))}${PERCENT_UNITS.includes(sde.attributes.get(t.attr)?.unitId ?? 0) ? ' %' : ''}`);
      }
    }
    return [...new Set(parts)].join(' · ');
  }

  function row(d: Dogma, id: number, extra: { attr?: string; tag?: string } = {}) {
    const slot = slotOf(id);
    const set = setLine(d, id);
    const sub = bonusLine(id);
    return `<div class="slot fitted imp-row">
      <span class="imp-slot num">${slot || '·'}</span>
      <img class="slot-img" src="${typeIconUrl(id, 32)}" alt="" loading="lazy" />
      <div class="slot-main"><button class="slot-name link" data-info="${id}">${esc(env.name(id))}</button>${sub ? `<span class="dim small">${esc(sub)}</span>` : ''}${set ? `<span class="small set-bonus">${esc(set)}</span>` : ''}</div>
      ${extra.tag ? badge(extra.tag, 'accent') : ''}
      <button class="slot-info" data-info="${id}" title="Show Info">${icon('info')}</button>
      ${extra.attr ? `<button class="slot-remove" ${extra.attr} title="${tx('Scoate')}">${icon('close')}</button>` : ''}
    </div>`;
  }

  function emptyRow(slot: number) {
    const options = (implantsBySlot().get(slot) ?? []).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    return `<div class="slot imp-row imp-empty">
      <span class="imp-slot num">${slot}</span>
      <select class="input plain sm imp-pick" data-imp-slot="${slot}"><option value="">${tx('Slot {n} liber, alege un implant', { n: slot })}</option>${options}</select>
    </div>`;
  }

  function summary(d: Dogma) {
    const list = activeSets(d);
    if (!list.length) return '';
    return `<div class="imp-sets">${list.map((x) => `<div class="imp-set">
        <div class="imp-set-head"><b>${esc(x.set.name)}</b><span class="dim small">${x.items.length === 1 ? tx('{n} piesă', { n: 1 }) : tx('{n} piese', { n: x.items.length })} / ${x.set.pieces.length}</span>
        <span class="num set-bonus">${tx('Multiplicator set')} ×${formatNum(x.mult, 3)}</span></div>
        ${x.totals.map((t) => `<div class="small">${esc(attrLabel(t.attr))} <b class="num">${signed(formatNum(t.value, 2))}${t.percent || PERCENT_UNITS.includes(sde.attributes.get(t.attr)?.unitId ?? 0) ? ' %' : ''}</b> <span class="dim">${tx('total cu bonusul de set')}</span></div>`).join('')}
      </div>`).join('')}</div>`;
  }

  function body(f: Fit, d: Dogma): string {
    const own = env.ctx.character.implants.filter((id) => sde.types.has(id) && !isBooster(id));
    const useOwn = f.charImplants !== false;
    const active = new Set(mergeImplants(sde, useOwn ? own : [], f.implants));
    const fitted = new Map<number, number>();
    f.implants.forEach((id, i) => { if (!isBooster(id)) fitted.set(id, i); });
    const occupied = new Map<number, number>();
    const other: number[] = [];
    for (const id of active) {
      if (isBooster(id)) continue;
      const slot = slotOf(id);
      if (slot >= 1 && slot <= SLOTS && !occupied.has(slot)) occupied.set(slot, id); else other.push(id);
    }
    const line = (id: number) => fitted.has(id) ? row(d, id, { attr: `data-implant="${fitted.get(id)}"` }) : row(d, id, { tag: tx('caracter') });
    const rows = Array.from({ length: SLOTS }, (_, i) => i + 1).map((slot) => occupied.has(slot) ? line(occupied.get(slot)!) : emptyRow(slot)).join('') + other.map(line).join('');
    const setPicker = `<select class="input plain sm" id="impAddSet"><option value="">+ ${tx('Set de implanturi')}</option>
      ${allSets().map((s) => `<option value="${esc(s.key)}">${esc(s.name)} (${s.pieces.length})</option>`).join('')}
    </select>`;
    const ownChip = own.length ? `<button class="chip-btn sm ${useOwn ? 'active' : ''}" data-imp-char title="${tx('Folosește și implanturile clonei active a caracterului')}">${tx('Implanturile caracterului')} (${own.length})</button>` : '';
    const clear = f.implants.some((id) => !isBooster(id)) ? `<button class="chip-btn sm" data-imp-clear>${tx('Scoate implanturile fitului')}</button>` : '';
    return `<div class="imp-tools">${setPicker}${ownChip}${clear}</div>${summary(d)}<div class="slot-group implants">${rows}</div>`;
  }

  function count(f: Fit): number {
    const own = f.charImplants === false ? [] : env.ctx.character.implants.filter((id) => sde.types.has(id));
    return mergeImplants(sde, own, f.implants).filter((id) => !isBooster(id)).length;
  }

  function addSet(key: string) {
    const set = allSets().find((s) => s.key === key);
    if (!set) return;
    env.change((draft) => { for (const p of set.pieces) addToFit(sde, draft, p.id); });
    toast(tx('{name} adăugat la implanturi', { name: set.name }));
  }

  function handleClick(target: HTMLElement): boolean {
    if (target.closest('[data-imp-char]')) { env.change((draft) => { draft.charImplants = draft.charImplants === false; if (draft.charImplants) delete draft.charImplants; }); return true; }
    if (target.closest('[data-imp-clear]')) { env.change((draft) => { draft.implants = draft.implants.filter(isBooster); }); return true; }
    return false;
  }

  function handleChange(target: HTMLSelectElement): boolean {
    if (target.id === 'impAddSet') { if (target.value) addSet(target.value); return true; }
    if (target.dataset.impSlot != null) {
      const id = Number(target.value);
      if (id) env.change((draft) => { addToFit(sde, draft, id); });
      return true;
    }
    return false;
  }

  return { body, count, bonusLine, handleClick, handleChange };
}
