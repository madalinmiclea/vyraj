import { Category, type Sde } from '../data/sde';
import { canLoadCharge, emptyFit, slotCounts, toDogmaInput, SLOT_KINDS, type Fit, type SlotKind } from '../engine/fit';
import { Dogma } from '../engine/dogma';
import { resources, type Resource, type Resources } from '../engine/stats';
import { allLevels } from '../character/characters';
import { parseEft } from '../io/eft';
import { tx } from '../i18n';

export type RealFitKind = 'pve' | 'pvp';

interface PublishedFit { eft: string; source: string; title?: string }
type ShipFits = Record<string, Partial<Record<RealFitKind, PublishedFit>>>;

export interface RealFit {
  fit: Fit;
  source: string;
  title: string;
  generated: boolean;
}

interface Upgraded { k: SlotKind; i: number; original: number }

let data: Promise<ShipFits> | null = null;

function loadShipFits(): Promise<ShipFits> {
  data ??= import('../data/shipFits.json').then((m) => m.default as ShipFits).catch((e) => { data = null; throw e; });
  return data;
}

export function hasFittingSlots(sde: Sde, shipId: number): boolean {
  const ship = sde.types.get(shipId);
  if (!ship || ship.categoryId !== Category.Ship) return false;
  const c = slotCounts(sde, emptyFit(shipId));
  return c.high + c.mid + c.low + c.subsystem > 0;
}

function toT2(sde: Sde, typeId: number): number {
  const t = sde.types.get(typeId);
  if (!t || t.metaGroupId === 2) return typeId;
  return sde.variations(typeId).find((v) => v.metaGroupId === 2)?.id ?? typeId;
}

function factionOf(sde: Sde, typeId: number): number[] {
  return sde.variations(typeId).filter((v) => v.metaGroupId === 4).map((v) => v.id);
}

function t1Of(sde: Sde, typeId: number, original: number): number {
  const list = sde.variations(typeId);
  return (list.find((v) => v.variationParentId == null && v.metaGroupId !== 2) ?? list.find((v) => v.metaGroupId === 1))?.id ?? original;
}

function metaOf(sde: Sde, typeId: number): number[] {
  return sde.variations(typeId).filter((v) => (v.metaGroupId === 1 || (v.variationParentId == null && v.metaGroupId !== 2)) && !/\bCivilian\b/.test(v.name)).map((v) => v.id);
}

const excess = (r: Resource) => Math.max(0, r.used - r.total) / Math.max(r.total, 1);
const fittingExcess = (r: Resources) => excess(r.cpu) + excess(r.power);
const calibrationExcess = (r: Resources) => excess(r.calibration);

interface Adjustments { faction: number; meta: number; rigs: number; removed: number; trimmed: boolean; valid: boolean }

function swapUntilFits(fit: Fit, measure: () => Resources, positions: Upgraded[], choices: (p: Upgraded) => number[], score: (r: Resources) => number): number {
  const open = [...positions];
  let current = score(measure());
  let swaps = 0;
  while (current > 1e-9 && open.length) {
    let best: { index: number; typeId: number; value: number } | null = null;
    open.forEach((p, index) => {
      const m = fit.slots[p.k][p.i]!;
      const keep = m.typeId;
      for (const typeId of choices(p)) {
        if (typeId === keep) continue;
        m.typeId = typeId;
        const value = score(measure());
        if (!best || value < best.value) best = { index, typeId, value };
      }
      m.typeId = keep;
    });
    const chosen = best as { index: number; typeId: number; value: number } | null;
    if (!chosen || chosen.value >= current - 1e-9) break;
    const p = open.splice(chosen.index, 1)[0];
    fit.slots[p.k][p.i]!.typeId = chosen.typeId;
    current = chosen.value;
    swaps++;
  }
  return swaps;
}

function removeExtraModules(sde: Sde, fit: Fit, measure: () => Resources): number {
  let removed = 0;
  const dropLast = (k: SlotKind, match: (typeId: number) => boolean) => {
    const list = fit.slots[k];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m && match(m.typeId)) { list[i] = null; removed++; return true; }
    }
    return false;
  };
  for (let guard = 0; guard < 40; guard++) {
    const r = measure();
    const k = SLOT_KINDS.find((x) => x !== 'subsystem' && r.slots[x].used > r.slots[x].total);
    if (k) { if (!dropLast(k, () => true)) break; continue; }
    if (r.turrets.used > r.turrets.total) { if (!dropLast('high', (id) => sde.hasEffect(id, 'turretFitted'))) break; continue; }
    if (r.launchers.used > r.launchers.total) { if (!dropLast('high', (id) => sde.hasEffect(id, 'launcherFitted'))) break; continue; }
    break;
  }
  return removed;
}

function trimBays(sde: Sde, fit: Fit, measure: () => Resources): boolean {
  let trimmed = false;
  for (let guard = 0; guard < 200; guard++) {
    const r = measure();
    const bay = r.droneBay.used > r.droneBay.total + 1e-6 ? (id: number) => sde.types.get(id)?.categoryId === Category.Drone
      : r.fighterBay.used > r.fighterBay.total + 1e-6 ? (id: number) => sde.types.get(id)?.categoryId === Category.Fighter : null;
    if (!bay) break;
    const d = [...fit.drones].reverse().find((x) => bay(x.typeId) && x.count > 0);
    if (!d) break;
    d.count--;
    d.active = Math.min(d.active, d.count);
    trimmed = true;
  }
  fit.drones = fit.drones.filter((d) => d.count > 0);
  for (let guard = 0; guard < 50; guard++) {
    const r = measure();
    if (r.droneBandwidth.used <= r.droneBandwidth.total + 1e-6) break;
    const d = [...fit.drones].reverse().find((x) => x.active > 0 && sde.types.get(x.typeId)?.categoryId === Category.Drone);
    if (!d) break;
    d.active--;
  }
  for (let guard = 0; guard < 20; guard++) {
    const r = measure();
    if (r.cargo.used <= r.cargo.total + 1e-6 || !fit.cargo.length) break;
    const factor = r.cargo.total / r.cargo.used;
    for (const c of fit.cargo) c.count = Math.floor(c.count * factor);
    fit.cargo = fit.cargo.filter((c) => c.count > 0);
    trimmed = true;
  }
  return trimmed;
}

const DAMAGE_ATTRS = ['emDamage', 'thermalDamage', 'kineticDamage', 'explosiveDamage'];

function damageOf(sde: Sde, typeId: number): number {
  return DAMAGE_ATTRS.filter((n) => sde.hasAttr(n)).reduce((a, n) => a + sde.baseAttr(typeId, sde.attrId(n)), 0);
}

function strongest(sde: Sde, ids: number[]): number | undefined {
  return [...ids].sort((a, b) => damageOf(sde, b) - damageOf(sde, a) || sde.type(a).name.localeCompare(sde.type(b).name))[0];
}

function upgradeCharge(sde: Sde, chargeId: number, fits: (id: number) => boolean): number {
  const t = sde.types.get(chargeId);
  if (!t || t.metaGroupId === 2) return chargeId;
  const variants = sde.variations(chargeId).filter((v) => fits(v.id));
  const pick = (meta: number) => strongest(sde, variants.filter((v) => v.metaGroupId === meta).map((v) => v.id));
  if (t.metaGroupId === 4) return pick(2) ?? chargeId;
  return pick(2) ?? pick(4) ?? chargeId;
}

let chargePool: number[] | null = null;

function chargeFor(sde: Sde, moduleId: number, only?: number): number | undefined {
  chargePool ??= sde.typesInCategory(Category.Charge).filter((c) => c.metaGroupId === 2 || c.metaGroupId === 4).map((c) => c.id);
  const fit = chargePool.filter((id) => canLoadCharge(sde, moduleId, id) && (only == null || sde.types.get(id)?.metaGroupId === only));
  return strongest(sde, fit.filter((id) => sde.types.get(id)?.metaGroupId === 2)) ?? strongest(sde, fit.filter((id) => sde.types.get(id)?.metaGroupId === 4));
}

function loadCharges(sde: Sde, fit: Fit): void {
  const cargo = new Map<number, number>();
  for (const c of fit.cargo) {
    const id = sde.types.get(c.typeId)?.categoryId === Category.Charge ? upgradeCharge(sde, c.typeId, () => true) : c.typeId;
    cargo.set(id, (cargo.get(id) ?? 0) + c.count);
  }
  const fromCargo = (moduleId: number) => [...cargo].filter(([id]) => canLoadCharge(sde, moduleId, id)).sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const k of SLOT_KINDS) {
    for (const m of fit.slots[k]) {
      if (!m) continue;
      const weapon = sde.hasEffect(m.typeId, 'turretFitted') || sde.hasEffect(m.typeId, 'launcherFitted');
      if (m.chargeId) m.chargeId = upgradeCharge(sde, m.chargeId, (id) => canLoadCharge(sde, m.typeId, id));
      else if (weapon) m.chargeId = fromCargo(m.typeId) ?? chargeFor(sde, m.typeId);
      if (weapon && m.chargeId && sde.types.get(m.chargeId)?.metaGroupId !== 2) m.chargeId = chargeFor(sde, m.typeId, 2) ?? m.chargeId;
    }
  }
  const loaded = new Map<number, number>();
  for (const k of SLOT_KINDS) for (const m of fit.slots[k]) {
    if (!m?.chargeId) continue;
    const rounds = Math.floor(sde.baseAttr(m.typeId, sde.attrId('capacity')) / Math.max(sde.baseAttr(m.chargeId, sde.attrId('volume')), 1e-6));
    loaded.set(m.chargeId, (loaded.get(m.chargeId) ?? 0) + Math.max(1, rounds) * 10);
  }
  for (const [id, n] of loaded) if (!cargo.has(id)) cargo.set(id, n);
  fit.cargo = [...cargo].map(([typeId, count]) => ({ typeId, count }));
}

function keepWithinLimits(sde: Sde, fit: Fit, upgraded: Upgraded[]): Adjustments {
  const skills = allLevels(sde, 5).skills;
  const measure = () => resources(sde, fit, new Dogma(sde, toDogmaInput(sde, fit, skills)));
  const removed = removeExtraModules(sde, fit, measure);
  const originals = new Map(upgraded.map((p) => [`${p.k}:${p.i}`, p.original]));
  const positions = (rig: boolean): Upgraded[] => SLOT_KINDS.filter((k) => k !== 'subsystem' && (k === 'rig') === rig)
    .flatMap((k) => fit.slots[k].map((m, i) => (m && !m.mutation ? { k, i, original: originals.get(`${k}:${i}`) ?? m.typeId } : null)))
    .filter((p): p is Upgraded => !!p);
  const typeAt = (p: Upgraded) => fit.slots[p.k][p.i]!.typeId;
  const rigs = swapUntilFits(fit, measure, positions(true), (p) => [t1Of(sde, typeAt(p), p.original), ...metaOf(sde, typeAt(p))], calibrationExcess);
  const faction = swapUntilFits(fit, measure, positions(false), (p) => factionOf(sde, typeAt(p)), fittingExcess);
  const meta = swapUntilFits(fit, measure, positions(false).filter((p) => p.original !== typeAt(p)), (p) => [p.original], fittingExcess)
    + swapUntilFits(fit, measure, positions(false), (p) => metaOf(sde, typeAt(p)), fittingExcess);
  const trimmed = trimBays(sde, fit, measure);
  const r = measure();
  const valid = fittingExcess(r) + calibrationExcess(r) < 1e-9 && SLOT_KINDS.every((k) => r.slots[k].used <= r.slots[k].total) && r.turrets.used <= r.turrets.total && r.launchers.used <= r.launchers.total;
  return { faction, meta, rigs, removed, trimmed, valid };
}

export async function findRealFit(sde: Sde, shipId: number, kind: RealFitKind): Promise<RealFit | null> {
  const entry = (await loadShipFits())[String(shipId)]?.[kind];
  if (!entry) return null;
  const { fit } = parseEft(sde, entry.eft);
  if (fit.shipId !== shipId) return null;
  const upgraded: Upgraded[] = [];
  for (const k of SLOT_KINDS) {
    if (k === 'subsystem') continue;
    fit.slots[k].forEach((m, i) => {
      if (!m || m.mutation) return;
      const t2 = toT2(sde, m.typeId);
      if (t2 !== m.typeId) { upgraded.push({ k, i, original: m.typeId }); m.typeId = t2; }
    });
  }
  for (const d of fit.drones) if (sde.types.get(d.typeId)?.categoryId === Category.Drone) d.typeId = toT2(sde, d.typeId);
  loadCharges(sde, fit);
  const swaps = keepWithinLimits(sde, fit, upgraded);
  if (!swaps.valid) return null;
  const label = kind === 'pve' ? 'PvE' : 'PvP';
  const title = entry.title?.trim() || fit.name;
  fit.name = `${sde.type(shipId).name} ${label}`;
  const generated = entry.source === 'generated';
  const notes = [generated
    ? tx('Fit {kind} compus din bonusurile și statisticile navei, pentru că nu există un fit publicat. Modulele care au variantă T2 au fost trecute pe T2.', { kind: label })
    : tx('Fit publicat: „{title}”, sursa {url} . Modulele care au variantă T2 au fost trecute pe T2.', { title, url: entry.source })];
  notes.push(tx('Charges sunt T2 unde există, altfel faction.'));
  if (swaps.removed) notes.push(tx('Am scos modulele care nu aveau sloturi sau hardpoints libere pe navă ({n}).', { n: swaps.removed }));
  if (swaps.faction) notes.push(tx('Ca să încapă în CPU și powergrid cu toate skill-urile la V, unele module au trecut pe varianta faction ({n}).', { n: swaps.faction }));
  if (swaps.meta) notes.push(tx('Unde nici faction nu a ajuns, unele module au rămas T1 sau meta ({n}).', { n: swaps.meta }));
  if (swaps.rigs) notes.push(tx('Ca să încapă în calibration, unele rig-uri au rămas T1 ({n}).', { n: swaps.rigs }));
  if (swaps.trimmed) notes.push(tx('Am redus dronele și încărcătura din cargo ca să încapă în bay.'));
  fit.notes = notes.join(' ');
  return { fit, source: entry.source, title, generated };
}
