import { loadJson, saveJson } from '../storage';

export interface ImplantSet { name: string; implants: number[] }

const SETS_KEY = 'eve-fit:implant-sets';
const ACTIVE_KEY = 'eve-fit:implant-set';
const DRAFT_KEY = 'eve-fit:implant-draft';
export const DRAFT = '*';

let sets = loadJson<ImplantSet[]>(SETS_KEY, []);
let active = loadJson<string>(ACTIVE_KEY, '');
let draft = loadJson<number[] | null>(DRAFT_KEY, null);

export const implantSets = () => sets;
export const hasDraft = () => !!draft;
export const activeSet = (): ImplantSet | null => (active === DRAFT && draft ? { name: '', implants: draft } : sets.find((s) => s.name === active) ?? null);

export function useSet(name: string) {
  active = name;
  saveJson(ACTIVE_KEY, active);
}

export function saveSet(name: string, implants: number[]) {
  sets = [...sets.filter((s) => s.name !== name), { name, implants }].sort((a, b) => a.name.localeCompare(b.name));
  saveJson(SETS_KEY, sets);
  if (active === DRAFT) setDraft(null);
  useSet(name);
}

function setDraft(next: number[] | null) {
  draft = next;
  saveJson(DRAFT_KEY, draft);
}

export function setImplants(implants: number[]) {
  const set = sets.find((s) => s.name === active);
  if (set) {
    set.implants = implants;
    saveJson(SETS_KEY, sets);
    return;
  }
  setDraft(implants);
  useSet(DRAFT);
}

export function deleteSet(name: string) {
  if (!name) {
    setDraft(null);
    useSet('');
    return;
  }
  sets = sets.filter((s) => s.name !== name);
  saveJson(SETS_KEY, sets);
  if (active === name) useSet('');
}

export function fitCharacter<T extends { implants: number[] }>(c: T): T {
  const set = activeSet();
  return set ? { ...c, implants: set.implants } : c;
}
