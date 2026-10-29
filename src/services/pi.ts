import { dataMissing, fetchData } from '../data/manifest';
import { ESI, esiFetch } from './esiClient';
import { accessToken, hasScope } from '../character/sso';
import { loadJson, saveJson } from '../storage';
import type { Aggregates } from './market';


export const PI_SCOPE = 'esi-planets.manage_planets.v1';
export const TIER_NAMES = ['P0', 'P1', 'P2', 'P3', 'P4'];
export const EXPORT_BASE = [5, 400, 7200, 60000, 1200000];

const COLONIES_KEY = 'eve-pi:colonies';
const PLANET_NAMES_KEY = 'eve-pi:planet-names';

export type PinKind = 'ext' | 'cc' | 'fac' | 'store' | 'pad' | 'ecu';

export interface PiType { id: number; name: string; tier: number; volume: number }
export interface Schematic { id: number; name: string; cycle: number; out: number; outQty: number; ins: [number, number][] }
export interface PlanetType { id: number; name: string; raws: number[] }

interface RawPi {
  generated: string;
  types: Record<string, [string, number, number]>;
  schematics: [number, string, number, number, number, [number, number][]][];
  planets: Record<string, [string, number[]]>;
  pins: Record<string, [string, PinKind, number]>;
}

export class PiData {
  readonly types = new Map<number, PiType>();
  readonly schematics = new Map<number, Schematic>();
  readonly byOutput = new Map<number, Schematic>();
  readonly planets = new Map<number, PlanetType>();
  readonly pins = new Map<number, { name: string; kind: PinKind; capacity: number }>();
  readonly generated: string;

  constructor(raw: RawPi) {
    this.generated = raw.generated;
    for (const [id, [name, tier, volume]] of Object.entries(raw.types)) this.types.set(Number(id), { id: Number(id), name, tier, volume });
    for (const [id, name, cycle, out, outQty, ins] of raw.schematics) {
      const s = { id, name, cycle, out, outQty, ins };
      this.schematics.set(id, s);
      this.byOutput.set(out, s);
    }
    for (const [id, [name, raws]] of Object.entries(raw.planets)) this.planets.set(Number(id), { id: Number(id), name, raws });
    for (const [id, [name, kind, capacity]] of Object.entries(raw.pins)) this.pins.set(Number(id), { name, kind, capacity });
  }

  name(id: number) { return this.types.get(id)?.name ?? `#${id}`; }
  tier(id: number) { return this.types.get(id)?.tier ?? 0; }

  planetsFor(raw: number): PlanetType[] {
    return [...this.planets.values()].filter((p) => p.raws.includes(raw));
  }

  planetByName(name: string): PlanetType | undefined {
    return [...this.planets.values()].find((p) => p.name.toLowerCase() === name.toLowerCase());
  }

  cover(raws: number[], among: Iterable<PlanetType> = this.planets.values()) {
    const left = new Set(raws);
    const pool = [...among];
    const chosen: { id: number; name: string; raws: number[] }[] = [];
    while (left.size) {
      let pick: { id: number; name: string; raws: number[] } | null = null;
      for (const p of pool) {
        const hit = p.raws.filter((r) => left.has(r));
        if (hit.length && (!pick || hit.length > pick.raws.length)) pick = { id: p.id, name: p.name, raws: hit };
      }
      if (!pick) break;
      chosen.push(pick);
      pick.raws.forEach((r) => left.delete(r));
    }
    return chosen;
  }

  rawSet(typeId: number): Set<number> {
    return new Set(this.rawNeeds(typeId, 1).keys());
  }

  usedIn(typeId: number): Schematic[] {
    return [...this.schematics.values()].filter((s) => s.ins.some(([id]) => id === typeId));
  }

  rawNeeds(typeId: number, qty: number, out = new Map<number, number>()): Map<number, number> {
    const s = this.byOutput.get(typeId);
    if (!s) {
      out.set(typeId, (out.get(typeId) ?? 0) + qty);
      return out;
    }
    const runs = qty / s.outQty;
    for (const [inp, q] of s.ins) this.rawNeeds(inp, q * runs, out);
    return out;
  }

  levelNeeds(typeId: number, qty: number, out = new Map<number, number>()): Map<number, number> {
    out.set(typeId, (out.get(typeId) ?? 0) + qty);
    const s = this.byOutput.get(typeId);
    if (s) for (const [inp, q] of s.ins) this.levelNeeds(inp, (q * qty) / s.outQty, out);
    return out;
  }
}

let cached: Promise<PiData> | null = null;

export function loadPi(): Promise<PiData> {
  cached ??= fetchData('pi').then(async (res) => {
    if (!res.ok) throw dataMissing(res.url);
    return new PiData(await res.json());
  }).catch((e) => { cached = null; throw e; });
  return cached;
}

export type PriceSide = 'sell' | 'buy';

export const priceOf = (prices: Map<number, Aggregates>, id: number, side: PriceSide) => {
  const p = prices.get(id);
  if (!p) return 0;
  return side === 'sell' ? p.sellMin || p.buyMax : p.buyMax || p.sellMin;
};

export interface ChainRow {
  schematic: Schematic;
  tier: number;
  outValue: number;
  inCost: number;
  tax: number;
  profitCycle: number;
  profitHour: number;
  margin: number;
  missing: boolean;
  outVolume: number;
}

export interface ChainOptions { input: PriceSide; output: PriceSide; taxRate: number }

export function exportTax(pi: PiData, id: number, qty: number, rate: number) {
  return EXPORT_BASE[pi.tier(id)] * qty * rate;
}

export function chainRows(pi: PiData, prices: Map<number, Aggregates>, o: ChainOptions): ChainRow[] {
  return [...pi.schematics.values()].map((s) => {
    const outPrice = priceOf(prices, s.out, o.output);
    const outValue = outPrice * s.outQty;
    let inCost = 0;
    let tax = exportTax(pi, s.out, s.outQty, o.taxRate);
    let missing = !outPrice;
    for (const [id, q] of s.ins) {
      const p = priceOf(prices, id, o.input);
      if (!p) missing = true;
      inCost += p * q;
      tax += exportTax(pi, id, q, o.taxRate) / 2;
    }
    const profitCycle = outValue - inCost - tax;
    return {
      schematic: s,
      tier: pi.tier(s.out),
      outValue,
      inCost,
      tax,
      profitCycle,
      profitHour: (profitCycle * 3600) / s.cycle,
      margin: inCost > 0 ? profitCycle / inCost : 0,
      missing,
      outVolume: (pi.types.get(s.out)?.volume ?? 0) * s.outQty,
    };
  });
}

export interface ColonyExtractor { pinId: number; product: number; qtyPerCycle: number; cycle: number; heads: number; install: number; expiry: number }
export interface ColonyFactory { schematic: number; count: number }
export interface ColonyStorage { kind: PinKind; name: string; used: number; capacity: number; contents: [number, number][] }

export interface Colony {
  planetId: number;
  planetType: string;
  systemId: number;
  level: number;
  pins: number;
  lastUpdate: number;
  extractors: ColonyExtractor[];
  factories: ColonyFactory[];
  storage: ColonyStorage[];
}

export interface ColonyEntry { characterId: number; fetched: number; colonies: Colony[]; error?: string; missingScope?: boolean }

interface EsiPlanet { planet_id: number; planet_type: string; solar_system_id: number; upgrade_level: number; num_pins: number; last_update: string }

interface EsiPin {
  pin_id: number;
  type_id: number;
  install_time?: string;
  expiry_time?: string;
  schematic_id?: number;
  extractor_details?: { cycle_time?: number; product_type_id?: number; qty_per_cycle?: number; heads?: unknown[] };
  factory_details?: { schematic_id: number };
  contents?: { type_id: number; amount: number }[];
}

async function authed<T>(characterId: number, path: string): Promise<T> {
  const token = await accessToken(characterId);
  const res = await esiFetch(`${ESI}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`ESI ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

const time = (s?: string) => (s ? new Date(s).getTime() : 0);

function toColony(pi: PiData, p: EsiPlanet, pins: EsiPin[]): Colony {
  const extractors: ColonyExtractor[] = [];
  const factories = new Map<number, number>();
  const storage: ColonyStorage[] = [];
  for (const pin of pins) {
    const meta = pi.pins.get(pin.type_id);
    const ex = pin.extractor_details;
    if (ex?.product_type_id) {
      extractors.push({
        pinId: pin.pin_id,
        product: ex.product_type_id,
        qtyPerCycle: ex.qty_per_cycle ?? 0,
        cycle: ex.cycle_time ?? 0,
        heads: ex.heads?.length ?? 0,
        install: time(pin.install_time),
        expiry: time(pin.expiry_time),
      });
      continue;
    }
    const schematic = pin.factory_details?.schematic_id ?? pin.schematic_id;
    if (schematic) {
      factories.set(schematic, (factories.get(schematic) ?? 0) + 1);
      continue;
    }
    if (meta && (meta.kind === 'store' || meta.kind === 'pad' || meta.kind === 'cc')) {
      const contents = (pin.contents ?? []).map((c) => [c.type_id, c.amount] as [number, number]);
      const used = contents.reduce((s, [id, n]) => s + (pi.types.get(id)?.volume ?? 0) * n, 0);
      storage.push({ kind: meta.kind, name: meta.name, used, capacity: meta.capacity, contents });
    }
  }
  return {
    planetId: p.planet_id,
    planetType: p.planet_type,
    systemId: p.solar_system_id,
    level: p.upgrade_level,
    pins: p.num_pins,
    lastUpdate: time(p.last_update),
    extractors: extractors.sort((a, b) => a.expiry - b.expiry),
    factories: [...factories].map(([schematic, count]) => ({ schematic, count })),
    storage,
  };
}

export function loadColonies(): Record<number, ColonyEntry> {
  return loadJson<Record<number, ColonyEntry>>(COLONIES_KEY, {});
}

export async function fetchColonies(pi: PiData, characterId: number): Promise<ColonyEntry> {
  const entry: ColonyEntry = { characterId, fetched: Date.now(), colonies: [] };
  if (!hasScope(characterId, PI_SCOPE)) return { ...entry, missingScope: true };
  try {
    const list = await authed<EsiPlanet[]>(characterId, `/characters/${characterId}/planets/`);
    entry.colonies = await Promise.all(list.map(async (p) => {
      const detail = await authed<{ pins: EsiPin[] }>(characterId, `/characters/${characterId}/planets/${p.planet_id}/`);
      return toColony(pi, p, detail.pins ?? []);
    }));
  } catch (e) {
    const prev = loadColonies()[characterId];
    return { ...entry, colonies: prev?.colonies ?? [], fetched: prev?.fetched ?? entry.fetched, error: (e as Error).message };
  }
  return entry;
}

export function saveColonies(all: Record<number, ColonyEntry>) {
  saveJson(COLONIES_KEY, all);
}

export async function planetNames(ids: number[]): Promise<Map<number, string>> {
  const cache = loadJson<Record<string, string>>(PLANET_NAMES_KEY, {});
  const missing = [...new Set(ids)].filter((id) => !cache[id]);
  if (missing.length) {
    await Promise.all(missing.map(async (id) => {
      const res = await esiFetch(`${ESI}/universe/planets/${id}/`).catch(() => null);
      if (res?.ok) cache[id] = ((await res.json()) as { name: string }).name;
    }));
    saveJson(PLANET_NAMES_KEY, cache);
  }
  return new Map(ids.map((id) => [id, cache[id] ?? `#${id}`]));
}

export function cyclesUntil(e: ColonyExtractor, now: number) {
  if (!e.cycle || !e.expiry) return 0;
  return Math.max(0, Math.floor((e.expiry - now) / 1000 / e.cycle));
}

export function perDay(e: ColonyExtractor) {
  return e.cycle ? (e.qtyPerCycle * 86400) / e.cycle : 0;
}
