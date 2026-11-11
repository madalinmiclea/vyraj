import type { AppContext } from '../app/context';
import { compactISK } from '../ui/components';
import type { Aggregates } from '../services/market';
import type { PermId } from '../character/permissions';
import { locale } from '../i18n';

export type ToolTab = 'appraisal' | 'abyssal' | 'assets' | 'lp' | 'alerts';
export type Basis = 'sell' | 'buy';
export type At = (selector: string) => HTMLElement | null;

export interface ToolEnv {
  body: HTMLElement;
  ctx: AppContext;
  readonly tab: ToolTab | null;
  readonly basis: Basis;
  basisChips(): string;
  esiCharacter(scope?: string): { id: number } | string;
  scopePrompt(perm: PermId): string;
}

export const priceOf = (p: Aggregates | undefined, basis: Basis) => (p ? (basis === 'sell' ? p.sellMin : p.buyMax) : 0);
export const isk = (v: number) => `<span class="num">${compactISK(v)}</span>`;
export const dateTime = (ms: number) => new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
