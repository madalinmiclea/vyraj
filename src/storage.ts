const EVICTABLE = ['eve-market:listed-types', 'eve-intel:hub-prices', 'eve-market:prices', 'eve-intel:scan'];

const errorListeners = new Set<(key: string) => void>();

export function onStorageError(fn: (key: string) => void) {
  errorListeners.add(fn);
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): boolean {
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(key, raw);
    return true;
  } catch {
    for (const cache of EVICTABLE) {
      if (cache === key) continue;
      try {
        localStorage.removeItem(cache);
        localStorage.setItem(key, raw);
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
    localStorage.removeItem(key);
  } catch {
    return;
  }
}
