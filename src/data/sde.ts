import { fold } from '../ui/fold';
import { tx } from '../i18n';
import { dataMissing, fetchData } from './manifest';

export interface RawModifier {
  f: string;
  d: string;
  op: number;
  to: number;
  from: number;
  g?: number;
  s?: number;
}

export interface RawEffect {
  i: number;
  n: string;
  cat: number;
  mods: RawModifier[];
  dur?: number;
  dis?: number;
  rng?: number;
  fal?: number;
  res?: number;
}

export interface RawAttribute {
  i: number;
  n: string;
  dn?: string;
  def: number;
  st: 0 | 1;
  hi: 0 | 1;
  max?: number;
  u?: number;
  pub?: 1;
  z?: 1;
  cat?: number;
}

export interface RawType {
  i: number;
  n: string;
  g: number;
  mg?: number;
  mt?: number;
  ml?: number;
  vp?: number;
  r?: number;
  f?: number;
  a: Record<string, number>;
  e: number[];
}

export interface RawSde {
  version: { build?: number; generated: string };
  categories: { i: number; n: string }[];
  groups: { i: number; n: string; c: number }[];
  attributes: RawAttribute[];
  effects: RawEffect[];
  types: RawType[];
  cloneGrades: { i: number; n: string; skills: Record<string, number> }[];
  units?: Record<string, string>;
  mutaplasmids?: RawMutaplasmid[];
  buffs?: RawBuff[];
  weathers?: RawWeather[];
}

export interface RawWeather {
  k: string;
  i: number;
  n: string;
  lvl: number;
  b: [number, number][];
}

export interface RawBuff {
  i: number;
  n?: string;
  op: string;
  agg: 'Maximum' | 'Minimum';
  item: number[];
  loc: number[];
  locGroup: [number, number][];
  locSkill: [number, number][];
}

export interface RawMutaplasmid {
  i: number;
  n: string;
  a: Record<string, [number, number]>;
  m: { from: number[]; to: number }[];
}

export interface Mutaplasmid {
  id: number;
  name: string;
  ranges: Map<number, [number, number]>;
  resultFor: Map<number, number>;
}

export const Category = {
  Ship: 6,
  Module: 7,
  Charge: 8,
  Skill: 16,
  Drone: 18,
  Implant: 20,
  Subsystem: 32,
  Fighter: 87,
} as const;

export const MODE_GROUP = 1306;

export interface TypeInfo {
  id: number;
  name: string;
  groupId: number;
  groupName: string;
  categoryId: number;
  marketGroupId?: number;
  metaGroupId?: number;
  metaLevel?: number;
  variationParentId?: number;
  raceId?: number;
  factionId?: number;
  attrs: Map<number, number>;
  effects: number[];
}

export interface AttributeInfo {
  id: number;
  name: string;
  displayName?: string;
  defaultValue: number;
  stackable: boolean;
  highIsGood: boolean;
  maxAttributeId?: number;
  unitId?: number;
  published: boolean;
  showWhenZero: boolean;
  categoryId?: number;
}

export interface EffectInfo {
  id: number;
  name: string;
  category: number;
  modifiers: RawModifier[];
  durationAttributeId?: number;
  dischargeAttributeId?: number;
  rangeAttributeId?: number;
  falloffAttributeId?: number;
  resistanceAttributeId?: number;
}

export class Sde {
  readonly build?: number;
  readonly types = new Map<number, TypeInfo>();
  readonly attributes = new Map<number, AttributeInfo>();
  readonly effects = new Map<number, EffectInfo>();
  readonly groups = new Map<number, { id: number; name: string; categoryId: number }>();
  readonly units: Map<number, string>;
  readonly cloneGrades: { id: number; name: string; skills: Map<number, number> }[];
  readonly mutaplasmids = new Map<number, Mutaplasmid>();
  readonly buffs = new Map<number, RawBuff>();
  readonly weathers: RawWeather[];
  private readonly mutaplasmidsByBase = new Map<number, Mutaplasmid[]>();
  private readonly abyssalBase = new Map<number, number[]>();
  private readonly attrByName = new Map<string, number>();
  private readonly effectByName = new Map<string, number>();
  private readonly typeByName = new Map<string, number>();

  constructor(raw: RawSde) {
    this.build = raw.version.build;
    for (const g of raw.groups) this.groups.set(g.i, { id: g.i, name: g.n, categoryId: g.c });
    for (const a of raw.attributes) {
      this.attributes.set(a.i, {
        id: a.i, name: a.n, displayName: a.dn, defaultValue: a.def,
        stackable: a.st === 1, highIsGood: a.hi === 1, maxAttributeId: a.max, unitId: a.u,
        published: a.pub === 1, showWhenZero: a.z === 1, categoryId: a.cat,
      });
      this.attrByName.set(a.n, a.i);
    }
    for (const e of raw.effects) {
      this.effects.set(e.i, {
        id: e.i, name: e.n, category: e.cat, modifiers: e.mods,
        durationAttributeId: e.dur, dischargeAttributeId: e.dis, rangeAttributeId: e.rng, falloffAttributeId: e.fal, resistanceAttributeId: e.res,
      });
      this.effectByName.set(e.n, e.i);
    }
    for (const t of raw.types) {
      const group = this.groups.get(t.g);
      const attrs = new Map<number, number>();
      for (const [k, v] of Object.entries(t.a)) attrs.set(Number(k), v);
      this.types.set(t.i, {
        id: t.i, name: t.n, groupId: t.g, groupName: group?.name ?? '', categoryId: group?.categoryId ?? 0,
        marketGroupId: t.mg, metaGroupId: t.mt, metaLevel: t.ml, variationParentId: t.vp, raceId: t.r, factionId: t.f, attrs, effects: t.e,
      });
      this.typeByName.set(fold(t.n), t.i);
    }
    this.units = new Map(Object.entries(raw.units ?? {}).map(([k, v]) => [Number(k), v]));
    this.cloneGrades = raw.cloneGrades.map((c) => ({
      id: c.i, name: c.n, skills: new Map(Object.entries(c.skills).map(([k, v]) => [Number(k), v])),
    }));
    for (const b of raw.buffs ?? []) this.buffs.set(b.i, b);
    this.weathers = raw.weathers ?? [];
    for (const m of raw.mutaplasmids ?? []) {
      const mp: Mutaplasmid = {
        id: m.i,
        name: m.n,
        ranges: new Map(Object.entries(m.a).map(([k, v]) => [Number(k), v])),
        resultFor: new Map(m.m.flatMap((x) => x.from.map((f) => [f, x.to] as [number, number]))),
      };
      this.mutaplasmids.set(mp.id, mp);
      for (const x of m.m) {
        for (const f of x.from) {
          const list = this.mutaplasmidsByBase.get(f);
          if (list) list.push(mp); else this.mutaplasmidsByBase.set(f, [mp]);
          const bases = this.abyssalBase.get(x.to);
          if (bases) { if (!bases.includes(f)) bases.push(f); } else this.abyssalBase.set(x.to, [f]);
        }
      }
    }
  }

  attrId(name: string): number {
    const id = this.attrByName.get(name);
    if (id == null) throw new Error(tx('Atribut necunoscut: {name}', { name }));
    return id;
  }

  hasAttr(name: string): boolean {
    return this.attrByName.has(name);
  }

  effectId(name: string): number | undefined {
    return this.effectByName.get(name);
  }

  type(id: number): TypeInfo {
    const t = this.types.get(id);
    if (!t) throw new Error(tx('Item necunoscut în datele de fitting: {id}', { id }));
    return t;
  }

  findType(name: string): TypeInfo | undefined {
    const id = this.typeByName.get(fold(name.trim()));
    return id == null ? undefined : this.types.get(id);
  }

  baseAttr(typeId: number, attrId: number): number {
    const v = this.types.get(typeId)?.attrs.get(attrId);
    return v ?? this.attributes.get(attrId)?.defaultValue ?? 0;
  }

  hasEffect(typeId: number, effectName: string): boolean {
    const id = this.effectByName.get(effectName);
    return id != null && (this.types.get(typeId)?.effects.includes(id) ?? false);
  }

  variations(typeId: number): TypeInfo[] {
    const t = this.types.get(typeId);
    if (!t) return [];
    const parent = t.variationParentId ?? t.id;
    if (!this.variationIndex) {
      this.variationIndex = new Map();
      for (const x of this.types.values()) {
        const p = x.variationParentId ?? x.id;
        const list = this.variationIndex.get(p);
        if (list) list.push(x); else this.variationIndex.set(p, [x]);
      }
    }
    const list = this.variationIndex.get(parent) ?? [t];
    return [...list].sort((a, b) => (a.metaLevel ?? 0) - (b.metaLevel ?? 0) || a.name.localeCompare(b.name));
  }

  private variationIndex?: Map<number, TypeInfo[]>;

  mutaplasmidsFor(baseTypeId: number): Mutaplasmid[] {
    return this.mutaplasmidsByBase.get(baseTypeId) ?? [];
  }

  isAbyssal(typeId: number): boolean {
    return this.abyssalBase.has(typeId);
  }

  abyssalBases(abyssalTypeId: number): number[] {
    return this.abyssalBase.get(abyssalTypeId) ?? [];
  }

  modesFor(shipId: number): TypeInfo[] {
    const ship = this.types.get(shipId);
    if (!ship) return [];
    return [...this.types.values()].filter((t) => t.groupId === MODE_GROUP && t.name.startsWith(`${ship.name} `)).sort((a, b) => a.name.localeCompare(b.name));
  }

  typesInCategory(categoryId: number): TypeInfo[] {
    return [...this.types.values()].filter((t) => t.categoryId === categoryId);
  }
}

let loading: Promise<Sde> | null = null;

export function loadSde(): Promise<Sde> {
  loading ??= fetchData('sde')
    .then((res) => {
      if (!res.ok) throw dataMissing(res.url);
      return res.json() as Promise<RawSde>;
    })
    .then((raw) => new Sde(raw))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
