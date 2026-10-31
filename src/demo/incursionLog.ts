import { loadMap } from '../services/navigation';
import { spaceOf, type IncEvent, type IncLog, type IncState, type Observed } from '../services/incursions';

const DAY = 86_400_000;
const H = 3_600_000;

const ENDED: [string, number, number, IncState][] = [
  ['Goins', 14.5, 7.3, 'withdrawing'],
  ['Umamon', 11.7, 5.7, 'mobilizing'],
  ['Kraken', 11.3, 3.9, 'withdrawing'],
  ['I-WRVM', 10.5, 6.7, 'withdrawing'],
  ['Wyllequet', 6.0, 5.6, 'withdrawing'],
  ['Afinoo', 5.1, 1.6, 'mobilizing'],
];

export async function demoIncursionLog(now: number): Promise<IncLog> {
  const map = await loadMap();
  const ids = new Map([...map.constellations].map(([id, name]) => [name, id]));
  const log: IncLog = { active: [], ended: [], events: [] };
  for (const [name, start, days, last] of ENDED) {
    const c = ids.get(name);
    const staging = c ? [...map.systems.values()].find((s) => s.constellationId === c)?.id : undefined;
    if (!c || !staging) continue;
    const space = spaceOf(map, staging);
    const first = now - start * DAY;
    const end = first + days * DAY;
    const boss = first + Math.max(days * 0.55, Math.min(days - 0.4, space === 'high' ? 3.1 : 1.2)) * DAY;
    const mobil = last === 'withdrawing' ? end - 72 * H : Math.min(boss + 2 * H, end - H);
    const ev = (t: number, kind: IncEvent['kind'], state?: IncState): IncEvent => ({ t: Math.round(t), c, kind, state, staging, space });
    log.events.push(ev(first, 'new', 'established'));
    if (mobil > first) log.events.push(ev(mobil, 'state', 'mobilizing'));
    log.events.push(ev(boss, 'boss'));
    if (last === 'withdrawing') log.events.push(ev(end - 24 * H, 'state', 'withdrawing'));
    log.events.push(ev(end, 'end', last));
    const o: Observed = { c, first, fresh: true, last: end, state: last, since: last === 'withdrawing' ? end - 24 * H : mobil, boss: true, bossAt: boss, influence: 1, staging, space };
    log.ended.push({ ...o, end });
  }
  return log;
}
