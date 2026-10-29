import { loadMap, type NavMap } from '../services/navigation';
import type { IntelReport } from '../services/chatIntel';
import { demoSystem } from './identity';

const MIN = 60_000;
const CAMP = 30000856;
const SPEAKERS = ['Arkon Veyl', 'Tessa Morrow', 'Kade Ostrin', 'Mira Solenne', 'Juno Halvar', 'Riv Talmet'];

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

export interface DemoIntel {
  backfill(): IntelReport[];
  next(): { reports: IntelReport[]; wait: number };
}

let mapPromise: Promise<NavMap> | null = null;
const navMap = () => (mapPromise ??= loadMap());

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
