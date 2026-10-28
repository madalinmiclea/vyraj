import { lang } from '../i18n';

export interface DamageProfile {
  id: string;
  name: string;
  group: string;
  em: number;
  thermal: number;
  kinetic: number;
  explosive: number;
}

const p = (group: string, name: string, em: number, thermal: number, kinetic: number, explosive: number): DamageProfile => ({
  id: `${group}/${name}`, name, group, em, thermal, kinetic, explosive,
});

export const UNIFORM: DamageProfile = p('Generic', 'Uniform', 25, 25, 25, 25);

export const DAMAGE_PROFILES: DamageProfile[] = [
  UNIFORM,
  p('Generic', 'EM', 1, 0, 0, 0),
  p('Generic', 'Thermal', 0, 1, 0, 0),
  p('Generic', 'Kinetic', 0, 0, 1, 0),
  p('Generic', 'Explosive', 0, 0, 0, 1),
  p('Abyssal', 'All', 126, 427, 218, 230),
  p('Abyssal', 'Angel', 450, 72, 80, 398),
  p('Abyssal', 'Concord', 53, 559, 94, 295),
  p('Abyssal', 'Drifter', 250, 250, 250, 250),
  p('Abyssal', 'Drones', 250, 250, 250, 250),
  p('Abyssal', 'Overmind', 0, 410, 590, 0),
  p('Abyssal', 'Sansha', 569, 431, 0, 0),
  p('Abyssal', 'Seeker', 402, 402, 98, 98),
  p('Abyssal', 'Sleeper', 313, 313, 187, 187),
  p('Abyssal', 'Triglavian', 0, 615, 0, 385),
  p('Asteroid', 'Angel Cartel', 1838, 562, 2215, 3838),
  p('Asteroid', 'Blood Raiders', 5067, 4214, 0, 0),
  p('Asteroid', 'Guristas', 0, 1828, 7413, 0),
  p('Asteroid', 'Rogue Drone', 394, 666, 1090, 1687),
  p('Asteroid', 'Sanshas Nation', 5586, 4112, 0, 0),
  p('Asteroid', 'Serpentis', 0, 5373, 4813, 0),
  p('Deadspace', 'Angel Cartel', 369, 533, 1395, 3302),
  p('Deadspace', 'Blood Raiders', 6040, 5052, 10, 15),
  p('Deadspace', 'Guristas', 0, 1531, 9680, 0),
  p('Deadspace', 'Rogue Drone', 276, 1071, 1069, 871),
  p('Deadspace', 'Sanshas Nation', 3009, 2237, 0, 0),
  p('Deadspace', 'Serpentis', 0, 3110, 1929, 0),
  p('Invasion', 'Triglavian Subcaps', 0, 610, 0, 390),
  p('Invasion', 'Drifter Entities', 250, 250, 250, 250),
  p('Invasion', 'Sleeper Entities', 265, 265, 235, 235),
  p('Invasion', 'Rogue Drone Entities', 250, 250, 250, 250),
  p('Mission', 'Amarr Empire', 4464, 3546, 97, 0),
  p('Mission', 'Caldari State', 0, 2139, 4867, 0),
  p('Mission', 'CONCORD', 336, 134, 212, 412),
  p('Mission', 'Gallente Federation', 9, 3712, 2758, 0),
  p('Mission', 'Khanid', 612, 483, 43, 6),
  p('Mission', 'Minmatar Republic', 1024, 388, 1655, 4285),
  p('Mission', 'Mordus Legion', 25, 262, 625, 0),
  p('Mission', 'Thukker', 0, 52, 10, 79),
  p('NPC', 'Sansha Incursion', 1682, 1347, 3678, 3678),
  p('NPC', 'Sleepers', 1472, 1472, 1384, 1384),
];

export function findProfile(id: string | null | undefined): DamageProfile {
  return DAMAGE_PROFILES.find((x) => x.id === id) ?? UNIFORM;
}

const PROFILE_RO: Record<string, string> = {
  Generic: 'Generice', Uniform: 'Uniform', Thermal: 'Termic', Kinetic: 'Cinetic', Explosive: 'Exploziv',
  Abyssal: 'Abisal', All: 'Toate', Drones: 'Drone', Asteroid: 'Anomalii (asteroizi)', Invasion: 'Invazie', Mission: 'Misiuni',
  'Triglavian Subcaps': 'Nave Triglavian (subcapitale)', 'Drifter Entities': 'Entități Drifter', 'Sleeper Entities': 'Entități Sleeper', 'Rogue Drone Entities': 'Entități Rogue Drone',
  'Sansha Incursion': 'Incursiune Sansha',
};

export function profileText(s: string): string {
  return lang === 'ro' ? PROFILE_RO[s] ?? s : s;
}
