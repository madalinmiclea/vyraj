import { fetchData } from '../data/manifest';

type RawDescriptions = Record<string, string>;

let loading: Promise<RawDescriptions | null> | undefined;

function load(): Promise<RawDescriptions | null> {
  loading ??= fetchData('descriptions')
    .then((res) => (res.ok ? (res.json() as Promise<RawDescriptions>) : null))
    .catch(() => null)
    .then((raw) => { if (!raw) loading = undefined; return raw; });
  return loading;
}

export async function itemDescription(typeId: number): Promise<string[] | null> {
  const text = (await load())?.[typeId];
  return text ? text.split('\n') : null;
}
