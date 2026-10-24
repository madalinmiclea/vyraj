import { Category, type Sde, type TypeInfo } from '../data/sde';

export interface FleetBoost {
  charges: number[];
  t2: boolean;
  shipBonus: number;
  mindlink: boolean;
}

export const SKILL_FACTOR = 1.5;
export const SHIP_BONUSES = [0, 2, 3, 4, 5];

export function burstCharges(sde: Sde): { group: string; charges: TypeInfo[] }[] {
  if (!sde.hasAttr('warfareBuff1ID') || !sde.hasAttr('warfareBuff1Multiplier')) return [];
  const id = sde.attrId('warfareBuff1ID');
  const groups = new Map<string, TypeInfo[]>();
  for (const t of sde.typesInCategory(Category.Charge)) {
    if (!(t.attrs.get(id) ?? 0) || !t.marketGroupId) continue;
    const g = t.groupName.replace(/ (Command|Foreman) Burst Charges$/, '');
    const list = groups.get(g);
    if (list) list.push(t); else groups.set(g, [t]);
  }
  return [...groups.entries()].map(([group, charges]) => ({ group, charges: charges.sort((a, b) => a.name.localeCompare(b.name)) })).sort((a, b) => a.group.localeCompare(b.group));
}

export function boostFactor(b: FleetBoost): number {
  return SKILL_FACTOR * (b.t2 ? 1.25 : 1) * (1 + (b.shipBonus * 5) / 100) * (b.mindlink ? 1.25 : 1);
}

export function fleetBuffs(sde: Sde, b: FleetBoost | undefined): { id: number; value: number }[] {
  if (!b?.charges.length) return [];
  const factor = boostFactor(b);
  const out: { id: number; value: number }[] = [];
  for (const chargeId of b.charges) {
    for (let n = 1; n <= 4; n++) {
      const idAttr = `warfareBuff${n}ID`, multAttr = `warfareBuff${n}Multiplier`;
      if (!sde.hasAttr(idAttr) || !sde.hasAttr(multAttr)) continue;
      const id = sde.baseAttr(chargeId, sde.attrId(idAttr));
      const mult = sde.baseAttr(chargeId, sde.attrId(multAttr));
      if (id > 0 && mult) out.push({ id, value: mult * factor });
    }
  }
  return out;
}
