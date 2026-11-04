import { fetchData, dataMissing } from '../data/manifest';

export type Division = 0 | 1 | 2;
export type AgentKind = 0 | 1 | 2 | 3 | 4;

export interface Agent { id: number; name: string; corp: number; division: Division; level: number; system: number; station: number; kind: AgentKind; locator: boolean }

export interface AgentData {
  agents: Agent[];
  corps: Map<number, { name: string; faction: number }>;
  factions: Map<number, string>;
  stations: Map<number, { system: number; where: string }>;
}

interface Raw {
  corps: Record<string, [string, number]>;
  factions: Record<string, string>;
  stations: Record<string, [number, string]>;
  agents: [number, string, number, Division, number, number, number, AgentKind, 0 | 1][];
}

let loading: Promise<AgentData> | null = null;

export function loadAgents(): Promise<AgentData> {
  loading ??= fetchData('agents')
    .then((res) => {
      if (!res.ok) throw dataMissing(res.url);
      return res.json() as Promise<Raw>;
    })
    .then((raw) => ({
      agents: raw.agents.map(([id, name, corp, division, level, system, station, kind, locator]) => ({ id, name, corp, division, level, system, station, kind, locator: locator === 1 })),
      corps: new Map(Object.entries(raw.corps).map(([k, [name, faction]]) => [Number(k), { name, faction }])),
      factions: new Map(Object.entries(raw.factions).map(([k, v]) => [Number(k), v])),
      stations: new Map(Object.entries(raw.stations).map(([k, [system, where]]) => [Number(k), { system, where }])),
    }))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

export const STANDING_NEEDED: Record<number, number> = { 1: -2, 2: 1, 3: 3, 4: 5, 5: 7 };
