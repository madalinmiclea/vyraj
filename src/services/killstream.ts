import { loadJson, saveJson, isDemo } from '../storage';
import { summarizeKill, isCapsule, isGateLocation, type EsiKillmail, type KillSummary, type ZkbMeta } from './recon';

const R2Z2 = 'https://r2z2.zkillboard.com/ephemeral';
const CACHE_KEY = 'eve-live:kills';
export const WINDOW_MS = 60 * 60 * 1000;
const MAX_BACKFILL = 1600;
const MAX_GAP = 1200;
const BATCH = 16;
const IDLE_MS = 5000;

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

async function fetchSeq(seq: number): Promise<R2Z2Kill | null> {
  try {
    const res = await fetch(`${R2Z2}/${seq}.json`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2Z2 ${res.status}`);
    return (await res.json()) as R2Z2Kill;
  } catch {
    return null;
  }
}

async function head(): Promise<number> {
  const res = await fetch(`${R2Z2}/sequence.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`zKillboard R2Z2: ${res.status}`);
  return ((await res.json()) as { sequence: number }).sequence;
}

async function findHead(from: number): Promise<number> {
  let lo = from;
  let step = 16;
  while (step < 4096 && (await fetchSeq(lo + step))?.esi) {
    lo += step;
    step *= 2;
  }
  let hi = lo + step;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await fetchSeq(mid))?.esi) lo = mid; else hi = mid;
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
      if (!r?.esi) continue;
      const k = toLive(r);
      if (k.time >= cut) recent++;
      add(k, false);
    }
    loaded += batch.length;
    seq -= batch.length;
    setStatus({ loaded: kills.size });
    if (!recent && got.some((r) => r?.esi)) break;
  }
}

async function runDemo() {
  setStatus({ state: 'backfill', loaded: 0, error: undefined });
  const feed = await (await import('../demo/liveFeed')).createDemoFeed();
  for (const k of feed.backfill(WINDOW_MS)) add(k, false);
  setStatus({ state: 'live', loaded: kills.size });
  while (running) {
    if (paused) { await sleep(1000); continue; }
    const { kill, wait } = feed.next();
    add(kill, true);
    await sleep(wait);
    prune();
  }
}

async function run() {
  if (isDemo()) return runDemo();
  setStatus({ state: 'backfill', loaded: kills.size, error: undefined });
  let seq: number;
  try {
    seq = await findHead(await head());
  } catch (err) {
    setStatus({ state: 'error', error: (err as Error).message });
    running = false;
    return;
  }
  const cached = loadJson<{ seq: number; at: number; kills: LiveKill[] } | null>(CACHE_KEY, null);
  let stopAt = 0;
  if (cached && cached.seq && Date.now() - cached.at < WINDOW_MS && seq - cached.seq < MAX_GAP) {
    for (const k of cached.kills) add(k, false);
    stopAt = Math.min(cached.seq, seq);
    lastSeq = cached.seq;
  }
  await backfill(seq, stopAt || seq - MAX_BACKFILL);
  lastSeq = Math.max(lastSeq, seq);
  setStatus({ state: 'live', loaded: kills.size });
  persist();
  let misses = 0;
  while (running) {
    if (paused) { await sleep(1000); continue; }
    const r = await fetchSeq(lastSeq + 1);
    if (r?.esi) {
      lastSeq++;
      misses = 0;
      add(toLive(r), true);
      if (status.state !== 'live') setStatus({ state: 'live' });
      persist();
      continue;
    }
    misses++;
    if (misses > 20) {
      try {
        const h = await head();
        if (h > lastSeq + 1) lastSeq = h - 1;
      } catch {
        setStatus({ state: 'error', error: 'zKillboard R2Z2' });
      }
      misses = 0;
    }
    await sleep(IDLE_MS);
    prune();
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
