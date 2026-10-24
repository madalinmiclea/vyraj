import { dataUrl } from '../data/manifest';

export interface Certificate {
  id: number;
  name: string;
  skills: { skillId: number; levels: number[] }[];
}

export interface ShipMastery {
  levels: Certificate[][];
}

interface RawMasteries {
  certs: Record<string, [string, number[][]]>;
  ships: Record<string, number[][]>;
}

let loading: Promise<RawMasteries | null> | undefined;

function load(): Promise<RawMasteries | null> {
  loading ??= dataUrl('masteries')
    .then((url) => fetch(url))
    .then((res) => (res.ok ? (res.json() as Promise<RawMasteries>) : null))
    .catch(() => null);
  return loading;
}

export async function shipMastery(shipId: number): Promise<ShipMastery | null> {
  const raw = await load();
  const levels = raw?.ships[shipId];
  if (!raw || !levels) return null;
  return {
    levels: levels.map((ids) => ids.flatMap((id) => {
      const c = raw.certs[id];
      return c ? [{ id, name: c[0], skills: c[1].map(([skillId, ...lv]) => ({ skillId, levels: lv })) }] : [];
    })),
  };
}

export function masterySkills(mastery: ShipMastery, level: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const cert of mastery.levels[level - 1] ?? []) {
    for (const s of cert.skills) {
      const need = s.levels[level - 1] ?? 0;
      if (need > (out.get(s.skillId) ?? 0)) out.set(s.skillId, need);
    }
  }
  return out;
}
