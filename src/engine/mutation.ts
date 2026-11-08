import { attrLabel } from '../i18n/attributes';
import type { Mutaplasmid, Sde } from '../data/sde';
import type { Mutation } from './fit';

export interface Mutable {
  typeId: number;
  mutation?: Mutation;
}

export interface MutationRow {
  attrId: number;
  name: string;
  base: number;
  min: number;
  max: number;
  value: number;
  highIsGood: boolean;
}

export function mutationRows(sde: Sde, m: Mutable): MutationRow[] {
  const mp = m.mutation && sde.mutaplasmids.get(m.mutation.mutaplasmidId);
  if (!mp) return [];
  return [...mp.ranges].flatMap(([attrId, [lo, hi]]) => {
    const base = sde.baseAttr(m.typeId, attrId);
    if (!base) return [];
    const a = sde.attributes.get(attrId);
    const [min, max] = [base * lo, base * hi].sort((x, y) => x - y);
    return [{
      attrId,
      name: a?.displayName ? attrLabel(a.displayName) : a?.name || String(attrId),
      base,
      min,
      max,
      value: m.mutation!.values[attrId] ?? base,
      highIsGood: a?.highIsGood ?? true,
    }];
  });
}

export function mutate(sde: Sde, m: Mutable, mp: Mutaplasmid) {
  const values: Record<string, number> = {};
  for (const [attrId, [lo, hi]] of mp.ranges) {
    const base = sde.baseAttr(m.typeId, attrId);
    if (!base) continue;
    const [min, max] = [base * lo, base * hi].sort((x, y) => x - y);
    values[attrId] = Math.min(max, Math.max(min, base));
  }
  m.mutation = { mutaplasmidId: mp.id, values };
}

export function abyssalTypeId(sde: Sde, m: Mutable): number | undefined {
  if (!m.mutation) return undefined;
  return sde.mutaplasmids.get(m.mutation.mutaplasmidId)?.resultFor.get(m.typeId);
}

export function moduleName(sde: Sde, m: Mutable): string {
  const abyssal = abyssalTypeId(sde, m);
  return abyssal ? sde.type(abyssal).name : sde.type(m.typeId).name;
}

export function rollMutation(sde: Sde, typeId: number, mp: Mutaplasmid, rnd: () => number = Math.random): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [attrId, [lo, hi]] of mp.ranges) {
    const base = sde.baseAttr(typeId, attrId);
    if (!base) continue;
    values[attrId] = base * (lo + rnd() * (hi - lo));
  }
  return values;
}

export function betterChance(r: MutationRow): number {
  if (r.max <= r.min) return 0;
  const good = r.highIsGood ? r.max - r.base : r.base - r.min;
  return Math.min(1, Math.max(0, good / (r.max - r.min)));
}

export function rowPct(r: MutationRow, value = r.value): number {
  return ((value - r.base) / Math.abs(r.base)) * 100 * (r.highIsGood ? 1 : -1);
}
