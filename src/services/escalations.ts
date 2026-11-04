import { loadJson, saveJson } from '../storage';

export interface Escalation { id: string; char: number; name: string; system: number; at: number; hours: number; note: string; done: boolean }

const KEY = 'eve-pve:escalations';

export const loadEscalations = () => loadJson<Escalation[]>(KEY, []);
export const saveEscalations = (list: Escalation[]) => saveJson(KEY, list);
export const expiresAt = (e: Escalation) => e.at + e.hours * 3600000;

export function forgetEscalations(characterId: number) {
  const list = loadEscalations();
  if (list.some((e) => e.char === characterId)) saveEscalations(list.filter((e) => e.char !== characterId));
}
