import { allEveItems } from '../data/items';
import { loadJson, saveJson } from '../storage';

export const TIERS = ['Tranquil', 'Calm', 'Agitated', 'Fierce', 'Raging', 'Chaotic', 'Cataclysmic'];
export const WEATHERS = ['Electrical', 'Dark', 'Exotic', 'Firestorm', 'Gamma'];

export interface AbyssalRun {
  id: string;
  date: number;
  tier: number;
  weather: string;
  ship: string;
  minutes: number;
  filamentCost: number;
  lootValue: number;
  shipLoss: number;
}

const KEY = 'eve-tools:abyssal-runs';

export const loadRuns = () => loadJson<AbyssalRun[]>(KEY, []);
export const saveRuns = (runs: AbyssalRun[]) => saveJson(KEY, runs);

export function filamentTypeId(tier: number, weather: string): number | undefined {
  const name = `${TIERS[tier]} ${weather} Filament`.toLowerCase();
  return allEveItems.find((i) => i.n.trim().toLowerCase() === name)?.t;
}

export const profitOf = (r: AbyssalRun) => r.lootValue - r.filamentCost - r.shipLoss;

export interface RunSummary {
  key: string;
  runs: number;
  profit: number;
  minutes: number;
  losses: number;
}

export function summarize(runs: AbyssalRun[], keyOf: (r: AbyssalRun) => string): RunSummary[] {
  const map = new Map<string, RunSummary>();
  for (const r of runs) {
    const k = keyOf(r);
    const s = map.get(k) ?? { key: k, runs: 0, profit: 0, minutes: 0, losses: 0 };
    s.runs++;
    s.profit += profitOf(r);
    s.minutes += r.minutes;
    if (r.shipLoss > 0) s.losses++;
    map.set(k, s);
  }
  return [...map.values()].sort((a, b) => b.profit / Math.max(1, b.minutes) - a.profit / Math.max(1, a.minutes));
}

export const iskPerHour = (profit: number, minutes: number) => (minutes > 0 ? (profit / minutes) * 60 : 0);
