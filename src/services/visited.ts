import { loadJson, saveJson } from '../storage';
import { fold } from '../ui/fold';
import { loadStoredCharacters } from '../character/characters';
import { hasScope } from '../character/sso';
import { characterLocation } from '../character/esi';
import { ZARZAKH, POCHVEN_REGION, type NavMap, type NavSystem } from './navigation';
import type { SystemActivity } from './recon';

export type Visit = [number, number, number];

interface VisitStore {
  v: 1;
  who: string[];
  path: Visit[];
  seen: Record<string, Record<string, number>>;
}

export interface VisitEntry { who: string; systemId: number; time: number }

export type RiskLevel = 'safe' | 'risky' | 'yolo';

export interface ExplorePlan {
  path: number[];
  fresh: number[];
  waypoints: number[];
  jumps: number;
  risky: number[];
}

const KEY = 'eve-nav:visited';
const MAX_PATH = 20_000;
const POLL_MS = 30_000;
const LOCATION_SCOPE = 'esi-location.read_location.v1';
export const MANUAL = '';
export const WH_REGION = 11_000_000;

const listeners = new Set<() => void>();
let cache: VisitStore | null = null;
let timer = 0;

const empty = (): VisitStore => ({ v: 1, who: [], path: [], seen: {} });

function store(): VisitStore {
  if (!cache) {
    const s = loadJson<VisitStore | null>(KEY, null);
    cache = s && s.v === 1 && Array.isArray(s.path) ? s : empty();
  }
  return cache;
}

function persist() {
  const s = store();
  if (s.path.length > MAX_PATH) s.path.splice(0, s.path.length - MAX_PATH);
  saveJson(KEY, s);
  listeners.forEach((fn) => fn());
}

function whoIndex(s: VisitStore, who: string): number {
  let i = s.who.indexOf(who);
  if (i < 0) { i = s.who.length; s.who.push(who); }
  return i;
}

function markSeen(s: VisitStore, w: number, systemId: number, sec: number) {
  const seen = (s.seen[w] ??= {});
  const prev = seen[systemId];
  if (prev == null || sec < prev) seen[systemId] = sec;
}

export function onVisitsChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reloadVisits() {
  cache = null;
  listeners.forEach((fn) => fn());
}

export function visitors(): string[] {
  const s = store();
  return s.who.filter((w, i) => w !== MANUAL && (s.path.some((p) => p[2] === i) || Object.keys(s.seen[i] ?? {}).length));
}

export function hasManual(): boolean {
  const s = store();
  const i = s.who.indexOf(MANUAL);
  return i >= 0 && Object.keys(s.seen[i] ?? {}).length > 0;
}

export function visitedSet(who?: string, since = 0): Map<number, number> {
  const s = store();
  const out = new Map<number, number>();
  const sinceSec = Math.floor(since / 1000);
  s.who.forEach((w, i) => {
    if (who != null && w !== who && w !== MANUAL) return;
    if (since && w !== MANUAL) return;
    for (const [id, t] of Object.entries(s.seen[i] ?? {})) {
      const sys = Number(id);
      const prev = out.get(sys);
      if (prev == null || t < prev) out.set(sys, t);
    }
  });
  if (since) {
    for (const [sys, t, w] of s.path) {
      if (t < sinceSec || (who != null && s.who[w] !== who)) continue;
      if (!out.has(sys)) out.set(sys, t);
    }
  }
  return out;
}

export function visitCounts(who?: string): Map<number, number> {
  const s = store();
  const out = new Map<number, number>();
  for (const [sys, , w] of s.path) {
    if (who != null && s.who[w] !== who) continue;
    out.set(sys, (out.get(sys) ?? 0) + 1);
  }
  return out;
}

export function pathFor(who?: string, since = 0): { who: string; visits: { systemId: number; time: number }[] }[] {
  const s = store();
  const sinceSec = Math.floor(since / 1000);
  const by = new Map<number, { systemId: number; time: number }[]>();
  for (const [sys, t, w] of s.path) {
    if (t < sinceSec) continue;
    if (who != null && s.who[w] !== who) continue;
    (by.get(w) ?? by.set(w, []).get(w)!).push({ systemId: sys, time: t * 1000 });
  }
  return [...by.entries()].map(([w, visits]) => ({ who: s.who[w], visits: visits.sort((a, b) => a.time - b.time) }));
}

export function lastPosition(who: string): { systemId: number; time: number } | null {
  const s = store();
  const w = s.who.indexOf(who);
  if (w < 0) return null;
  let best: Visit | null = null;
  for (const p of s.path) if (p[2] === w && (!best || p[1] >= best[1])) best = p;
  return best ? { systemId: best[0], time: best[1] * 1000 } : null;
}

export function recordVisit(who: string, systemId: number, time = Date.now()): boolean {
  if (!who || !systemId) return false;
  const s = store();
  const w = whoIndex(s, who);
  const sec = Math.floor(time / 1000);
  let last: Visit | null = null;
  for (let i = s.path.length - 1; i >= 0; i--) if (s.path[i][2] === w) { last = s.path[i]; break; }
  if (last && last[0] === systemId) return false;
  s.path.push([systemId, sec, w]);
  markSeen(s, w, systemId, sec);
  persist();
  return true;
}

export function importVisits(entries: VisitEntry[]): { added: number; systems: number } {
  const s = store();
  const before = new Set<number>();
  for (const seen of Object.values(s.seen)) for (const id of Object.keys(seen)) before.add(Number(id));
  const keys = new Set(s.path.map((p) => `${p[2]}:${p[0]}:${p[1]}`));
  const start = s.path.length;
  for (const e of entries) {
    const w = whoIndex(s, e.who);
    const sec = Math.floor(e.time / 1000);
    markSeen(s, w, e.systemId, sec);
    const k = `${w}:${e.systemId}:${sec}`;
    if (keys.has(k)) continue;
    keys.add(k);
    s.path.push([e.systemId, sec, w]);
  }
  s.path.sort((a, b) => a[1] - b[1]);
  const cleaned: Visit[] = [];
  const lastBy = new Map<number, number>();
  for (const p of s.path) {
    if (lastBy.get(p[2]) === p[0]) continue;
    lastBy.set(p[2], p[0]);
    cleaned.push(p);
  }
  s.path = cleaned;
  const after = new Set<number>();
  for (const seen of Object.values(s.seen)) for (const id of Object.keys(seen)) after.add(Number(id));
  persist();
  return { added: Math.max(0, s.path.length - start), systems: after.size - before.size };
}

export function setManual(systemId: number, on: boolean) {
  const s = store();
  if (on) {
    markSeen(s, whoIndex(s, MANUAL), systemId, Math.floor(Date.now() / 1000));
  } else {
    for (const seen of Object.values(s.seen)) delete seen[systemId];
  }
  persist();
}

export function clearVisits(who?: string) {
  if (who == null) {
    cache = empty();
    persist();
    return;
  }
  const s = store();
  const w = s.who.indexOf(who);
  if (w < 0) return;
  s.path = s.path.filter((p) => p[2] !== w);
  delete s.seen[w];
  persist();
}

export function visitStats(): { entries: number; bytes: number } {
  const s = store();
  return { entries: s.path.length, bytes: JSON.stringify(s).length };
}

async function pollLocations() {
  clearTimeout(timer);
  const chars = loadStoredCharacters().filter((c) => c.characterId && hasScope(c.characterId, LOCATION_SCOPE));
  await Promise.all(chars.map(async (c) => {
    try {
      const loc = await characterLocation(c.characterId!);
      if (loc?.solar_system_id) recordVisit(c.name, loc.solar_system_id);
    } catch {
      return;
    }
  }));
  timer = window.setTimeout(pollLocations, POLL_MS);
}

export function startVisitTracker() {
  if (timer) return;
  timer = window.setTimeout(pollLocations, 3000);
}

export function trackNow() {
  return pollLocations();
}

const LINE = /^\s*\[\s*(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s*\]\s*(.*)$/;
const LISTENER = /^\s*(?:Listener|Empfänger|Auditeur|Слушатель|リスナー|청취자)\s*:\s*(.+?)\s*$/im;
const JUMP = /Jumping from\s+(.+?)\s+to\s+(.+?)\s*$/i;
const UNDOCK = /Undocking from\s+.+?\s+to\s+(.+?)\s+solar system/i;

export async function readLogFile(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const utf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf.length > 3 && buf[1] === 0 && buf[3] === 0);
  return new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(buf).replace(/^﻿/, '');
}

export const isLogFile = (name: string) => /\.txt$/i.test(name) && (/^Local_/i.test(name) || /^\d{8}_\d{6}/.test(name));

export function parseLog(text: string, fileName: string, map: NavMap, fallbackWho = ''): VisitEntry[] {
  const who = LISTENER.exec(text)?.[1]?.trim() || fallbackWho;
  if (!who) return [];
  const isLocal = /^Local_/i.test(fileName) || /Channel ID:\s*local\b/i.test(text);
  const out: VisitEntry[] = [];
  const pick = (name: string) => map.find(name.replace(/<[^>]+>/g, '').replace(/\*+$/, '').trim());
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const time = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const body = m[7].replace(/<[^>]+>/g, '');
    if (isLocal) {
      const gt = body.indexOf(' > ');
      if (gt < 0) continue;
      const speaker = body.slice(0, gt);
      if (!/EVE|Sistem|Систем/i.test(speaker)) continue;
      const colon = body.lastIndexOf(':');
      if (colon < gt) continue;
      const s = pick(body.slice(colon + 1));
      if (s && fold(s.name) === fold(body.slice(colon + 1).replace(/\*+$/, '').trim())) out.push({ who, systemId: s.id, time });
      continue;
    }
    const j = JUMP.exec(body);
    if (j) {
      const a = pick(j[1]);
      const b = pick(j[2]);
      if (a && b) {
        out.push({ who, systemId: a.id, time: time - 1000 });
        out.push({ who, systemId: b.id, time });
      }
      continue;
    }
    const u = UNDOCK.exec(body);
    if (u) {
      const s = pick(u[1]);
      if (s) out.push({ who, systemId: s.id, time });
    }
  }
  return out;
}

export const EXORDIUM_REGION = 10001004;
export const isKspace = (s: NavSystem) => s.regionId < WH_REGION && s.regionId !== EXORDIUM_REGION;

export function allowedFor(level: RiskLevel, s: NavSystem): boolean {
  if (!isKspace(s) || s.id === ZARZAKH) return false;
  if (level === 'safe') return s.sec >= 0.45 && s.regionId !== POCHVEN_REGION;
  if (level === 'risky') return s.sec > 0 && s.regionId !== POCHVEN_REGION;
  return true;
}

function systemCost(level: RiskLevel, s: NavSystem, a?: SystemActivity): number {
  const pvp = a ? a.ship + a.pod : 0;
  if (level === 'safe') return 1 + (pvp >= 1 ? 25 : 0);
  if (level === 'risky') return 1 + (s.sec < 0.45 ? 1 : 0) + (pvp >= 5 || (a?.pod ?? 0) >= 3 ? 20 : pvp >= 1 ? 4 : 0);
  return 1;
}

export function isRiskyStop(level: RiskLevel, a?: SystemActivity): boolean {
  if (!a) return false;
  const pvp = a.ship + a.pod;
  return level === 'safe' ? pvp >= 1 : pvp >= 5 || a.pod >= 3;
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

export function planExplore(map: NavMap, start: number, visited: Set<number>, level: RiskLevel, count: number, opts: { region?: number; activity?: Map<number, SystemActivity> } = {}): ExplorePlan {
  const seen = new Set(visited);
  seen.add(start);
  const ok = (s: NavSystem) => isKspace(s) && s.id !== ZARZAKH;
  const isTarget = (s: NavSystem) => allowedFor(level, s) && !seen.has(s.id) && (!opts.region || s.regionId === opts.region);
  const path: number[] = [start];
  const fresh: number[] = [];
  const waypoints: number[] = [];
  let cur = start;
  while (fresh.length < count) {
    const dist = new Map<number, number>([[cur, 0]]);
    const prev = new Map<number, number>();
    const heap = new Heap();
    heap.push(0, cur);
    let found: number | null = null;
    while (heap.size) {
      const [d, id] = heap.pop();
      if (d > (dist.get(id) ?? Infinity)) continue;
      const s = map.systems.get(id);
      if (id !== cur && s && isTarget(s)) { found = id; break; }
      for (const n of map.gates.get(id) ?? []) {
        const ns = map.systems.get(n);
        if (!ns || !ok(ns)) continue;
        const nd = d + systemCost(level, ns, opts.activity?.get(n)) + (allowedFor(level, ns) ? 0 : 40);
        if (nd < (dist.get(n) ?? Infinity)) { dist.set(n, nd); prev.set(n, id); heap.push(nd, n); }
      }
    }
    if (found == null) break;
    const leg: number[] = [];
    for (let x: number | undefined = found; x != null && x !== cur; x = prev.get(x)) leg.push(x);
    leg.reverse();
    for (const id of leg) {
      path.push(id);
      const s = map.systems.get(id)!;
      if (!seen.has(id) && allowedFor(level, s) && (!opts.region || s.regionId === opts.region)) { seen.add(id); fresh.push(id); }
      else seen.add(id);
    }
    waypoints.push(found);
    cur = found;
  }
  const risky = path.filter((id, i) => i > 0 && (isRiskyStop(level, opts.activity?.get(id)) || !allowedFor(level, map.systems.get(id)!)));
  return { path, fresh, waypoints, jumps: path.length - 1, risky };
}

export function demoHistory(route: [number, number][], who: string, end = Date.now() - 3 * 3_600_000): VisitEntry[] {
  return route.map(([systemId, ago]) => ({ who, systemId, time: end - ago * 1000 }));
}
