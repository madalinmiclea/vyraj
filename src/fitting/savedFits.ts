import { loadJson, saveJson } from '../storage';
import { cloneFit, type Fit } from '../engine/fit';

const KEY = 'eve-fit:saved-fits';

export function loadFits(): Fit[] {
  return loadJson<Fit[]>(KEY, []);
}

export function saveFit(fit: Fit) {
  const list = loadFits().filter((f) => f.id !== fit.id);
  list.unshift(cloneFit(fit));
  saveJson(KEY, list);
}

export function deleteFit(id: string) {
  saveJson(KEY, loadFits().filter((f) => f.id !== id));
}
