import { loadJson, saveJson } from './storage';

export type Theme = 'dark' | 'light' | 'vyraj';

const THEMES: Theme[] = ['dark', 'light', 'vyraj'];

const THEME_KEY = 'eve-fit:ui:theme';

const stored = loadJson<Theme>(THEME_KEY, 'dark');

export let theme: Theme = THEMES.includes(stored) ? stored : 'dark';

const BAR: Record<Theme, string> = { dark: '#05070a', light: '#e5ebf0', vyraj: '#0a0909' };

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[t]);
}

apply(theme);

export function setTheme(next: Theme) {
  theme = next;
  saveJson(THEME_KEY, next);
  apply(next);
}
