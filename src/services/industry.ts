import { accessToken } from '../character/sso';
import { dataMissing, fetchData } from '../data/manifest';
import { fold } from '../ui/fold';
import { esiFetch } from './esiClient';
import type { Aggregates } from './market';

export const SKILL_INDUSTRY = 3380;
export const SKILL_ADVANCED_INDUSTRY = 3388;
export const SKILL_REACTIONS = 45746;
export const SCC_SURCHARGE = 0.04;
export const INVENTION_EIV_SHARE = 0.02;

export interface Blueprint {
  id: number;
  productId: number;
  qty: number;
  time: number;
  limit: number;
  reaction: boolean;
  mats: [number, number][];
  skills: [number, number][];
}

export interface Invention {
  sourceId: number;
  time: number;
  mats: [number, number][];
  skills: [number, number][];
  encryption: number;
  prob: number;
  runs: number;
}

export interface Decryptor {
  id: number;
  prob: number;
  me: number;
  te: number;
  runs: number;
}

type Flat = number[];

interface RawIndustry {
  generated: string;
  bps: [number, number, number, number, number, number, Flat, Flat][];
  inv: [number, number, Flat, Flat, number, [number, number, number][]][];
  decryptors: [number, number, number, number, number][];
  names: Record<string, string>;
  groups: Record<string, [string, string]>;
  groupOf: Record<string, number>;
}

const pairs = (f: Flat): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < f.length; i += 2) out.push([f[i], f[i + 1]]);
  return out;
};

export class IndustryData {
  readonly blueprints = new Map<number, Blueprint>();
  readonly byProduct = new Map<number, Blueprint>();
  readonly inventions = new Map<number, Invention>();
  readonly inventable = new Map<number, number[]>();
  readonly decryptors: Decryptor[];
  readonly generated: string;
  private readonly names = new Map<number, string>();
  private readonly groups = new Map<number, [string, string]>();
  private readonly groupOf = new Map<number, number>();
  private readonly sorted: Blueprint[];

  constructor(raw: RawIndustry) {
    this.generated = raw.generated;
    for (const [k, v] of Object.entries(raw.names)) this.names.set(Number(k), v);
    for (const [k, v] of Object.entries(raw.groups)) this.groups.set(Number(k), v);
    for (const [k, v] of Object.entries(raw.groupOf)) this.groupOf.set(Number(k), v);
    for (const [id, productId, qty, time, limit, kind, mats, skills] of raw.bps) {
      const bp: Blueprint = { id, productId, qty, time, limit, reaction: kind === 1, mats: pairs(mats), skills: pairs(skills) };
      this.blueprints.set(id, bp);
      if (!this.byProduct.has(productId) || !bp.reaction) this.byProduct.set(productId, bp);
    }
    for (const [sourceId, time, mats, skills, encryption, outs] of raw.inv) {
      for (const [target, prob, runs] of outs) {
        if (this.inventions.has(target)) continue;
        this.inventions.set(target, { sourceId, time, mats: pairs(mats), skills: pairs(skills), encryption, prob, runs });
        (this.inventable.get(sourceId) ?? this.inventable.set(sourceId, []).get(sourceId)!).push(target);
      }
    }
    this.decryptors = raw.decryptors.map(([id, prob, me, te, runs]) => ({ id, prob, me, te, runs }));
    this.sorted = [...this.byProduct.values()].sort((a, b) => this.name(a.productId).localeCompare(this.name(b.productId)));
  }

  name(id: number): string {
    return this.names.get(id) ?? `#${id}`;
  }

  category(productId: number): string {
    return this.groups.get(this.groupOf.get(productId) ?? 0)?.[1] ?? '';
  }

  group(productId: number): string {
    return this.groups.get(this.groupOf.get(productId) ?? 0)?.[0] ?? '';
  }

  find(text: string): Blueprint | undefined {
    const q = fold(text.trim());
    if (!q) return undefined;
    return this.sorted.find((b) => fold(this.name(b.productId)) === q || fold(this.name(b.id)) === q) ?? (this.suggest(text, 2).length === 1 ? this.suggest(text, 1)[0] : undefined);
  }

  suggest(text: string, limit = 30): Blueprint[] {
    const q = fold(text.trim());
    if (!q) return [];
    const starts = this.sorted.filter((b) => fold(this.name(b.productId)).startsWith(q));
    const rest = starts.length >= limit ? [] : this.sorted.filter((b) => !starts.includes(b) && fold(this.name(b.productId)).includes(q));
    return [...starts, ...rest].slice(0, limit);
  }
}

let loading: Promise<IndustryData> | null = null;

export function loadIndustry(): Promise<IndustryData> {
  loading ??= fetchData('industry')
    .then((res) => {
      if (!res.ok) throw dataMissing(res.url);
      return res.json() as Promise<RawIndustry>;
    })
    .then((raw) => new IndustryData(raw))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

const ESI = 'https://esi.evetech.net/latest';
const HOUR = 60 * 60 * 1000;

let adjusted: { at: number; map: Map<number, number> } | null = null;

export async function adjustedPrices(): Promise<Map<number, number>> {
  if (adjusted && Date.now() - adjusted.at < HOUR) return adjusted.map;
  const res = await esiFetch(`${ESI}/markets/prices/?datasource=tranquility`);
  if (!res.ok) throw new Error(`ESI markets/prices: ${res.status}`);
  const list = (await res.json()) as { type_id: number; adjusted_price?: number }[];
  adjusted = { at: Date.now(), map: new Map(list.map((p) => [p.type_id, p.adjusted_price ?? 0])) };
  return adjusted.map;
}

export interface CostIndices {
  manufacturing: number;
  invention: number;
  reaction: number;
}

let indices: { at: number; map: Map<number, CostIndices> } | null = null;

export async function costIndices(): Promise<Map<number, CostIndices>> {
  if (indices && Date.now() - indices.at < HOUR) return indices.map;
  const res = await esiFetch(`${ESI}/industry/systems/?datasource=tranquility`);
  if (!res.ok) throw new Error(`ESI industry/systems: ${res.status}`);
  const list = (await res.json()) as { solar_system_id: number; cost_indices: { activity: string; cost_index: number }[] }[];
  const map = new Map<number, CostIndices>();
  for (const s of list) {
    const get = (a: string) => s.cost_indices.find((c) => c.activity === a)?.cost_index ?? 0;
    map.set(s.solar_system_id, { manufacturing: get('manufacturing'), invention: get('invention'), reaction: get('reaction') });
  }
  indices = { at: Date.now(), map };
  return map;
}

export interface OwnedBlueprint {
  item_id: number;
  type_id: number;
  location_id: number;
  location_flag: string;
  material_efficiency: number;
  time_efficiency: number;
  quantity: number;
  runs: number;
}

export interface IndustryJob {
  job_id: number;
  activity_id: number;
  blueprint_type_id: number;
  product_type_id?: number;
  runs: number;
  licensed_runs?: number;
  cost?: number;
  status: string;
  start_date: string;
  end_date: string;
  probability?: number;
  facility_id: number;
}

async function paged<T>(characterId: number, path: string): Promise<T[]> {
  const token = await accessToken(characterId);
  const get = async (page: number) => {
    const res = await esiFetch(`${ESI}${path}?datasource=tranquility&page=${page}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`ESI ${path}: ${res.status} ${await res.text()}`);
    return res;
  };
  const first = await get(1);
  const pages = Number(first.headers.get('x-pages')) || 1;
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => get(i + 2).then((r) => r.json() as Promise<T[]>)));
  return [...((await first.json()) as T[]), ...rest.flat()];
}

export const ownedBlueprints = (characterId: number) => paged<OwnedBlueprint>(characterId, `/characters/${characterId}/blueprints/`);

export const industryJobs = (characterId: number) => paged<IndustryJob>(characterId, `/characters/${characterId}/industry/jobs/`);

export interface Facility {
  me: number;
  te: number;
  costBonus: number;
  tax: number;
  index: CostIndices;
}

export interface Fees {
  salesTax: number;
  brokerFee: number;
}

export type Basis = 'sell' | 'buy';

export interface MatLine {
  id: number;
  base: number;
  qty: number;
  unit: number;
  total: number;
}

export interface BuildResult {
  bp: Blueprint;
  runs: number;
  units: number;
  mats: MatLine[];
  matCost: number;
  eiv: number;
  jobGross: number;
  jobBonus: number;
  jobTax: number;
  jobCost: number;
  baseTime: number;
  time: number;
  timeParts: { label: string; factor: number }[];
  invention: InventionResult | null;
  costUnit: number;
  sellUnit: number;
  buyUnit: number;
  netSellUnit: number;
  netBuyUnit: number;
  profitUnit: number;
  profitInstantUnit: number;
  margin: number;
  iskHour: number;
}

export interface InventionResult {
  inv: Invention;
  decryptor: Decryptor | null;
  chance: number;
  runs: number;
  me: number;
  te: number;
  mats: MatLine[];
  matCost: number;
  jobCost: number;
  attempt: number;
  perUnit: number;
  skillLevels: { id: number; level: number }[];
}

const priceOf = (p: Aggregates | undefined, basis: Basis) => (p ? (basis === 'sell' ? p.sellMin || p.buyMax : p.buyMax || p.sellMin) : 0);

export function materialQty(base: number, runs: number, me: number, facilityMe: number): number {
  return Math.max(runs, Math.ceil(Math.round(base * runs * (1 - me / 100) * (1 - facilityMe / 100) * 100) / 100));
}

export function eivOf(mats: [number, number][], runs: number, adjusted: Map<number, number>): number {
  return mats.reduce((a, [id, q]) => a + (adjusted.get(id) ?? 0) * q * runs, 0);
}

export function jobCostOf(eiv: number, index: number, f: Facility) {
  const gross = eiv * index;
  const bonus = gross * (f.costBonus / 100);
  const tax = eiv * (f.tax / 100 + SCC_SURCHARGE);
  return { gross, bonus, tax, total: gross - bonus + tax };
}

export function inventionChance(inv: Invention, skills: Map<number, number>, decryptor: Decryptor | null) {
  const science = inv.skills.filter(([id]) => id !== inv.encryption).map(([id]) => skills.get(id) ?? 0);
  const enc = skills.get(inv.encryption) ?? 0;
  return Math.min(1, inv.prob * (1 + science.reduce((a, b) => a + b, 0) / 30 + enc / 40) * (decryptor?.prob ?? 1));
}

export interface BuildInput {
  bp: Blueprint;
  runs: number;
  me: number;
  te: number;
  facility: Facility;
  basis: Basis;
  fees: Fees;
  skills: Map<number, number>;
  prices: Map<number, Aggregates>;
  adjusted: Map<number, number>;
  invention?: { inv: Invention; decryptor: Decryptor | null } | null;
  labels: { te: string; facility: string; skill: (id: number) => string };
}

export function computeBuild(input: BuildInput): BuildResult {
  const { bp, facility, basis, prices, adjusted, skills } = input;
  const runs = Math.max(1, Math.floor(input.runs) || 1);
  let me = input.me;
  let te = input.te;
  let invention: InventionResult | null = null;
  if (input.invention) {
    const { inv, decryptor } = input.invention;
    const chance = inventionChance(inv, skills, decryptor);
    me = 2 + (decryptor?.me ?? 0);
    te = 4 + (decryptor?.te ?? 0);
    const invRuns = Math.max(1, inv.runs + (decryptor?.runs ?? 0));
    const mats = inv.mats.map(([id, q]) => ({ id, base: q, qty: q, unit: priceOf(prices.get(id), basis), total: q * priceOf(prices.get(id), basis) }));
    if (decryptor) mats.push({ id: decryptor.id, base: 1, qty: 1, unit: priceOf(prices.get(decryptor.id), basis), total: priceOf(prices.get(decryptor.id), basis) });
    const matCost = mats.reduce((a, m) => a + m.total, 0);
    const jobCost = jobCostOf(eivOf(bp.mats, 1, adjusted) * INVENTION_EIV_SHARE, facility.index.invention, facility).total;
    const attempt = matCost + jobCost;
    invention = {
      inv, decryptor, chance, runs: invRuns, me, te, mats, matCost, jobCost, attempt,
      perUnit: chance > 0 ? attempt / chance / (invRuns * bp.qty) : 0,
      skillLevels: inv.skills.map(([id]) => ({ id, level: skills.get(id) ?? 0 })),
    };
  }
  const meApplied = bp.reaction ? 0 : me;
  const teApplied = bp.reaction ? 0 : te;
  const mats = bp.mats.map(([id, base]) => {
    const qty = materialQty(base, runs, meApplied, facility.me);
    const unit = priceOf(prices.get(id), basis);
    return { id, base, qty, unit, total: qty * unit };
  });
  const matCost = mats.reduce((a, m) => a + m.total, 0);
  const eiv = eivOf(bp.mats, runs, adjusted);
  const job = jobCostOf(eiv, bp.reaction ? facility.index.reaction : facility.index.manufacturing, facility);
  const timeParts: { label: string; factor: number }[] = [];
  if (teApplied) timeParts.push({ label: input.labels.te, factor: 1 - teApplied / 100 });
  const skillFactors: [number, number][] = bp.reaction ? [[SKILL_REACTIONS, 0.04]] : [[SKILL_INDUSTRY, 0.04], [SKILL_ADVANCED_INDUSTRY, 0.03]];
  for (const [id, per] of skillFactors) {
    const lvl = skills.get(id) ?? 0;
    if (lvl) timeParts.push({ label: input.labels.skill(id) + ` ${lvl}`, factor: 1 - per * lvl });
  }
  if (facility.te) timeParts.push({ label: input.labels.facility, factor: 1 - facility.te / 100 });
  const baseTime = bp.time * runs;
  const time = timeParts.reduce((t, p) => t * p.factor, baseTime);
  const units = runs * bp.qty;
  const costUnit = (matCost + job.total) / units + (invention?.perUnit ?? 0);
  const p = prices.get(bp.productId);
  const sellUnit = p?.sellMin ?? 0;
  const buyUnit = p?.buyMax ?? 0;
  const netSellUnit = sellUnit * (1 - (input.fees.salesTax + input.fees.brokerFee) / 100);
  const netBuyUnit = buyUnit * (1 - input.fees.salesTax / 100);
  const profitUnit = sellUnit ? netSellUnit - costUnit : 0;
  return {
    bp, runs, units, mats, matCost, eiv,
    jobGross: job.gross, jobBonus: job.bonus, jobTax: job.tax, jobCost: job.total,
    baseTime, time, timeParts, invention, costUnit, sellUnit, buyUnit, netSellUnit, netBuyUnit,
    profitUnit,
    profitInstantUnit: buyUnit ? netBuyUnit - costUnit : 0,
    margin: costUnit > 0 && sellUnit ? (profitUnit / costUnit) * 100 : 0,
    iskHour: time > 0 && sellUnit ? (profitUnit * units) / (time / 3600) : 0,
  };
}

export interface FacilityPreset {
  id: string;
  name: string;
  me: number;
  te: number;
  costBonus: number;
  reaction: boolean;
}

export const FACILITIES: FacilityPreset[] = [
  { id: 'npc', name: 'NPC Station', me: 0, te: 0, costBonus: 0, reaction: false },
  { id: 'raitaru', name: 'Raitaru', me: 1, te: 15, costBonus: 3, reaction: false },
  { id: 'azbel', name: 'Azbel', me: 1, te: 20, costBonus: 4, reaction: false },
  { id: 'sotiyo', name: 'Sotiyo', me: 1, te: 30, costBonus: 5, reaction: false },
  { id: 'athanor', name: 'Athanor', me: 0, te: 0, costBonus: 0, reaction: true },
  { id: 'tatara', name: 'Tatara', me: 0, te: 25, costBonus: 0, reaction: true },
];

export const RIG_ME: Record<string, number> = { none: 0, t1: 2, t2: 2.4 };
export const RIG_TE: Record<string, number> = { none: 0, t1: 20, t2: 24 };

export function securityFactor(sec: number | null): number {
  if (sec == null || sec >= 0.45) return 1;
  return sec > 0 ? 1.9 : 2.1;
}

export function facilityBonus(preset: FacilityPreset, rig: string, sec: number | null) {
  const k = securityFactor(sec);
  const rigMe = (RIG_ME[rig] ?? 0) * k;
  const rigTe = (RIG_TE[rig] ?? 0) * k;
  const me = 1 - (1 - preset.me / 100) * (1 - rigMe / 100);
  const te = 1 - (1 - preset.te / 100) * (1 - rigTe / 100);
  return { me: me * 100, te: te * 100, rigMe, rigTe };
}

export const ACTIVITY: Record<number, string> = {
  1: 'Manufacturing',
  3: 'TE Research',
  4: 'ME Research',
  5: 'Copying',
  8: 'Invention',
  9: 'Reaction',
  11: 'Reaction',
};
