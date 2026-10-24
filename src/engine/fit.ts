import { Category, type Sde } from '../data/sde';
import { Dogma, EffectCategory, type ModuleState } from './dogma';
import { tx } from '../i18n';

export type SlotKind = 'high' | 'mid' | 'low' | 'rig' | 'subsystem';
export const SLOT_KINDS: SlotKind[] = ['high', 'mid', 'low', 'rig', 'subsystem'];

export interface FitModule {
  typeId: number;
  state: ModuleState;
  chargeId?: number;
  mutation?: Mutation;
}

export interface Mutation {
  mutaplasmidId: number;
  values: Record<string, number>;
}

export interface FitDrone {
  typeId: number;
  count: number;
  active: number;
}

export interface FitCargo {
  typeId: number;
  count: number;
}

export interface Fit {
  id: string;
  name: string;
  shipId: number;
  slots: Record<SlotKind, (FitModule | null)[]>;
  drones: FitDrone[];
  cargo: FitCargo[];
  implants: number[];
  boosterSides?: Record<string, string[]>;
}

export interface CharacterSkills {
  name: string;
  skills: Map<number, number>;
  implants?: number[];
}

const SLOT_EFFECTS: Record<SlotKind, string> = {
  high: 'hiPower',
  mid: 'medPower',
  low: 'loPower',
  rig: 'rigSlot',
  subsystem: 'subSystem',
};

const SLOT_COUNT_ATTR: Record<Exclude<SlotKind, 'subsystem'>, string> = {
  high: 'hiSlots',
  mid: 'medSlots',
  low: 'lowSlots',
  rig: 'rigSlots',
};

export function newFitId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function emptyFit(shipId: number, name = tx('Fit nou')): Fit {
  return { id: newFitId(), name, shipId, slots: { high: [], mid: [], low: [], rig: [], subsystem: [] }, drones: [], cargo: [], implants: [] };
}

export function slotOf(sde: Sde, typeId: number): SlotKind | undefined {
  return SLOT_KINDS.find((k) => sde.hasEffect(typeId, SLOT_EFFECTS[k]));
}

export function slotCounts(sde: Sde, fit: Fit, dogma?: Dogma): Record<SlotKind, number> {
  const d = dogma ?? new Dogma(sde, toDogmaInput(fit, new Map()));
  const ship = d.ship;
  const isT3C = ship.get('maxSubSystems') > 0;
  return {
    high: Math.round(ship.get(SLOT_COUNT_ATTR.high)),
    mid: Math.round(ship.get(SLOT_COUNT_ATTR.mid)),
    low: Math.round(ship.get(SLOT_COUNT_ATTR.low)),
    rig: Math.round(ship.get(SLOT_COUNT_ATTR.rig)),
    subsystem: isT3C ? Math.round(ship.get('maxSubSystems')) : 0,
  };
}

export function defaultState(sde: Sde, typeId: number): ModuleState {
  const t = sde.type(typeId);
  const activatable = t.effects.some((id) => sde.effects.get(id)?.category === EffectCategory.Active);
  return activatable ? 'active' : 'online';
}

export function canOverheat(sde: Sde, typeId: number): boolean {
  return sde.type(typeId).effects.some((id) => sde.effects.get(id)?.category === EffectCategory.Overload);
}

export function canActivate(sde: Sde, typeId: number): boolean {
  return defaultState(sde, typeId) === 'active';
}

const CHARGE_GROUP_ATTRS = ['chargeGroup1', 'chargeGroup2', 'chargeGroup3', 'chargeGroup4', 'chargeGroup5'];

export function canLoadCharge(sde: Sde, moduleId: number, chargeId: number): boolean {
  const charge = sde.types.get(chargeId);
  if (!charge || charge.categoryId !== Category.Charge) return false;
  const groups = CHARGE_GROUP_ATTRS.filter((n) => sde.hasAttr(n)).map((n) => sde.baseAttr(moduleId, sde.attrId(n))).filter((g) => g > 0);
  if (!groups.includes(charge.groupId)) return false;
  const modSize = sde.baseAttr(moduleId, sde.attrId('chargeSize'));
  const chargeSize = sde.baseAttr(chargeId, sde.attrId('chargeSize'));
  if (modSize > 0 && chargeSize > 0 && modSize !== chargeSize) return false;
  const capacity = sde.baseAttr(moduleId, sde.attrId('capacity'));
  const volume = sde.baseAttr(chargeId, sde.attrId('volume'));
  return capacity <= 0 || volume <= capacity;
}

export function chargesPerModule(sde: Sde, moduleId: number, chargeId: number): number {
  const capacity = sde.baseAttr(moduleId, sde.attrId('capacity'));
  const volume = sde.baseAttr(chargeId, sde.attrId('volume'));
  return volume > 0 ? Math.max(1, Math.floor(capacity / volume)) : 1;
}

export type AddResult = { ok: true; message: string } | { ok: false; message: string };

export function addToFit(sde: Sde, fit: Fit, typeId: number): AddResult {
  const t = sde.types.get(typeId);
  if (!t) return { ok: false, message: tx('Itemul nu se poate fita.') };

  if (t.categoryId === Category.Charge) {
    let loaded = 0;
    for (const kind of SLOT_KINDS) {
      for (const m of fit.slots[kind]) {
        if (m && canLoadCharge(sde, m.typeId, typeId)) { m.chargeId = typeId; loaded++; }
      }
    }
    return loaded ? { ok: true, message: tx('{name} încărcat în {n} module', { name: t.name, n: loaded }) } : { ok: false, message: tx('Niciun modul din fit nu acceptă {name}.', { name: t.name }) };
  }

  if (t.categoryId === Category.Drone || t.categoryId === Category.Fighter) {
    const existing = fit.drones.find((d) => d.typeId === typeId);
    if (existing) { existing.count++; existing.active++; } else fit.drones.push({ typeId, count: 1, active: 1 });
    return { ok: true, message: tx('{name} adăugată în drone bay', { name: t.name }) };
  }

  if (t.categoryId === Category.Implant) {
    const booster = sde.baseAttr(typeId, sde.attrId('boosterness'));
    const slotAttr = sde.attrId(booster ? 'boosterness' : 'implantness');
    const slot = sde.baseAttr(typeId, slotAttr);
    const same = (id: number) => slot > 0 && sde.types.get(id)?.attrs.has(slotAttr) && sde.baseAttr(id, slotAttr) === slot;
    fit.implants = fit.implants.filter((id) => id === typeId || !same(id));
    if (!fit.implants.includes(typeId)) fit.implants.push(typeId);
    return { ok: true, message: booster ? tx('{name} adăugat la boostere', { name: t.name }) : tx('{name} adăugat la implanturi', { name: t.name }) };
  }

  const kind = slotOf(sde, typeId);
  if (!kind) return { ok: false, message: tx('{name} nu se poate fita pe navă.', { name: t.name }) };
  if (kind === 'rig') {
    const shipSize = sde.baseAttr(fit.shipId, sde.attrId('rigSize'));
    const rigSize = sde.baseAttr(typeId, sde.attrId('rigSize'));
    if (shipSize && rigSize && shipSize !== rigSize) return { ok: false, message: tx('{name} nu are mărimea potrivită pentru nava asta.', { name: t.name }) };
  }
  if (kind === 'subsystem') {
    const fitsTo = sde.baseAttr(typeId, sde.attrId('fitsToShipType'));
    if (fitsTo && fitsTo !== fit.shipId) return { ok: false, message: tx('{name} nu e pentru nava asta.', { name: t.name }) };
    const pos = sde.baseAttr(typeId, sde.attrId('subSystemSlot'));
    const list = fit.slots.subsystem;
    const idx = list.findIndex((m) => m && sde.baseAttr(m.typeId, sde.attrId('subSystemSlot')) === pos);
    const entry = { typeId, state: 'online' as ModuleState };
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    return { ok: true, message: `${t.name} montat` };
  }

  const d = new Dogma(sde, toDogmaInput(fit, new Map()));
  const fitted = SLOT_KINDS.flatMap((k) => fit.slots[k]).filter((m): m is FitModule => m != null);
  const maxGroup = sde.baseAttr(typeId, sde.attrId('maxGroupFitted'));
  if (maxGroup > 0 && fitted.filter((m) => sde.types.get(m.typeId)?.groupId === t.groupId).length >= maxGroup) {
    return { ok: false, message: tx('Poți monta maxim {n} × {group} pe navă.', { n: maxGroup, group: t.groupName }) };
  }

  const counts = slotCounts(sde, fit, d);
  const list = fit.slots[kind];
  while (list.length < counts[kind]) list.push(null);
  for (let i = 0; i < counts[kind]; i++) {
    if (!list[i]) {
      list[i] = { typeId, state: defaultState(sde, typeId) };
      return { ok: true, message: `${t.name} montat` };
    }
  }
  return { ok: false, message: tx('Nu mai sunt sloturi {k} libere.', { k: kind }) };
}

export function toDogmaInput(fit: Fit, skills: Map<number, number>, implants: number[] = []) {
  const modules = SLOT_KINDS.flatMap((kind) =>
    fit.slots[kind].flatMap((m, i) => (m ? [{ typeId: m.typeId, state: m.state, chargeId: m.chargeId, slotKey: `${kind}${i}`, overrides: m.mutation?.values }] : [])));
  return {
    shipId: fit.shipId,
    skills,
    implants: [...new Set([...implants, ...fit.implants])],
    modules,
    drones: fit.drones.map((d) => ({ typeId: d.typeId, count: d.active })),
    boosterSides: fit.boosterSides,
  };
}

export function buildDogma(sde: Sde, fit: Fit, character: CharacterSkills): Dogma {
  return new Dogma(sde, toDogmaInput(fit, character.skills, character.implants));
}

export function fitContents(sde: Sde, fit: Fit): Map<number, number> {
  const out = new Map<number, number>();
  const add = (id: number, n: number) => out.set(id, (out.get(id) ?? 0) + n);
  add(fit.shipId, 1);
  for (const kind of SLOT_KINDS) {
    for (const m of fit.slots[kind]) {
      if (!m) continue;
      if (!m.mutation) add(m.typeId, 1);
      if (m.chargeId) add(m.chargeId, chargesPerModule(sde, m.typeId, m.chargeId));
    }
  }
  for (const d of fit.drones) add(d.typeId, d.count);
  for (const c of fit.cargo) add(c.typeId, c.count);
  for (const i of fit.implants) add(i, 1);
  return out;
}

export function cloneFit(fit: Fit): Fit {
  return JSON.parse(JSON.stringify(fit)) as Fit;
}
