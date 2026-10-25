import type { Sde } from '../data/sde';
import { loadJson, removeKey, saveJson } from '../storage';
import type { Character } from './characters';
import { directRequirements } from './requirements';
import { skillRank, spForLevel, trainingAttributes, trainingSeconds } from './training';

export interface PlanEntry {
  skillId: number;
  level: number;
}

export interface PlanRow extends PlanEntry {
  name: string;
  seconds: number;
  sp: number;
  finishes: number;
}

const key = (characterId: string) => `eve-fit:plan:${characterId}`;

export function loadPlan(characterId: string): PlanEntry[] {
  return loadJson<PlanEntry[]>(key(characterId), []);
}

export function forgetPlan(characterId: string) {
  removeKey(key(characterId));
}

export function savePlan(characterId: string, plan: PlanEntry[]) {
  saveJson(key(characterId), plan);
  window.dispatchEvent(new Event('eve-plan-changed'));
}

function planned(plan: PlanEntry[], character: Character, skillId: number): number {
  const inPlan = plan.filter((e) => e.skillId === skillId).reduce((a, e) => Math.max(a, e.level), 0);
  return Math.max(inPlan, character.skills.get(skillId) ?? 0);
}

export function addToPlan(sde: Sde, plan: PlanEntry[], character: Character, skillId: number, level: number, depth = 0): PlanEntry[] {
  if (depth > 25) return plan;
  let out = plan;
  for (const r of directRequirements(sde, skillId)) out = addToPlan(sde, out, character, r.skillId, r.level, depth + 1);
  for (let l = planned(out, character, skillId) + 1; l <= level; l++) out = [...out, { skillId, level: l }];
  return out;
}

export function addItemToPlan(sde: Sde, plan: PlanEntry[], character: Character, typeId: number): PlanEntry[] {
  return directRequirements(sde, typeId).reduce((p, r) => addToPlan(sde, p, character, r.skillId, r.level), plan);
}

function validEntries(sde: Sde, plan: PlanEntry[], character: Character): PlanEntry[] {
  const have = new Map(character.skills);
  const kept: PlanEntry[] = [];
  for (const e of plan) {
    const ready = (have.get(e.skillId) ?? 0) >= e.level - 1 && directRequirements(sde, e.skillId).every((r) => (have.get(r.skillId) ?? 0) >= r.level);
    if (!ready) continue;
    kept.push(e);
    have.set(e.skillId, Math.max(have.get(e.skillId) ?? 0, e.level));
  }
  return kept;
}

export function removeFromPlan(sde: Sde, plan: PlanEntry[], character: Character, index: number): PlanEntry[] {
  const target = plan[index];
  if (!target) return plan;
  return validEntries(sde, plan.filter((e, i) => i !== index && !(e.skillId === target.skillId && e.level > target.level)), character);
}

export function movePlan(sde: Sde, plan: PlanEntry[], character: Character, index: number, delta: number): PlanEntry[] {
  const to = index + delta;
  if (to < 0 || to >= plan.length) return plan;
  const out = [...plan];
  [out[index], out[to]] = [out[to], out[index]];
  return validEntries(sde, out, character).length < validEntries(sde, plan, character).length ? plan : out;
}

export function planRows(sde: Sde, plan: PlanEntry[], character: Character, start = Date.now()): PlanRow[] {
  const attrs = trainingAttributes(sde, character);
  let t = start;
  return plan.map((e) => {
    const rank = skillRank(sde, e.skillId);
    const trained = character.skills.get(e.skillId) ?? 0;
    const startSp = e.level - 1 === trained ? character.sp.get(e.skillId) ?? spForLevel(rank, trained) : spForLevel(rank, e.level - 1);
    const seconds = e.level <= trained ? 0 : trainingSeconds(sde, e.skillId, e.level, startSp, attrs);
    t += seconds * 1000;
    return { ...e, name: sde.types.get(e.skillId)?.name ?? `Skill ${e.skillId}`, seconds, sp: Math.max(0, spForLevel(rank, e.level) - startSp), finishes: t };
  });
}

export function planText(rows: PlanRow[]): string {
  return rows.map((r) => `${r.name} ${r.level}`).join('\n');
}
