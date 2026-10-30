import { loadJson, saveJson, isDemo } from '../storage';
import { summarizeKill, isCapsule, isGateLocation, type EsiKillmail, type KillSummary, type ZkbMeta } from './recon';

const FEED = `${(import.meta.env.VITE_R2Z2_URL || 'https://vyraj-r2z2.vyraj.workers.dev').replace(/\/+$/, '')}/recent`;
const CACHE_KEY = 'eve-live:kills';
export const WINDOW_MS = 60 * 60 * 1000;
const POLL_MS = 60_000;
const WARM_MS = 4000;
const DEMO_LEAD = 30_000;
const DEMO_GAP = 60_000;
const DEMO_TICK_MS = 6000;
const RETRY_MIN = 5000;
const RETRY_MAX = 60_000;

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

interface R2Z2Kill { killmail_id: number; hash: string; esi: EsiKillmail; zkb: ZkbMeta }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const kills = new Map<number, LiveKill>();
const killListeners = new Set<KillListener>();
const statusListeners = new Set<StatusListener>();
let status: StreamStatus = { state: 'idle', loaded: 0, lastKill: 0 };
let running = false;
let paused = false;
let retryDelay = RETRY_MIN;

function setStatus(patch: Partial<StreamStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((fn) => fn(status));
}

function prune() {
  const cut = Date.now() - WINDOW_MS;
  for (const [id, k] of kills) if (k.time < cut) kills.delete(id);
}

function persist(head: number) {
  prune();
  saveJson(CACHE_KEY, { at: Date.now(), head, kills: [...kills.values()] });
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

function goLive() {
  retryDelay = RETRY_MIN;
  if (status.state !== 'live' || status.error) setStatus({ state: 'live', loaded: kills.size, error: undefined });
}

type SnapshotRow = [number, string, string, number, number[], number[][], number[]];
type FeedRow = [number, ...SnapshotRow];
interface FeedReply { head: number; ready: boolean; kills: FeedRow[] }

function fromRow([id, hash, time, system, victim, attackers, meta]: SnapshotRow): LiveKill {
  const id0 = (n: number) => n || undefined;
  return toLive({
    killmail_id: id,
    hash,
    esi: {
      killmail_time: time,
      solar_system_id: system,
      victim: { ship_type_id: victim[0], character_id: id0(victim[1]), alliance_id: id0(victim[2]), corporation_id: id0(victim[3]) },
      attackers: attackers.map(([c, ship, a, corp, fb, w]) => ({ character_id: id0(c), ship_type_id: id0(ship), alliance_id: id0(a), corporation_id: id0(corp), final_blow: !!fb, weapon_type_id: id0(w) })),
    },
    zkb: { hash, totalValue: meta[0], npc: !!meta[1], solo: !!meta[2], locationID: id0(meta[3]) },
  });
}

async function demoStream() {
  const snapshot = (await import('../demo/liveSnapshot.json')).default as unknown as { kills: SnapshotRow[] };
  const list = snapshot.kills.map(fromRow).sort((a, b) => a.time - b.time);
  if (!list.length) return;
  const first = list[0].time;
  const span = list[list.length - 1].time - first + DEMO_GAP;
  let base = Date.now() - DEMO_LEAD - (list[list.length - 1].time - first);
  for (const k of list) add({ ...k, time: base + k.time - first }, false);
  goLive();
  base += span;
  let i = 0;
  while (running) {
    if (paused) { await sleep(1000); continue; }
    while (base + list[i].time - first <= Date.now()) {
      const k = { ...list[i], time: base + list[i].time - first };
      kills.delete(k.id);
      add(k, true);
      if (++i === list.length) {
        i = 0;
        base += span;
      }
    }
    await sleep(DEMO_TICK_MS);
    prune();
  }
}

async function pull(since: number): Promise<FeedReply> {
  const res = await fetch(since ? `${FEED}?since=${since}` : FEED, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) throw new Error('zKillboard');
  return (await res.json()) as FeedReply;
}

async function stream() {
  if (status.state !== 'error') setStatus({ state: 'backfill', loaded: kills.size, error: undefined });
  const cached = loadJson<{ at: number; head?: number; kills: LiveKill[] } | null>(CACHE_KEY, null);
  const base = cached?.head && Date.now() - cached.at < WINDOW_MS ? cached.head : 0;
  if (base) for (const k of cached!.kills) add(k, false);
  let head = base;
  let warm = false;
  while (running) {
    if (paused) { await sleep(1000); continue; }
    const reply = await pull(warm ? head : base);
    for (const [, ...row] of reply.kills) add(fromRow(row), warm);
    head = Math.max(head, reply.head);
    if (reply.ready) {
      warm = true;
      goLive();
    } else {
      setStatus({ loaded: kills.size });
    }
    persist(head);
    await sleep(warm ? POLL_MS : WARM_MS);
  }
}

async function run() {
  if (isDemo()) {
    await demoStream();
    return;
  }
  while (running) {
    try {
      await stream();
      return;
    } catch (err) {
      setStatus({ state: 'error', error: (err as Error).message });
      await sleep(retryDelay);
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
  const cached = loadJson<{ at: number; kills: LiveKill[] } | null>(CACHE_KEY, null);
  if (!cached?.at || Date.now() - cached.at > FRESH_CACHE) return null;
  return cached.kills.filter((k) => k.systemId === systemId && k.time >= cut);
}
