import type { Sde } from '../data/sde';
import { SLOT_KINDS, type Fit } from '../engine/fit';
import type { Character } from './characters';
import { spForLevel, skillRank, trainingAttributes, trainingSeconds } from './training';

const REQ = [
  ['requiredSkill1', 'requiredSkill1Level'],
  ['requiredSkill2', 'requiredSkill2Level'],
  ['requiredSkill3', 'requiredSkill3Level'],
  ['requiredSkill4', 'requiredSkill4Level'],
  ['requiredSkill5', 'requiredSkill5Level'],
  ['requiredSkill6', 'requiredSkill6Level'],
] as const;

export interface Requirement {
  skillId: number;
  level: number;
}

export function directRequirements(sde: Sde, typeId: number): Requirement[] {
  const out: Requirement[] = [];
  for (const [skillAttr, levelAttr] of REQ) {
    const skillId = sde.baseAttr(typeId, sde.attrId(skillAttr));
    if (skillId > 0) out.push({ skillId, level: sde.baseAttr(typeId, sde.attrId(levelAttr)) || 1 });
  }
  return out;
}

export interface RequirementNode extends Requirement {
  name: string;
  children: RequirementNode[];
}

export function requirementTree(sde: Sde, typeId: number, seen = new Set<number>()): RequirementNode[] {
  return directRequirements(sde, typeId).map((r) => {
    const loop = seen.has(r.skillId);
    const next = new Set(seen).add(r.skillId);
    return {
      ...r,
      name: sde.types.get(r.skillId)?.name ?? `Skill ${r.skillId}`,
      children: loop ? [] : requirementTree(sde, r.skillId, next),
    };
  });
}

export function flattenRequirements(sde: Sde, typeIds: number[]): Map<number, number> {
  const out = new Map<number, number>();
  const visit = (typeId: number, depth: number) => {
    if (depth > 20) return;
    for (const r of directRequirements(sde, typeId)) {
      if ((out.get(r.skillId) ?? 0) < r.level) out.set(r.skillId, r.level);
      visit(r.skillId, depth + 1);
    }
  };
  typeIds.forEach((id) => visit(id, 0));
  return out;
}

export function fitTypeIds(fit: Fit): number[] {
  const ids = new Set<number>([fit.shipId, ...fit.implants]);
  for (const k of SLOT_KINDS) {
    for (const m of fit.slots[k]) {
      if (!m) continue;
      ids.add(m.typeId);
      if (m.chargeId) ids.add(m.chargeId);
    }
  }
  for (const d of fit.drones) ids.add(d.typeId);
  return [...ids];
}

export type SkillStatus = 'ok' | 'partial' | 'missing';

export interface PlanStep {
  skillId: number;
  name: string;
  required: number;
  current: number;
  status: SkillStatus;
  seconds: number;
  sp: number;
}

export interface FitRequirements {
  steps: PlanStep[];
  missing: PlanStep[];
  totalSeconds: number;
  totalSp: number;
  canFly: boolean;
}

function status(current: number, required: number): SkillStatus {
  if (current >= required) return 'ok';
  return current > 0 ? 'partial' : 'missing';
}

export function requirementsFor(sde: Sde, typeIds: number[], character: Character): FitRequirements {
  return planFor(sde, flattenRequirements(sde, typeIds), character);
}

export function skillsPlan(sde: Sde, skills: Map<number, number>, character: Character): FitRequirements {
  const needed = flattenRequirements(sde, [...skills.keys()]);
  for (const [skillId, level] of skills) if ((needed.get(skillId) ?? 0) < level) needed.set(skillId, level);
  return planFor(sde, needed, character);
}

function planFor(sde: Sde, needed: Map<number, number>, character: Character): FitRequirements {
  const attrs = trainingAttributes(sde, character);

  const ordered: number[] = [];
  const done = new Set<number>();
  const visit = (skillId: number, depth: number) => {
    if (done.has(skillId) || depth > 20) return;
    done.add(skillId);
    for (const r of directRequirements(sde, skillId)) if (needed.has(r.skillId)) visit(r.skillId, depth + 1);
    ordered.push(skillId);
  };
  [...needed.keys()].forEach((id) => visit(id, 0));

  const steps = ordered.map((skillId): PlanStep => {
    const required = needed.get(skillId)!;
    const current = character.skills.get(skillId) ?? 0;
    const currentSp = character.sp.get(skillId) ?? spForLevel(skillRank(sde, skillId), current);
    const seconds = current >= required ? 0 : trainingSeconds(sde, skillId, required, currentSp, attrs);
    const sp = Math.max(0, spForLevel(skillRank(sde, skillId), required) - currentSp);
    return { skillId, name: sde.types.get(skillId)?.name ?? `Skill ${skillId}`, required, current, status: status(current, required), seconds, sp };
  });
  const missing = steps.filter((s) => s.status !== 'ok');
  return {
    steps,
    missing,
    totalSeconds: missing.reduce((a, s) => a + s.seconds, 0),
    totalSp: missing.reduce((a, s) => a + s.sp, 0),
    canFly: missing.length === 0,
  };
}

export function alphaRaces(sde: Sde, typeIds: number[]): string[] {
  const needed = flattenRequirements(sde, typeIds);
  return sde.cloneGrades
    .filter((g) => [...needed].every(([skillId, level]) => (g.skills.get(skillId) ?? 0) >= level))
    .map((g) => g.name.replace(/^Alpha\s*/i, ''));
}
