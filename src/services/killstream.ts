import { loadJson, saveJson } from '../storage';
import { summarizeKill, isCapsule, isGateLocation, type EsiKillmail, type KillSummary, type ZkbMeta } from './recon';

const R2Z2 = 'https://r2z2.zkillboard.com/ephemeral';
const CACHE_KEY = 'eve-live:kills';
export const WINDOW_MS = 60 * 60 * 1000;
const MAX_BACKFILL = 1600;
const MAX_GAP = 1200;
const BATCH = 16;
const IDLE_MS = 5000;
const MAX_STEP = 1 << 22;
const MAX_FAILS = 2;
const PROBE_EVERY = 12;
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

interface R2Z2Kill { killmail_id: number; hash: string; esi: EsiKillmail; zkb: ZkbMeta; sequence_id?: number }

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

async function r2z2(path: string, init?: RequestInit): Promise<Response> {
  if (limited()) throw new Error('zKillboard R2Z2');
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP;
  if (at > now) await sleep(at - now);
  const res = await fetch(`${R2Z2}/${path}`, init).catch(() => null);
  if (!res || res.status === 429) {
    bannedUntil = Date.now() + BAN_MS;
    throw new Error('zKillboard R2Z2');
  }
  return res;
}

async function fetchSeq(seq: number): Promise<R2Z2Kill | null> {
  try {
    const res = await r2z2(`${seq}.json`);
    return res.ok ? ((await res.json()) as R2Z2Kill) : null;
  } catch (e) {
    if (limited()) throw e;
    return null;
  }
}

const exists = async (seq: number) => hasKill(await fetchSeq(seq));

async function head(): Promise<number> {
  try {
    const res = await r2z2('sequence.json', { cache: 'no-store' });
    if (!res.ok) return 0;
    return ((await res.json()) as { sequence: number }).sequence || 0;
  } catch (e) {
    if (limited()) throw e;
    return 0;
  }
}

async function findHead(from: number): Promise<number> {
  let lo = from;
  let step = 16;
  while (step <= MAX_STEP && (await exists(lo + step))) {
    lo += step;
    step *= 2;
  }
  let hi = lo + step;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(mid)) lo = mid; else hi = mid;
  }
  return lo;
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
  let misses = 0;
  let fails = 0;
  while (running) {
    if (paused) { await sleep(1000); continue; }
    const r = await fetchSeq(lastSeq + 1);
    if (hasKill(r)) {
      lastSeq++;
      misses = 0;
      fails = 0;
      add(toLive(r), true);
      goLive();
      persist();
      continue;
    }
    if (++misses >= PROBE_EVERY) {
      misses = 0;
      if (await head()) {
        fails = 0;
        goLive();
        if ((await findHead(lastSeq)) > lastSeq) lastSeq++;
      } else if (++fails >= MAX_FAILS) {
        setStatus({ state: 'error', error: 'zKillboard R2Z2' });
      }
    }
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
