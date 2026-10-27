import { fetchData } from '../data/manifest';

export interface TraitGroup {
  header: string;
  bonuses: { amount: string; text: string }[];
}

type RawTraits = Record<string, [string, [string, string][]][]>;

let loading: Promise<RawTraits | null> | undefined;

function load(): Promise<RawTraits | null> {
  loading ??= fetchData('traits')
    .then((res) => (res.ok ? (res.json() as Promise<RawTraits>) : null))
    .catch(() => null)
    .then((raw) => { if (!raw) loading = undefined; return raw; });
  return loading;
}

export async function shipTraits(typeId: number): Promise<TraitGroup[] | null> {
  const groups = (await load())?.[typeId];
  return groups ? groups.map(([header, bonuses]) => ({ header, bonuses: bonuses.map(([amount, text]) => ({ amount, text: text.replace(/^·/, '') })) })) : null;
}
