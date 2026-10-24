import { fetchData } from './manifest';
import { tx } from '../i18n';

export interface EveItem {
  n: string;
  c: string;
  t: number;
  m?: number;
}

export type MarketGroups = Record<string, [string, number]>;

export let allEveItems: EveItem[] = [];
export let marketGroups: MarketGroups = {};

let loading: Promise<EveItem[]> | null = null;

export function loadItems(): Promise<EveItem[]> {
  loading ??= fetchData('items')
    .then((res) => {
      if (!res.ok) throw new Error(tx('Nu găsesc {url}. Rulează "npm run data" ca să generezi datele.', { url: res.url }));
      return res.json() as Promise<{ items: EveItem[]; groups: MarketGroups }>;
    })
    .then((raw) => {
      allEveItems = raw.items;
      marketGroups = raw.groups;
      return allEveItems;
    })
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
