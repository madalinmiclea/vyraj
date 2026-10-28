import { Category, type Sde } from '../data/sde';
import { buildDogma, type Fit } from '../engine/fit';
import { computeStats, type FitStats } from '../engine/stats';
import type { DamageProfile } from '../engine/profiles';
import type { Character } from './characters';
import { directRequirements, type Requirement } from './requirements';
import { skillRank, spForLevel, trainingAttributes, trainingSeconds } from './training';
import { tx } from '../i18n';

export type AdviceKind = 'dps' | 'tank' | 'general';

export interface StatChange {
  label: string;
  pct: number;
  text: string;
}

export interface SkillAdvice {
  skillId: number;
  name: string;
  groupName: string;
  from: number;
  to: number;
  sp: number;
  seconds: number;
  missing: Requirement[];
  score: Record<AdviceKind, number>;
  changes: Record<AdviceKind, StatChange[]>;
}

const EPS = 0.05;

function pct(before: number, after: number, lowerIsBetter = false): number {
  if (!before) return after > 0 && !lowerIsBetter ? 100 : 0;
  const p = ((after - before) / Math.abs(before)) * 100;
  return lowerIsBetter ? -p : p;
}

function change(label: string, p: number): StatChange | undefined {
  if (Math.abs(p) < EPS) return undefined;
  return { label, pct: p, text: `${p > 0 ? '+' : ''}${p.toFixed(1)}%` };
}

function freeChange(label: string, a: { used: number; total: number }, b: { used: number; total: number }, unit: string): StatChange | undefined {
  const delta = (b.total - b.used) - (a.total - a.used);
  const p = a.total ? (delta / a.total) * 100 : 0;
  if (Math.abs(p) < EPS) return undefined;
  return { label, pct: p, text: `${delta > 0 ? '+' : ''}${delta.toFixed(1)} ${unit}` };
}

function capChange(a: FitStats, b: FitStats): StatChange | undefined {
  const ca = a.capacitor, cb = b.capacitor;
  if (!ca.stable && cb.stable) return { label: tx('Capacitor'), pct: 25, text: tx('devine stabil') };
  if (ca.stable && cb.stable) {
    const pts = ((cb.stableAt ?? 1) - (ca.stableAt ?? 1)) * 100;
    return Math.abs(pts) < 0.1 ? undefined : { label: tx('Capacitor stabil la'), pct: pts, text: `${pts > 0 ? '+' : ''}${pts.toFixed(1)} ${tx('p.p.')}` };
  }
  if (!ca.stable && !cb.stable) return change(tx('Durată capacitor'), pct(ca.lastsSeconds ?? 0, cb.lastsSeconds ?? 0));
  return undefined;
}

function weaponRange(s: FitStats) {
  return s.offense.weapons.reduce((m, w) => Math.max(m, w.range ?? 0), 0);
}

function tankRepair(s: FitStats) {
  return s.defense.activeTank + s.defense.passiveShield.effective;
}

function compare(a: FitStats, b: FitStats): Record<AdviceKind, StatChange[]> {
  const keep = (x: (StatChange | undefined)[]) => x.filter((c): c is StatChange => !!c);
  return {
    dps: keep([
      change('DPS', pct(a.offense.totalDps, b.offense.totalDps)),
      change('Volley', pct(a.offense.totalVolley, b.offense.totalVolley)),
    ]),
    tank: keep([
      change('EHP', pct(a.defense.ehp, b.defense.ehp)),
      change(tx('Reparare / regen'), pct(tankRepair(a), tankRepair(b))),
    ]),
    general: keep([
      capChange(a, b),
      change(tx('Reîncărcare capacitor'), pct(a.capacitor.peakRecharge, b.capacitor.peakRecharge)),
      change(tx('Consum capacitor'), pct(a.capacitor.usage, b.capacitor.usage, true)),
      freeChange(tx('CPU liber'), a.resources.cpu, b.resources.cpu, 'tf'),
      freeChange(tx('Grid liber'), a.resources.power, b.resources.power, 'MW'),
      change(tx('Viteză'), pct(a.navigation.maxVelocity, b.navigation.maxVelocity)),
      change(tx('Aliniere'), pct(a.navigation.alignTime, b.navigation.alignTime, true)),
      change(tx('Rază arme'), pct(weaponRange(a), weaponRange(b))),
      change(tx('Rază țintire'), pct(a.targeting.maxRange, b.targeting.maxRange)),
      change(tx('Rezoluție scan'), pct(a.targeting.scanResolution, b.targeting.scanResolution)),
    ]),
  };
}

function candidateSkills(sde: Sde, character: Character): number[] {
  return sde.typesInCategory(Category.Skill)
    .filter((t) => (character.skills.get(t.id) ?? 0) < 5)
    .filter((t) => t.effects.some((e) => (sde.effects.get(e)?.modifiers.length ?? 0) > 0))
    .map((t) => t.id);
}

export function adviseSkills(sde: Sde, fit: Fit, character: Character, profile: DamageProfile): SkillAdvice[] {
  const base = computeStats(sde, fit, buildDogma(sde, fit, character), profile);
  const attrs = trainingAttributes(sde, character);
  const out: SkillAdvice[] = [];
  for (const skillId of candidateSkills(sde, character)) {
    const from = character.skills.get(skillId) ?? 0;
    const to = from + 1;
    const skills = new Map(character.skills).set(skillId, to);
    const after = computeStats(sde, fit, buildDogma(sde, fit, { ...character, skills }), profile);
    const changes = compare(base, after);
    const score = {
      dps: Math.max(0, ...changes.dps.map((c) => c.pct)),
      tank: Math.max(0, ...changes.tank.map((c) => c.pct)),
      general: changes.general.reduce((a, c) => a + Math.max(0, c.pct), 0),
    };
    if (!score.dps && !score.tank && !score.general) continue;
    const t = sde.type(skillId);
    const currentSp = character.sp.get(skillId) ?? spForLevel(skillRank(sde, skillId), from);
    out.push({
      skillId,
      name: t.name,
      groupName: t.groupName,
      from,
      to,
      sp: Math.max(0, spForLevel(skillRank(sde, skillId), to) - currentSp),
      seconds: trainingSeconds(sde, skillId, to, currentSp, attrs),
      missing: from > 0 ? [] : directRequirements(sde, skillId).filter((r) => (character.skills.get(r.skillId) ?? 0) < r.level),
      score,
      changes,
    });
  }
  return out;
}

export function rankAdvice(list: SkillAdvice[], kind: AdviceKind, perDay: boolean): SkillAdvice[] {
  const value = (a: SkillAdvice) => (perDay ? a.score[kind] / Math.max(a.seconds / 86400, 1 / 24) : a.score[kind]);
  return list.filter((a) => a.score[kind] > 0).sort((a, b) => value(b) - value(a));
}
