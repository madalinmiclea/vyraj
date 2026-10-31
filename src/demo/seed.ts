import { loadSde } from '../data/sde';
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

const DAY = 86_400_000;

const ISHTAR = `[Ishtar, Ishtar anomalies]
Drone Damage Amplifier II
Drone Damage Amplifier II
Drone Damage Amplifier II
Drone Damage Amplifier II
Power Diagnostic System II

Large Shield Extender II
Large Shield Extender II
Multispectrum Shield Hardener II
10MN Afterburner II
Omnidirectional Tracking Link II

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

export async function seedDemo(): Promise<void> {
  const [sde] = await Promise.all([loadSde(), loadItems()]);
  const fit = (text: string) => parseEft(sde, text).fit;
  const fits = [ISHTAR, GILA, RETRIEVER, VENTURE].map(fit);
  saveJson('eve-fit:saved-fits', fits);
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
}
