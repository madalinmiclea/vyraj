import { tx } from '../i18n';
import { findProfile, type DamageProfile } from './profiles';
import { simulateCapacitor, type CapResult } from './capacitor';
import { defense, type Damage, type DamageType, type FitStats } from './stats';
import type { Dogma } from './dogma';
import type { Sde } from '../data/sde';

export type NpcKind = 'mission' | 'anomaly' | 'ded' | 'abyss' | 'wormhole';
export type Ewar = 'web' | 'scram' | 'jam' | 'damp' | 'paint' | 'neut' | 'rr';

export interface NpcSite { id: string; kind: NpcKind; name: string; dps: number; neut: number }
export interface NpcFaction { id: string; name: string; weak: DamageType[]; ewar: Ewar[]; profiles: Partial<Record<NpcKind, string>> }

export const NPC_KINDS: NpcKind[] = ['mission', 'anomaly', 'ded', 'abyss', 'wormhole'];

const site = (kind: NpcKind, id: string, name: string, dps: number, neut: number): NpcSite => ({ id: `${kind}/${id}`, kind, name, dps, neut });

export const NPC_SITES: NpcSite[] = [
  site('mission', 'l1', tx('Nivel {v}', { v: 1 }), 40, 0),
  site('mission', 'l2', tx('Nivel {v}', { v: 2 }), 100, 3),
  site('mission', 'l3', tx('Nivel {v}', { v: 3 }), 250, 8),
  site('mission', 'l4', tx('Nivel {v}', { v: 4 }), 550, 18),
  site('mission', 'l4h', tx('Nivel {v}', { v: '4+' }), 900, 30),
  site('anomaly', 'hub', 'Hub', 250, 6),
  site('anomaly', 'fhub', 'Forsaken Hub', 350, 10),
  site('anomaly', 'sanctum', 'Sanctum', 450, 15),
  site('anomaly', 'haven', 'Haven', 600, 18),
  site('ded', '3', 'DED 3/10', 150, 5),
  site('ded', '5', 'DED 5/10', 300, 10),
  site('ded', '6', 'DED 6/10', 450, 15),
  site('ded', '8', 'DED 8/10', 700, 25),
  site('ded', '10', 'DED 10/10', 1000, 40),
  site('abyss', 't0', tx('T0 Liniștit'), 80, 5),
  site('abyss', 't1', tx('T1 Calm'), 120, 10),
  site('abyss', 't2', tx('T2 Agitat'), 180, 15),
  site('abyss', 't3', tx('T3 Feroce'), 260, 25),
  site('abyss', 't4', tx('T4 Furios'), 380, 35),
  site('abyss', 't5', tx('T5 Haotic'), 520, 50),
  site('abyss', 't6', tx('T6 Cataclismic'), 700, 70),
  site('wormhole', 'c1', 'C1', 150, 10),
  site('wormhole', 'c2', 'C2', 250, 15),
  site('wormhole', 'c3', 'C3', 400, 25),
  site('wormhole', 'c4', 'C4', 600, 35),
  site('wormhole', 'c5', 'C5', 1200, 70),
  site('wormhole', 'c6', 'C6', 1800, 120),
];

const pirate = (asteroid: string, deadspace: string) => ({ mission: `Deadspace/${deadspace}`, anomaly: `Asteroid/${asteroid}`, ded: `Deadspace/${deadspace}` });

export const NPC_FACTIONS: NpcFaction[] = [
  { id: 'angel', name: 'Angel Cartel', weak: ['explosive', 'kinetic'], ewar: ['web'], profiles: { ...pirate('Angel Cartel', 'Angel Cartel'), abyss: 'Abyssal/Angel' } },
  { id: 'blood', name: 'Blood Raiders', weak: ['em', 'thermal'], ewar: ['neut', 'paint'], profiles: pirate('Blood Raiders', 'Blood Raiders') },
  { id: 'guristas', name: 'Guristas', weak: ['kinetic', 'thermal'], ewar: ['jam'], profiles: pirate('Guristas', 'Guristas') },
  { id: 'sansha', name: "Sansha's Nation", weak: ['em', 'thermal'], ewar: ['neut', 'paint'], profiles: { ...pirate('Sanshas Nation', 'Sanshas Nation'), abyss: 'Abyssal/Sansha' } },
  { id: 'serpentis', name: 'Serpentis', weak: ['thermal', 'kinetic'], ewar: ['damp'], profiles: pirate('Serpentis', 'Serpentis') },
  { id: 'drones', name: 'Rogue Drones', weak: ['em', 'thermal'], ewar: [], profiles: { ...pirate('Rogue Drone', 'Rogue Drone'), abyss: 'Abyssal/Drones' } },
  { id: 'mordu', name: "Mordu's Legion", weak: ['kinetic', 'thermal'], ewar: ['scram', 'jam'], profiles: { mission: 'Mission/Mordus Legion' } },
  { id: 'amarr', name: 'Amarr Empire', weak: ['em', 'thermal'], ewar: ['neut', 'paint'], profiles: { mission: 'Mission/Amarr Empire' } },
  { id: 'caldari', name: 'Caldari State', weak: ['kinetic', 'thermal'], ewar: ['jam'], profiles: { mission: 'Mission/Caldari State' } },
  { id: 'gallente', name: 'Gallente Federation', weak: ['thermal', 'kinetic'], ewar: ['damp'], profiles: { mission: 'Mission/Gallente Federation' } },
  { id: 'minmatar', name: 'Minmatar Republic', weak: ['explosive', 'kinetic'], ewar: ['web', 'paint'], profiles: { mission: 'Mission/Minmatar Republic' } },
  { id: 'khanid', name: 'Khanid', weak: ['em', 'thermal'], ewar: ['neut'], profiles: { mission: 'Mission/Khanid' } },
  { id: 'thukker', name: 'Thukker', weak: ['explosive', 'thermal'], ewar: ['web'], profiles: { mission: 'Mission/Thukker' } },
  { id: 'triglavian', name: 'Triglavian', weak: ['thermal', 'explosive'], ewar: ['neut', 'web', 'scram', 'rr'], profiles: { abyss: 'Abyssal/Triglavian' } },
  { id: 'drifter', name: 'Drifter', weak: [], ewar: [], profiles: { abyss: 'Abyssal/Drifter' } },
  { id: 'sleeper', name: 'Sleeper', weak: ['em', 'thermal'], ewar: ['web', 'scram', 'neut', 'rr'], profiles: { abyss: 'Abyssal/Sleeper', wormhole: 'NPC/Sleepers' } },
  { id: 'concord', name: 'Concord', weak: [], ewar: ['web', 'scram'], profiles: { abyss: 'Abyssal/Concord' } },
  { id: 'seeker', name: 'Seeker', weak: [], ewar: ['web'], profiles: { abyss: 'Abyssal/Seeker' } },
  { id: 'overmind', name: 'Overmind', weak: ['em', 'thermal'], ewar: ['web'], profiles: { abyss: 'Abyssal/Overmind' } },
  { id: 'mixed', name: 'Mixed', weak: [], ewar: ['neut', 'web'], profiles: { abyss: 'Abyssal/All' } },
];

export function findSite(id: string | undefined): NpcSite {
  return NPC_SITES.find((s) => s.id === id) ?? NPC_SITES[3];
}

export function factionsFor(kind: NpcKind): NpcFaction[] {
  return NPC_FACTIONS.filter((f) => f.profiles[kind]);
}

export function findFaction(kind: NpcKind, id: string | undefined): NpcFaction {
  const list = factionsFor(kind);
  return list.find((f) => f.id === id) ?? list[0];
}

export interface NpcScenario { site: NpcSite; faction: NpcFaction; dps: number; neut: number }

export interface NpcAssessment {
  profile: DamageProfile;
  ehp: number;
  layerEhp: Record<'shield' | 'armor' | 'hull', number>;
  active: number;
  passive: number;
  capFraction: number;
  sustained: number;
  incoming: number;
  margin: number;
  timeToDie: number;
  verdict: 'ok' | 'warn' | 'bad';
  cap: CapResult;
  neut: number;
  matchShare: number | null;
}

export function assessNpc(sde: Sde, d: Dogma, s: FitStats, sc: NpcScenario): NpcAssessment {
  const profile = findProfile(sc.faction.profiles[sc.site.kind]);
  const def = defense(sde, d, profile);
  const c = s.capacitor;
  const neut = sc.faction.ewar.includes('neut') ? Math.max(0, sc.neut) : 0;
  const cap = simulateCapacitor(c.capacity, c.rechargeTime, c.usage + neut);
  const available = Math.max(0, c.peakRecharge - neut);
  const capFraction = cap.stable || c.grossUsage <= 0 ? 1 : Math.min(1, available / c.grossUsage);
  const active = def.activeTank;
  const passive = def.passiveShield.effective;
  const sustained = Math.max(passive, active * capFraction);
  const incoming = Math.max(0, sc.dps);
  const timeToDie = sustained >= incoming ? Infinity : def.ehp / (incoming - sustained);
  const verdict = timeToDie === Infinity ? 'ok' : timeToDie >= 180 ? 'warn' : 'bad';
  return {
    profile,
    ehp: def.ehp,
    layerEhp: { shield: def.layers.shield.ehp, armor: def.layers.armor.ehp, hull: def.layers.hull.ehp },
    active,
    passive,
    capFraction,
    sustained,
    incoming,
    margin: incoming > 0 ? sustained / incoming : Infinity,
    timeToDie,
    verdict,
    cap,
    neut,
    matchShare: share(s.offense.dps, sc.faction.weak),
  };
}

function share(dps: Damage, weak: DamageType[]): number | null {
  if (!weak.length) return null;
  const total = dps.em + dps.thermal + dps.kinetic + dps.explosive;
  if (total <= 0) return null;
  return weak.reduce((a, t) => a + dps[t], 0) / total;
}
