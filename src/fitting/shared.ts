import type { AppContext } from '../app/context';
import type { Fit, SlotKind } from '../engine/fit';
import type { ModuleState } from '../engine/dogma';
import { DAMAGE_TYPES } from '../engine/stats';
import { formatNum } from '../ui/components';
import { tx } from '../i18n';
import type { Sde } from '../data/sde';

export const CURRENT_KEY = 'eve-fit:current';

export function capTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
}
export const PROFILE_KEY = 'eve-fit:damage-profile';
export const TARGET_KEY = 'eve-fit:target';

export interface TargetState { id: string; signature: number; velocity: number; distanceKm: number }

export const GROUPS: { key: SlotKind; label: string; cls: string }[] = [
  { key: 'high', label: 'High slots', cls: 'high' },
  { key: 'mid', label: 'Medium slots', cls: 'mid' },
  { key: 'low', label: 'Low slots', cls: 'low' },
  { key: 'rig', label: 'Rig slots', cls: 'rig' },
  { key: 'subsystem', label: tx('Subsisteme'), cls: 'sub' },
];

export const STATE_LABEL: Record<ModuleState, string> = { offline: 'Offline', online: 'Online', active: tx('Activ'), overheated: tx('Supraîncălzit') };
export const DMG_LABEL = { em: 'EM', thermal: 'Th', kinetic: 'Kin', explosive: 'Exp' } as const;
export const LAYER_LABEL = { shield: 'Shield', armor: 'Armor', hull: 'Hull' } as const;

export interface FitEnv {
  sde: Sde;
  ctx: AppContext;
  getFit(): Fit | null;
  setFit(fit: Fit): void;
  change(fn: (draft: Fit) => void): void;
  profileId(): string;
  targetState(): TargetState;
  name(id: number): string;
}

export function sum(d: Record<string, number>) {
  return Object.values(d).reduce((a, b) => a + b, 0);
}

export function damageBar(d: Record<string, number>) {
  const total = sum(d);
  if (!total) return '';
  return `<div class="dmg-bar">${DAMAGE_TYPES.map((t) => `<span class="${t}" style="width:${(d[t] / total) * 100}%" title="${DMG_LABEL[t]} ${formatNum((d[t] / total) * 100, 0)}%"></span>`).join('')}</div>`;
}

export function groupBy<T>(list: T[], key: (x: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(x);
  }
  return [...map];
}
