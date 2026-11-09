import { loadJson, saveJson, removeKey } from '../storage';
import { lang } from '../i18n';
import type { Dmg } from './missions';
import { effective, type NpcStandings, type SocialSkills } from './npcStandings';

export interface ArcText { ro: string; en: string }
export type ArcShip = [string, string, string, string[], string];
export interface ArcWave { l: ArcText; d: string; s: ArcShip[] }
export interface ArcReward { isk?: number[]; bonus?: number[] | null; bh?: number }
export interface ArcMission {
  n: string; t: 'enc' | 'talk' | 'courier' | 'choice'; sys?: string; agent?: string; to?: string;
  obj?: ArcText; carry?: ArcText; ship?: ArcText; steps: ArcText[]; notes?: ArcText[];
  remote?: 1; hard?: 1; fac?: string[]; dealt?: Dmg[]; weak?: Dmg[]; rw?: ArcReward; w?: ArcWave[]; eu?: string;
}
export interface ArcChoice { c: ArcText; p: { l: ArcText; s: ArcNode[] }[] }
export type ArcNode = string | ArcChoice;
export interface ArcStart { agent: string; corp: string; sys: string; where?: string; mission: string; need: ArcText }
export interface Arc {
  id: string; name: string; fac: string; level: number; icon?: string;
  start: { agent: string; corp: string; station: string; sys: string };
  starts?: ArcStart[];
  standing: ArcText; space: ArcText; time: ArcText; ship: ArcText; reward: ArcText; intro: ArcText;
  tips: ArcText[];
  chapters: { name: string; steps: ArcNode[] }[];
  m: Record<string, ArcMission>;
  eu: string | null;
}
export interface ArcData { arcs: Arc[] }

export interface ArcProgress { d: string[]; p: Record<string, number>; at?: number }
export type ArcDone = Record<string, ArcProgress>;

export const COOLDOWN_DAYS = 90;

let loading: Promise<ArcData> | null = null;

export function loadEpicArcs(): Promise<ArcData> {
  loading ??= import('../data/epicArcs.json').then((m) => m.default as unknown as ArcData).catch((e) => { loading = null; throw e; });
  return loading;
}

export const pickArc = (t: ArcText | undefined | null) => (t ? (lang === 'en' ? t.en : t.ro || t.en) : '');

const key = (charKey: string) => `eve-epic:done:${charKey}`;

export function loadArcDone(charKey: string): ArcDone {
  return loadJson<ArcDone>(key(charKey), {});
}

export function saveArcDone(charKey: string, d: ArcDone) {
  saveJson(key(charKey), d);
}

export function forgetEpicArcs(charKey: string) {
  removeKey(key(charKey));
}

export const isChoice = (n: ArcNode): n is ArcChoice => typeof n !== 'string';

export type RouteItem = { k: 'm'; title: string; ch: number } | { k: 'c'; key: string; node: ArcChoice; ch: number };

export function route(arc: Arc, prog: ArcProgress | undefined, guess = false): RouteItem[] {
  const out: RouteItem[] = [];
  const walk = (nodes: ArcNode[], prefix: string, ch: number): boolean => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!isChoice(n)) { out.push({ k: 'm', title: n, ch }); continue; }
      const k = `${prefix}.${i}`;
      const idx = prog?.p[k];
      if (idx == null || !n.p[idx]) {
        if (!guess) { out.push({ k: 'c', key: k, node: n, ch }); return false; }
        if (!walk(n.p[0].s, `${k}.0`, ch)) return false;
        continue;
      }
      if (!walk(n.p[idx].s, `${k}.${idx}`, ch)) return false;
    }
    return true;
  };
  for (let c = 0; c < arc.chapters.length; c++) if (!walk(arc.chapters[c].steps, String(c), c)) break;
  return out;
}

export function arcStats(arc: Arc, prog: ArcProgress | undefined) {
  const done = new Set(prog?.d ?? []);
  const items = route(arc, prog, true).filter((r): r is Extract<RouteItem, { k: 'm' }> => r.k === 'm');
  const total = items.length;
  const sum = items.filter((r) => done.has(r.title)).length;
  const next = route(arc, prog).find((r) => r.k === 'c' || !done.has(r.title));
  return { total, sum, next, finished: !next && total > 0 };
}

export interface ArcGate { agent: number; corp: number; faction: number }
export interface ArcReq { need: number; starts: ArcGate[] }

export const ARC_REQ: Record<string, ArcReq> = {
  angel: { need: 3, starts: [{ agent: 3019465, corp: 1000054, faction: 500002 }, { agent: 3019466, corp: 1000084, faction: 500003 }, { agent: 3019467, corp: 1000138, faction: 500011 }] },
  guristas: { need: 3, starts: [{ agent: 3019463, corp: 1000121, faction: 500004 }, { agent: 3019462, corp: 1000004, faction: 500001 }, { agent: 3019464, corp: 1000127, faction: 500010 }] },
  amarr: { need: 5, starts: [{ agent: 3019415, corp: 1000082, faction: 500003 }] },
  caldari: { need: 5, starts: [{ agent: 3019396, corp: 1000023, faction: 500001 }] },
  gallente: { need: 5, starts: [{ agent: 3019412, corp: 1000105, faction: 500004 }] },
  minmatar: { need: 5, starts: [{ agent: 3019411, corp: 1000049, faction: 500002 }] },
};

export type GateVia = 'agent' | 'corp' | 'faction';
export interface GateCheck { i: number; ok: boolean; v: Record<GateVia, number>; base: Record<GateVia, number | undefined>; best: number; via: GateVia; low: GateVia[] }
export interface ArcAccess { need: number; checks: GateCheck[]; ok: boolean; top: GateCheck; unlock: { skill: keyof SocialSkills; level: number } | null }

const VIA: GateVia[] = ['agent', 'corp', 'faction'];

function checkGate(st: NpcStandings, skills: SocialSkills, g: ArcGate, need: number, i: number): GateCheck {
  const base = { agent: st.agent.get(g.agent), corp: st.corp.get(g.corp), faction: st.faction.get(g.faction) };
  const v = { agent: effective(base.agent, g.faction, skills), corp: effective(base.corp, g.faction, skills), faction: effective(base.faction, g.faction, skills) };
  const via = VIA.reduce((a, b) => (v[b] > v[a] ? b : a));
  const low = VIA.filter((k) => v[k] <= -2);
  return { i, ok: !low.length && v[via] >= need, v, base, best: v[via], via, low };
}

function evaluate(req: ArcReq, st: NpcStandings, skills: SocialSkills) {
  const checks = req.starts.map((g, i) => checkGate(st, skills, g, req.need, i));
  const rank = (c: GateCheck) => (c.ok ? 1e3 : 0) - c.low.length * 100 + c.best;
  const top = checks.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  return { checks, top, ok: checks.some((c) => c.ok) };
}

export function arcAccess(arcId: string, st: NpcStandings, skills: SocialSkills): ArcAccess | null {
  const req = ARC_REQ[arcId];
  if (!req) return null;
  const r = evaluate(req, st, skills);
  let unlock: ArcAccess['unlock'] = null;
  if (!r.ok) {
    const order: (keyof SocialSkills)[] = ['connections', 'criminal', 'diplomacy'];
    outer: for (let lvl = 1; lvl <= 5; lvl++) {
      for (const sk of order) {
        if (skills[sk] >= lvl) continue;
        if (evaluate(req, st, { ...skills, [sk]: lvl }).ok) { unlock = { skill: sk, level: lvl }; break outer; }
      }
    }
  }
  return { need: req.need, ...r, unlock };
}

export interface ArcLimit { m: string[]; r: ArcText }
export interface ArcShips { tier: ArcText; hull: ArcText; ships: string[]; limits: ArcLimit[] }

const T3D: ArcText = { ro: 'Cel mult distrugătoare, inclusiv T3', en: 'Destroyers and below, T3 included' };
const T1D: ArcText = { ro: 'Doar fregate T1/T2 și distrugătoare T1', en: 'T1/T2 frigates and T1 destroyers only' };

export const ARC_SHIPS: Record<string, ArcShips> = {
  soe: {
    tier: { ro: 'Pilot nou', en: 'New pilot' }, hull: { ro: 'Distrugător T1', en: 'T1 destroyer' },
    ships: ['Catalyst', 'Coercer', 'Cormorant', 'Thrasher'], limits: [],
  },
  air: {
    tier: { ro: 'Pilot nou', en: 'New pilot' }, hull: { ro: 'Fregată standard T1', en: 'T1 standard frigate' },
    ships: ['Merlin', 'Rifter', 'Punisher', 'Tristan'],
    limits: [
      { m: ['Caldari Prime Breakout'], r: { ro: 'Doar fregate standard Caldari', en: 'Caldari standard frigates only' } },
      { m: ['Battle of Pator'], r: { ro: 'Doar fregate standard Minmatar', en: 'Minmatar standard frigates only' } },
      { m: ['Golgothan Fields'], r: { ro: 'Doar fregate standard Amarr', en: 'Amarr standard frigates only' } },
      { m: ['Intaki Liberation'], r: { ro: 'Doar fregate standard Gallente', en: 'Gallente standard frigates only' } },
    ],
  },
  ore: {
    tier: { ro: 'Pilot nou', en: 'New pilot' }, hull: { ro: 'Venture, apoi Pioneer', en: 'Venture, then Pioneer' },
    ships: ['Venture', 'Pioneer'],
    limits: [{ m: ['Pioneering Spirit'], r: { ro: 'Doar Pioneer', en: 'Pioneer only' } }],
  },
  angel: {
    tier: { ro: 'Pilot mediu, null-sec', en: 'Mid pilot, null-sec' }, hull: { ro: 'Fregată sau distrugător', en: 'Frigate or destroyer' },
    ships: ['Svipul', 'Thrasher', 'Wolf', 'Stiletto'],
    limits: [{ m: ['Clear the Way', 'Natural Consequences', 'Rabbit Trap', 'Salvage Heist'], r: T3D }],
  },
  guristas: {
    tier: { ro: 'Pilot mediu, null-sec', en: 'Mid pilot, null-sec' }, hull: { ro: 'Fregată sau distrugător T1', en: 'Frigate or T1 destroyer' },
    ships: ['Corax', 'Hawk', 'Crow', 'Caldari Shuttle'],
    limits: [
      { m: ['Dread Pirates', 'Rabbit Hole', 'Foxfire', 'Fuel Gauge', 'Miscommunication', 'Smoke and Mirrors', 'Spy Games'], r: T1D },
      { m: ['Passing the Buck'], r: T3D },
      { m: ['Knockout Punch'], r: { ro: 'Doar shuttle', en: 'Shuttle only' } },
    ],
  },
  amarr: {
    tier: { ro: 'Pilot avansat, L4', en: 'Advanced pilot, L4' }, hull: { ro: 'Battleship, HAC sau T3C', en: 'Battleship, HAC or T3C' },
    ships: ['Paladin', 'Apocalypse Navy Issue', 'Legion', 'Zealot'], limits: [],
  },
  caldari: {
    tier: { ro: 'Pilot avansat, L4', en: 'Advanced pilot, L4' }, hull: { ro: 'Battleship, HAC sau T3C', en: 'Battleship, HAC or T3C' },
    ships: ['Golem', 'Raven Navy Issue', 'Tengu', 'Cerberus', 'Crow', 'Crane'], limits: [],
  },
  gallente: {
    tier: { ro: 'Pilot avansat, L4', en: 'Advanced pilot, L4' }, hull: { ro: 'Battleship cu rază mare', en: 'Long range battleship' },
    ships: ['Vargur', 'Paladin', 'Tengu', 'Ishtar', 'Purifier'],
    limits: [{ m: ['Rendezvous'], r: { ro: 'Cel mult battlecruiser T2', en: 'T2 battlecruisers and below' } }],
  },
  minmatar: {
    tier: { ro: 'Pilot avansat, L4', en: 'Advanced pilot, L4' }, hull: { ro: 'Battleship sniper', en: 'Sniping battleship' },
    ships: ['Vargur', 'Maelstrom', 'Loki', 'Muninn'],
    limits: [{ m: ['Church Of The Obsidian', 'Friends In High Places'], r: { ro: 'Cel mult battleship', en: 'Battleships and below' } }],
  },
};

export function missionLimit(arcId: string, title: string): ArcText | null {
  return ARC_SHIPS[arcId]?.limits.find((l) => l.m.includes(title))?.r ?? null;
}
