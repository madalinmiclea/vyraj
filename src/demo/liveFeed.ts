import { loadMap, type NavMap } from '../services/navigation';
import type { LiveKill } from '../services/killstream';
import type { IntelReport } from '../services/chatIntel';
import { demoSystem } from './identity';

const MIN = 60_000;
const HOME = 30001261;
const CAMP = 30000856;
const CAPSULE = 670;
const SMARTBOMB = 3995;

const SHIPS = {
  mining: [32880, 17478, 17480, 17476, 22544, 22548],
  hauler: [657, 648, 1944, 655, 12735, 12743],
  frig: [587, 603, 602, 608, 585, 33816, 11192, 11172, 11182, 11198, 11202, 11176, 11186],
  dessie: [16240, 16242, 32878, 22456, 16236, 16238, 32872, 34562, 34828, 35683, 34317],
  cruiser: [17843, 33468, 33470, 17715, 12005, 11993, 12015, 12011, 11999],
  bc: [24698, 24702, 16227, 16229, 24700, 4310],
  bs: [638, 644, 645, 24688, 17738, 17736, 28659, 28710],
  t3: [29984, 29990, 29986, 29988],
  cap: [19722, 23757, 28606],
};

const CAMPERS = [22456, 29990, 11993, 12015, 32878, 16242, 24702];
const GANKERS = [16240, 4310];
const WEAPONS = [2889, 3178, 2913, 2410, 3244, 3170, 3154, 2456, 2488];
const SPEAKERS = ['Arkon Veyl', 'Tessa Morrow', 'Kade Ostrin', 'Mira Solenne', 'Juno Halvar', 'Riv Talmet'];

type Kind = 'camp' | 'gank' | 'lowsec' | 'null' | 'high' | 'near';

interface Spot { id: number; kind: Kind; w: number }

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoFeed {
  backfill(windowMs: number): LiveKill[];
  next(): { kill: LiveKill; wait: number };
}

export interface DemoIntel {
  backfill(): IntelReport[];
  next(): { reports: IntelReport[]; wait: number };
}

let mapPromise: Promise<NavMap> | null = null;
const navMap = () => (mapPromise ??= loadMap());

export async function createDemoFeed(): Promise<DemoFeed> {
  const map = await navMap();
  const r = rng(Date.now());
  const pick = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const all = [...map.systems.values()].filter((s) => s.regionId < 11000000);
  const nulls = all.filter((s) => s.sec <= 0);
  const highs = all.filter((s) => s.sec >= 0.45);
  const near = [...map.distances([HOME], 8).entries()].filter(([, d]) => d >= 1 && d <= 8).map(([id]) => id);
  const spots: Spot[] = [
    { id: CAMP, kind: 'camp', w: 7 },
    { id: 30002768, kind: 'gank', w: 6 },
    { id: 30000142, kind: 'gank', w: 3 },
    { id: 30002813, kind: 'lowsec', w: 6 },
    { id: 30002537, kind: 'lowsec', w: 5 },
    { id: 30002718, kind: 'lowsec', w: 5 },
    { id: 30005196, kind: 'lowsec', w: 3 },
    { id: 30001984, kind: 'null', w: 3 },
    { id: 30004759, kind: 'null', w: 2 },
    { id: 0, kind: 'near', w: 6 },
    { id: 0, kind: 'null', w: 30 },
    { id: 0, kind: 'high', w: 24 },
  ].filter((s) => !s.id || map.systems.has(s.id)) as Spot[];
  const total = spots.reduce((a, s) => a + s.w, 0);
  const campers = Array.from({ length: 6 }, (_, i) => 2_120_000_100 + i);
  const gankers = Array.from({ length: 14 }, (_, i) => 2_120_000_200 + i);
  let seq = 0;

  function spot(): Spot {
    let x = r() * total;
    for (const s of spots) if ((x -= s.w) <= 0) return s;
    return spots[spots.length - 1];
  }

  function kill(time: number): LiveKill {
    const s = spot();
    const systemId = s.id || (s.kind === 'near' ? pick(near) : s.kind === 'null' ? pick(nulls).id : pick(highs).id);
    const id = 9_100_000_000 + Math.floor(time / 1000) * 10 + (seq++ % 10);
    const gate = 50_000_000 + (systemId - 30_000_000) * 8 + Math.floor(r() * 3);
    let victimShip: number;
    let attackerIds: number[];
    let attackerShips: number[];
    let weapons: number[];
    let location: number | undefined;
    let npc = false;
    if (s.kind === 'camp') {
      victimShip = r() < 0.45 ? CAPSULE : pick([...SHIPS.frig, ...SHIPS.cruiser, ...SHIPS.hauler, ...SHIPS.mining]);
      attackerIds = campers.filter(() => r() < 0.75);
      if (attackerIds.length < 3) attackerIds = campers.slice(0, 3);
      attackerShips = attackerIds.map((_, i) => CAMPERS[i % CAMPERS.length]);
      weapons = attackerIds.map(() => pick(WEAPONS));
      location = 50_000_000 + (systemId - 30_000_000) * 8;
    } else if (s.kind === 'gank') {
      const pod = r() < 0.3;
      victimShip = pod ? CAPSULE : pick([...SHIPS.hauler, ...SHIPS.mining, ...SHIPS.bs]);
      attackerIds = gankers.filter(() => r() < (pod ? 0.3 : 0.7));
      if (!attackerIds.length) attackerIds = gankers.slice(0, 2);
      attackerShips = attackerIds.map(() => pick(GANKERS));
      weapons = attackerIds.map(() => (pod ? SMARTBOMB : pick(WEAPONS)));
      location = pod ? gate : undefined;
    } else {
      const group = s.kind === 'high' ? pick([SHIPS.mining, SHIPS.hauler, SHIPS.frig, SHIPS.cruiser]) : pick([SHIPS.frig, SHIPS.dessie, SHIPS.cruiser, SHIPS.bc, SHIPS.bs, SHIPS.t3, SHIPS.hauler]);
      victimShip = r() < 0.18 ? CAPSULE : r() < 0.01 ? pick(SHIPS.cap) : pick(group);
      npc = s.kind === 'high' ? r() < 0.55 : r() < 0.12;
      const n = npc ? 0 : r() < 0.3 ? 1 : 2 + Math.floor(r() * r() * 18);
      attackerIds = Array.from({ length: n }, () => 2_121_000_000 + Math.floor(r() * 5000));
      attackerShips = attackerIds.map(() => pick([...SHIPS.frig, ...SHIPS.dessie, ...SHIPS.cruiser, ...SHIPS.bc, ...SHIPS.t3]));
      weapons = attackerIds.map(() => pick(WEAPONS));
      location = r() < 0.35 ? gate : undefined;
    }
    const players = attackerIds.length;
    const counts = new Map<number, number>();
    for (const t of attackerShips) counts.set(t, (counts.get(t) ?? 0) + 1);
    const shipList = [...counts.entries()].map(([sid, n]) => ({ id: sid, n })).sort((a, b) => b.n - a.n);
    const base = victimShip === CAPSULE ? 10_000 + r() * 400_000_000 * r() * r() : SHIPS.cap.includes(victimShip) ? 2e9 + r() * 4e9 : 2e6 + r() * 600e6 * r() * r();
    return {
      id,
      hash: 'demo',
      time,
      systemId,
      victimShip,
      victimChar: 2_122_000_000 + Math.floor(r() * 90_000),
      victimCorp: 98_000_000 + Math.floor(r() * 4000),
      victimAlliance: r() < 0.6 ? 99_000_000 + Math.floor(r() * 900) : undefined,
      value: Math.round(base),
      attackers: npc ? 1 + Math.floor(r() * 4) : players,
      players,
      npcAttackers: npc ? 1 + Math.floor(r() * 4) : 0,
      attackerIds,
      attackerShips,
      weapons,
      attackerAlliances: s.kind === 'camp' ? [99_000_777] : [],
      topShip: shipList[0]?.id,
      shipList,
      location,
      npc,
      solo: players === 1,
      pod: victimShip === CAPSULE,
      onGate: location != null && location < 60_000_000,
    };
  }

  return {
    backfill(windowMs) {
      const now = Date.now();
      const n = Math.round((windowMs / MIN) * 6);
      return Array.from({ length: n }, () => kill(now - Math.floor(r() * windowMs))).sort((a, b) => a.time - b.time);
    },
    next() {
      return { kill: kill(Date.now()), wait: 3000 + Math.floor(r() * 7000) };
    },
  };
}

export async function createDemoIntel(channel: string): Promise<DemoIntel> {
  const map = await navMap();
  const r = rng(Date.now() ^ 0x5eed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const ships = ['Sabre', 'Loki', 'Cerberus', 'Stratios', 'Ishtar', 'Svipul', 'Hecate', 'Gila', 'Muninn', 'Talwar', 'Proteus', 'Heron'];
  let n = 0;

  function report(time: number): IntelReport {
    const pool = [...map.distances([demoSystem(time)], 6).entries()].filter(([id]) => id !== CAMP);
    const [id, d] = pick(pool);
    const sys = map.systems.get(id)!;
    const near = pick((map.gates.get(id) ?? [id]).map((g) => map.systems.get(g)!.name));
    const clear = d > 1 && r() < 0.22;
    const text = clear
      ? pick([`${sys.name} clr`, `${sys.name} clear`, `${sys.name} nv`])
      : pick([
          `${sys.name} +${2 + Math.floor(r() * 6)} ${pick(ships)}`,
          `${pick(ships)} ${sys.name} ${near} gate`,
          `${sys.name} red ${pick(ships)} on scan`,
          `${sys.name} gang ${3 + Math.floor(r() * 12)} ${pick(ships)} ${pick(ships)}`,
          `${pick(ships)} jumped ${near} > ${sys.name}`,
        ]);
    return { id: `demo:${time}:${n++}`, time, channel, speaker: pick(SPEAKERS), text, systems: [id], clear };
  }

  return {
    backfill() {
      const now = Date.now();
      return Array.from({ length: 8 }, (_, i) => report(now - (i + 1) * (2 + Math.floor(r() * 2)) * MIN));
    },
    next() {
      return { reports: [report(Date.now())], wait: 25_000 + Math.floor(r() * 35_000) };
    },
  };
}
