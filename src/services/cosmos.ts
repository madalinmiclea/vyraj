import { loadJson, saveJson, removeKey } from '../storage';

export type CosmosSec = 'high' | 'low' | 'null';

export interface CosmosAgent { n: string; sec: CosmosSec; s: number; id?: number; lvl?: number; corp?: number; f: number; fn?: string; st?: number; site?: string; std?: number; ch?: string; rep?: string | 1; prev?: string; w?: string; mc?: number }
export interface CosmosSite { n: string; sec: CosmosSec; s: number; sn?: string; ded?: string; type?: string; sid?: string; w?: string }
export interface CosmosReq { a?: string; m: string; q?: number; w?: string }
export interface CosmosItem { n: string; q: number; t?: number; m?: 1; via?: string; src?: string; sw?: string; req: CosmosReq[]; note?: string }
export interface CosmosLine { id: string; name: string; kind: 'empire' | 'pirate'; where: [CosmosSec, string, string][]; agents: CosmosAgent[]; sites: CosmosSite[]; items: CosmosItem[] }
export interface CosmosData { source: string; lines: CosmosLine[] }

export type Txt = [string, string];
export interface CosmosMission { t: string; k?: string; l?: number; goal?: Txt; steps?: Txt[]; foes?: string; deal?: string[]; resist?: string[]; need?: string[]; reward?: Txt; tip?: Txt; brief?: string }
export interface CosmosAgentMissions { story?: Txt; m: CosmosMission[] }

let missionsLoading: Promise<Record<string, CosmosAgentMissions>> | null = null;

export function loadCosmosMissions(): Promise<Record<string, CosmosAgentMissions>> {
  missionsLoading ??= import('../data/cosmosMissions.json').then((m) => m.default as unknown as Record<string, CosmosAgentMissions>).catch((e) => { missionsLoading = null; throw e; });
  return missionsLoading;
}

export const WIKI = 'https://wiki.eveuniversity.org/';

let loading: Promise<CosmosData> | null = null;

export function loadCosmos(): Promise<CosmosData> {
  loading ??= import('../data/cosmos.json').then((m) => m.default as unknown as CosmosData).catch((e) => { loading = null; throw e; });
  return loading;
}

export interface CosmosDone { a: string[]; s: string[]; i: string[] }

const key = (charKey: string) => `eve-cosmos:done:${charKey}`;

export const doneKey = (line: string, name: string) => `${line}|${name}`;

export function loadDone(charKey: string): { a: Set<string>; s: Set<string>; i: Set<string> } {
  const raw = loadJson<Partial<CosmosDone>>(key(charKey), {});
  return { a: new Set(raw.a ?? []), s: new Set(raw.s ?? []), i: new Set(raw.i ?? []) };
}

export function saveDone(charKey: string, d: { a: Set<string>; s: Set<string>; i: Set<string> }) {
  saveJson(key(charKey), { a: [...d.a], s: [...d.s], i: [...d.i] });
}

export function forgetCosmos(charKey: string) {
  removeKey(key(charKey));
}
