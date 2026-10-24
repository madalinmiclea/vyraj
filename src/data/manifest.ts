export type DataName = 'sde' | 'items' | 'skins' | 'masteries' | 'map';

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
