import type { Sde } from '../data/sde';
import { tx } from '../i18n';

export interface Attributes {
  charisma: number;
  intelligence: number;
  memory: number;
  perception: number;
  willpower: number;
}

export const DEFAULT_ATTRIBUTES: Attributes = { charisma: 20, intelligence: 20, memory: 20, perception: 20, willpower: 20 };

const ATTRIBUTE_BY_ID: Record<number, keyof Attributes> = {
  164: 'charisma',
  165: 'intelligence',
  166: 'memory',
  167: 'perception',
  168: 'willpower',
};

const IMPLANT_BONUS: Record<keyof Attributes, string> = {
  charisma: 'charismaBonus',
  intelligence: 'intelligenceBonus',
  memory: 'memoryBonus',
  perception: 'perceptionBonus',
  willpower: 'willpowerBonus',
};

export function spForLevel(rank: number, level: number): number {
  if (level <= 0) return 0;
  return Math.ceil(250 * rank * 2 ** (2.5 * (level - 1)));
}

export function skillRank(sde: Sde, skillId: number): number {
  return sde.baseAttr(skillId, sde.attrId('skillTimeConstant')) || 1;
}

export function withImplants(sde: Sde, base: Attributes, implants: number[]): Attributes {
  const out = { ...base };
  for (const id of implants) {
    for (const key of Object.keys(IMPLANT_BONUS) as (keyof Attributes)[]) {
      if (sde.hasAttr(IMPLANT_BONUS[key])) out[key] += sde.baseAttr(id, sde.attrId(IMPLANT_BONUS[key]));
    }
  }
  return out;
}

export function spPerMinute(sde: Sde, skillId: number, attrs: Attributes): number {
  const primary = ATTRIBUTE_BY_ID[sde.baseAttr(skillId, sde.attrId('primaryAttribute'))] ?? 'intelligence';
  const secondary = ATTRIBUTE_BY_ID[sde.baseAttr(skillId, sde.attrId('secondaryAttribute'))] ?? 'memory';
  return attrs[primary] + attrs[secondary] / 2;
}

export function trainingSeconds(sde: Sde, skillId: number, targetLevel: number, currentSp: number, attrs: Attributes): number {
  const needed = spForLevel(skillRank(sde, skillId), targetLevel) - currentSp;
  if (needed <= 0) return 0;
  return (needed / spPerMinute(sde, skillId, attrs)) * 60;
}

export function durationHtml(seconds: number): string {
  return formatDuration(seconds).replace(/(\d+)([zdhm])/g, '<span class="unit">$1</span>$2');
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const total = Math.ceil(seconds / 60);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return `${d}${tx('z')} ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
