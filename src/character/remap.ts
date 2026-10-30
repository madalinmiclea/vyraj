import type { Sde } from '../data/sde';
import type { Character } from './characters';
import { spPerMinute, trainingAttributes, type Attributes } from './training';

export const ATTRIBUTE_KEYS: (keyof Attributes)[] = ['perception', 'memory', 'willpower', 'intelligence', 'charisma'];

const MIN = 17;
const MAX = 27;
const TOTAL = 99;

export interface RemapResult {
  current: Attributes;
  optimal: Attributes;
  currentSeconds: number;
  optimalSeconds: number;
}

function distributions(): Attributes[] {
  const out: Attributes[] = [];
  const walk = (i: number, left: number, acc: number[]) => {
    if (i === ATTRIBUTE_KEYS.length - 1) {
      if (left < MIN || left > MAX) return;
      const values = [...acc, left];
      out.push(Object.fromEntries(ATTRIBUTE_KEYS.map((k, j) => [k, values[j]])) as unknown as Attributes);
      return;
    }
    for (let v = MIN; v <= MAX; v++) {
      if (left - v < MIN * (ATTRIBUTE_KEYS.length - i - 1)) break;
      walk(i + 1, left - v, [...acc, v]);
    }
  };
  walk(0, TOTAL, []);
  return out;
}

let cached: Attributes[] | null = null;

export function optimalRemap(sde: Sde, character: Character, rows: { skillId: number; sp: number }[]): RemapResult | null {
  const work = rows.filter((r) => r.sp > 0);
  if (!work.length) return null;
  const seconds = (base: Attributes) => {
    const attrs = trainingAttributes(sde, { ...character, attributes: base });
    return work.reduce((a, r) => a + (r.sp / spPerMinute(sde, r.skillId, attrs)) * 60, 0);
  };
  const current = character.attributes;
  let best = current;
  let bestSeconds = seconds(current);
  const currentSeconds = bestSeconds;
  for (const d of (cached ??= distributions())) {
    const s = seconds(d);
    if (s < bestSeconds - 1) { best = d; bestSeconds = s; }
  }
  return { current, optimal: best, currentSeconds, optimalSeconds: bestSeconds };
}
