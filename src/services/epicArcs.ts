import { loadJson, saveJson, removeKey } from '../storage';
import { lang } from '../i18n';
import type { Dmg } from './missions';

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
