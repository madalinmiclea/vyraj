import { allEveItems } from '../data/items';
import { universeNames } from '../character/esi';
import { loadJson, saveJson } from '../storage';

const KEY = 'eve-fit:type-names';
const extra = loadJson<Record<string, string>>(KEY, {});
let index = new Map<number, string>();
let indexed = 0;

function known(id: number): string | undefined {
  if (indexed !== allEveItems.length) {
    index = new Map(allEveItems.map((i) => [i.t, i.n.trim()]));
    indexed = allEveItems.length;
  }
  return index.get(id) ?? extra[id];
}

export const typeName = (id: number) => known(id) ?? `Type ${id}`;

export async function resolveTypeNames(ids: number[]): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => !known(id));
  if (!missing.length) return;
  const found = await universeNames(missing).catch(() => new Map<number, string>());
  if (!found.size) return;
  for (const [id, name] of found) extra[id] = name;
  saveJson(KEY, extra);
}
