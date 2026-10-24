import { loadJson, saveJson } from './storage';

export type Theme = 'dark' | 'light' | 'vyraj';

const THEMES: Theme[] = ['dark', 'light', 'vyraj'];

const THEME_KEY = 'eve-fit:ui:theme';

const stored = loadJson<Theme>(THEME_KEY, 'dark');

export let theme: Theme = THEMES.includes(stored) ? stored : 'dark';

document.documentElement.dataset.theme = theme;

export function setTheme(next: Theme) {
  theme = next;
  saveJson(THEME_KEY, next);
  document.documentElement.dataset.theme = next;
}
