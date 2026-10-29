import { dataMissing, fetchData } from '../data/manifest';
import { loadMap, type NavMap } from './navigation';
import { fold } from '../ui/fold';

export interface PlanetSpot { index: number; typeId: number; name: string }
export interface SpaceSystem { id: number; name: string; sec: number; region: string; wh: number }

interface RawPlanets {
  generated: string;
  kinds: number[];
  names: Record<string, string>;
  systems: Record<string, string>;
  wh: [number, string, number, number][];
  regions: Record<string, string>;
}

const ROMAN: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

export function roman(n: number) {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

export class PlanetAtlas {
  readonly kinds: number[];
  readonly names = new Map<number, string>();
  readonly wh = new Map<number, SpaceSystem>();
  private readonly codes: Record<string, string>;
  private readonly whByName = new Map<string, SpaceSystem>();
  private readonly whSorted: SpaceSystem[];

  constructor(raw: RawPlanets, readonly map: NavMap) {
    this.kinds = raw.kinds;
    this.codes = raw.systems;
    for (const [k, v] of Object.entries(raw.names)) this.names.set(Number(k), v);
    for (const [id, name, cls, region] of raw.wh) {
      const s = { id, name, sec: -1, region: raw.regions[region] ?? '', wh: cls };
      this.wh.set(id, s);
      this.whByName.set(fold(name), s);
    }
    this.whSorted = [...this.wh.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  planets(systemId: number): PlanetSpot[] {
    const code = this.codes[systemId] ?? '';
    const sys = this.system(systemId);
    return [...code].map((c, i) => ({ index: i + 1, typeId: this.kinds[parseInt(c, 36)], name: `${sys?.name ?? systemId} ${roman(i + 1)}` }));
  }

  typeCounts(systemId: number): Map<number, number> {
    const out = new Map<number, number>();
    for (const c of this.codes[systemId] ?? '') {
      const t = this.kinds[parseInt(c, 36)];
      out.set(t, (out.get(t) ?? 0) + 1);
    }
    return out;
  }

  system(id: number): SpaceSystem | undefined {
    const k = this.map.systems.get(id);
    if (k) return { id, name: k.name, sec: k.sec, region: this.map.region(k), wh: 0 };
    return this.wh.get(id);
  }

  find(name: string): SpaceSystem | undefined {
    const q = fold(name.trim());
    if (!q) return undefined;
    const k = this.map.find(name);
    if (k) return this.system(k.id);
    const exact = this.whByName.get(q);
    if (exact) return exact;
    const hits = this.whSorted.filter((s) => fold(s.name).startsWith(q));
    return hits.length === 1 ? hits[0] : undefined;
  }

  suggest(prefix: string, limit = 12): SpaceSystem[] {
    const q = fold(prefix.trim());
    if (!q) return [];
    const k = this.map.suggest(prefix, limit).map((s) => this.system(s.id)!);
    const w = this.whSorted.filter((s) => fold(s.name).startsWith(q)).slice(0, Math.max(0, limit - k.length));
    return [...k, ...w];
  }

  nearest(from: number, typeIds: number[], { maxJumps = 30, minSec = -1, limit = 40 } = {}) {
    const want = new Set(typeIds);
    const dist = this.map.gateDistances(from, maxJumps);
    const rows: { system: SpaceSystem; jumps: number; count: number }[] = [];
    for (const [id, jumps] of dist) {
      const s = this.map.systems.get(id);
      if (!s || s.sec < minSec) continue;
      let count = 0;
      for (const [t, n] of this.typeCounts(id)) if (want.has(t)) count += n;
      if (count) rows.push({ system: this.system(id)!, jumps, count });
    }
    return rows.sort((a, b) => a.jumps - b.jumps || b.count - a.count || a.system.name.localeCompare(b.system.name)).slice(0, limit);
  }
}

let loading: Promise<PlanetAtlas> | null = null;

export function loadAtlas(): Promise<PlanetAtlas> {
  loading ??= Promise.all([
    fetchData('planets').then((res) => {
      if (!res.ok) throw dataMissing(res.url);
      return res.json() as Promise<RawPlanets>;
    }),
    loadMap(),
  ]).then(([raw, map]) => new PlanetAtlas(raw, map)).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
