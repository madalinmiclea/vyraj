import { loadJson, saveJson } from '../storage';
import { summarizeKill, isCapsule, isGateLocation, type EsiKillmail, type KillSummary, type ZkbMeta } from './recon';

const R2Z2 = 'https://r2z2.zkillboard.com/ephemeral';
const CACHE_KEY = 'eve-live:kills';
export const WINDOW_MS = 60 * 60 * 1000;
const MAX_BACKFILL = 1600;
const MAX_GAP = 1200;
const BATCH = 16;
const IDLE_MS = 6000;
const RATE_MS = 5500;
const RATE_MIN = 1000;
const RATE_MAX = 120_000;
const SEEK_STEPS = 12;
const SEEK_SHARE = 0.8;
const SEEK_MIN = 8;
const LAG = 2;
const AHEAD_MAX = 40;
const SKEW_MAX = 10 * 60_000;
const RATE_SPAN = 15 * 60_000;
const SLOW_MAX = 8;
const RESEEK_MS = 10 * 60_000;
const RETRY_MIN = 5000;
const RETRY_MAX = 60_000;
const MIN_GAP = 100;
const BAN_MS = 60_000;

export interface LiveKill extends KillSummary {
  hash: string;
  victimChar?: number;
  pod: boolean;
  onGate: boolean;
}

export type StreamState = 'idle' | 'backfill' | 'live' | 'error';

export interface StreamStatus { state: StreamState; loaded: number; lastKill: number; error?: string }

type KillListener = (k: LiveKill, live: boolean) => void;
type StatusListener = (s: StreamStatus) => void;

interface R2Z2Kill { killmail_id: number; hash: string; esi: EsiKillmail; zkb: ZkbMeta; sequence_id?: number; uploaded_at?: number }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const kills = new Map<number, LiveKill>();
const killListeners = new Set<KillListener>();
const statusListeners = new Set<StatusListener>();
let status: StreamStatus = { state: 'idle', loaded: 0, lastKill: 0 };
let running = false;
let paused = false;
let lastSeq = 0;
let saveTimer = 0;
let retryDelay = RETRY_MIN;
let nextSlot = 0;
let bannedUntil = 0;
let rate = RATE_MS;
let skew = Infinity;
let headUp = 0;
const missed = new Set<number>();
const marks: [number, number][] = [];
let slow = 1;

function setStatus(patch: Partial<StreamStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((fn) => fn(status));
}

function prune() {
  const cut = Date.now() - WINDOW_MS;
  for (const [id, k] of kills) if (k.time < cut) kills.delete(id);
}

function persist() {
  if (saveTimer) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    prune();
    saveJson(CACHE_KEY, { seq: lastSeq, at: Date.now(), kills: [...kills.values()] });
  }, 15_000);
}

function toLive(r: R2Z2Kill): LiveKill {
  const base = summarizeKill(r.killmail_id, r.esi, r.zkb);
  return { ...base, hash: r.hash ?? r.zkb.hash, victimChar: r.esi.victim.character_id, pod: isCapsule(base.victimShip), onGate: isGateLocation(base.location) };
}

function add(k: LiveKill, live: boolean) {
  if (kills.has(k.id) || k.time < Date.now() - WINDOW_MS) return;
  kills.set(k.id, k);
  if (k.time > status.lastKill) status.lastKill = k.time;
  killListeners.forEach((fn) => fn(k, live));
}

const hasKill = (r: R2Z2Kill | null): r is R2Z2Kill => !!r?.esi;

const limited = () => bannedUntil > Date.now();

function ban(): never {
  bannedUntil = Date.now() + BAN_MS;
  throw new Error('zKillboard R2Z2');
}

async function r2z2(path: string, init?: RequestInit): Promise<Response | null> {
  if (limited()) throw new Error('zKillboard R2Z2');
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP;
  if (at > now) await sleep(at - now);
  const res = await fetch(`${R2Z2}/${path}`, init).catch(() => null);
  if (res?.status === 429) ban();
  return res;
}

async function reachable(): Promise<boolean> {
  const res = await r2z2('sequence.json', { cache: 'no-store' });
  return !!res?.ok;
}

async function fetchSeq(seq: number): Promise<R2Z2Kill | null> {
  try {
    const res = await r2z2(`${seq}.json`);
    if (!res) {
      if (!(await reachable())) ban();
      return null;
    }
    return res.ok ? ((await res.json()) as R2Z2Kill) : null;
  } catch (e) {
    if (limited()) throw e;
    return null;
  }
}

async function head(): Promise<number> {
  try {
    const res = await r2z2('sequence.json', { cache: 'no-store' });
    if (!res) ban();
    if (!res.ok) return 0;
    return ((await res.json()) as { sequence: number }).sequence || 0;
  } catch (e) {
    if (limited()) throw e;
    return 0;
  }
}

const uploaded = (r: R2Z2Kill) => (r.uploaded_at ?? 0) * 1000;

function observe(r: R2Z2Kill) {
  const up = uploaded(r);
  const gap = Date.now() - up;
  if (up && Math.abs(gap) < SKEW_MAX) skew = Math.min(skew, gap);
}

const serverNow = () => Date.now() - Math.min(0, skew);

const clampRate = (ms: number) => Math.min(RATE_MAX, Math.max(RATE_MIN, ms));

function mark(seq: number, up: number) {
  const last = marks[marks.length - 1];
  if (!up || (last && (seq <= last[0] || up < last[1]))) return;
  marks.push([seq, up]);
  while (marks.length > 2 && up - marks[1][1] > RATE_SPAN) marks.shift();
  const [s0, u0] = marks[0];
  if (seq > s0 && up > u0) rate = clampRate((up - u0) / (seq - s0));
}

async function probe(seq: number): Promise<R2Z2Kill | null> {
  if (missed.has(seq)) return null;
  const r = await fetchSeq(seq);
  if (!hasKill(r)) {
    missed.add(seq);
    return null;
  }
  observe(r);
  return r;
}

async function findHead(from: number): Promise<number> {
  let seq = 0;
  let up = 0;
  for (let at = from; at > from - 8 && !seq; at--) {
    const r = await probe(at);
    if (r) {
      seq = at;
      up = uploaded(r) || Date.now();
      mark(seq, uploaded(r));
    }
  }
  if (!seq) throw new Error('zKillboard R2Z2');
  for (let i = 0; i < SEEK_STEPS; i++) {
    const step = Math.floor(((serverNow() - up) / rate) * SEEK_SHARE);
    if (step < SEEK_MIN) break;
    const r = await probe(seq + step);
    if (!r) break;
    const next = uploaded(r);
    seq += step;
    mark(seq, next);
    up = Math.max(up, next);
  }
  headUp = up;
  return seq;
}

async function follow() {
  if (serverNow() - headUp > RESEEK_MS) {
    const seq = await findHead(lastSeq);
    await backfill(seq, lastSeq);
    lastSeq = Math.max(lastSeq, seq);
    persist();
    return;
  }
  const elapsed = (serverNow() - headUp) / (rate * slow);
  let ahead = 0;
  while (ahead < AHEAD_MAX && ahead + 1 + LAG * Math.sqrt(ahead + 1) + LAG <= elapsed) ahead++;
  if (ahead < 1) return;
  const from = lastSeq;
  let found = 0;
  let foundUp = 0;
  for (let next = from + 1; next <= from + ahead && running && !paused; next++) {
    const r = await probe(next);
    if (!r) continue;
    add(toLive(r), true);
    mark(next, uploaded(r));
    found = next;
    foundUp = Math.max(foundUp, uploaded(r));
  }
  if (!found) {
    slow = Math.min(slow * 1.5, SLOW_MAX);
    return;
  }
  slow = 1;
  headUp = foundUp > headUp ? foundUp : headUp + (found - from) * rate;
  lastSeq = found;
  for (const m of missed) if (m <= lastSeq) missed.delete(m);
  persist();
}

async function backfill(from: number, stopAt: number) {
  const cut = Date.now() - WINDOW_MS;
  let seq = from;
  let loaded = 0;
  while (seq > stopAt && loaded < MAX_BACKFILL && !paused) {
    const batch = Array.from({ length: Math.min(BATCH, seq - stopAt) }, (_, i) => seq - i);
    const got = await Promise.all(batch.map(fetchSeq));
    let recent = 0;
    for (const r of got) {
      if (!hasKill(r)) continue;
      const k = toLive(r);
      if (k.time >= cut) recent++;
      add(k, false);
    }
    loaded += batch.length;
    seq -= batch.length;
    setStatus({ loaded: kills.size });
    if (!recent && got.some(hasKill)) break;
  }
}

function goLive() {
  retryDelay = RETRY_MIN;
  if (status.state !== 'live' || status.error) setStatus({ state: 'live', loaded: kills.size, error: undefined });
}

async function stream() {
  if (status.state !== 'error') setStatus({ state: 'backfill', loaded: kills.size, error: undefined });
  const cached = lastSeq ? null : loadJson<{ seq: number; at: number; kills: LiveKill[] } | null>(CACHE_KEY, null);
  const fresh = cached && cached.seq && Date.now() - cached.at < WINDOW_MS ? cached : null;
  const start = Math.max(await head(), lastSeq, fresh?.seq ?? 0);
  if (!start) throw new Error('zKillboard R2Z2');
  const seq = await findHead(start);
  let stopAt = lastSeq;
  if (!stopAt && fresh && seq - fresh.seq < MAX_GAP) {
    for (const k of fresh.kills) add(k, false);
    stopAt = Math.min(fresh.seq, seq);
  }
  await backfill(seq, stopAt || seq - MAX_BACKFILL);
  lastSeq = Math.max(lastSeq, seq);
  goLive();
  persist();
  while (running) {
    if (paused) { await sleep(1000); continue; }
    await follow();
    goLive();
    await sleep(IDLE_MS);
    prune();
  }
}

async function run() {
  while (running) {
    try {
      await stream();
      return;
    } catch (err) {
      setStatus({ state: 'error', error: (err as Error).message });
      await sleep(Math.max(retryDelay, bannedUntil - Date.now()));
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX);
    }
  }
}

export function startKillStream() {
  paused = false;
  if (running) return;
  running = true;
  run();
}

export function setStreamPaused(p: boolean) {
  paused = p;
  if (!p) startKillStream();
}

export const streamPaused = () => paused;

export function onKill(fn: KillListener) {
  killListeners.add(fn);
  return () => killListeners.delete(fn);
}

export function onStreamStatus(fn: StatusListener) {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

export function liveKills(sinceMs = WINDOW_MS): LiveKill[] {
  const cut = Date.now() - sinceMs;
  return [...kills.values()].filter((k) => k.time >= cut).sort((a, b) => b.time - a.time);
}

export const streamStatus = () => status;

const FRESH_CACHE = 5 * 60_000;

export function feedKills(systemId: number, sinceMs = WINDOW_MS): LiveKill[] | null {
  const cut = Date.now() - sinceMs;
  if (status.state === 'live' && !paused) return [...kills.values()].filter((k) => k.systemId === systemId && k.time >= cut);
  const cached = loadJson<{ seq: number; at: number; kills: LiveKill[] } | null>(CACHE_KEY, null);
  if (!cached?.seq || Date.now() - cached.at > FRESH_CACHE) return null;
  return cached.kills.filter((k) => k.systemId === systemId && k.time >= cut);
}
