import type { Sde, AttributeInfo } from '../data/sde';
import type { DogmaItem } from '../engine/dogma';
import { tx } from '../i18n';

const CATEGORIES: Record<number, string> = {
  1: 'Fitting', 2: 'Shield', 3: 'Armor', 4: 'Structure', 5: 'Capacitor', 6: 'Targeting', 7: tx('Diverse'),
  10: 'Drone', 17: tx('Viteză și navigație'), 20: tx('Asistență la distanță'), 21: 'EWAR · Target painting',
  22: tx('EWAR · Neutralizare'), 23: 'EWAR · ECCM', 24: 'EWAR · Sensor damp', 25: 'EWAR · Jamming',
  26: 'EWAR · Tracking disruption', 27: 'EWAR · Warp scramble', 28: 'EWAR · Web', 29: 'Turrets', 30: tx('Rachete'),
  34: 'Fighter', 36: tx('Rezistență la EWAR'), 37: tx('Bonusuri'), 38: 'Fighter', 40: tx('Hangare și bay-uri'),
};
const CATEGORY_ORDER = [37, 1, 29, 30, 10, 5, 2, 3, 4, 6, 17, 20, 21, 22, 24, 25, 26, 27, 28, 36, 40, 34, 38, 7];
const HIDDEN_CATEGORIES = new Set([8, 9, 12, 19, 31, 32, 33, 41, 42]);
const SIZES = ['', 'Small', 'Medium', 'Large', 'Capital'];
const NEUTRAL_UNITS = new Set([115, 116, 117, 137]);

export interface AttributeRow {
  id: number;
  name: string;
  value: string;
  base?: string;
  better?: boolean;
  compare?: string;
  delta?: 'better' | 'worse';
}

export interface AttributeSection {
  title: string;
  rows: AttributeRow[];
}

const num = (n: number, digits = 2) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n);

export function formatAttribute(sde: Sde, attr: AttributeInfo, v: number): string {
  const unit = sde.units.get(attr.unitId ?? 0) ?? '';
  switch (attr.unitId) {
    case 101: return `${num(v / 1000, 2)} s`;
    case 108: return `${num((1 - v) * 100, 2)} %`;
    case 109: return `${v >= 1 ? '+' : ''}${num((v - 1) * 100, 2)} %`;
    case 111: return `${num((1 - v) * 100, 2)} %`;
    case 127: return `${num(v * 100, 2)} %`;
    case 115: return sde.groups.get(v)?.name ?? tx('Grup {v}', { v });
    case 116: return sde.types.get(v)?.name ?? `Type ${v}`;
    case 117: return SIZES[v] ?? String(v);
    case 137: return v ? tx('Da') : tx('Nu');
    case 140: return tx('Nivel {v}', { v });
    case 1: return Math.abs(v) >= 10000 ? `${num(v / 1000, 2)} km` : `${num(v, 2)} m`;
    default: return unit && !/=/.test(unit) ? `${num(v, 2)} ${unit}` : num(v, 4);
  }
}

export function attributeSections(sde: Sde, typeId: number, item?: DogmaItem, compare?: DogmaItem): AttributeSection[] {
  const t = sde.types.get(typeId);
  if (!t) return [];
  const byCategory = new Map<number, AttributeRow[]>();
  for (const [id, baseValue] of t.attrs) {
    const a = sde.attributes.get(id);
    if (!a || !a.published || !a.displayName || HIDDEN_CATEGORIES.has(a.categoryId ?? 0)) continue;
    if (a.unitId === 119) continue;
    const value = item ? item.attr(id) : baseValue;
    if (value === 0 && baseValue === 0 && !a.showWhenZero) continue;
    const changed = item && Math.abs(value - baseValue) > 1e-9 * Math.max(1, Math.abs(baseValue));
    const row: AttributeRow = { id, name: a.displayName, value: formatAttribute(sde, a, value) };
    if (compare) {
      const other = compare.attr(id);
      row.compare = formatAttribute(sde, a, other);
      const differs = Math.abs(value - other) > 1e-9 * Math.max(1, Math.abs(other));
      if (differs && !NEUTRAL_UNITS.has(a.unitId ?? 0)) row.delta = (a.highIsGood ? value > other : value < other) ? 'better' : 'worse';
    } else if (changed) {
      row.base = formatAttribute(sde, a, baseValue);
      row.better = a.highIsGood ? value > baseValue : value < baseValue;
    }
    const cat = CATEGORIES[a.categoryId ?? 7] ? a.categoryId ?? 7 : 7;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(row);
  }
  return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({
    title: CATEGORIES[c],
    rows: byCategory.get(c)!.sort((x, y) => x.name.localeCompare(y.name)),
  }));
}
