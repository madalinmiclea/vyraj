import { formatNum } from '../ui/components';
import { tx } from '../i18n';
import type { SoundKind } from '../ui/sound';
import type { NavMap, WormholeLink } from '../services/navigation';
import { displaySec, secClass, type ActivitySnapshot, type SovClaim } from '../services/recon';
import type { LiveKill, StreamStatus } from '../services/killstream';
import type { ChatWatcher, IntelReport } from '../services/chatIntel';

export type SideTab = 'events' | 'system' | 'chat';
export type KillMode = 'pvp' | 'npc' | 'all';

export interface LiveSettings {
  win: number;
  npc?: boolean;
  mode: KillMode;
  labels: boolean;
  battles: boolean;
  follow: string;
  range: number;
  sound: SoundKind;
  soundSet?: boolean;
  notify: boolean;
  wh: boolean;
  center: boolean;
  ref: number;
  tab: SideTab;
}

export interface SysStat { n: number; pods: number; gate: number; value: number; last: number; kills: LiveKill[]; camp: boolean; smartbomb: boolean }

export interface Battle { id: number; systems: number[]; main: number; kills: number; value: number; pilots: number; start: number; end: number }

export interface Followed { id: number; name: string; systemId?: number; online?: boolean; at: number; error?: string }

export interface LiveEnv {
  el: HTMLElement;
  settings: LiveSettings;
  followed: Map<number, Followed>;
  chat: ChatWatcher;
  readonly map: NavMap | null;
  readonly stats: Map<number, SysStat>;
  readonly hourly: Map<number, number>;
  readonly battles: Battle[];
  readonly dist: Map<number, number> | null;
  readonly intel: IntelReport[];
  readonly links: WormholeLink[];
  readonly activity: ActivitySnapshot | null;
  readonly sov: Map<number, SovClaim>;
  readonly selected: number | null;
  readonly status: StreamStatus;
  characters(): { characterId?: number; name: string }[];
  typeName(id: number): string;
  filtered(kills: LiveKill[]): LiveKill[];
  battleAt(id: number): Battle | undefined;
  refLabel(): string;
}

const BATTLE_GAP = 20 * 60_000;
const BATTLE_MIN_KILLS = 5;
const BATTLE_MIN_PILOTS = 6;
const NPC_CORP_MAX = 2_000_000;

const groupOf = (alliance?: number, corp?: number) => alliance || (corp && corp > NPC_CORP_MAX ? corp : 0);

export function findBattles(kills: LiveKill[], gates: Map<number, number[]>): Battle[] {
  const list = kills.filter((k) => !k.npc).sort((a, b) => a.time - b.time);
  const parent = list.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const bySys = new Map<number, number[]>();
  list.forEach((k, i) => (bySys.get(k.systemId) ?? bySys.set(k.systemId, []).get(k.systemId)!).push(i));
  list.forEach((k, i) => {
    for (const sys of [k.systemId, ...(gates.get(k.systemId) ?? [])]) {
      for (const j of bySys.get(sys) ?? []) {
        if (j >= i) break;
        if (k.time - list[j].time <= BATTLE_GAP) parent[root(j)] = root(i);
      }
    }
  });
  const groups = new Map<number, LiveKill[]>();
  list.forEach((k, i) => (groups.get(root(i)) ?? groups.set(root(i), []).get(root(i))!).push(k));
  const out: Battle[] = [];
  for (const all of groups.values()) {
    const tally = new Map<number, number>();
    for (const k of all) tally.set(k.systemId, (tally.get(k.systemId) ?? 0) + 1);
    const core = [...tally.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const near = new Set([core, ...(gates.get(core) ?? [])]);
    const g = all.filter((k) => near.has(k.systemId));
    if (g.length < BATTLE_MIN_KILLS) continue;
    const pilots = new Set<number>();
    const hits = new Set<string>();
    for (const k of g) {
      k.attackerIds.forEach((id) => pilots.add(id));
      if (k.victimChar) pilots.add(k.victimChar);
      const victim = groupOf(k.victimAlliance, k.victimCorp);
      if (!victim) continue;
      for (const a of [...k.attackerAlliances, ...(k.attackerCorps ?? []).filter((c) => c > NPC_CORP_MAX)]) if (a !== victim) hits.add(`${a}>${victim}`);
    }
    const twoSided = [...hits].some((h) => { const [a, b] = h.split('>'); return hits.has(`${b}>${a}`); });
    if (!twoSided || pilots.size < BATTLE_MIN_PILOTS) continue;
    const counts = new Map<number, number>();
    for (const k of g) counts.set(k.systemId, (counts.get(k.systemId) ?? 0) + 1);
    const systems = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    out.push({ id: g[0].id, systems, main: systems[0], kills: g.length, value: g.reduce((t, k) => t + k.value, 0), pilots: pilots.size, start: g[0].time, end: g[g.length - 1].time });
  }
  return out.sort((a, b) => b.value - a.value);
}

export const agoShort = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return tx('acum {n} s', { n: s });
  const m = Math.round(s / 60);
  return m < 60 ? tx('acum {n} min', { n: m }) : tx('acum {n} h', { n: Math.round(m / 60) });
};

export const secSpan = (sec: number) => `<span class="num ${secClass(sec)}">${formatNum(displaySec(sec), 1)}</span>`;

export function ringRadius(n: number, big: boolean, spacing = 30) {
  return big ? Math.max(8, Math.min(15, spacing * 0.26)) + Math.min(5, Math.sqrt(n)) : 2.5 + Math.min(7, Math.sqrt(n) * 1.8);
}
