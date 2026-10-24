import { Category, type Sde } from '../data/sde';
import type { Dogma, DogmaItem } from './dogma';
import { simulateCapacitor, type CapCycle, type CapResult } from './capacitor';
import { slotCounts, SLOT_KINDS, type Fit, type SlotKind } from './fit';
import type { DamageProfile } from './profiles';
import { tx } from '../i18n';
import { projectedCapCycles, projectedFlow } from './projected';

export type DamageType = 'em' | 'thermal' | 'kinetic' | 'explosive';
export const DAMAGE_TYPES: DamageType[] = ['em', 'thermal', 'kinetic', 'explosive'];
export type Damage = Record<DamageType, number>;

const DAMAGE_ATTR: Record<DamageType, string> = { em: 'emDamage', thermal: 'thermalDamage', kinetic: 'kineticDamage', explosive: 'explosiveDamage' };

const zero = (): Damage => ({ em: 0, thermal: 0, kinetic: 0, explosive: 0 });
const sum = (d: Damage) => d.em + d.thermal + d.kinetic + d.explosive;
const scale = (d: Damage, k: number): Damage => ({ em: d.em * k, thermal: d.thermal * k, kinetic: d.kinetic * k, explosive: d.explosive * k });
const add = (a: Damage, b: Damage): Damage => ({ em: a.em + b.em, thermal: a.thermal + b.thermal, kinetic: a.kinetic + b.kinetic, explosive: a.explosive + b.explosive });

export interface Resource { used: number; total: number }

export interface Resources {
  cpu: Resource;
  power: Resource;
  calibration: Resource;
  droneBandwidth: Resource;
  droneBay: Resource;
  fighterBay: Resource;
  fighterTubes: Resource;
  fighterLight: Resource;
  fighterSupport: Resource;
  fighterHeavy: Resource;
  turrets: Resource;
  launchers: Resource;
  slots: Record<SlotKind, Resource>;
}

const isOnline = (m: DogmaItem) => m.state !== 'offline';
const isFighter = (sde: Sde, typeId: number) => sde.types.get(typeId)?.categoryId === Category.Fighter;

export function resources(sde: Sde, fit: Fit, d: Dogma): Resources {
  const ship = d.ship;
  const counts = slotCounts(sde, fit, d);
  const mods = d.modules;
  const turrets = mods.filter((m) => sde.hasEffect(m.typeId, 'turretFitted')).length;
  const launchers = mods.filter((m) => sde.hasEffect(m.typeId, 'launcherFitted')).length;
  const activeDrones = d.drones.filter((x) => !isFighter(sde, x.item.typeId)).reduce((a, x) => a + x.item.get('droneBandwidthUsed') * x.count, 0);
  const volume = (typeId: number) => sde.baseAttr(typeId, sde.attrId('volume'));
  const bayVolume = fit.drones.filter((x) => !isFighter(sde, x.typeId)).reduce((a, x) => a + volume(x.typeId) * x.count, 0);
  const squads = fit.drones.filter((x) => isFighter(sde, x.typeId));
  const squadSize = (typeId: number) => sde.baseAttr(typeId, sde.attrId('fighterSquadronMaxSize')) || 1;
  const fighterVolume = squads.reduce((a, x) => a + volume(x.typeId) * squadSize(x.typeId) * x.count, 0);
  const launchedSquads = squads.filter((x) => x.active > 0);
  const squadsOf = (attr: string) => launchedSquads.filter((x) => sde.baseAttr(x.typeId, sde.attrId(attr)) > 0).reduce((a, x) => a + x.active, 0);

  const slots = Object.fromEntries(SLOT_KINDS.map((k) => [k, { used: fit.slots[k].filter(Boolean).length, total: counts[k] }])) as Record<SlotKind, Resource>;

  return {
    cpu: { used: mods.filter(isOnline).reduce((a, m) => a + m.get('cpu'), 0), total: ship.get('cpuOutput') },
    power: { used: mods.filter(isOnline).reduce((a, m) => a + m.get('power'), 0), total: ship.get('powerOutput') },
    calibration: { used: mods.reduce((a, m) => a + m.get('upgradeCost'), 0), total: ship.get('upgradeCapacity') },
    droneBandwidth: { used: activeDrones, total: ship.get('droneBandwidth') },
    droneBay: { used: bayVolume, total: ship.get('droneCapacity') },
    fighterBay: { used: fighterVolume, total: ship.get('fighterCapacity') },
    fighterTubes: { used: launchedSquads.reduce((a, x) => a + x.active, 0), total: Math.round(ship.get('fighterTubes')) },
    fighterLight: { used: squadsOf('fighterSquadronIsLight'), total: Math.round(ship.get('fighterLightSlots')) },
    fighterSupport: { used: squadsOf('fighterSquadronIsSupport'), total: Math.round(ship.get('fighterSupportSlots')) },
    fighterHeavy: { used: squadsOf('fighterSquadronIsHeavy'), total: Math.round(ship.get('fighterHeavySlots')) },
    turrets: { used: turrets, total: Math.round(ship.get('turretSlotsLeft')) },
    launchers: { used: launchers, total: Math.round(ship.get('launcherSlotsLeft')) },
    slots,
  };
}

export function validate(sde: Sde, fit: Fit, d: Dogma, r: Resources): string[] {
  const out: string[] = [];
  const over = (res: Resource, label: string) => { if (res.used > res.total + 1e-6) out.push(tx('{label} depășit: {used} / {total}', { label, used: round(res.used), total: round(res.total) })); };
  over(r.cpu, 'CPU');
  over(r.power, 'Powergrid');
  over(r.calibration, 'Calibration');
  over(r.droneBandwidth, 'Drone bandwidth');
  over(r.droneBay, 'Drone bay');
  over(r.fighterBay, 'Fighter bay');
  over(r.fighterTubes, 'Fighter tubes');
  over(r.fighterLight, 'Light fighters');
  over(r.fighterSupport, 'Support fighters');
  over(r.fighterHeavy, 'Heavy fighters');
  over(r.turrets, 'Turret hardpoints');
  over(r.launchers, 'Launcher hardpoints');
  for (const k of SLOT_KINDS) over(r.slots[k], tx('Sloturi {k}', { k }));

  const maxDrones = d.character.get('maxActiveDrones');
  const launched = fit.drones.filter((x) => !isFighter(sde, x.typeId)).reduce((a, x) => a + x.active, 0);
  if (launched > maxDrones) out.push(tx('Prea multe drone lansate: {n} / {max} (skill-ul Drones)', { n: launched, max: maxDrones }));

  const byGroup = new Map<number, number>();
  for (const m of d.modules) byGroup.set(m.groupId, (byGroup.get(m.groupId) ?? 0) + 1);
  for (const m of d.modules) {
    const max = sde.baseAttr(m.typeId, sde.attrId('maxGroupFitted'));
    if (max > 0 && (byGroup.get(m.groupId) ?? 0) > max) {
      out.push(tx('Maxim {max} × {group} pe navă', { max, group: sde.groups.get(m.groupId)?.name ?? tx('grup') }));
      byGroup.set(m.groupId, 0);
    }
  }
  const activeByGroup = new Map<number, number>();
  for (const m of d.modules.filter((x) => x.state === 'active' || x.state === 'overheated')) activeByGroup.set(m.groupId, (activeByGroup.get(m.groupId) ?? 0) + 1);
  for (const [g, n] of activeByGroup) {
    const sample = d.modules.find((m) => m.groupId === g)!;
    const max = sde.baseAttr(sample.typeId, sde.attrId('maxGroupActive'));
    if (max > 0 && n > max) out.push(tx('Maxim {max} × {group} activ', { max, group: sde.groups.get(g)?.name ?? tx('grup') }));
  }
  return out;
}

export interface WeaponStat {
  name: string;
  count: number;
  kind: 'turret' | 'missile' | 'drone' | 'fighter';
  volley: Damage;
  dps: Damage;
  range?: number;
  falloff?: number;
}

export interface Offense {
  weapons: WeaponStat[];
  weaponDps: number;
  droneDps: number;
  totalDps: number;
  totalVolley: number;
  dps: Damage;
}

const FIGHTER_ABILITIES = [
  { effect: 'fighterAbilityAttackM', prefix: 'fighterAbilityAttackMissileDamage', multiplier: 'fighterAbilityAttackMissileDamageMultiplier', duration: 'fighterAbilityAttackMissileDuration', range: 'fighterAbilityAttackMissileRangeOptimal' },
  { effect: 'fighterAbilityMissiles', prefix: 'fighterAbilityMissilesDamage', multiplier: 'fighterAbilityMissilesDamageMultiplier', duration: 'fighterAbilityMissilesDuration', range: 'fighterAbilityMissilesRange' },
];

const TURRET_EFFECTS = ['targetAttack', 'projectileFired', 'targetDisintegratorAttack'];

function chargeDamage(charge: DogmaItem | undefined): Damage {
  const out = zero();
  if (!charge) return out;
  for (const t of DAMAGE_TYPES) out[t] = charge.get(DAMAGE_ATTR[t]);
  return out;
}

export function offense(sde: Sde, d: Dogma): Offense {
  const weapons: WeaponStat[] = [];
  const push = (w: WeaponStat) => {
    const same = weapons.find((x) => x.name === w.name && x.kind === w.kind);
    if (same) {
      same.count += w.count;
      same.volley = add(same.volley, w.volley);
      same.dps = add(same.dps, w.dps);
    } else weapons.push(w);
  };

  for (const m of d.modules) {
    if (m.state !== 'active' && m.state !== 'overheated') continue;
    const cycle = m.get('speed') / 1000;
    if (cycle <= 0) continue;
    const label = m.other ? `${m.type.name} · ${m.other.type.name}` : m.type.name;
    if (TURRET_EFFECTS.some((e) => sde.hasEffect(m.typeId, e)) && m.other) {
      const volley = scale(chargeDamage(m.other), m.get('damageMultiplier'));
      push({ name: label, count: 1, kind: 'turret', volley, dps: scale(volley, 1 / cycle), range: m.get('maxRange'), falloff: m.get('falloff') });
    } else if (sde.hasEffect(m.typeId, 'useMissiles') && m.other) {
      const volley = scale(chargeDamage(m.other), d.character.get('missileDamageMultiplier'));
      const range = m.other.get('maxVelocity') * (m.other.get('explosionDelay') / 1000);
      push({ name: label, count: 1, kind: 'missile', volley, dps: scale(volley, 1 / cycle), range });
    }
  }

  for (const { item, count } of d.drones) {
    if (isFighter(sde, item.typeId)) {
      const size = item.get('fighterSquadronMaxSize') || 1;
      let volley = zero();
      let dps = zero();
      let range = 0;
      for (const ab of FIGHTER_ABILITIES) {
        if (!sde.hasEffect(item.typeId, ab.effect)) continue;
        const seconds = item.get(ab.duration) / 1000;
        if (seconds <= 0) continue;
        const v = scale({ em: item.get(ab.prefix + 'EM'), thermal: item.get(ab.prefix + 'Therm'), kinetic: item.get(ab.prefix + 'Kin'), explosive: item.get(ab.prefix + 'Exp') }, (item.get(ab.multiplier) || 1) * size * count);
        volley = add(volley, v);
        dps = add(dps, scale(v, 1 / seconds));
        range = Math.max(range, ab.range ? item.get(ab.range) : 0);
      }
      if (sum(dps) > 0) push({ name: item.type.name, count, kind: 'fighter', volley, dps, range: range || undefined });
      continue;
    }
    if (!sde.hasEffect(item.typeId, 'targetAttack') && !sde.hasEffect(item.typeId, 'projectileFired')) continue;
    const cycle = item.get('speed') / 1000;
    if (cycle <= 0) continue;
    const volley = scale(chargeDamage(item), item.get('damageMultiplier') * count);
    push({ name: item.type.name, count, kind: 'drone', volley, dps: scale(volley, 1 / cycle), range: item.get('maxRange') });
  }

  const weaponDps = weapons.filter((w) => w.kind !== 'drone' && w.kind !== 'fighter').reduce((a, w) => a + sum(w.dps), 0);
  const droneDps = weapons.filter((w) => w.kind === 'drone' || w.kind === 'fighter').reduce((a, w) => a + sum(w.dps), 0);
  return {
    weapons,
    weaponDps,
    droneDps,
    totalDps: weaponDps + droneDps,
    totalVolley: weapons.reduce((a, w) => a + sum(w.volley), 0),
    dps: weapons.reduce((a, w) => add(a, w.dps), zero()),
  };
}

export type Layer = 'shield' | 'armor' | 'hull';
export const LAYERS: Layer[] = ['shield', 'armor', 'hull'];

const RESONANCE: Record<Layer, Record<DamageType, string>> = {
  shield: { em: 'shieldEmDamageResonance', thermal: 'shieldThermalDamageResonance', kinetic: 'shieldKineticDamageResonance', explosive: 'shieldExplosiveDamageResonance' },
  armor: { em: 'armorEmDamageResonance', thermal: 'armorThermalDamageResonance', kinetic: 'armorKineticDamageResonance', explosive: 'armorExplosiveDamageResonance' },
  hull: { em: 'emDamageResonance', thermal: 'thermalDamageResonance', kinetic: 'kineticDamageResonance', explosive: 'explosiveDamageResonance' },
};

const HP_ATTR: Record<Layer, string> = { shield: 'shieldCapacity', armor: 'armorHP', hull: 'hp' };

export interface LayerStat {
  hp: number;
  resists: Damage;
  ehp: number;
}

export interface Defense {
  layers: Record<Layer, LayerStat>;
  hp: number;
  ehp: number;
  repairs: Record<Layer, { raw: number; effective: number }>;
  passiveShield: { raw: number; effective: number };
  activeTank: number;
}

export function profileWeights(p: DamageProfile): Damage {
  const total = p.em + p.thermal + p.kinetic + p.explosive || 1;
  return { em: p.em / total, thermal: p.thermal / total, kinetic: p.kinetic / total, explosive: p.explosive / total };
}

export function defense(sde: Sde, d: Dogma, profile: DamageProfile): Defense {
  const ship = d.ship;
  const w = profileWeights(profile);
  const layers = {} as Record<Layer, LayerStat>;
  const factor = {} as Record<Layer, number>;
  for (const l of LAYERS) {
    const res = zero();
    let f = 0;
    for (const t of DAMAGE_TYPES) {
      const resonance = ship.get(RESONANCE[l][t]);
      res[t] = 1 - resonance;
      f += w[t] * resonance;
    }
    factor[l] = f || 1;
    const hp = ship.get(HP_ATTR[l]);
    layers[l] = { hp, resists: res, ehp: hp / factor[l] };
  }

  const repairs = { shield: { raw: 0, effective: 0 }, armor: { raw: 0, effective: 0 }, hull: { raw: 0, effective: 0 } };
  for (const m of d.modules) {
    if (m.state !== 'active' && m.state !== 'overheated') continue;
    const cycle = m.get('duration') / 1000;
    if (cycle <= 0) continue;
    if (sde.hasEffect(m.typeId, 'shieldBoosting') || sde.hasEffect(m.typeId, 'fueledShieldBoosting')) {
      repairs.shield.raw += m.get('shieldBonus') / cycle;
    } else if (sde.hasEffect(m.typeId, 'armorRepair')) {
      repairs.armor.raw += m.get('armorDamageAmount') / cycle;
    } else if (sde.hasEffect(m.typeId, 'fueledArmorRepair')) {
      const paste = m.other ? m.get('chargedArmorDamageMultiplier') || 1 : 1;
      repairs.armor.raw += (m.get('armorDamageAmount') * paste) / cycle;
    } else if (sde.hasEffect(m.typeId, 'structureRepair')) {
      repairs.hull.raw += m.get('structureDamageAmount') / cycle;
    }
  }
  const flow = projectedFlow(d);
  repairs.shield.raw += flow.shield;
  repairs.armor.raw += flow.armor;
  repairs.hull.raw += flow.hull;
  for (const l of LAYERS) repairs[l].effective = repairs[l].raw / factor[l];

  const rechargeSec = ship.get('shieldRechargeRate') / 1000;
  const passiveRaw = rechargeSec > 0 ? (2.5 * layers.shield.hp) / rechargeSec : 0;
  const passiveShield = { raw: passiveRaw, effective: passiveRaw / factor.shield };

  return {
    layers,
    hp: LAYERS.reduce((a, l) => a + layers[l].hp, 0),
    ehp: LAYERS.reduce((a, l) => a + layers[l].ehp, 0),
    repairs,
    passiveShield,
    activeTank: LAYERS.reduce((a, l) => a + repairs[l].effective, 0),
  };
}

export interface CapacitorStat extends CapResult {
  drains: { name: string; perSecond: number }[];
  grossUsage: number;
}

export function capacitor(sde: Sde, d: Dogma): CapacitorStat {
  const ship = d.ship;
  const drains: { name: string; perSecond: number }[] = [];
  const cycles: CapCycle[] = [];
  for (const m of d.modules) {
    if (m.state !== 'active' && m.state !== 'overheated') continue;
    const effect = activeEffect(sde, m);
    if (!effect) continue;
    const duration = effect.durationAttributeId ? m.attr(effect.durationAttributeId) / 1000 : 0;
    if (duration <= 0) continue;
    const need = effect.dischargeAttributeId ? m.attr(effect.dischargeAttributeId) : 0;
    if (need !== 0) { drains.push({ name: m.type.name, perSecond: need / duration }); cycles.push({ need, duration }); }
    if (effect.name === 'powerBooster' && m.other) {
      drains.push({ name: `${m.type.name} · ${m.other.type.name}`, perSecond: -m.other.get('capacitorBonus') / duration });
      cycles.push({ need: -m.other.get('capacitorBonus'), duration });
    }
  }
  for (const p of projectedCapCycles(d)) {
    drains.push({ name: p.name, perSecond: p.need / p.duration });
    cycles.push({ need: p.need, duration: p.duration });
  }
  const usage = drains.reduce((a, x) => a + x.perSecond, 0);
  const grossUsage = drains.reduce((a, x) => a + Math.max(0, x.perSecond), 0);
  const result = simulateCapacitor(ship.get('capacitorCapacity'), ship.get('rechargeRate') / 1000, usage, cycles);
  return { ...result, drains, grossUsage };
}

function activeEffect(sde: Sde, m: DogmaItem) {
  return m.type.effects.map((id) => sde.effects.get(id)).find((e) => e && (e.category === 1 || e.category === 2) && e.durationAttributeId);
}

export interface Navigation {
  maxVelocity: number;
  mass: number;
  agility: number;
  alignTime: number;
  warpSpeed: number;
  signatureRadius: number;
}

export function navigation(d: Dogma): Navigation {
  const ship = d.ship;
  const mass = ship.get('mass');
  const agility = ship.get('agility');
  return {
    maxVelocity: ship.get('maxVelocity'),
    mass,
    agility,
    alignTime: (-Math.log(0.25) * agility * mass) / 1e6,
    warpSpeed: ship.get('warpSpeedMultiplier') * ship.get('baseWarpSpeed'),
    signatureRadius: ship.get('signatureRadius'),
  };
}

export interface Targeting {
  maxRange: number;
  scanResolution: number;
  maxLocked: number;
  sensorStrength: number;
  sensorType: string;
}

export function targeting(d: Dogma): Targeting {
  const ship = d.ship;
  const sensors: [string, number][] = [
    ['Radar', ship.get('scanRadarStrength')],
    ['Ladar', ship.get('scanLadarStrength')],
    ['Magnetometric', ship.get('scanMagnetometricStrength')],
    ['Gravimetric', ship.get('scanGravimetricStrength')],
  ];
  const [sensorType, sensorStrength] = sensors.reduce((a, b) => (b[1] > a[1] ? b : a));
  return {
    maxRange: ship.get('maxTargetRange'),
    scanResolution: ship.get('scanResolution'),
    maxLocked: Math.min(ship.get('maxLockedTargets'), d.character.get('maxLockedTargets') || Infinity),
    sensorStrength,
    sensorType,
  };
}

export function lockTime(scanResolution: number, targetSignature: number): number {
  if (!scanResolution || !targetSignature) return 0;
  return Math.min(40000 / scanResolution / Math.asinh(targetSignature) ** 2, 1800);
}

export interface HeatStat {
  name: string;
  slotKey: string;
  damage: number;
  hp: number;
  cycle: number;
  cycles: number;
}

export function heat(d: Dogma): HeatStat[] {
  return d.modules.filter((m) => m.state === 'overheated').map((m) => {
    const damage = m.get('heatDamage');
    const hp = m.get('hp');
    const cycle = (m.get('speed') || m.get('duration')) / 1000;
    return { name: m.type.name, slotKey: m.slotKey ?? '', damage, hp, cycle, cycles: damage > 0 ? Math.ceil(hp / damage) : Infinity };
  });
}

export interface FitStats {
  heat: HeatStat[];
  resources: Resources;
  warnings: string[];
  offense: Offense;
  defense: Defense;
  capacitor: CapacitorStat;
  navigation: Navigation;
  targeting: Targeting;
}

export function computeStats(sde: Sde, fit: Fit, d: Dogma, profile: DamageProfile): FitStats {
  const res = resources(sde, fit, d);
  return {
    resources: res,
    warnings: validate(sde, fit, d, res),
    offense: offense(sde, d),
    defense: defense(sde, d, profile),
    capacitor: capacitor(sde, d),
    navigation: navigation(d),
    targeting: targeting(d),
    heat: heat(d),
  };
}

export function isWeaponOrDroneCategory(categoryId: number) {
  return categoryId === Category.Drone || categoryId === Category.Fighter;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
