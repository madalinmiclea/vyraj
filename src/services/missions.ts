import { lang, tx } from '../i18n';
import { fold } from '../ui/fold';

export type Dmg = 'em' | 'th' | 'kin' | 'exp';
export type ShipClass = 'F' | 'D' | 'C' | 'BC' | 'BS' | 'EF' | 'EC' | 'ST' | 'TW' | 'DR' | 'O';
export type Flag = 'trig' | 'web' | 'scram' | 'disrupt' | 'damp' | 'ecm' | 'neut' | 'td' | 'tp' | 'obj' | 'loot' | 'aggro' | 'passive';
export type Ewar = 'web' | 'scram' | 'disrupt' | 'damp' | 'ecm' | 'neut' | 'td' | 'tp';
export type Section = 'l1' | 'l2' | 'l3' | 'l4' | 'l5' | 'story' | 'ded';
export type Intensity = 'e' | 'm' | 'h' | 'x';

export interface MText { en: string; ro: string }
export interface MList { en: string[]; ro: string[] }
export type MShip = [string, ShipClass, string, Flag[]];
export interface MGroup { l: MText; d?: string | null; s: MShip[] }
export type InfoKey = 'type' | 'space' | 'dealt' | 'dmg' | 'ships' | 'setup' | 'extras' | 'web' | 'diff' | 'obj' | 'limit' | 'bounty' | 'enemy';
export type MCell = [string, number?, number?];
export interface MRow { h?: number; c: MCell[] }
export interface MRoom { n: MText; gate?: string | null; g: MGroup[]; w?: MList; x?: MList; i?: [InfoKey, string, string?][]; t?: MRow[][] }

export interface MVariant {
  id: string;
  fac: string[];
  dealt?: Dmg[];
  weak?: Dmg[];
  ewar?: Ewar[];
  rooms?: MRoom[];
  obj?: MText;
  blitz?: MList;
  tips?: MList;
  bounty?: string | null;
  loot?: string | null;
  lootList?: string[];
  es?: string;
  eu?: string;
}

export interface MGuide { obj?: string; rooms?: string; gates?: string; steps?: string[]; stepsNote?: string; notes?: string[]; blitz?: boolean; home?: boolean }

export interface MBonus { k: 'room' | 'key'; t: MText; key?: MText; get?: MText; gives?: MText; opt?: boolean; used?: boolean }

export interface Mission {
  key: string;
  name: string;
  level: number;
  story?: boolean;
  courier?: boolean;
  rating?: number;
  ship?: MText;
  sig?: MText;
  found?: MText;
  escal?: string;
  eu?: string;
  guide?: MGuide;
  bonus?: MBonus[];
  variants: MVariant[];
  range?: [number, number];
  total?: number;
  parts?: Mission[];
}

export interface MissionData { missions: Mission[] }

export interface Faction { id: string; name: string; empire?: string; weak: Dmg[]; shoot: Dmg[]; ewar: Ewar[]; npc?: string }

export const FACTIONS: Faction[] = [
  { id: 'angel', name: 'Angel Cartel', weak: ['exp', 'kin'], shoot: ['exp', 'kin'], ewar: ['web', 'tp'], npc: 'angel' },
  { id: 'blood', name: 'Blood Raiders', weak: ['em', 'th'], shoot: ['em', 'th'], ewar: ['neut', 'td'], npc: 'blood' },
  { id: 'guristas', name: 'Guristas', weak: ['kin', 'th'], shoot: ['kin', 'th'], ewar: ['ecm'], npc: 'guristas' },
  { id: 'sansha', name: "Sansha's Nation", weak: ['em', 'th'], shoot: ['em', 'th'], ewar: ['neut', 'td'], npc: 'sansha' },
  { id: 'serpentis', name: 'Serpentis', weak: ['th', 'kin'], shoot: ['kin', 'th'], ewar: ['damp'], npc: 'serpentis' },
  { id: 'drones', name: 'Rogue Drones', weak: ['em', 'th'], shoot: ['exp', 'kin'], ewar: [], npc: 'drones' },
  { id: 'mercs', name: 'Mercenaries', weak: ['kin', 'th'], shoot: ['kin', 'th'], ewar: ['web', 'scram'] },
  { id: 'mordu', name: "Mordu's Legion", weak: ['kin', 'th'], shoot: ['kin', 'em'], ewar: ['scram', 'ecm'], npc: 'mordu' },
  { id: 'eom', name: 'Equilibrium of Mankind', weak: ['kin', 'th'], shoot: ['kin', 'th'], ewar: [] },
  { id: 'concord', name: 'CONCORD', weak: ['kin', 'th'], shoot: ['kin', 'th'], ewar: ['web', 'scram'] },
  { id: 'rogue', name: 'Rogue Pirates', weak: ['kin', 'th'], shoot: ['kin', 'th'], ewar: [] },
  { id: 'sotsg', name: 'Scions of the Superior Gene', weak: ['em', 'th'], shoot: ['em', 'th'], ewar: [] },
  { id: 'thukker', name: 'Thukker Tribe', weak: ['exp', 'th'], shoot: ['exp', 'kin'], ewar: ['web'], npc: 'thukker' },
  { id: 'amarr', name: 'Amarr Empire', empire: 'Amarr', weak: ['em', 'th'], shoot: ['em', 'th'], ewar: ['neut', 'tp'], npc: 'amarr' },
  { id: 'khanid', name: 'Khanid Kingdom', empire: 'Amarr', weak: ['em', 'th'], shoot: ['em', 'th'], ewar: ['neut'], npc: 'khanid' },
  { id: 'ammatar', name: 'Ammatar Mandate', empire: 'Amarr', weak: ['em', 'th'], shoot: ['em', 'th'], ewar: ['neut'], npc: 'amarr' },
  { id: 'caldari', name: 'Caldari State', empire: 'Caldari', weak: ['kin', 'th'], shoot: ['kin', 'th'], ewar: ['ecm'], npc: 'caldari' },
  { id: 'gallente', name: 'Gallente Federation', empire: 'Gallente', weak: ['th', 'kin'], shoot: ['kin', 'th'], ewar: ['damp'], npc: 'gallente' },
  { id: 'minmatar', name: 'Minmatar Republic', empire: 'Minmatar', weak: ['exp', 'kin'], shoot: ['exp', 'kin'], ewar: ['web', 'tp'], npc: 'minmatar' },
];

export const EMPIRES = ['Amarr', 'Caldari', 'Gallente', 'Minmatar'] as const;

export const DMG_ORDER: Dmg[] = ['em', 'th', 'kin', 'exp'];

export const SECTIONS: { id: Section | 'all'; label: string }[] = [
  { id: 'all', label: tx('Toate') },
  { id: 'l1', label: tx('Nivel {v}', { v: 1 }) },
  { id: 'l2', label: tx('Nivel {v}', { v: 2 }) },
  { id: 'l3', label: tx('Nivel {v}', { v: 3 }) },
  { id: 'l4', label: tx('Nivel {v}', { v: 4 }) },
  { id: 'l5', label: tx('Nivel {v}', { v: 5 }) },
  { id: 'story', label: tx('Storyline') },
  { id: 'ded', label: tx('Complexe DED') },
];

export const INTENSITY: Record<Intensity, string> = { e: tx('Ușoară'), m: tx('Medie'), h: tx('Grea'), x: tx('Fără luptă') };

export const CLASS_LABEL: Record<ShipClass, string> = {
  F: tx('Fregată'), D: tx('Distrugător'), C: tx('Crucișător'), BC: tx('Battlecruiser'), BS: tx('Battleship'),
  EF: tx('Fregată elite'), EC: tx('Crucișător elite'), ST: tx('Structură'), TW: tx('Turn / santinelă'), DR: tx('Dronă'), O: tx('Altele'),
};

export const FLAG_LABEL: Record<Flag, string> = {
  trig: tx('Trigger'), web: 'Web', scram: 'Scram', disrupt: tx('Disruptor'), damp: tx('Damp'), ecm: 'ECM', neut: 'Neut', td: tx('Tracking disruptor'),
  tp: tx('Target painter'), obj: tx('Obiectiv'), loot: tx('Loot'), aggro: tx('Atacă la sosire'), passive: tx('Pasiv'),
};

export const EWAR_LABEL: Record<Ewar, string> = {
  web: tx('Web (te încetinește)'), scram: tx('Scram (oprește MWD și warp)'), disrupt: tx('Warp disruptor'), damp: tx('Sensor dampener (rază de lock mai mică)'),
  ecm: tx('ECM (îți pierzi lock-ul)'), neut: tx('Neut (îți golește capacitorul)'), td: tx('Tracking disruptor'), tp: tx('Target painter'),
};

export const INFO_LABEL: Record<InfoKey, string> = {
  type: tx('Tip misiune'), space: tx('Spațiu'), dealt: tx('Daune primite'), dmg: tx('Daune recomandate'), ships: tx('Nave recomandate'), setup: tx('Echipare recomandată'),
  extras: tx('Extra'), web: 'Web / scram', diff: tx('Dificultate'), obj: tx('Obiectiv'), limit: tx('Nave permise'), bounty: 'Bounty', enemy: tx('Inamic'),
};

export const NPC_HEAD: Record<string, string> = {
  Qty: tx('Nr.'), Name: tx('Nume'), Orbit: tx('Orbită'), 'Orbit (km)': tx('Orbită (km)'), 'Max velocity': tx('Viteză max.'),
  'Shield (hp)': tx('Scut (HP)'), 'Armor (hp)': tx('Armură (HP)'), 'Structure (hp)': tx('Structură (HP)'),
  'Shield resist (%)': tx('Rezistențe scut (%)'), 'Armor resist (%)': tx('Rezistențe armură (%)'), 'Shield & armor resist (%)': tx('Rezistențe scut și armură (%)'),
  'DPS (hp/s)': 'DPS (HP/s)', 'Group DPS': tx('DPS grup'), Bounty: 'Bounty', Weapon: tx('Armă'), 'Shield boost': tx('Boost scut'),
  'Chance (%)': tx('Șansă (%)'), 'Amount (hp)': tx('Cantitate (HP)'), 'Duration (s)': tx('Durată (s)'), EM: 'EM', Exp: tx('Expl.'), Kin: tx('Cin.'), Th: tx('Term.'),
};

const CLASS_WEIGHT: Record<ShipClass, number> = { F: 1, D: 1.5, C: 3, BC: 5, BS: 10, EF: 3, EC: 6, ST: 0, TW: 2, DR: 1, O: 2 };

let loading: Promise<MissionData> | null = null;

export function loadMissions(): Promise<MissionData> {
  loading ??= import('../data/missions.json').then((m) => m.default as unknown as MissionData).catch((e) => { loading = null; throw e; });
  return loading;
}

export const pick = (t: MText | undefined | null) => (t ? (lang === 'en' ? t.en : t.ro || t.en) : '');
export const pickList = (t: MList | undefined | null) => (t ? (lang === 'en' ? t.en : t.ro?.length ? t.ro : t.en) : []);

export function faction(id: string): Faction {
  return FACTIONS.find((f) => f.id === id) ?? { id, name: id, weak: [], shoot: [], ewar: [] };
}

export function sectionOf(m: Mission): Section {
  if (m.rating) return 'ded';
  if (m.story) return 'story';
  return `l${Math.min(5, Math.max(1, m.level))}` as Section;
}

export function shipCount(n: string): number {
  const nums = String(n).match(/\d+/g)?.map(Number) ?? [1];
  return nums.length > 1 ? (nums[0] + nums[1]) / 2 : nums[0];
}

export function variantWeight(v: MVariant): number {
  let w = 0;
  for (const r of v.rooms ?? []) for (const g of r.g) for (const s of g.s) w += shipCount(s[0]) * (CLASS_WEIGHT[s[1]] ?? 2);
  const ewar = new Set(v.ewar ?? []);
  if (ewar.has('neut')) w *= 1.15;
  if (ewar.has('scram') || ewar.has('disrupt')) w *= 1.1;
  if (ewar.has('ecm')) w *= 1.1;
  return w;
}

export function intensities(missions: Mission[]): Map<string, Intensity> {
  const out = new Map<string, Intensity>();
  const bySection = new Map<Section, { key: string; w: number }[]>();
  for (const m of missions) {
    const w = Math.max(0, ...m.variants.map(variantWeight));
    if (!w) { out.set(m.key, m.variants.some((v) => v.rooms?.length) ? 'e' : 'x'); continue; }
    const s = sectionOf(m);
    const bucket = m.rating ? `ded${m.rating}` : s;
    const list = bySection.get(bucket as Section) ?? [];
    list.push({ key: m.key, w });
    bySection.set(bucket as Section, list);
  }
  for (const list of bySection.values()) {
    const sorted = [...list].sort((a, b) => a.w - b.w);
    sorted.forEach((x, i) => {
      const p = sorted.length > 1 ? i / (sorted.length - 1) : 0.5;
      out.set(x.key, p < 0.34 ? 'e' : p < 0.67 ? 'm' : 'h');
    });
  }
  return out;
}

export function dealtOf(v: MVariant): Dmg[] {
  if (v.dealt?.length) return v.dealt;
  const all = v.fac.flatMap((f) => faction(f).shoot);
  return [...new Set(all)];
}

export function weakOf(v: MVariant): Dmg[] {
  if (v.weak?.length) return v.weak;
  const all = v.fac.flatMap((f) => faction(f).weak);
  return [...new Set(all)];
}

export function ewarOf(v: MVariant): Ewar[] {
  const set = new Set<Ewar>(v.ewar ?? []);
  for (const r of v.rooms ?? []) for (const g of r.g) for (const s of g.s) for (const f of s[3]) if (f in EWAR_LABEL) set.add(f as Ewar);
  return [...set];
}

export function empiresOf(v: MVariant): string[] {
  return [...new Set(v.fac.map((f) => faction(f).empire).filter((e): e is string => !!e))];
}

export function hasBlitz(m: Mission): boolean {
  return m.variants.some((v) => pickList(v.blitz).length > 0);
}

export function searchText(m: Mission): string {
  return fold(m.name.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

export const ES_URL = 'https://eve-survival.org/?wakka=';
export const EU_URL = 'https://wiki.eveuniversity.org/';

interface NamePart { base: string; from?: number; to?: number; total?: number }

export function parseChainName(name: string): NamePart {
  const n = name.trim();
  let r = n.match(/^(.*?)\s*\(P(\d+) of (.+)\)$/i);
  if (r) return { base: r[3].trim(), from: +r[2], to: +r[2] };
  r = n.match(/^(.*?)\s*\((\d+)(?:\s*-\s*(\d+))?\s+of\s+(\d+)\)$/i);
  if (r) return { base: r[1], from: +r[2], to: +(r[3] ?? r[2]), total: +r[4] };
  r = n.match(/^(.*?)\s*\((\d+)\s*-\s*(\d+)\)$/);
  if (r) return { base: r[1], from: +r[2], to: +r[3] };
  r = n.match(/^(.*?)\s+part\s+(\d+)\s+to\s+(\d+)$/i);
  if (r) return { base: r[1], from: +r[2], to: +r[3] };
  r = n.match(/^(.*?)\s+(\d+)\s*-\s*(\d+)$/);
  if (r) return { base: r[1], from: +r[2], to: +r[3] };
  return { base: n };
}

export const chainBase = (name: string) => parseChainName(name).base;

function roomRange(m: Mission): { from?: number; to?: number; total?: number } {
  let from: number | undefined;
  let to: number | undefined;
  let total: number | undefined;
  let unlabeledFirst = false;
  for (const v of m.variants) {
    (v.rooms ?? []).forEach((r, i) => {
      const t = r.n?.en ?? '';
      const nums: number[] = [];
      for (const x of t.matchAll(/\bparts?\s+(\d+)(?:\s+(?:to|-)\s+(\d+))?/gi)) { nums.push(+x[1]); if (x[2]) nums.push(+x[2]); }
      for (const x of t.matchAll(/\((\d+)\s+of\s+(\d+)\)/gi)) nums.push(+x[1]);
      for (const x of t.matchAll(/\bof\s+(\d+)\b/gi)) total = Math.max(total ?? 0, +x[1]);
      if (!nums.length) { if (i === 0) unlabeledFirst = true; return; }
      from = Math.min(from ?? Infinity, ...nums);
      to = Math.max(to ?? 0, ...nums);
    });
  }
  if (from !== undefined && unlabeledFirst) from = 1;
  return { from, to, total };
}

export function mergeChains(list: Mission[]): Mission[] {
  const groups = new Map<string, { m: Mission; p: NamePart }[]>();
  for (const m of list) {
    const p = m.rating ? { base: m.name } : parseChainName(m.name);
    const k = `${p.base.toLowerCase()}|${m.level}|${m.rating ?? 0}`;
    const g = groups.get(k);
    if (g) g.push({ m, p }); else groups.set(k, [{ m, p }]);
  }
  const out: Mission[] = [];
  for (const g of groups.values()) {
    if (g.length > 1 && g.every((x) => x.p.from === undefined && x.m.name === g[0].m.name)) { out.push(...g.map((x) => x.m)); continue; }
    if (g.length === 1) {
      const { m, p } = g[0];
      const rr = roomRange(m);
      const from = Math.min(p.from ?? Infinity, rr.from ?? Infinity);
      const to = Math.max(p.to ?? 0, rr.to ?? 0);
      const isChain = p.from !== undefined || (rr.from !== undefined && to > from);
      out.push(isChain && Number.isFinite(from) ? { ...m, name: p.base, range: [from, Math.max(from, to)], total: Math.max(p.total ?? 0, rr.total ?? 0, to) } : m);
      continue;
    }
    const items = g.map(({ m, p }) => {
      const rr = roomRange(m);
      const from = p.from ?? rr.from ?? 1;
      const to = p.to ?? Math.max(rr.to ?? 0, from);
      return { m, from, to, total: Math.max(p.total ?? 0, rr.total ?? 0) };
    }).sort((a, b) => a.from - b.from || a.to - b.to);
    const from = items[0].from;
    const to = Math.max(...items.map((x) => x.to));
    const total = Math.max(to, ...items.map((x) => x.total));
    const parts = items.map((x) => ({ ...x.m, range: [x.from, x.to] as [number, number], total }));
    const first = parts[0];
    const ships = [...new Set(parts.map((x) => x.ship?.en ?? ''))];
    out.push({
      key: `${first.key}-chain`,
      name: g[0].p.base,
      level: first.level,
      story: parts.some((x) => x.story) || undefined,
      courier: parts.every((x) => x.courier) || undefined,
      ship: ships.length === 1 && ships[0] ? first.ship : undefined,
      bonus: parts.flatMap((x) => x.bonus ?? []),
      guide: parts.some((x) => x.guide?.blitz) ? { blitz: true } : undefined,
      variants: parts.flatMap((x) => x.variants),
      range: [from, to],
      total,
      parts,
    });
  }
  return out;
}

export const rangeLabel = (m: Mission) => (m.range ? `(${m.range[0] === m.range[1] ? m.range[0] : `${m.range[0]}-${m.range[1]}`})` : '');
