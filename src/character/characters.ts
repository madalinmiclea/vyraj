import { Category, type Sde } from '../data/sde';
import type { CharacterSkills } from '../engine/fit';
import { loadJson, saveJson } from '../storage';
import { tx } from '../i18n';
import { DEFAULT_ATTRIBUTES, type Attributes } from './training';

export interface SkillState {
  level: number;
  sp: number;
}

export interface QueueEntry {
  skillId: number;
  level: number;
  finish?: string;
}

export interface RemapInfo {
  bonus: number;
  next?: string;
  last?: string;
}

export interface StoredCharacter {
  id: string;
  name: string;
  kind: 'esi' | 'custom';
  characterId?: number;
  skills: Record<string, SkillState>;
  attributes: Attributes;
  implants: number[];
  queue: QueueEntry[];
  totalSp?: number;
  unallocatedSp?: number;
  remap?: RemapInfo;
  updated?: string;
}

export interface Character extends CharacterSkills {
  id: string;
  kind: 'all5' | 'all0' | 'esi' | 'custom';
  clone?: 'alpha' | 'omega' | 'unknown';
  characterId?: number;
  sp: Map<number, number>;
  attributes: Attributes;
  implants: number[];
  queue: QueueEntry[];
  totalSp?: number;
  unallocatedSp?: number;
  remap?: RemapInfo;
  updated?: string;
}

const KEY = 'eve-fit:characters';
export const ROSTER_KEY = 'eve-fit:roster';
const ACTIVE_KEY = 'eve-fit:active-character';

export function allLevels(sde: Sde, level: number): Character {
  const skills = new Map(sde.typesInCategory(Category.Skill).map((t) => [t.id, level]));
  return {
    id: level === 5 ? 'all5' : 'all0',
    name: level === 5 ? tx('Toate la V') : tx('Toate la 0'),
    kind: level === 5 ? 'all5' : 'all0',
    skills,
    sp: new Map(),
    attributes: DEFAULT_ATTRIBUTES,
    implants: [],
    queue: [],
  };
}

export function fromStored(c: StoredCharacter): Character {
  const skills = new Map<number, number>();
  const sp = new Map<number, number>();
  for (const [id, s] of Object.entries(c.skills)) {
    skills.set(Number(id), s.level);
    sp.set(Number(id), s.sp);
  }
  const clone = c.kind === 'esi' ? loadJson<Record<string, { clone?: Character['clone'] }>>(ROSTER_KEY, {})[c.id]?.clone : undefined;
  return { ...c, skills, sp, clone };
}

export function loadStoredCharacters(): StoredCharacter[] {
  return loadJson<StoredCharacter[]>(KEY, []);
}

export function saveStoredCharacters(list: StoredCharacter[]) {
  saveJson(KEY, list);
}

export function upsertStoredCharacter(c: StoredCharacter) {
  const list = loadStoredCharacters().filter((x) => x.id !== c.id);
  list.push(c);
  saveStoredCharacters(list);
}

export function removeStoredCharacter(id: string) {
  saveStoredCharacters(loadStoredCharacters().filter((x) => x.id !== id));
}

export function allCharacters(sde: Sde): Character[] {
  return [allLevels(sde, 5), allLevels(sde, 0), ...loadStoredCharacters().map(fromStored)];
}

export function getActiveCharacterId(): string {
  return loadJson<string>(ACTIVE_KEY, 'all5');
}

export function setActiveCharacterId(id: string) {
  saveJson(ACTIVE_KEY, id);
}

export function findCharacter(sde: Sde, id: string): Character {
  const list = allCharacters(sde);
  return list.find((c) => c.id === id) ?? list[0];
}

export function toCustom(c: Character, name: string): StoredCharacter {
  const skills: Record<string, SkillState> = {};
  for (const [id, level] of c.skills) skills[id] = { level, sp: c.sp.get(id) ?? 0 };
  return {
    id: 'custom-' + Date.now().toString(36),
    name,
    kind: 'custom',
    skills,
    attributes: c.attributes,
    implants: [...c.implants],
    queue: [],
  };
}
