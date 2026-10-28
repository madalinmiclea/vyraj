import { loadJson, saveJson } from './storage';
import { EN } from './i18n/en';

export type Lang = 'ro' | 'en';

const LANG_KEY = 'eve-fit:ui:lang';

export const lang: Lang = loadJson<Lang>(LANG_KEY, 'en') === 'ro' ? 'ro' : 'en';

export const locale = lang === 'en' ? 'en-GB' : 'ro-RO';

document.documentElement.lang = lang;

if (lang === 'ro') {
  document.title = 'Vyraj · unelte pentru EVE Online';
  document.querySelector('meta[name="description"]')?.setAttribute('content', 'Fitting cu formulele Pyfa, prețuri live din Jita, plan de skill-uri, doctrine de flotă, intel pe rută, industrie și ghid de misiuni. Gratuit, totul rulează în browser.');
}

export function setLang(next: Lang) {
  if (next === lang) return;
  saveJson(LANG_KEY, next);
  location.reload();
}

export function tx(text: string, vars?: Record<string, string | number>): string {
  const s = lang === 'en' ? EN[text] ?? text : text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
