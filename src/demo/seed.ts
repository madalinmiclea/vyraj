import { loadSde, type Sde } from '../data/sde';
import { mutate, mutationRows, type Mutable } from '../engine/mutation';
import type { FitDrone } from '../engine/fit';
import { loadItems, allEveItems } from '../data/items';
import { parseEft } from '../io/eft';
import { saveJson } from '../storage';
import { doctrineFit, newDoctrine, saveDoctrines } from '../fitting/doctrines';
import { WTM_DOCTRINES } from './wtmDoctrines';
import { saveRuns, WEATHERS, type AbyssalRun } from '../services/abyssal';
import { saveAlerts, type PriceAlert } from '../services/alerts';
import { tx } from '../i18n';
import { saveLog } from '../services/incursions';
import { demoIncursionLog } from './incursionLog';
import { demoNoticeLog } from './notices';
import { saveLog as saveNoticeLog } from '../services/notices';
import { saveEscalations } from '../services/escalations';
import { loadMissions, sectionOf } from '../services/missions';
import { DEMO_ID } from './identity';
import { OPEN_KEY, CURRENT_KEY } from '../fitting/shared';
import { loadCosmos, loadDone, saveDone, doneKey } from '../services/cosmos';
import { getActiveCharacterId } from '../character/characters';

const DAY = 86_400_000;

const ISHTAR = `[Ishtar, Ishtar anomalies]
Drone Damage Amplifier II
Drone Damage Amplifier II
Drone Damage Amplifier II
Drone Damage Amplifier II
Power Diagnostic System II
Omnidirectional Tracking Enhancer II

Large Shield Extender II
Large Shield Extender II
Multispectrum Shield Hardener II
10MN Afterburner II

Drone Link Augmentor II

Medium Core Defense Field Extender I
Medium Core Defense Field Extender I

Ogre II x5
Hammerhead II x5
Hobgoblin II x5`;

const VENTURE = `[Venture, Venture mining]
Mining Laser Upgrade II

1MN Afterburner II
Small Shield Extender II

Miner II
Miner II`;

const RETRIEVER = `[Retriever, Retriever ore]
Mining Laser Upgrade II
Mining Laser Upgrade II

Medium Shield Extender II
Multispectrum Shield Hardener II

Strip Miner I
Strip Miner I

Medium Core Defense Field Extender I`;

const GILA = `[Gila, Gila T4 abyssal]
Drone Damage Amplifier II
Drone Damage Amplifier II
Damage Control II

Large Shield Extender II
Multispectrum Shield Hardener II
Multispectrum Shield Hardener II
Large Shield Extender II
10MN Afterburner II

Rapid Light Missile Launcher II, Scourge Fury Light Missile
Rapid Light Missile Launcher II, Scourge Fury Light Missile

Medium Core Defense Field Extender I
Medium Core Defense Field Extender I
Medium Core Defense Field Extender I

Vespa II x2`;

const JACKDAW = `[Jackdaw, Jackdaw missions]
Ballistic Control System II
Micro Auxiliary Power Core II
Damage Control II

Medium Shield Extender II
Medium Shield Extender II
Multispectrum Shield Hardener II
Multispectrum Shield Hardener II
1MN Monopropellant Enduring Afterburner

Arbalest Compact Light Missile Launcher, Scourge Light Missile
Arbalest Compact Light Missile Launcher, Scourge Light Missile
Arbalest Compact Light Missile Launcher, Scourge Light Missile
Arbalest Compact Light Missile Launcher, Scourge Light Missile
Arbalest Compact Light Missile Launcher, Scourge Light Missile

Small Core Defense Field Extender I
Small Core Defense Field Extender I
Small Core Defense Field Extender I`;

const THANATOS = `[Thanatos, Thanatos ratting]
Fighter Support Unit II
Fighter Support Unit II
Damage Control II
Capital Armor Repairer II
Multispectrum Energized Membrane II
Multispectrum Energized Membrane II

Capital Capacitor Booster II, Navy Cap Booster 3200
Omnidirectional Tracking Link II
Omnidirectional Tracking Link II
Sensor Booster II
50000MN Microwarpdrive II

Networked Sensor Array

Capital Trimark Armor Pump I
Capital Trimark Armor Pump I
Capital Auxiliary Nano Pump I

Firbolg II x27
Dromi II x12`;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function abyssalRuns(now: number): AbyssalRun[] {
  const r = rng(4242);
  const out: AbyssalRun[] = [];
  for (let i = 0; i < 18; i++) {
    const tier = r() < 0.6 ? 3 : r() < 0.7 ? 2 : 4;
    const weather = WEATHERS[Math.floor(r() * WEATHERS.length)];
    const filamentCost = [180_000, 900_000, 3_500_000, 11_000_000, 24_000_000][tier];
    const loss = tier === 4 && r() < 0.25;
    out.push({
      id: `demo-run-${i}`,
      date: now - Math.floor((i * 1.6 + r()) * DAY),
      tier,
      weather,
      ship: 'Gila',
      minutes: 15 + Math.round(r() * 5),
      filamentCost,
      lootValue: loss ? 0 : Math.round([4e6, 9e6, 18e6, 42e6, 86e6][tier] * (0.5 + r())),
      shipLoss: loss ? 310_000_000 : 0,
    });
  }
  return out;
}

function mutateDemo(sde: Sde, target: Mutable | undefined, pick: RegExp, seed: number) {
  const mps = target ? sde.mutaplasmidsFor(target.typeId) : [];
  const mp = mps.find((x) => pick.test(x.name)) ?? mps[0];
  if (!target || !mp) return;
  const r = rng(seed);
  mutate(sde, target, mp);
  for (const row of mutationRows(sde, target)) {
    const toward = r() < 0.75 ? (row.highIsGood ? row.max : row.min) : (row.highIsGood ? row.min : row.max);
    target.mutation!.values[row.attrId] = row.base + (toward - row.base) * (0.3 + r() * 0.5);
  }
}

function splitDrone(sde: Sde, drones: FitDrone[], name: string): FitDrone | undefined {
  const typeId = sde.findType(name)?.id;
  const i = drones.findIndex((d) => d.typeId === typeId && d.count > 1);
  if (i < 0) return undefined;
  const d = drones[i];
  const one: FitDrone = { ...d, count: 1, active: Math.min(1, d.active) };
  drones[i] = { ...d, count: d.count - 1, active: Math.min(d.count - 1, d.active - one.active) };
  drones.splice(i + 1, 0, one);
  return one;
}

async function seedCosmos() {
  const data = await loadCosmos().catch(() => null);
  const line = data?.lines.find((l) => l.id === 'caldari') ?? data?.lines[0];
  if (!line) return;
  const done = loadDone(getActiveCharacterId());
  for (const a of line.agents.filter((x) => x.sec === 'high').slice(0, 9)) done.a.add(doneKey(line.id, a.n));
  for (const x of line.sites.filter((x) => x.sec === 'high').slice(0, 4)) done.s.add(doneKey(line.id, x.n));
  for (const x of line.items.slice(0, 12)) done.i.add(doneKey(line.id, x.n));
  saveDone(getActiveCharacterId(), done);
}

export async function seedDemo(): Promise<void> {
  const [sde] = await Promise.all([loadSde(), loadItems()]);
  const fit = (text: string) => parseEft(sde, text).fit;
  const fits = [ISHTAR, GILA, JACKDAW, THANATOS, RETRIEVER, VENTURE].map(fit);
  mutateDemo(sde, splitDrone(sde, fits[0].drones, 'Ogre II'), /Exigent Heavy Drone Firepower/, 4242);
  mutateDemo(sde, fits[1].slots.mid.find((m) => m?.typeId === sde.findType('Large Shield Extender II')?.id) ?? undefined, /^Gravid Large Shield Extender/, 4343);
  for (const f of fits) f.mode ??= sde.modesFor(f.shipId)[0]?.id;
  saveJson('eve-fit:saved-fits', fits);
  saveJson(OPEN_KEY, { fits: [fits[0]], active: 0 });
  saveJson(CURRENT_KEY, fits[0]);
  saveJson('eve-industry:calc', { product: 'Hammerhead II', me: 10, te: 20, runs: 10 });
  await seedCosmos();
  saveDoctrines(WTM_DOCTRINES.map((w) => {
    const doctrine = newDoctrine(w.name);
    doctrine.notes = w.fits.some(([, tier]) => tier)
      ? tx('Fiturile flotei de incursiuni Warp To Me (wtmincursions.com/doctrines), pe tier: Optimal, Intermediate și Starter.')
      : tx('Fiturile flotei de incursiuni Warp To Me (wtmincursions.com/doctrines).');
    doctrine.fits = w.fits.map(([role, tier, text]) => {
      const f = fit(text);
      if (tier) f.name = `${f.name} · ${tier}`;
      return doctrineFit(sde, f, role);
    });
    return doctrine;
  }));
  const now = Date.now();
  saveRuns(abyssalRuns(now));
  const typeOf = (name: string) => allEveItems.find((i) => i.n === name)?.t;
  const alerts: Omit<PriceAlert, 'id'>[] = [
    { typeId: typeOf('PLEX') ?? 44992, name: 'PLEX', side: 'sell', op: 'below', price: 4_500_000 },
    { typeId: typeOf('Ishtar') ?? 12005, name: 'Ishtar', side: 'sell', op: 'below', price: 125_000_000 },
    { typeId: typeOf('Large Skill Injector') ?? 40520, name: 'Large Skill Injector', side: 'buy', op: 'above', price: 900_000_000 },
  ];
  saveAlerts(alerts.map((a, i) => ({ ...a, id: `demo-alert-${i}` })));
  saveLog(await demoIncursionLog(now));
  saveNoticeLog(demoNoticeLog(now, tx('Pilot demo')));
  const ded = (await loadMissions().catch(() => null))?.missions.filter((m) => sectionOf(m) === 'ded' && (m.rating ?? 0) >= 4 && (m.rating ?? 0) <= 6) ?? [];
  saveEscalations(ded.slice(0, 3).map((m, i) => ({ id: `demo-esc-${i}`, char: DEMO_ID, name: m.name, system: [30001262, 30001264, 30001261][i], at: now - [3, 17, 30][i] * 3_600_000, hours: 24, note: '', done: i === 2 })));
}
