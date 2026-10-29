import { Category, type Sde, type TypeInfo } from '../data/sde';
import { addToFit, buildDogma, emptyFit, fitContents, slotCounts, SLOT_KINDS, type Fit, type SlotKind } from '../engine/fit';
import { applyChecked } from '../engine/rules';
import { navigation } from '../engine/stats';
import { fitTypeIds, requirementsFor, type FitRequirements } from '../character/requirements';
import type { Character } from '../character/characters';
import type { RiskLevel } from './visited';

export interface TravelFit {
  fit: Fit;
  ship: TypeInfo;
  align: number;
  warp: number;
  speed: number;
  nullified: boolean;
  covert: boolean;
  req: FitRequirements;
  contents: Map<number, number>;
}

const GROUPS = ['Shuttle', 'Interceptor', 'Covert Ops', 'Frigate'];
const MWD = ['5MN Microwarpdrive II', '5MN Microwarpdrive I'];
const CLOAK = ['Covert Ops Cloaking Device II'];
const NULLIFIER = ['Interdiction Nullifier II', 'Interdiction Nullifier I', 'Compact Interdiction Nullifier'];
const LOWS = [['Inertial Stabilizers II', 'Inertial Stabilizers I'], ['Nanofiber Internal Structure II', 'Nanofiber Internal Structure I']];
const RIGS = [['Small Low Friction Nozzle Joints I'], ['Small Hyperspatial Velocity Optimizer I']];
export const INSTA_ALIGN = 2;

function canFitOn(sde: Sde, moduleId: number, ship: TypeInfo): boolean {
  const groups: number[] = [];
  const types: number[] = [];
  for (const [attrId, v] of sde.types.get(moduleId)?.attrs ?? []) {
    const name = sde.attributes.get(attrId)?.name ?? '';
    if (/^canFitShipGroup\d+$/.test(name)) groups.push(v);
    else if (/^canFitShipType\d+$/.test(name)) types.push(v);
  }
  if (!groups.length && !types.length) return true;
  return groups.includes(ship.groupId) || types.includes(ship.id);
}

function candidates(sde: Sde): TypeInfo[] {
  const ids = new Set([...sde.groups.values()].filter((g) => g.categoryId === Category.Ship && GROUPS.includes(g.name)).map((g) => g.id));
  return [...sde.types.values()].filter((t) => ids.has(t.groupId) && t.marketGroupId != null && (t.metaGroupId == null || t.metaGroupId <= 2));
}

function buildTravelFit(sde: Sde, ship: TypeInfo, character: Character, name: string): Fit {
  const skills = character.skills;
  const implants = character.implants ?? [];
  const fit = emptyFit(ship.id, name);
  const free = (k: SlotKind) => slotCounts(sde, fit)[k] - fit.slots[k].filter(Boolean).length;
  const add = (names: string[]) => {
    for (const n of names) {
      const t = sde.findType(n);
      if (!t || !canFitOn(sde, t.id, ship)) continue;
      if (applyChecked(sde, fit, skills, (d) => addToFit(sde, d, t.id), implants).ok) return true;
    }
    return false;
  };
  if (free('mid') > 0) add(MWD);
  if (free('high') > 0) add(CLOAK);
  if (free('high') > 0) add(NULLIFIER);
  for (let i = 0; free('low') > 0 && i < 8; i++) if (!add(LOWS[i % 2])) break;
  for (let i = 0; free('rig') > 0 && i < 4; i++) if (!add(RIGS[i % 2]) && !add(RIGS[(i + 1) % 2])) break;
  for (const k of SLOT_KINDS) for (const m of fit.slots[k]) if (m) m.state = 'online';
  return fit;
}

export function travelFits(sde: Sde, character: Character, name: (ship: string) => string): TravelFit[] {
  const immune = sde.hasAttr('warpBubbleImmune') ? sde.attrId('warpBubbleImmune') : -1;
  const bonus = sde.hasAttr('warpBubbleImmuneBonus') ? sde.attrId('warpBubbleImmuneBonus') : -1;
  const out: TravelFit[] = [];
  for (const ship of candidates(sde)) {
    const fit = buildTravelFit(sde, ship, character, name(ship.name));
    const nav = navigation(buildDogma(sde, fit, character));
    const mods = SLOT_KINDS.flatMap((k) => fit.slots[k]).filter((m) => m != null).map((m) => sde.types.get(m!.typeId)!);
    out.push({
      fit,
      ship,
      align: nav.alignTime,
      warp: nav.warpSpeed,
      speed: nav.maxVelocity,
      nullified: (immune > 0 && sde.baseAttr(ship.id, immune) > 0) || mods.some((m) => bonus > 0 && (m.attrs.get(bonus) ?? 0) > 0),
      covert: mods.some((m) => CLOAK.includes(m.name)),
      req: requirementsFor(sde, fitTypeIds(fit), character),
      contents: fitContents(sde, fit),
    });
  }
  return out;
}

export function rankTravelFits(level: RiskLevel, list: TravelFit[], price?: (f: TravelFit) => number | null): TravelFit[] {
  const a = (f: TravelFit) => Math.round(f.align * 20) / 20;
  const cost = (f: TravelFit) => price?.(f) ?? Infinity;
  const score = (f: TravelFit) => level === 'safe' ? 0
    : level === 'risky' ? (f.align < INSTA_ALIGN ? 0 : 2) - (f.covert ? 1 : 0)
    : (f.nullified ? 0 : 4) + (f.align < INSTA_ALIGN ? 0 : 2) - (f.covert ? 1 : 0);
  const sorted = list
    .filter((f) => !price || (price(f) ?? 0) > 0)
    .sort((x, y) => score(x) - score(y) || a(x) - a(y) || cost(x) - cost(y) || y.warp - x.warp);
  const groups = new Set<number>();
  return sorted.filter((f) => !groups.has(f.ship.groupId) && groups.add(f.ship.groupId));
}
