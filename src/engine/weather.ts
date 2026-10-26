import type { RawWeather, Sde } from '../data/sde';

export type WeatherKey = 'electrical' | 'dark' | 'exotic' | 'firestorm' | 'gamma';

export const WEATHER_KEYS: WeatherKey[] = ['electrical', 'dark', 'exotic', 'firestorm', 'gamma'];

export interface WeatherBuff { id: number; value: number; label: string }

export function weatherLevels(tier: number): number[] {
  return tier >= 4 ? [2, 3] : [1, 2];
}

export function findWeather(sde: Sde, key: string | undefined, level: number): RawWeather | undefined {
  return sde.weathers.find((w) => w.k === key && w.lvl === level);
}

export function weatherPenalty(w: RawWeather): number {
  return Math.abs(w.b[0]?.[1] ?? 0);
}

export function weatherBuffs(sde: Sde, w: RawWeather | undefined): WeatherBuff[] {
  if (!w) return [];
  return w.b.filter(([id]) => sde.buffs.has(id)).map(([id, value]) => ({ id, value, label: `${w.n}: ${sde.buffs.get(id)?.n ?? id}` }));
}
