import { tx } from '../i18n';

export type DataName = 'sde' | 'items' | 'skins' | 'masteries' | 'map' | 'pi' | 'industry' | 'mining' | 'traits';

let manifest: Promise<Partial<Record<DataName, string>>> | null = null;

export async function dataUrl(name: DataName): Promise<string> {
  manifest ??= fetch(`${import.meta.env.BASE_URL}data/manifest.json`, { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  const file = (await manifest)[name] ?? `${name}.json`;
  return `${import.meta.env.BASE_URL}data/${file}`;
}

export async function fetchData(name: DataName): Promise<Response> {
  const res = await fetch(await dataUrl(name)).catch(() => null);
  if (res?.ok && res.headers.get('content-type')?.includes('json')) return res;
  manifest = null;
  return fetch(await dataUrl(name));
}

export function dataMissing(url: string): Error {
  return new Error(import.meta.env.DEV
    ? tx('Nu găsesc {url}. Rulează "npm run data" ca să generezi datele.', { url })
    : tx('Nu am putut încărca datele aplicației ({url}). Reîncarcă pagina; dacă tot nu merge, încearcă mai târziu.', { url }));
}
