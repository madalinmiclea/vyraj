import { tx } from '../i18n';

export type AnomFaction = 'angel' | 'blood' | 'guristas' | 'sansha' | 'serpentis' | 'drones';
export type Band = 'high' | 'low' | 'null';

export const ANOM_FACTIONS: { id: AnomFaction; prefix: string }[] = [
  { id: 'angel', prefix: 'Angel' },
  { id: 'blood', prefix: 'Blood' },
  { id: 'guristas', prefix: 'Guristas' },
  { id: 'sansha', prefix: 'Sansha' },
  { id: 'serpentis', prefix: 'Serpentis' },
  { id: 'drones', prefix: 'Drone' },
];

type Esc = [number, number, number, number, number, number];

export interface AnomTier {
  id: string;
  tier: number;
  name: string;
  drone: string;
  bands: Band[];
  ship: string;
  esc: Esc;
  tank?: string;
  variant?: boolean;
}

const PIRATE = ['angel', 'blood', 'guristas', 'sansha', 'serpentis'];

export const ANOM_TIERS: AnomTier[] = [
  { id: 'hideaway', tier: 1, name: 'Hideaway', drone: 'Drone Cluster', bands: ['high', 'low'], ship: tx('Fregată sau distrugător'), esc: [0, 0, 4, 3, 3, 0] },
  { id: 'burrow', tier: 2, name: 'Burrow', drone: 'Drone Collection', bands: ['high'], ship: tx('Fregată sau distrugător'), esc: [0, 0, 0, 0, 0, 0] },
  { id: 'refuge', tier: 3, name: 'Refuge', drone: 'Drone Assembly', bands: ['high', 'low'], ship: tx('Distrugător sau cruiser'), esc: [5, 4, 4, 3, 3, 3] },
  { id: 'den', tier: 4, name: 'Den', drone: 'Drone Gathering', bands: ['high', 'low'], ship: tx('Cruiser'), esc: [5, 5, 5, 5, 5, 3] },
  { id: 'yard', tier: 5, name: 'Yard', drone: 'Drone Surveillance', bands: ['low'], ship: tx('Cruiser sau battlecruiser'), esc: [5, 6, 5, 6, 6, 3] },
  { id: 'rally', tier: 6, name: 'Rally Point', drone: 'Drone Menagerie', bands: ['low', 'null'], ship: tx('Battlecruiser sau HAC'), esc: [6, 6, 6, 6, 6, 5] },
  { id: 'port', tier: 7, name: 'Port', drone: 'Drone Herd', bands: ['low', 'null'], ship: tx('Battlecruiser sau HAC'), esc: [7, 7, 7, 7, 7, 5] },
  { id: 'hub', tier: 8, name: 'Hub', drone: 'Drone Squad', bands: ['low', 'null'], ship: tx('HAC, battlecruiser sau battleship'), esc: [8, 8, 8, 8, 8, 10], tank: 'anomaly/hub' },
  { id: 'haven', tier: 9, name: 'Haven', drone: 'Drone Patrol', bands: ['null'], ship: tx('Battleship, marauder sau carrier'), esc: [10, 10, 10, 10, 10, 10], tank: 'anomaly/haven' },
  { id: 'sanctum', tier: 10, name: 'Sanctum', drone: 'Drone Horde', bands: ['null'], ship: tx('Battleship, marauder sau carrier'), esc: [0, 10, 10, 10, 10, 10], tank: 'anomaly/sanctum' },
  { id: 'fhub', tier: 8, name: 'Forsaken Hub', drone: '', bands: ['low', 'null'], ship: tx('Battleship sau marauder'), esc: [9, 9, 9, 9, 9, 0], tank: 'anomaly/fhub', variant: true },
  { id: 'frally', tier: 6, name: 'Forsaken Rally Point', drone: '', bands: ['low', 'null'], ship: tx('Battlecruiser sau HAC'), esc: [8, 8, 8, 8, 8, 0], variant: true },
  { id: 'fden', tier: 4, name: 'Forsaken Den', drone: '', bands: ['low', 'null'], ship: tx('Cruiser sau battlecruiser'), esc: [7, 0, 7, 0, 7, 0], variant: true },
  { id: 'fsanctum', tier: 10, name: 'Forsaken Sanctum', drone: 'Teeming Drone Horde', bands: ['null'], ship: tx('Battleship sau marauder'), esc: [0, 0, 0, 0, 10, 0], variant: true },
];

export const VARIANTS: { name: string; text: string }[] = [
  { name: 'Hidden', text: tx('Mai multe valuri declanșate de lovituri sau de distrugerea anumitor nave.') },
  { name: 'Forsaken', text: tx('Dificultate medie, cu nave elite care trag mai tare, de la distanță mai mare, și pot avea web sau warp disruptor.') },
  { name: 'Forlorn', text: tx('Inamici mai duri și nave elite; cel mai greu tip de variantă.') },
];

export function siteName(t: AnomTier, f: AnomFaction): string {
  if (f === 'drones') return t.drone;
  const prefix = ANOM_FACTIONS.find((x) => x.id === f)!.prefix;
  return `${prefix} ${t.name}`;
}

export function escalation(t: AnomTier, f: AnomFaction): number {
  return t.esc[ANOM_FACTIONS.findIndex((x) => x.id === f)] ?? 0;
}

export const isPirate = (f: AnomFaction) => PIRATE.includes(f);
