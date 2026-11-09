import { loadJson, saveJson } from '../storage';

export interface ImplantSet { name: string; implants: number[] }

const SETS_KEY = 'eve-fit:implant-sets';
const ACTIVE_KEY = 'eve-fit:implant-set';

let sets = loadJson<ImplantSet[]>(SETS_KEY, []);
let active = loadJson<string>(ACTIVE_KEY, '');

export const implantSets = () => sets;
export const activeSet = () => sets.find((s) => s.name === active) ?? null;

export function useSet(name: string) {
  active = name;
  saveJson(ACTIVE_KEY, active);
}

export function saveSet(name: string, implants: number[]) {
  sets = [...sets.filter((s) => s.name !== name), { name, implants }].sort((a, b) => a.name.localeCompare(b.name));
  saveJson(SETS_KEY, sets);
  useSet(name);
}

export function deleteSet(name: string) {
  sets = sets.filter((s) => s.name !== name);
  saveJson(SETS_KEY, sets);
  if (active === name) useSet('');
}

export function fitCharacter<T extends { implants: number[] }>(c: T): T {
  const set = activeSet();
  return set ? { ...c, implants: set.implants } : c;
}
