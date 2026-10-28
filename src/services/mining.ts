import { fetchData, dataMissing } from '../data/manifest';
import type { Sde } from '../data/sde';
import type { Dogma, DogmaItem, AttrTrace } from '../engine/dogma';
import type { Character } from '../character/characters';
import type { Breakdown } from '../ui/breakdown';
import type { Aggregates } from './market';
import { roman } from '../ui/itemInfo';
import { tx } from '../i18n';

export type OreKind = 'ore' | 'moon' | 'ice' | 'gas';
export type MinerKind = 'ore' | 'ice' | 'gas';
export const ORE_KINDS: OreKind[] = ['ore', 'moon', 'ice', 'gas'];

export interface Ore {
  id: number;
  name: string;
  kind: OreKind;
  group: string;
  volume: number;
  portion: number;
  compressedId?: number;
  compressedVolume?: number;
  compressedMaterials?: [number, number][];
  skillId?: number;
  family?: string;
  baseId?: number;
  materials: [number, number][];
}

export interface Rig { id: number; name: string; kind: Exclude<OreKind, 'gas'>; yield: number; sec: [number, number, number] }

export interface MiningData {
  ores: Ore[];
  byId: Map<number, Ore>;
  minerals: Map<number, string>;
  skills: Map<number, { name: string; pct: number }>;
  implants: { id: number; name: string; pct: number }[];
  structures: { id: number; name: string; bonus: number }[];
  rigs: Rig[];
}

interface RawMining {
  ores: { i: number; n: string; k: OreKind; g: string; v: number; p: number; c?: number; cv?: number; cm?: [number, number][]; s?: number; f?: string; b?: number; m: [number, number][] }[];
  minerals: Record<string, string>;
  skills: Record<string, [string, number]>;
  implants: [number, string, number][];
  structures: [number, string, number][];
  rigs: { i: number; n: string; k: Rig['kind']; y: number; sec: [number, number, number] }[];
}

let loading: Promise<MiningData> | null = null;

export function loadMining(): Promise<MiningData> {
  loading ??= fetchData('mining')
    .then((res) => {
      if (!res.ok) throw dataMissing(res.url);
      return res.json() as Promise<RawMining>;
    })
    .then((raw) => {
      const ores: Ore[] = raw.ores.map((o) => ({
        id: o.i, name: o.n, kind: o.k, group: o.g, volume: o.v, portion: o.p || 1,
        compressedId: o.c, compressedVolume: o.cv, compressedMaterials: o.cm, skillId: o.s, family: o.f, baseId: o.b, materials: o.m,
      }));
      return {
        ores,
        byId: new Map(ores.flatMap((o) => (o.compressedId ? [[o.id, o], [o.compressedId, o]] : [[o.id, o]]) as [number, Ore][])),
        minerals: new Map(Object.entries(raw.minerals).map(([k, v]) => [Number(k), v])),
        skills: new Map(Object.entries(raw.skills).map(([k, [name, pct]]) => [Number(k), { name, pct }])),
        implants: raw.implants.map(([id, name, pct]) => ({ id, name, pct })),
        structures: raw.structures.map(([id, name, bonus]) => ({ id, name, bonus })),
        rigs: raw.rigs.map((r) => ({ id: r.i, name: r.n, kind: r.k, yield: r.y, sec: r.sec })),
      };
    })
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

export type Security = 0 | 1 | 2;
export const SECURITY_LABEL = (): Record<Security, string> => ({ 0: tx('High sec'), 1: tx('Low sec'), 2: tx('Null sec / W-space') });

export interface RefineSetup {
  place: number;
  rigs: Record<Rig['kind'], number>;
  sec: Security;
  implant: number;
  tax: number;
}

export const DEFAULT_SETUP: RefineSetup = { place: 0, rigs: { ore: 0, moon: 0, ice: 0 }, sec: 0, implant: -1, tax: 0 };

const REPROCESSING = 3385;
const EFFICIENCY = 3389;
const NPC_BASE = 0.5;

export function implantFor(data: MiningData, setup: RefineSetup, character: Character) {
  if (setup.implant > 0) return data.implants.find((i) => i.id === setup.implant);
  if (setup.implant === 0) return undefined;
  return data.implants.filter((i) => character.implants.includes(i.id)).sort((a, b) => b.pct - a.pct)[0];
}

export function refineYield(data: MiningData, setup: RefineSetup, character: Character, ore: Ore): Breakdown {
  const structure = data.structures.find((s) => s.id === setup.place);
  const rigKind = ore.kind === 'gas' ? null : ore.kind;
  const rig = structure && rigKind ? data.rigs.find((r) => r.id === setup.rigs[rigKind]) : undefined;
  const base = rig ? rig.yield : NPC_BASE;
  const parts: Breakdown['parts'] = [];
  let value = base;
  const step = (label: string, mult: number) => {
    if (mult === 1) return;
    const next = value * mult;
    parts.push({ label, delta: next - value });
    value = next;
  };
  if (rig) step(SECURITY_LABEL()[setup.sec], rig.sec[setup.sec]);
  if (structure) step(structure.name, 1 + structure.bonus / 100);
  for (const id of [REPROCESSING, EFFICIENCY, ore.skillId]) {
    if (!id) continue;
    const s = data.skills.get(id);
    const lvl = character.skills.get(id) ?? 0;
    if (s && lvl) step(`${s.name} ${roman(lvl)}`, 1 + (s.pct * lvl) / 100);
  }
  const imp = implantFor(data, setup, character);
  if (imp) step(imp.name, 1 + imp.pct / 100);
  return { base, parts, value: Math.min(1, value) };
}

export function baseLabel(data: MiningData, setup: RefineSetup, ore: Ore): string {
  const structure = data.structures.find((s) => s.id === setup.place);
  const rig = structure && ore.kind !== 'gas' ? data.rigs.find((r) => r.id === setup.rigs[ore.kind as Rig['kind']]) : undefined;
  return rig ? rig.name : tx('bază reprocesare');
}

export const priceOf = (a: Aggregates | undefined, basis: 'sell' | 'buy') => (a ? (basis === 'sell' ? a.sellMin : a.buyMax) : 0);

export interface RefineResult {
  portions: number;
  leftover: number;
  outputs: { id: number; qty: number }[];
}

export function refine(ore: Ore, typeId: number, qty: number, yieldPct: number): RefineResult {
  const mats = typeId === ore.compressedId && ore.compressedMaterials ? ore.compressedMaterials : ore.materials;
  const portions = Math.floor(qty / ore.portion);
  return {
    portions,
    leftover: qty - portions * ore.portion,
    outputs: mats.map(([id, q]) => ({ id, qty: Math.floor(q * portions * yieldPct) })).filter((o) => o.qty > 0),
  };
}

export function refinedUnitValue(ore: Ore, yieldPct: number, price: (id: number) => number, tax: number): number {
  const total = ore.materials.reduce((a, [id, q]) => a + q * yieldPct * price(id), 0);
  return (total / ore.portion) * (1 - tax / 100);
}

export interface OreValue {
  raw: number;
  compressed: number;
  refined: number;
  best: 'raw' | 'compressed' | 'refined';
}

export function oreValuePerM3(ore: Ore, yieldPct: number, price: (id: number) => number, tax: number): OreValue {
  const raw = price(ore.id) / ore.volume;
  const compressed = ore.compressedId ? price(ore.compressedId) / ore.volume : 0;
  const refined = ore.materials.length ? refinedUnitValue(ore, yieldPct, price, tax) / ore.volume : 0;
  const best = refined > raw && refined >= compressed ? 'refined' : compressed > raw ? 'compressed' : 'raw';
  return { raw, compressed, refined, best };
}

export interface Miner {
  item: DogmaItem;
  kind: MinerKind;
  count: number;
  drone: boolean;
  amount: number;
  duration: number;
  crystal?: { name: string; family: string; yieldMult: number; durationMult: number };
  critChance: number;
  critBonus: number;
  wasteChance: number;
  wasteMult: number;
  deepCore: boolean;
  amountTrace: AttrTrace;
  durationTrace: AttrTrace;
}

function minerKind(name: string, groupName: string): MinerKind {
  const s = `${groupName} ${name}`;
  if (/ice/i.test(s)) return 'ice';
  if (/gas/i.test(s)) return 'gas';
  return 'ore';
}

export function miners(sde: Sde, d: Dogma): Miner[] {
  const id = (n: string) => (sde.hasAttr(n) ? sde.attrId(n) : -1);
  const amountId = id('miningAmount');
  const durationId = id('duration');
  const get = (item: DogmaItem, n: string) => (id(n) > 0 ? item.attr(id(n)) : 0);
  const out: Miner[] = [];
  const add = (item: DogmaItem, count: number, drone: boolean) => {
    if (amountId < 0 || item.attr(amountId) <= 0) return;
    const t = item.type;
    const charge = item.other;
    const yieldMult = charge ? get(charge, 'specializationAsteroidYieldMultiplier') : 0;
    const crystal = charge && yieldMult > 0 ? {
      name: charge.type.name,
      family: charge.type.name.split(' ')[0],
      yieldMult,
      durationMult: get(charge, 'specializationAsteroidDurationMultiplier') || 1,
    } : undefined;
    out.push({
      item,
      kind: minerKind(t.name, t.groupName),
      count,
      drone,
      amount: item.attr(amountId),
      duration: item.attr(durationId) / 1000,
      crystal,
      critChance: get(item, 'miningCritChance'),
      critBonus: get(item, 'miningCritBonusYield'),
      wasteChance: get(item, 'miningWasteProbability') / 100,
      wasteMult: get(item, 'miningWastedVolumeMultiplier'),
      deepCore: /deep core/i.test(t.name),
      amountTrace: item.trace(amountId),
      durationTrace: item.trace(durationId),
    });
  };
  for (const m of d.modules) if (m.state === 'active' || m.state === 'overheated') add(m, 1, false);
  for (const dr of d.drones) if (dr.count > 0) add(dr.item, dr.count, true);
  return out;
}

export function canMine(m: Miner, ore: Ore): boolean {
  if (ore.kind === 'gas') return m.kind === 'gas';
  if (ore.kind === 'ice') return m.kind === 'ice';
  if (m.kind !== 'ore') return false;
  if (ore.family === 'Mercoxit') return m.deepCore || m.drone;
  return true;
}

export interface Rate { m3: number; crit: number; waste: number }

export function minerRate(m: Miner, ore: Ore): Rate {
  if (!canMine(m, ore) || m.duration <= 0) return { m3: 0, crit: 0, waste: 0 };
  let amount = m.amount;
  let duration = m.duration;
  if (m.crystal && m.crystal.family !== ore.family) {
    amount /= m.crystal.yieldMult;
    duration /= m.crystal.durationMult;
  }
  const perHour = (3600 / duration) * m.count;
  const m3 = amount * perHour;
  return { m3, crit: m3 * m.critChance * m.critBonus, waste: m3 * m.wasteChance * m.wasteMult };
}

export function fitRate(list: Miner[], ore: Ore): Rate {
  return list.reduce((a, m) => {
    const r = minerRate(m, ore);
    return { m3: a.m3 + r.m3, crit: a.crit + r.crit, waste: a.waste + r.waste };
  }, { m3: 0, crit: 0, waste: 0 });
}

export function holdCapacity(sde: Sde, d: Dogma, kind: MinerKind): number {
  const names = kind === 'ore' ? ['generalMiningHoldCapacity', 'specialAsteroidHoldCapacity', 'specialOreHoldCapacity'] : kind === 'ice' ? ['generalMiningHoldCapacity', 'specialIceHoldCapacity'] : ['generalMiningHoldCapacity', 'specialGasHoldCapacity'];
  const hold = Math.max(0, ...names.filter((n) => sde.hasAttr(n)).map((n) => d.ship.attr(sde.attrId(n))));
  return hold || (sde.hasAttr('capacity') ? d.ship.attr(sde.attrId('capacity')) : 0);
}
