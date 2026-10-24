import { loadJson, saveJson } from './storage';
import { EN } from './i18n/en';

export type Lang = 'ro' | 'en';

const LANG_KEY = 'eve-fit:ui:lang';

const browserLang: Lang = navigator.language.toLowerCase().startsWith('ro') ? 'ro' : 'en';

export const lang: Lang = loadJson<Lang>(LANG_KEY, browserLang) === 'en' ? 'en' : 'ro';

export const locale = lang === 'en' ? 'en-GB' : 'ro-RO';

document.documentElement.lang = lang;

export function setLang(next: Lang) {
  if (next === lang) return;
  saveJson(LANG_KEY, next);
  location.reload();
}

export function tx(text: string, vars?: Record<string, string | number>): string {
  const s = lang === 'en' ? EN[text] ?? text : text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
