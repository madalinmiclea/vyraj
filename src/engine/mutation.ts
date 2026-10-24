import type { Mutaplasmid, Sde } from '../data/sde';
import type { FitModule } from './fit';

export interface MutationRow {
  attrId: number;
  name: string;
  base: number;
  min: number;
  max: number;
  value: number;
  highIsGood: boolean;
}

export function mutationRows(sde: Sde, m: FitModule): MutationRow[] {
  const mp = m.mutation && sde.mutaplasmids.get(m.mutation.mutaplasmidId);
  if (!mp) return [];
  return [...mp.ranges].flatMap(([attrId, [lo, hi]]) => {
    const base = sde.baseAttr(m.typeId, attrId);
    if (!base) return [];
    const a = sde.attributes.get(attrId);
    const [min, max] = [base * lo, base * hi].sort((x, y) => x - y);
    return [{
      attrId,
      name: a?.displayName || a?.name || String(attrId),
      base,
      min,
      max,
      value: m.mutation!.values[attrId] ?? base,
      highIsGood: a?.highIsGood ?? true,
    }];
  });
}

export function mutate(sde: Sde, m: FitModule, mp: Mutaplasmid) {
  const values: Record<string, number> = {};
  for (const [attrId, [lo, hi]] of mp.ranges) {
    const base = sde.baseAttr(m.typeId, attrId);
    if (!base) continue;
    const [min, max] = [base * lo, base * hi].sort((x, y) => x - y);
    values[attrId] = Math.min(max, Math.max(min, base));
  }
  m.mutation = { mutaplasmidId: mp.id, values };
}

export function abyssalTypeId(sde: Sde, m: FitModule): number | undefined {
  if (!m.mutation) return undefined;
  return sde.mutaplasmids.get(m.mutation.mutaplasmidId)?.resultFor.get(m.typeId);
}

export function moduleName(sde: Sde, m: FitModule): string {
  const abyssal = abyssalTypeId(sde, m);
  return abyssal ? sde.type(abyssal).name : sde.type(m.typeId).name;
}
