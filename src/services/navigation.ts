import { fetchData } from '../data/manifest';
import { esiFetch } from './esiClient';
import { fold } from '../ui/fold';
import { tx } from '../i18n';

const ESI = 'https://esi.evetech.net/latest';
const SCOUT = 'https://api.eve-scout.com/v2/public/signatures';

export const POCHVEN_REGION = 10000070;
export const ZARZAKH = 30100000;
const JOVE_REGIONS = new Set([10000004, 10000017, 10000019]);
const NO_CYNO_REGIONS = new Set([POCHVEN_REGION, 10001000, ...JOVE_REGIONS]);

export const ISOTOPES: Record<number, string> = { 16274: 'Helium Isotopes', 17887: 'Oxygen Isotopes', 17888: 'Nitrogen Isotopes', 17889: 'Hydrogen Isotopes' };

export const POCHVEN_FILAMENTS = [56076, 56077, 56078, 56079, 56080, 56081, 56070, 56071, 56072, 56073, 56074, 56075, 56065, 56066, 56067, 56068, 56069];

export const KRAI_HOMES: Record<string, string> = { Perun: 'Kino', Svarog: 'Niarja', Veles: 'Archee' };
export const KRAI_BORDERS = ['Ahtila', 'Senda', 'Arvasaras', 'Sakenta', 'Otanuomi', 'Urhinichi'];

export interface NavSystem {
  id: number;
  name: string;
  constellationId: number;
  regionId: number;
  sec: number;
  x: number;
  y: number;
  z: number;
}

interface RawMap {
  generated: string;
  regions: Record<string, string>;
  constellations: Record<string, string>;
  systems: [number, string, number, number, number, number, number, number][];
  gates: number[];
}

export class NavMap {
  readonly systems = new Map<number, NavSystem>();
  readonly regions = new Map<number, string>();
  readonly constellations = new Map<number, string>();
  readonly gates = new Map<number, number[]>();
  readonly generated: string;
  private readonly byName = new Map<string, NavSystem>();
  private readonly sorted: NavSystem[];

  constructor(raw: RawMap) {
    this.generated = raw.generated;
    for (const [k, v] of Object.entries(raw.regions)) this.regions.set(Number(k), v);
    for (const [k, v] of Object.entries(raw.constellations)) this.constellations.set(Number(k), v);
    for (const [id, name, constellationId, regionId, sec, x, y, z] of raw.systems) {
      const s = { id, name, constellationId, regionId, sec, x, y, z };
      this.systems.set(id, s);
      this.byName.set(fold(name), s);
    }
    for (let i = 0; i < raw.gates.length; i += 2) {
      const a = raw.gates[i], b = raw.gates[i + 1];
      (this.gates.get(a) ?? this.gates.set(a, []).get(a)!).push(b);
      (this.gates.get(b) ?? this.gates.set(b, []).get(b)!).push(a);
    }
    this.sorted = [...this.systems.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  find(name: string): NavSystem | undefined {
    const q = fold(name.trim());
    return this.byName.get(q) ?? this.sorted.find((s) => fold(s.name).startsWith(q));
  }

  suggest(prefix: string, limit = 12): NavSystem[] {
    const q = fold(prefix.trim());
    if (!q) return [];
    return this.sorted.filter((s) => fold(s.name).startsWith(q)).slice(0, limit);
  }

  region(s: NavSystem) {
    return this.regions.get(s.regionId) ?? '';
  }

  constellation(s: NavSystem) {
    return this.constellations.get(s.constellationId) ?? '';
  }

  inRegion(regionId: number): NavSystem[] {
    return this.sorted.filter((s) => s.regionId === regionId);
  }

  gateDistances(from: number, max = 60): Map<number, number> {
    const dist = new Map<number, number>([[from, 0]]);
    let frontier = [from];
    for (let d = 1; d <= max && frontier.length; d++) {
      const next: number[] = [];
      for (const id of frontier) {
        for (const n of this.gates.get(id) ?? []) {
          if (dist.has(n)) continue;
          dist.set(n, d);
          next.push(n);
        }
      }
      frontier = next;
    }
    return dist;
  }
}

let loading: Promise<NavMap> | null = null;

export function loadMap(): Promise<NavMap> {
  loading ??= fetchData('map')
    .then((res) => {
      if (!res.ok) throw new Error(tx('Nu găsesc harta ({url}). Rulează "npm run data" ca să o generezi.', { url: res.url }));
      return res.json() as Promise<RawMap>;
    })
    .then((raw) => new NavMap(raw))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

export const displaySec = (sec: number) => (sec > 0 && sec < 0.05 ? 0.1 : Math.round(sec * 10) / 10);
export const secClass = (sec: number) => (sec >= 0.45 ? 'sec-hi' : sec > 0 ? 'sec-lo' : 'sec-null');
export const isHighsec = (s: NavSystem) => s.sec >= 0.45;

export function distanceLy(a: NavSystem, b: NavSystem): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function cynoAllowed(s: NavSystem): boolean {
  return !isHighsec(s) && !NO_CYNO_REGIONS.has(s.regionId) && s.id !== ZARZAKH;
}

export interface JumpShip {
  range: number;
  fuelPerLy: number;
  fuelType: number;
  fatigueFactor: number;
}

export interface JumpLeg {
  from: NavSystem;
  to: NavSystem;
  ly: number;
  fuel: number;
  fatigueAfter: number;
  cooldown: number;
  waitBefore: number;
}

export interface JumpPlan {
  legs: JumpLeg[];
  ly: number;
  fuel: number;
  travelMinutes: number;
  fatigueEnd: number;
}

export type PlanMode = 'jumps' | 'fuel';

const FATIGUE_CAP = 300;
const COOLDOWN_CAP = 30;

export function legFuel(ship: JumpShip, ly: number): number {
  return Math.ceil(ly * ship.fuelPerLy);
}

export function simulateFatigue(ship: JumpShip, hops: { ly: number }[], startFatigue = 0, waitForCooldown = true) {
  let fatigue = startFatigue;
  let total = 0;
  return hops.map((h) => {
    const eff = h.ly * ship.fatigueFactor;
    const cooldown = Math.min(COOLDOWN_CAP, Math.max(1 + eff, fatigue / 10));
    fatigue = Math.min(FATIGUE_CAP, Math.max(10 * (1 + eff), fatigue * (1 + eff)));
    const out = { fatigueAfter: fatigue, cooldown, at: total };
    if (waitForCooldown) {
      total += cooldown;
      fatigue = Math.max(0, fatigue - cooldown);
    }
    return out;
  });
}

class Heap {
  private items: [number, number][] = [];
  get size() { return this.items.length; }
  push(cost: number, id: number) {
    const a = this.items;
    a.push([cost, id]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function grid(nodes: NavSystem[], cell: number) {
  const g = new Map<string, NavSystem[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}:${Math.floor(z / cell)}`;
  for (const s of nodes) {
    const k = key(s.x, s.y, s.z);
    (g.get(k) ?? g.set(k, []).get(k)!).push(s);
  }
  return (s: NavSystem) => {
    const cx = Math.floor(s.x / cell), cy = Math.floor(s.y / cell), cz = Math.floor(s.z / cell);
    const out: NavSystem[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = g.get(`${cx + dx}:${cy + dy}:${cz + dz}`);
      if (list) out.push(...list);
    }
    return out;
  };
}

export function inRange(map: NavMap, from: NavSystem, range: number): { system: NavSystem; ly: number }[] {
  const out: { system: NavSystem; ly: number }[] = [];
  for (const s of map.systems.values()) {
    if (s.id === from.id || !cynoAllowed(s)) continue;
    const ly = distanceLy(from, s);
    if (ly <= range) out.push({ system: s, ly });
  }
  return out.sort((a, b) => a.ly - b.ly);
}

export function planJumps(map: NavMap, ship: JumpShip, from: NavSystem, to: NavSystem, mode: PlanMode, avoid: Set<number>, startFatigue = 0): JumpPlan | null {
  if (!cynoAllowed(to)) return null;
  const nodes = [...map.systems.values()].filter((s) => cynoAllowed(s) && !avoid.has(s.id));
  const near = grid(nodes, Math.max(ship.range, 0.5));
  const cost = new Map<number, number>([[from.id, 0]]);
  const prev = new Map<number, number>();
  const heap = new Heap();
  heap.push(0, from.id);
  const step = (ly: number) => (mode === 'jumps' ? 1e4 + ly : ly + 1e-3);
  while (heap.size) {
    const [c, id] = heap.pop();
    if (c > (cost.get(id) ?? Infinity)) continue;
    if (id === to.id) break;
    const cur = map.systems.get(id)!;
    for (const n of near(cur)) {
      if (n.id === id) continue;
      const ly = distanceLy(cur, n);
      if (ly > ship.range) continue;
      const nc = c + step(ly);
      if (nc < (cost.get(n.id) ?? Infinity)) {
        cost.set(n.id, nc);
        prev.set(n.id, id);
        heap.push(nc, n.id);
      }
    }
  }
  if (!cost.has(to.id)) return null;
  const path: NavSystem[] = [to];
  while (path[0].id !== from.id) path.unshift(map.systems.get(prev.get(path[0].id)!)!);
  const hops = path.slice(1).map((s, i) => ({ from: path[i], to: s, ly: distanceLy(path[i], s) }));
  const fat = simulateFatigue(ship, hops, startFatigue);
  const legs: JumpLeg[] = hops.map((h, i) => ({
    ...h,
    fuel: legFuel(ship, h.ly),
    fatigueAfter: fat[i].fatigueAfter,
    cooldown: fat[i].cooldown,
    waitBefore: i ? fat[i - 1].cooldown : 0,
  }));
  const last = fat[fat.length - 1];
  return {
    legs,
    ly: legs.reduce((a, l) => a + l.ly, 0),
    fuel: legs.reduce((a, l) => a + l.fuel, 0),
    travelMinutes: last ? last.at : 0,
    fatigueEnd: last ? last.fatigueAfter : startFatigue,
  };
}

export interface SystemStat { ship: number; pod: number; npc: number; jumps: number }

let statsCache: { at: number; map: Map<number, SystemStat> } | null = null;

export async function systemStats(): Promise<{ at: number; map: Map<number, SystemStat> }> {
  if (statsCache && Date.now() - statsCache.at < 10 * 60 * 1000) return statsCache;
  const [kills, jumps] = await Promise.all([
    esiFetch(`${ESI}/universe/system_kills/?datasource=tranquility`).then((r) => { if (!r.ok) throw new Error(`ESI system_kills: ${r.status}`); return r.json(); }),
    esiFetch(`${ESI}/universe/system_jumps/?datasource=tranquility`).then((r) => { if (!r.ok) throw new Error(`ESI system_jumps: ${r.status}`); return r.json(); }),
  ]) as [{ system_id: number; ship_kills: number; pod_kills: number; npc_kills: number }[], { system_id: number; ship_jumps: number }[]];
  const map = new Map<number, SystemStat>();
  const get = (id: number) => map.get(id) ?? map.set(id, { ship: 0, pod: 0, npc: 0, jumps: 0 }).get(id)!;
  for (const k of kills) Object.assign(get(k.system_id), { ship: k.ship_kills, pod: k.pod_kills, npc: k.npc_kills });
  for (const j of jumps) get(j.system_id).jumps = j.ship_jumps;
  statsCache = { at: Date.now(), map };
  return statsCache;
}

export interface WormholeLink {
  hub: string;
  hubId: number;
  hubSig: string;
  systemId: number;
  system: string;
  region: string;
  sig: string;
  type: string;
  size: string;
  hoursLeft: number;
  updated: number;
}

interface ScoutRow {
  out_system_id: number;
  out_system_name: string;
  out_signature?: string;
  in_system_id: number;
  in_system_name: string;
  in_region_name?: string;
  in_signature?: string;
  wh_type?: string;
  max_ship_size?: string;
  remaining_hours?: number;
  expires_at?: string;
  updated_at?: string;
  created_at?: string;
}

export async function wormholeLinks(): Promise<WormholeLink[]> {
  const res = await fetch(SCOUT, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`EVE-Scout: ${res.status}`);
  const rows = (await res.json()) as ScoutRow[];
  const now = Date.now();
  return rows.filter((r) => !r.expires_at || Date.parse(r.expires_at) > now).map((r) => ({
    hub: r.out_system_name,
    hubId: r.out_system_id,
    hubSig: r.out_signature ?? '',
    systemId: r.in_system_id,
    system: r.in_system_name,
    region: r.in_region_name ?? '',
    sig: r.in_signature ?? '',
    type: r.wh_type ?? '',
    size: r.max_ship_size ?? '',
    hoursLeft: r.expires_at ? Math.max(0, (Date.parse(r.expires_at) - now) / 3.6e6) : r.remaining_hours ?? 0,
    updated: Date.parse(r.updated_at ?? r.created_at ?? '') || 0,
  }));
}
