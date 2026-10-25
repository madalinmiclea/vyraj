import { loadJson, removeKey, saveJson } from '../storage';
import { dataMissing, fetchData } from '../data/manifest';

export interface SkinShip {
  id: number;
  name: string;
  group: string;
  license: number;
  licenses: number[];
}

export interface SkinLine {
  name: string;
  icon: number;
  colors?: (string | null)[];
  ships: SkinShip[];
}

interface RawSkins {
  lines: { n: string; i: number; c?: (string | null)[]; s: number[][] }[];
  ships: Record<string, [string, string]>;
}

let loading: Promise<SkinLine[]> | null = null;

export function loadSkins(): Promise<SkinLine[]> {
  loading ??= fetchData('skins')
    .then((res) => {
      if (!res.ok) throw dataMissing(res.url);
      return res.json() as Promise<RawSkins>;
    })
    .then((raw) => raw.lines.map((l) => ({
      name: l.n,
      icon: l.i,
      colors: l.c,
      ships: l.s
        .map(([id, ...lic]) => {
          const [name, group] = raw.ships[id] ?? [`Type ${id}`, ''];
          const licenses = lic.filter((x) => x > 0);
          return { id, name, group, license: licenses[0] ?? 0, licenses };
        })
        .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)),
    })))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

export const skinKey = (line: string, shipId: number) => `${line}|${shipId}`;

const ownedKey = (characterId: string) => `eve-skins:owned:${characterId}`;

export function loadOwned(characterId: string): Set<string> {
  return new Set(loadJson<string[]>(ownedKey(characterId), []));
}

export function saveOwned(characterId: string, owned: Set<string>) {
  saveJson(ownedKey(characterId), [...owned]);
}

export function licenseIndex(lines: SkinLine[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const l of lines) for (const s of l.ships) for (const lic of s.licenses) map.set(lic, skinKey(l.name, s.id));
  return map;
}

export interface ShipRef {
  id: number;
  name: string;
  group: string;
}

const EXTRA_KEY = 'eve-skins:extra';

export function loadExtras(): [string, number][] {
  return loadJson<[string, number][]>(EXTRA_KEY, []);
}

export function saveExtras(extras: [string, number][]) {
  saveJson(EXTRA_KEY, extras);
}

function homeLine(lines: SkinLine[], lineName: string, shipId: number): SkinLine | undefined {
  const exact = lines.find((l) => l.name === lineName);
  if (exact?.ships.some((s) => s.id === shipId)) return exact;
  const n = norm(lineName);
  return lines.find((l) => l.ships.some((s) => s.id === shipId) && (norm(l.name).startsWith(n) || n.startsWith(norm(l.name))));
}

export function migrateOwned(lines: SkinLine[], owned: Set<string>): boolean {
  let changed = false;
  for (const key of [...owned]) {
    const cut = key.lastIndexOf('|');
    const lineName = key.slice(0, cut);
    const shipId = Number(key.slice(cut + 1));
    const home = homeLine(lines, lineName, shipId);
    if (!home || home.name === lineName) continue;
    owned.delete(key);
    owned.add(skinKey(home.name, shipId));
    changed = true;
  }
  return changed;
}

export function applyExtras(lines: SkinLine[], ships: Map<number, ShipRef>) {
  const kept: [string, number][] = [];
  for (const [lineName, shipId] of loadExtras()) {
    const ship = ships.get(shipId);
    if (!ship) continue;
    if (homeLine(lines, lineName, shipId)) continue;
    kept.push([lineName, shipId]);
    let line = lines.find((l) => l.name === lineName);
    if (!line) {
      line = { name: lineName, icon: 0, ships: [] };
      lines.push(line);
    }
    if (line.ships.some((s) => s.id === shipId)) continue;
    line.ships.push({ ...ship, license: 0, licenses: [] });
    line.ships.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  }
  saveExtras(kept);
  lines.sort((a, b) => a.name.localeCompare(b.name));
}

const norm = (s: string) => s.toLowerCase().replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim();

function resolveLine(lines: SkinLine[], raw: string): SkinLine | null {
  const byName = new Map(lines.map((l) => [norm(l.name), l]));
  const candidates = [raw, raw.replace(/\s*\(.*?\)\s*$/, ''), raw.replace(/\s+-\s+.*$/, '')].map(norm);
  for (const c of candidates) if (byName.has(c)) return byName.get(c)!;
  const name = norm(raw);
  const prefix = lines
    .filter((l) => name.startsWith(norm(l.name) + ' '))
    .sort((a, b) => b.name.length - a.name.length)[0];
  return prefix ?? null;
}

export interface ImportResult {
  added: number;
  already: number;
  newShips: number;
  unknown: string[];
}

export function importList(text: string, lines: SkinLine[], ships: Map<number, ShipRef>, owned: Set<string>): ImportResult {
  const shipByName = new Map([...ships.values()].map((s) => [norm(s.name), s]));
  const extras = loadExtras();
  const result: ImportResult = { added: 0, already: 0, newShips: 0, unknown: [] };
  for (const row of text.split(/\r?\n/)) {
    const idx = row.indexOf(':');
    if (idx < 0) continue;
    const lineName = row.slice(0, idx).trim();
    const shipNames = row.slice(idx + 1).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!lineName || !shipNames.length) continue;
    const line = resolveLine(lines, lineName);
    for (const shipName of shipNames) {
      const known = line?.ships.find((s) => norm(s.name) === norm(shipName));
      const ship = known ?? shipByName.get(norm(shipName));
      if (!ship) { result.unknown.push(`${lineName}: ${shipName}`); continue; }
      const target = line?.name ?? lineName.replace(/\s*\(.*?\)\s*$/, '');
      if (!known && !extras.some(([l, id]) => l === target && id === ship.id)) {
        extras.push([target, ship.id]);
        result.newShips++;
      }
      const key = skinKey(target, ship.id);
      if (owned.has(key)) result.already++;
      else { owned.add(key); result.added++; }
    }
  }
  saveExtras(extras);
  applyExtras(lines, ships);
  return result;
}

const syncedKey = (characterId: string) => `eve-skins:synced:${characterId}`;

interface SyncState {
  seen: string[];
  at?: number;
}

export function lastSync(characterId: string): number | undefined {
  return loadJson<SyncState>(syncedKey(characterId), { seen: [] }).at;
}

export interface SyncSource {
  assets?: { item_id: number; type_id: number }[];
  transactions?: { transaction_id: number; type_id: number; is_buy: boolean }[];
}

export function applySync(characterId: string, lines: SkinLine[], owned: Set<string>, src: SyncSource): string[] {
  const state = loadJson<SyncState>(syncedKey(characterId), { seen: [] });
  const seen = new Set(state.seen);
  const index = licenseIndex(lines);
  const added: string[] = [];
  const take = (id: string, typeId: number) => {
    const key = index.get(typeId);
    if (!key || seen.has(id)) return;
    seen.add(id);
    if (!owned.has(key)) { owned.add(key); added.push(key); }
  };
  for (const a of src.assets ?? []) take(`a${a.item_id}`, a.type_id);
  for (const t of src.transactions ?? []) if (t.is_buy) take(`t${t.transaction_id}`, t.type_id);
  saveJson(syncedKey(characterId), { seen: [...seen], at: Date.now() });
  return added;
}

export function forgetSkins(characterId: string) {
  removeKey(ownedKey(characterId));
  removeKey(syncedKey(characterId));
}
