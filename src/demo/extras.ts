import { DEMO_ID } from './identity';
import { DEMO_CORP } from '../services/corporation';
import { sovereignty } from '../services/recon';

const HOUR = 3_600_000;
const DAY = 86_400_000;

const ORES = [22, 1223, 1225, 19, 21, 1231];
const SYSTEMS = [30001261, 30001262, 30001264];
const CITADEL = 1_035_466_617_946;
const MOONS: [number, number][] = [[40080196, -30], [40080200, 6], [40080204, 40], [40080300, 77]];
const STANDINGS = [10, 5, 5, -5, -10, -10, 0.5];

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function ledger(now: number) {
  const out: { date: string; quantity: number; solar_system_id: number; type_id: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const r = seeded(Math.floor((now - i * DAY) / DAY) * 7919);
    if (r() < 0.35) continue;
    const kinds = 1 + Math.floor(r() * 3);
    for (let k = 0; k < kinds; k++) {
      out.push({ date: day(now - i * DAY), quantity: Math.round(4000 + r() * 22000), solar_system_id: SYSTEMS[Math.floor(r() * SYSTEMS.length)], type_id: ORES[Math.floor(r() * ORES.length)] });
    }
  }
  return out;
}

function extractions(now: number) {
  const base = Math.floor(now / HOUR) * HOUR;
  return MOONS.map(([moon, hours]) => {
    const arrive = base + hours * HOUR;
    return {
      moon_id: moon,
      structure_id: CITADEL,
      extraction_start_time: new Date(arrive - 13 * DAY).toISOString(),
      chunk_arrival_time: new Date(arrive).toISOString(),
      natural_decay_time: new Date(arrive + 3 * HOUR).toISOString(),
    };
  });
}

async function contacts() {
  const sov = await sovereignty().catch(() => new Map());
  const count = new Map<number, number>();
  for (const c of sov.values()) if (c?.kind === 'alliance') count.set(c.id, (count.get(c.id) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, STANDINGS.length).map(([id], i) => ({ contact_id: id, contact_type: 'alliance', standing: STANDINGS[i] }));
}

export async function demoExtras(path: string, now: number): Promise<unknown | undefined> {
  if (path === `/characters/${DEMO_ID}/mining`) return ledger(now);
  if (path === `/corporation/${DEMO_CORP}/mining/extractions`) return extractions(now);
  if (path === `/characters/${DEMO_ID}/contacts`) return contacts();
  if (path === `/corporations/${DEMO_CORP}/contacts`) return [];
  return undefined;
}
