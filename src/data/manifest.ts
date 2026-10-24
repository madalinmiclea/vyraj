export type DataName = 'sde' | 'items' | 'skins' | 'masteries' | 'map';

let manifest: Promise<Partial<Record<DataName, string>>> | null = null;

export async function dataUrl(name: DataName): Promise<string> {
  manifest ??= fetch(`${import.meta.env.BASE_URL}data/manifest.json`, { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  const file = (await manifest)[name] ?? `${name}.json`;
  return `${import.meta.env.BASE_URL}data/${file}`;
}
