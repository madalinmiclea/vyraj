const EVICTABLE = ['eve-market:listed-types', 'eve-intel:hub-prices', 'eve-market:prices', 'eve-intel:scan'];

const DEMO_FLAG = 'vyraj:demo';
const DEMO_PREFIX = 'vyraj-demo:';

export function isDemo(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG) === '1';
  } catch {
    return false;
  }
}

const SHARED = (key: string) => EVICTABLE.includes(key) || key.startsWith('eve-fit:ui:');

export const storageKey = (key: string) => (isDemo() && !SHARED(key) ? DEMO_PREFIX + key : key);

export function setDemo(on: boolean): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(DEMO_PREFIX)) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
    if (on) localStorage.setItem(DEMO_FLAG, '1');
    else localStorage.removeItem(DEMO_FLAG);
  } catch {
    return;
  }
}

const errorListeners = new Set<(key: string) => void>();

export function onStorageError(fn: (key: string) => void) {
  errorListeners.add(fn);
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): boolean {
  const raw = JSON.stringify(value);
  const target = storageKey(key);
  try {
    localStorage.setItem(target, raw);
    return true;
  } catch {
    for (const cache of EVICTABLE) {
      if (cache === key) continue;
      try {
        localStorage.removeItem(cache);
        localStorage.setItem(target, raw);
        return true;
      } catch {
        continue;
      }
    }
    errorListeners.forEach((fn) => fn(key));
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    return;
  }
}
