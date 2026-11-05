import { isDemo } from '../storage';

const DB = 'vyraj-mail';
const META = 'meta';
const BODIES = 'bodies';

let opening: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(META);
        req.result.createObjectStore(BODIES);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

const scope = (characterId: number) => String(characterId);
const bodyKey = (characterId: number, mailId: number) => `${scope(characterId)}:${mailId}`;
const range = (s: string) => IDBKeyRange.bound(`${s}:`, `${s}:\uffff`);

async function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest | void, always = false): Promise<T | undefined> {
  if (isDemo() && !always) return undefined;
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const t = d.transaction(store, mode);
      const req = work(t.objectStore(store));
      t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      t.onerror = () => resolve(undefined);
      t.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export const loadMailMeta = <T>(characterId: number) => run<T>(META, 'readonly', (s) => s.get(scope(characterId)));

export const saveMailMeta = (characterId: number, value: unknown) => run<void>(META, 'readwrite', (s) => { s.put(value, scope(characterId)); });

export const loadMailBody = <T>(characterId: number, mailId: number) => run<T>(BODIES, 'readonly', (s) => s.get(bodyKey(characterId, mailId)));

export const saveMailBody = (characterId: number, mailId: number, body: unknown) => run<void>(BODIES, 'readwrite', (s) => { s.put(body, bodyKey(characterId, mailId)); });

export const dropMailBody = (characterId: number, mailId: number) => run<void>(BODIES, 'readwrite', (s) => { s.delete(bodyKey(characterId, mailId)); });

export async function cachedMailIds(characterId: number): Promise<Set<number>> {
  const s = scope(characterId);
  const keys = await run<IDBValidKey[]>(BODIES, 'readonly', (st) => st.getAllKeys(range(s)));
  return new Set((keys ?? []).map((k) => Number(String(k).slice(s.length + 1))).filter(Number.isFinite));
}

export async function forgetMail(characterId: number): Promise<void> {
  const s = scope(characterId);
  await run<void>(META, 'readwrite', (st) => { st.delete(s); }, true);
  await run<void>(BODIES, 'readwrite', (st) => { st.delete(range(s)); }, true);
}
