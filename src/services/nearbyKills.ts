import { rosterCharacters } from '../character/roster';
import { hasScope, SCOPES_CHANGED_EVENT } from '../character/sso';
import { characterLocation, characterOnline } from '../character/esi';
import { loadMap, type NavMap } from './navigation';
import { startKillStream, onKill, type LiveKill } from './killstream';
import { typeName, resolveTypeNames } from './typeNames';
import { compactISK } from '../ui/components';
import { tx } from '../i18n';
import { deliver, kindOn, NOTICE_EVENT } from './notices';

const LOCATION_SCOPE = 'esi-location.read_location.v1';
const ONLINE_SCOPE = 'esi-location.read_online.v1';
const POLL_MS = 30_000;
const ONLINE_MS = 5 * 60_000;
const BATCH_MS = 15_000;
export const NEARBY_EVENT = 'vyraj-nearby-updated';

interface Pilot { id: number; name: string; systemId?: number; arrivedAt: number; online?: boolean; onlineAt: number }

const pilots = new Map<number, Pilot>();
const seen = new Set<number>();
const pending = new Map<number, { kills: LiveKill[]; who: Set<string>; here: boolean }>();
let map: NavMap | null = null;
let timer = 0;
let batchTimer = 0;
let unsubscribe: (() => void) | null = null;

export const locatable = () => rosterCharacters().filter((c) => c.characterId != null && hasScope(c.characterId, LOCATION_SCOPE));

export function nearbyStatus(): { name: string; systemId?: number; arrivedAt: number; online?: boolean }[] {
  return [...pilots.values()].map(({ name, systemId, arrivedAt, online }) => ({ name, systemId, arrivedAt, online }));
}

async function poll() {
  clearTimeout(timer);
  if (!kindOn('nearby')) { stop(); return; }
  const chars = locatable();
  for (const id of [...pilots.keys()]) if (!chars.some((c) => c.characterId === id)) pilots.delete(id);
  await Promise.all(chars.map(async (c) => {
    const id = c.characterId!;
    const p = pilots.get(id) ?? { id, name: c.name, arrivedAt: 0, onlineAt: 0 };
    pilots.set(id, p);
    try {
      if (hasScope(id, ONLINE_SCOPE) && Date.now() - p.onlineAt > ONLINE_MS) {
        p.online = (await characterOnline(id)).online;
        p.onlineAt = Date.now();
      }
      if (p.online === false) { p.systemId = undefined; return; }
      const loc = await characterLocation(id);
      if (loc.solar_system_id !== p.systemId) { p.systemId = loc.solar_system_id; p.arrivedAt = Date.now(); }
    } catch { }
  }));
  window.dispatchEvent(new Event(NEARBY_EVENT));
  timer = window.setTimeout(poll, POLL_MS);
}

function watchers(systemId: number): { who: Set<string>; here: boolean } | null {
  const who = new Set<string>();
  let here = false;
  for (const p of pilots.values()) {
    if (!p.systemId) continue;
    if (p.systemId === systemId) { who.add(p.name); here = true; continue; }
    if (map?.gates.get(p.systemId)?.includes(systemId)) who.add(p.name);
  }
  return who.size ? { who, here } : null;
}

function handle(k: LiveKill, live: boolean) {
  if (!live || k.npc || seen.has(k.id)) return;
  const w = watchers(k.systemId);
  if (!w) return;
  const fresh = [...pilots.values()].some((p) => p.systemId && w.who.has(p.name) && k.time >= p.arrivedAt);
  if (!fresh) return;
  seen.add(k.id);
  const slot = pending.get(k.systemId) ?? { kills: [], who: new Set<string>(), here: false };
  slot.kills.push(k);
  w.who.forEach((n) => slot.who.add(n));
  slot.here ||= w.here;
  pending.set(k.systemId, slot);
  if (!batchTimer) batchTimer = window.setTimeout(flush, BATCH_MS);
}

async function flush() {
  batchTimer = 0;
  const batch = [...pending.entries()];
  pending.clear();
  await resolveTypeNames(batch.flatMap(([, s]) => s.kills.map((k) => k.victimShip))).catch(() => {});
  for (const [systemId, s] of batch) {
    const system = map?.systems.get(systemId)?.name ?? `#${systemId}`;
    const who = [...s.who].join(', ');
    const where = s.here ? tx('în sistemul tău ({who})', { who }) : tx('la un salt de {who}', { who });
    const value = s.kills.reduce((a, k) => a + k.value, 0);
    const title = s.kills.length === 1 ? tx('Kill PvP în {system}', { system }) : tx('{n} kill-uri PvP în {system}', { n: s.kills.length, system });
    const ships = s.kills.slice(0, 4).map((k) => typeName(k.victimShip)).join(', ') + (s.kills.length > 4 ? '…' : '');
    deliver('nearby', { title, body: `${ships} · ${compactISK(value)} ISK · ${where}`, url: '#/recon', tag: `vyraj-nearby-${systemId}` });
  }
}

function stop() {
  clearTimeout(timer);
  timer = 0;
  unsubscribe?.();
  unsubscribe = null;
  pilots.clear();
}

async function start() {
  if (unsubscribe || !kindOn('nearby') || !locatable().length) return;
  map ??= await loadMap().catch(() => null);
  if (!map) return;
  unsubscribe = onKill(handle);
  startKillStream();
  poll();
}

export function startNearbyWatcher() {
  const sync = () => { if (kindOn('nearby')) start(); else stop(); };
  window.addEventListener(NOTICE_EVENT, sync);
  window.addEventListener(SCOPES_CHANGED_EVENT, sync);
  setInterval(sync, 5 * 60_000);
  sync();
}
