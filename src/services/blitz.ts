import { tx } from '../i18n';

export type BlitzVerdict = 'always' | 'good' | 'standing' | 'empire';
export type BlitzShip = 'frig' | 'bs' | 'arty';
export type BlitzWhere = 'system' | 'adjacent' | 'const' | '';
export type Resist = 'em' | 'thermal' | 'kinetic' | 'explosive';

export interface BlitzMission { name: string; verdict: BlitzVerdict; ship: BlitzShip; where: BlitzWhere; how: string }

export const BLITZ_MISSIONS: BlitzMission[] = [
  { name: 'Recon (1 of 3)', verdict: 'always', ship: 'frig', where: 'system', how: tx('MWD la poartă, treci în camera a doua și ieși în warp.') },
  { name: 'Dread Pirate Scarlet', verdict: 'always', ship: 'arty', where: 'const', how: tx('Păstrează Gate Key-ul, nu se consumă. MWD la poartă, lovește-o pe Scarlet în camera 2, ia-i implantul din epavă și pleacă.') },
  { name: 'Pirate Invasion', verdict: 'good', ship: 'bs', where: 'system', how: tx('MWD sau MJD la Carrier Wreckage, omoară doar grupul de acolo și pleacă. Atenție la fregatele cu scrambler.') },
  { name: 'The Assault', verdict: 'good', ship: 'bs', where: '', how: tx('Porțile nu sunt încuiate. Omoară fregatele cu scrambler din camera 2, iar în ultima cameră doar grupul din stânga. Varianta Serpentis nu mai merge pe blitz.') },
  { name: 'The Damsel in Distress', verdict: 'good', ship: 'arty', where: 'adjacent', how: tx('Distruge pleasure hub-ul cel mai apropiat. Când apare Zor, omoară-l și ia-i epava, are drop scump.') },
  { name: 'The Right Hand of Zazzmatazz', verdict: 'good', ship: 'bs', where: 'const', how: tx('Omoară doar pe Zor, trage-i epava cu tractorul cât distrugi structura, apoi pleacă.') },
  { name: 'Stop the Thief', verdict: 'good', ship: 'bs', where: 'adjacent', how: tx('Aliniază-te spre ieșire, omoară Mercenary Overlord, apoi Shadow. Raportul îți intră singur în cală. Fără drone.') },
  { name: 'The Rogue Slave Trader (2 of 2)', verdict: 'good', ship: 'bs', where: 'adjacent', how: tx('Omoară navele de la intrare, ia poarta, aliniază-te și omoară doar cruiserele Sansha Slaver.') },
  { name: 'Smash The Supplier', verdict: 'empire', ship: 'arty', where: 'system', how: tx('Distruge doar Amarr Shipyard Control Tower. Plătește bine, dar pierzi standing la Amarr.') },
  { name: 'Surprise Surprise', verdict: 'empire', ship: 'arty', where: 'const', how: tx('MJD, apoi Transport Ship și cele două nave de luptă din jur. Pierdere mică de standing la Amarr.') },
  { name: 'Pot and Kettle (1 of 5)', verdict: 'empire', ship: 'arty', where: 'const', how: tx('Omoară doar Prophecy cât te aliniezi. Pierdere mică de standing la Amarr.') },
  { name: 'Cargo Delivery', verdict: 'standing', ship: 'frig', where: 'adjacent', how: tx('MWD la container, ia marfa, warp afară.') },
  { name: 'The Rogue Slave Trader (1 of 2)', verdict: 'standing', ship: 'bs', where: 'adjacent', how: tx('Distruge slave pen-urile și ia containerul. Fă-o doar dacă faci și partea 2.') },
  { name: 'Recon (2 of 3)', verdict: 'standing', ship: 'frig', where: 'system', how: tx('MWD spre poartă. Când apar inamicii, pe la 10 km, ieși în warp.') },
  { name: 'Duo of Death', verdict: 'standing', ship: 'bs', where: 'const', how: tx('MJD imediat, omoară cele două nave de luptă și ia marfa.') },
];

export type BurnerKind = 'agent' | 'team' | 'base';

export interface Burner { id: string; kind: BurnerKind; title: string; enemy: string; enemyId: number; tank: Resist[]; fit?: string; alt?: string; skip?: boolean; how: string }

export const BURNERS: Burner[] = [
  { id: 'agent-angel', kind: 'agent', title: 'Angel Cartel', enemy: 'Dramiel', enemyId: 17932, tank: ['explosive', 'kinetic'], fit: 'nergal-angel', how: tx('Web-uri pe Dramiel, AB supraîncălzit până la ~5 km, apoi viteza lui. Occult sau Tetryon.') },
  { id: 'agent-blood', kind: 'agent', title: 'Blood Raiders', enemy: 'Cruor', enemyId: 17926, tank: ['em', 'thermal'], fit: 'nergal-blood-raiders', how: tx('Web-uri și foc, nu trebuie să te miști. Bateria medie ține capacitorul sub neut.') },
  { id: 'agent-guristas', kind: 'agent', title: 'Guristas', enemy: 'Worm', enemyId: 17930, tank: ['kinetic', 'thermal'], fit: 'nergal-guristas', how: tx('MWD un ciclu rece și trei supraîncălzite, scram sub 11 km, apoi orbit la 2,5 km. Fără drone.') },
  { id: 'agent-sansha', kind: 'agent', title: "Sansha's Nation", enemy: 'Succubus', enemyId: 17924, tank: ['em', 'thermal'], fit: 'nergal-sansha', how: tx('Apropie-te și trage cu Mystic. Web supraîncălzit două cicluri ca să-l prinzi. Fără drone.') },
  { id: 'agent-serpentis', kind: 'agent', title: 'Serpentis', enemy: 'Daredevil', enemyId: 17928, tank: ['kinetic', 'thermal'], fit: 'nergal-serpentis', how: tx('Web-uri, armă și drone. Hardenerele supraîncălzite de la început. Periculoasă fără skill-uri bune de armură.') },
  { id: 'team-vengeance', kind: 'team', title: 'Amarr', enemy: 'Vengeance', enemyId: 11365, tank: ['em', 'thermal'], fit: 'nergal-vengeance', alt: 'garmur-team', how: tx('Întâi Inquisitorii, cu web supraîncălzit și muniție scurtă, apoi Vengeance. Retrage dronele.') },
  { id: 'team-hawk', kind: 'team', title: 'Caldari', enemy: 'Hawk', enemyId: 11379, tank: ['kinetic', 'thermal'], fit: 'nergal-hawk', alt: 'garmur-team', how: tx('Orbit pe un Bantam la 2,5 km. Ambii Bantam cu Mystic, apoi Hawk cu Occult.') },
  { id: 'team-enyo', kind: 'team', title: 'Gallente', enemy: 'Enyo', enemyId: 12044, tank: ['kinetic', 'thermal'], fit: 'nergal-enyo', alt: 'garmur-team', how: tx('Orbit Enyo la 6 km cu web. Navitas cu Meson și drone, apoi Enyo cu Occult. Nu coborî sub 5 km.') },
  { id: 'team-jaguar', kind: 'team', title: 'Minmatar', enemy: 'Jaguar', enemyId: 11400, tank: ['explosive', 'kinetic'], fit: 'nergal-jaguar', alt: 'garmur-team', how: tx('Orbit Jaguar la 10 km cu ambele web-uri. Burst cu Meson și drone, apoi Jaguar cu Baryon.') },
  { id: 'base-angel', kind: 'base', title: 'Angel Cartel', enemy: 'Dramiel', enemyId: 17932, tank: ['explosive', 'kinetic'], fit: 'vigilant-angel-base', how: tx('Patru Dramiel și un transport. Web doar când Dramiel orbitează aproape. Mulți o refuză.') },
  { id: 'base-blood', kind: 'base', title: 'Blood Raiders', enemy: 'Ashimmu', enemyId: 17922, tank: ['em', 'thermal'], fit: 'onyx-blood-base', how: tx('Întâi Sentinelele, apoi Ashimmu, cu orbit la 13 km. Ia epavele cu tractorul.') },
  { id: 'base-serpentis', kind: 'base', title: 'Serpentis', enemy: 'Talos', enemyId: 4308, tank: ['kinetic', 'thermal'], fit: 'vagabond-serpentis-base', how: tx('Trei Talos, unul câte unul, departe de turele. Ia epavele, au uneori drop-uri scumpe.') },
  { id: 'base-guristas', kind: 'base', title: 'Guristas', enemy: 'Supercarrier', enemyId: 0, tank: ['kinetic', 'thermal'], skip: true, how: tx('Durează peste 30 de minute. Nu merită, refuz-o.') },
];

export type BlitzLevel = 'l1' | 'l2' | 'l3' | 'l4' | 'l5';
export type ShipRole = BlitzLevel | 'burner';

export interface BlitzShipCard { ship: string; role: ShipRole; note: string; fits: string[]; tab?: 'nergal' }

export const BLITZ_LEVELS: { id: BlitzLevel; face: string }[] = [
  { id: 'l1', face: tx('Fregate și destroyere. Drumul durează mai mult decât lupta, deci o navă mică și rapidă.') },
  { id: 'l2', face: tx('Tot nave mici, plus câteva cruisere. Un destroyer bun le duce încă.') },
  { id: 'l3', face: tx('Mai ales cruisere și battlecruisere, dar încă multe fregate.') },
  { id: 'l4', face: tx('Battleship-uri cu escortă. Unele fregate îți blochează warp-ul.') },
  { id: 'l5', face: tx('Doar în lowsec. Multe nave și turnuri care îți golesc capacitorul.') },
];

export const BLITZ_SHIPS: BlitzShipCard[] = [
  { ship: 'Corax', role: 'l1', note: tx('Rachete ușoare, ieftin și rapid de antrenat. Schimbi tipul de daune după inamic.'), fits: [] },
  { ship: 'Cormorant', role: 'l1', note: tx('Railgun de la 40-50 km, cu MWD ca să ții distanța. Muniția e ieftină.'), fits: [] },
  { ship: 'Algos', role: 'l1', note: tx('Drone ușoare și tunuri mici. Skill-urile de drone îți folosesc și mai târziu.'), fits: [] },
  { ship: 'Jackdaw', role: 'l2', note: tx('Destroyer tactic cu rachete. În modul de propulsie ajunge foarte repede la poartă.'), fits: [] },
  { ship: 'Svipul', role: 'l2', note: tx('Destroyer tactic cu tunuri, rapid, cu tank pe scut sau pe armură.'), fits: [] },
  { ship: 'Gnosis', role: 'l2', note: tx('Bonusurile nu depind de skill-uri, deci merge bine și pe un caracter nou. Ține și L3.'), fits: [] },
  { ship: 'Gila', role: 'l3', note: tx('Drone medii și rachete ușoare rapide, scut care se reface singur. Ține și L4 cu skill-uri mici.'), fits: [] },
  { ship: 'Ishtar', role: 'l3', note: tx('Cruiser de asalt cu drone, cam cât Gila. Alege-l dacă ai deja skill-urile.'), fits: [] },
  { ship: 'Drake Navy Issue', role: 'l3', note: tx('Rachete medii cu bonus de aplicare, lovește bine și fregatele.'), fits: [] },
  { ship: 'Tengu', role: 'l3', note: tx('Pentru L3 în nullsec: cu cloak și nullifier treci de bule fără să fii prins.'), fits: [] },
  { ship: 'Paladin', role: 'l4', note: tx('Lasere cu daune instant și cristale în loc de muniție. Cel mai folosit Marauder pe L4.'), fits: [] },
  { ship: 'Kronos', role: 'l4', note: tx('Railgun care lovește peste 100 km. După ultima rebalansare are 5 sloturi medii.'), fits: [] },
  { ship: 'Golem', role: 'l4', note: tx('Rachete cruise care acoperă toată camera. Cu două target paintere, altfel pierde mult din daune.'), fits: [] },
  { ship: 'Machariel', role: 'l4', note: tx('Warp cu 25% mai rapid și fără bastion. Câștigă timp acolo unde drumul contează mai mult decât lupta.'), fits: ['machariel-autocannon', 'machariel-artillery'] },
  { ship: 'Barghest', role: 'l4', note: tx('Rachete de trei ori mai rapide, cu cruise sau rapid heavy. Fără bastion, pleci oricând.'), fits: [] },
  { ship: 'Rattlesnake', role: 'l4', note: tx('Drone grele și tank pasiv pe scut. Mai lent, dar iartă greșelile.'), fits: [] },
  { ship: 'Thanatos', role: 'l5', note: tx('Sau orice carrier, în misiunile fără acceleration gate. Ideal ai câte unul în fiecare sistem unde te trimite agentul.'), fits: [] },
  { ship: 'Barghest', role: 'l5', note: tx('Cruise de la distanță, pentru misiunile cu gate unde carrier-ul nu intră.'), fits: [] },
  { ship: 'Golem', role: 'l5', note: tx('Alternativa cu mai mult tank la Barghest, cu MJD pentru repoziționare.'), fits: [] },
  { ship: 'Nergal', role: 'burner', note: tx('Toate cele 9 burnere de fregată, cu aceleași rig-uri.'), fits: [], tab: 'nergal' },
  { ship: 'Garmur', role: 'burner', note: tx('Un fit pentru toate burnerele de echipă, schimbi doar muniția.'), fits: ['garmur-team'] },
  { ship: 'Vagabond', role: 'burner', note: tx('Baza Serpentis, cele trei Talos.'), fits: ['vagabond-serpentis-base'] },
  { ship: 'Onyx', role: 'burner', note: tx('Baza Blood Raiders, Ashimmu.'), fits: ['onyx-blood-base'] },
  { ship: 'Drekavac', role: 'burner', note: tx('Alternativă rapidă pentru baza Blood Raiders.'), fits: [] },
  { ship: 'Vigilant', role: 'burner', note: tx('Baza Angel Cartel, cele patru Dramiel.'), fits: ['vigilant-angel-base'] },
];

export const NERGAL_FITS = BURNERS.filter((b) => b.fit?.startsWith('nergal-')).map((b) => b.fit!);

export const BLITZ_FITS: Record<string, string> = {
  'garmur-team': `[Garmur, Anomic Team]
Caldari Navy Ballistic Control System
Caldari Navy Ballistic Control System
Caldari Navy Ballistic Control System

Missile Guidance Computer II
Missile Guidance Computer II
5MN Quad LiF Restrained Microwarpdrive
'Inception' Target Painter

Polarized Rocket Launcher, Caldari Navy Mjolnir Rocket
Polarized Rocket Launcher, Caldari Navy Mjolnir Rocket
Polarized Rocket Launcher, Caldari Navy Mjolnir Rocket

Small Hydraulic Bay Thrusters II
Small Rocket Fuel Cache Partition II
Small Warhead Flare Catalyst I


Mjolnir Rage Rocket x4000
Nova Rage Rocket x4000
Inferno Rage Rocket x4000
Caldari Navy Mjolnir Rocket x3000
Caldari Navy Scourge Rocket x3000
Missile Range Script x2
Missile Precision Script x2`,
  'machariel-artillery': `[Machariel, Blitz L4 artillery]
Damage Control II
Reactor Control Unit II
Large Armor Repairer II
Inertial Stabilizers II
Gyrostabilizer II
Gyrostabilizer II

500MN Cold-Gas Enduring Microwarpdrive
Tracking Computer II
Tracking Computer II
Tracking Computer II
Large Micro Jump Drive
Target Painter II

1400mm Prototype Siege Cannon, Republic Fleet EMP L
1400mm Prototype Siege Cannon, Republic Fleet EMP L
1400mm Prototype Siege Cannon, Republic Fleet EMP L
1400mm Prototype Siege Cannon, Republic Fleet EMP L
1400mm Prototype Siege Cannon, Republic Fleet EMP L
1400mm Prototype Siege Cannon, Republic Fleet EMP L
1400mm Prototype Siege Cannon, Republic Fleet EMP L
Small Tractor Beam II

Large Hyperspatial Velocity Optimizer II
Large Hyperspatial Velocity Optimizer II
Large Hyperspatial Velocity Optimizer II


Hobgoblin II x5
Warden II x4


Republic Fleet EMP L x2000
Republic Fleet Phased Plasma L x2000
Optimal Range Script x3`,
  'machariel-autocannon': `[Machariel, Blitz L4 autocannon]
Damage Control II
Multispectrum Energized Membrane II
Large Armor Repairer II
Gyrostabilizer II
Gyrostabilizer II
Counterbalanced Compact Gyrostabilizer

500MN Quad LiF Restrained Microwarpdrive
Tracking Computer II
Tracking Computer II
Tracking Computer II
Large Micro Jump Drive
Large Cap Battery II

800mm Repeating Cannon II, Republic Fleet EMP L
800mm Repeating Cannon II, Republic Fleet EMP L
800mm Repeating Cannon II, Republic Fleet EMP L
800mm Repeating Cannon II, Republic Fleet EMP L
800mm Repeating Cannon II, Republic Fleet EMP L
800mm Repeating Cannon II, Republic Fleet EMP L
800mm Repeating Cannon II, Republic Fleet EMP L
Small Tractor Beam II

Large Hyperspatial Velocity Optimizer II
Large Hyperspatial Velocity Optimizer II
Large Hyperspatial Velocity Optimizer II


Hobgoblin II x5
Infiltrator II x5
Valkyrie II x5


Republic Fleet EMP L x2000
Republic Fleet Phased Plasma L x2000
Republic Fleet Fusion L x2000
Optimal Range Script x3
Tracking Speed Script x3`,
  'nergal-angel': `[Nergal, Anomic Agent Angel]
Centii A-Type Small Armor Repairer
Overdrive Injector System II
Multispectrum Energized Membrane II
Centum A-Type Explosive Energized Membrane

Stasis Webifier II
Stasis Webifier II
Coreli A-Type 1MN Afterburner

Veles Light Entropic Disintegrator, Occult S

Small Auxiliary Nano Pump II
Small Capacitor Control Circuit II


Tetryon Exotic Plasma S x2000
Occult S x2500`,
  'nergal-blood-raiders': `[Nergal, Anomic Agent Blood Raiders]
Vigor Compact Micro Auxiliary Power Core
Centum A-Type EM Energized Membrane
Entropic Radiation Sink II
Centii A-Type Small Armor Repairer

'Censer' Medium Cap Battery
Stasis Webifier II
Stasis Webifier II

Veles Light Entropic Disintegrator, Occult S

Small Auxiliary Nano Pump II
Small Capacitor Control Circuit II


Warrior II x5


Occult S x3585`,
  'nergal-enyo': `[Nergal, Anomic Team Enyo]
Centii A-Type Small Armor Repairer
Entropic Radiation Sink II
Entropic Radiation Sink II
Centus C-Type Kinetic Armor Hardener

Federation Navy Stasis Webifier
Republic Fleet Small Cap Battery
Coreli A-Type 1MN Afterburner

Veles Light Entropic Disintegrator, Meson Exotic Plasma S

Small Auxiliary Nano Pump II
Small Capacitor Control Circuit II


Warrior II x5


Occult S x2000
Mystic S x2000
Meson Exotic Plasma S x2000`,
  'nergal-guristas': `[Nergal, Anomic Agent Guristas]
Centii A-Type Small Armor Repairer
Overdrive Injector System II
Overdrive Injector System II
Centus X-Type Kinetic Armor Hardener

Coreli A-Type 5MN Microwarpdrive
Republic Fleet Small Cap Battery
True Sansha Warp Scrambler

Veles Light Entropic Disintegrator, Occult S

Small Auxiliary Nano Pump II
Small Capacitor Control Circuit II


Occult S x2000`,
  'nergal-hawk': `[Nergal, Anomic Team Hawk]
Centus C-Type Kinetic Armor Hardener
Entropic Radiation Sink II
Centii A-Type Small Armor Repairer
Centus C-Type Kinetic Armor Hardener

Republic Fleet Small Cap Battery
Federation Navy Stasis Webifier
Coreli A-Type 1MN Afterburner

Veles Light Entropic Disintegrator, Mystic S

Small Auxiliary Nano Pump II
Small Capacitor Control Circuit II


Acolyte II x5


Mystic S x2000
Occult S x2000`,
  'nergal-jaguar': `[Nergal, Anomic Team Jaguar]
Centii A-Type Small Armor Repairer
Capacitor Power Relay II
Entropic Radiation Sink II
Centus C-Type Explosive Armor Hardener

Federation Navy Stasis Webifier
Federation Navy Stasis Webifier
Coreli A-Type 1MN Afterburner

Veles Light Entropic Disintegrator, Meson Exotic Plasma S

Small Auxiliary Nano Pump II
Small Capacitor Control Circuit II


Warrior II x5


Mystic S x2000
Baryon Exotic Plasma S x2000
Tetryon Exotic Plasma S x2000
Occult S x2000
Meson Exotic Plasma S x2000`,
  'nergal-sansha': `[Nergal, Anomic Agent Sansha]
Centii A-Type Small Armor Repairer
Overdrive Injector System II
Entropic Radiation Sink II
Centus C-Type EM Armor Hardener

Federation Navy Stasis Webifier
Coreli A-Type 1MN Afterburner
Republic Fleet Small Cap Battery

Veles Light Entropic Disintegrator, Mystic S

Small Auxiliary Nano Pump II
Small Capacitor Control Circuit II


Mystic S x2000`,
  'nergal-serpentis': `[Nergal, Anomic Agent Serpentis]
Centus C-Type Kinetic Armor Hardener
Centii A-Type Small Armor Repairer
Entropic Radiation Sink II
Centus C-Type Kinetic Armor Hardener

Federation Navy Stasis Webifier
Caldari Navy Stasis Webifier
Republic Fleet Small Cap Battery

Veles Light Entropic Disintegrator, Baryon Exotic Plasma S
Small Tractor Beam I

Small Auxiliary Nano Pump II
Small Capacitor Control Circuit II


Warrior II x5


Baryon Exotic Plasma S x2000`,
  'nergal-vengeance': `[Nergal, Anomic Team Vengeance]
Centii A-Type Small Armor Repairer
Entropic Radiation Sink II
Entropic Radiation Sink II
Centus C-Type EM Armor Hardener

Federation Navy Stasis Webifier
Republic Fleet Small Cap Battery
Coreli A-Type 1MN Afterburner

Veles Light Entropic Disintegrator, Occult S

Small Auxiliary Nano Pump II
Small Capacitor Control Circuit II


Hobgoblin II x5


Mystic S x2000
Baryon Exotic Plasma S x2000
Tetryon Exotic Plasma S x2000
Occult S x2000
Meson Exotic Plasma S x2000`,
  'onyx-blood-base': `[Onyx, Anomic Base Blood Raiders]
Caldari Navy Ballistic Control System
Caldari Navy Ballistic Control System
Caldari Navy Ballistic Control System
Missile Guidance Enhancer II

Pithum C-Type EM Shield Amplifier
Pithum C-Type EM Shield Amplifier
Shield Boost Amplifier II
X-Large Ancillary Shield Booster
Large Shield Extender II
Large Shield Extender II

Rapid Light Missile Launcher II, Caldari Navy Scourge Light Missile
Rapid Light Missile Launcher II, Caldari Navy Scourge Light Missile
Rapid Light Missile Launcher II, Caldari Navy Scourge Light Missile
Rapid Light Missile Launcher II, Caldari Navy Scourge Light Missile
Rapid Light Missile Launcher II, Caldari Navy Scourge Light Missile
Small Tractor Beam II

Medium Warhead Calefaction Catalyst II
Medium EM Shield Reinforcer II


Caldari Navy Scourge Light Missile x1000
Scourge Fury Light Missile x1000
Navy Cap Booster 400 x40`,
  'vagabond-serpentis-base': `[Vagabond, Anomic Base Serpentis]
Gyrostabilizer II
Gyrostabilizer II
Gyrostabilizer II
Overdrive Injector System II
Damage Control II

Shadow Serpentis 50MN Microwarpdrive
Pith X-Type Kinetic Shield Hardener
Pith C-Type Large Shield Booster
Medium F-RX Compact Capacitor Booster

425mm AutoCannon II, Hail M
425mm AutoCannon II, Hail M
425mm AutoCannon II, Hail M
425mm AutoCannon II, Hail M
425mm AutoCannon II, Hail M
[Empty High slot]

Medium Core Defense Capacitor Safeguard II
Medium Thermal Shield Reinforcer II


Hobgoblin II x5


Hail M x2000
Cap Booster 800 x20`,
  'vigilant-angel-base': `[Vigilant, Anomic Base Angel]
Medium Armor Repairer II
Multispectrum Energized Membrane II
Magnetic Field Stabilizer II
Explosive Armor Hardener II
Magnetic Field Stabilizer II
Explosive Armor Hardener II

Medium F-RX Compact Capacitor Booster
Stasis Webifier II
Stasis Webifier II
Stasis Webifier II

Heavy Neutron Blaster II, Void M
Heavy Neutron Blaster II, Void M
Heavy Neutron Blaster II, Void M
Heavy Neutron Blaster II, Void M
Heavy Neutron Blaster II, Void M

Medium Auxiliary Nano Pump II
Medium EM Armor Reinforcer II
Medium Nanobot Accelerator I


Hornet I x10


Void M x2000
Cap Booster 800 x20`,
};
