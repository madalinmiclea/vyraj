import { Category, type Sde, type TypeInfo } from '../data/sde';
import { allEveItems } from '../data/items';
import { addToFit, buildDogma, canLoadCharge, emptyFit, slotCounts, slotOf, type CharacterSkills, type Fit, type FitModule, type SlotKind } from './fit';
import { applyChecked, violations } from './rules';
import { capacitor, offense, resources } from './stats';
import type { Dogma } from './dogma';

export type StarterKind = 'pve' | 'pvp';

type Tank = 'shield' | 'armor';

interface Role {
  slot: SlotKind;
  match: (t: TypeInfo) => boolean;
  strength?: (t: TypeInfo) => number;
  max?: number;
  powerShare?: number;
  when?: () => boolean;
}

const DAMAGE_MOD_GROUPS = ['Gyrostabilizer', 'Magnetic Field Stabilizer', 'Heat Sink', 'Ballistic Control System', 'Entropic Radiation Sink', 'Vorton Projector Upgrade'];
const SHIELD_ATTRS = ['shieldCapacity', 'shieldBonus', 'shieldEmDamageResonance', 'shieldThermalDamageResonance', 'shieldKineticDamageResonance', 'shieldExplosiveDamageResonance', 'shieldRechargeRate'];
const ARMOR_ATTRS = ['armorHP', 'armorDamageAmount', 'armorEmDamageResonance', 'armorThermalDamageResonance', 'armorKineticDamageResonance', 'armorExplosiveDamageResonance'];
const ENGAGE_RANGE = [10000, 15000, 30000, 45000, 60000];
const SIZE_TOKENS: [RegExp, number][] = [
  [/\b(Small|1MN|5MN)\b/, 1],
  [/\b(Medium|10MN|50MN)\b/, 2],
  [/\b(Large|X-Large|100MN|500MN)\b/, 3],
  [/\bCapital\b/, 4],
];

let poolCache: { sde: Sde; size: number; list: TypeInfo[] } | null = null;

function starterPool(sde: Sde): TypeInfo[] {
  if (poolCache?.sde === sde && poolCache.size === allEveItems.length) return poolCache.list;
  const market = new Set(allEveItems.map((i) => i.t));
  const list = [...sde.types.values()].filter((t) => (market.size === 0 || market.has(t.id)) && (t.metaGroupId === 1 || t.metaGroupId === 2) && !/\b(Civilian|Polarized)\b/.test(t.name)
    && (t.categoryId === Category.Module || t.categoryId === Category.Drone || t.categoryId === Category.Charge || t.categoryId === Category.Fighter));
  poolCache = { sde, size: allEveItems.length, list };
  return list;
}

function sizeOf(name: string): number {
  return SIZE_TOKENS.find(([re]) => re.test(name))?.[1] ?? 0;
}

export function canBuildStarter(sde: Sde, shipId: number): boolean {
  const ship = sde.types.get(shipId);
  if (!ship || ship.categoryId !== Category.Ship) return false;
  const counts = slotCounts(sde, emptyFit(shipId));
  return counts.high + counts.mid + counts.low + counts.subsystem > 0;
}

export function buildStarterFit(sde: Sde, shipId: number, kind: StarterKind, character: CharacterSkills, name: string, notes: string): Fit {
  const pool = starterPool(sde);
  const attr = (n: string) => (sde.hasAttr(n) ? sde.attrId(n) : -1);
  const base = (id: number, n: string) => (sde.hasAttr(n) ? sde.baseAttr(id, sde.attrId(n)) : 0);
  const skills = character.skills;
  const implants = character.implants ?? [];
  const fit = emptyFit(shipId, name);
  fit.notes = notes;
  const dogma = (f: Fit) => buildDogma(sde, f, character);
  const hullSize = Math.max(1, Math.min(4, Math.round(base(shipId, 'rigSize')) || 1));
  const sizeOk = (t: TypeInfo) => { const s = sizeOf(t.name); return s === 0 || s === hullSize; };
  const fitting = (t: TypeInfo) => base(t.id, 'power') + base(t.id, 'cpu');
  const tier = (t: TypeInfo) => (t.metaGroupId === 2 ? 0 : 1);

  const tryAdd = (typeId: number, powerShare?: number): boolean => {
    if (powerShare != null && base(typeId, 'power') > 0) {
      const r = resources(sde, fit, dogma(fit));
      if (base(typeId, 'power') > r.power.total * powerShare) return false;
    }
    return applyChecked(sde, fit, skills, (draft) => addToFit(sde, draft, typeId), implants).ok;
  };
  const free = (slot: SlotKind) => {
    const total = slotCounts(sde, fit)[slot];
    return total - fit.slots[slot].filter(Boolean).length;
  };

  fitSubsystems();

  const shipEffects = sde.type(shipId).effects.map((id) => sde.effects.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
  const bonusTargets = new Set(shipEffects.flatMap((e) => e.modifiers.map((m) => m.to)));
  const bonusSkills = new Set(shipEffects.flatMap((e) => e.modifiers.filter((m) => m.s).map((m) => m.s!)));
  const miningSkills = new Set(shipEffects.flatMap((e) => e.modifiers.filter((m) => m.to === attr('miningAmount') && m.s).map((m) => m.s!)));
  const mining = [...miningSkills].some((s) => /^(Mining|Ice Harvesting)$/.test(sde.types.get(s)?.name ?? ''));
  const counts = slotCounts(sde, fit);
  let shieldScore = SHIELD_ATTRS.filter((n) => bonusTargets.has(attr(n))).length * 2;
  let armorScore = ARMOR_ATTRS.filter((n) => bonusTargets.has(attr(n))).length * 2;
  if (counts.mid > counts.low) shieldScore += 1;
  if (counts.low > counts.mid) armorScore += 1;
  if (counts.mid === counts.low) shieldScore += base(shipId, 'shieldCapacity') >= base(shipId, 'armorHP') ? 1 : 0;
  const tank: Tank = shieldScore >= armorScore ? 'shield' : 'armor';

  const hauler = /Industrial|Hauler|Freighter|Transport|Blockade|Shuttle/.test(sde.type(shipId).groupName);
  const weaponKind = mining && kind === 'pve' ? fitMiners() : hauler ? 'none' : fitWeapons();
  fitDrones();
  fitFighters();
  fillRoles(roles());
  fillRoles(fallbackRoles());
  return fit;

  function fitSubsystems() {
    if (base(shipId, 'maxSubSystems') <= 0) return;
    const subs = [...sde.types.values()].filter((t) => t.categoryId === Category.Subsystem && base(t.id, 'fitsToShipType') === shipId && t.metaGroupId !== 2);
    const positions = [...new Set(subs.map((t) => base(t.id, 'subSystemSlot')))];
    const score = (t: TypeInfo) => ['hiSlotModifier', 'medSlotModifier', 'lowSlotModifier', 'turretHardPointModifier', 'launcherHardPointModifier'].reduce((a, n) => a + base(t.id, n), 0);
    for (const p of positions) {
      const best = subs.filter((t) => base(t.id, 'subSystemSlot') === p).sort((a, b) => score(b) - score(a) || a.id - b.id)[0];
      if (best) applyChecked(sde, fit, skills, (draft) => addToFit(sde, draft, best.id), implants);
    }
  }

  function weaponScore(d: Dogma): number {
    const o = offense(sde, d);
    if (kind === 'pvp') return o.weaponDps;
    const range = ENGAGE_RANGE[hullSize];
    return o.weapons.filter((w) => w.kind === 'turret' || w.kind === 'missile').reduce((a, w) => {
      const dps = w.dps.em + w.dps.thermal + w.dps.kinetic + w.dps.explosive;
      if (w.kind === 'missile') return a + dps * ((w.range ?? 0) >= range ? 1 : 0.25);
      const over = Math.max(0, range - (w.range ?? 0));
      const factor = w.falloff ? 0.5 ** ((over / w.falloff) ** 2) : over > 0 ? 0 : 1;
      return a + dps * factor;
    }, 0);
  }

  function chargesFor(moduleId: number): TypeInfo[] {
    return pool.filter((c) => c.categoryId === Category.Charge && canLoadCharge(sde, moduleId, c.id));
  }

  function withWeapons(typeId: number, n: number, chargeId?: number): Fit {
    const f: Fit = { ...fit, slots: { ...fit.slots, high: [...fit.slots.high] } };
    let left = n;
    const total = slotCounts(sde, f).high;
    while (f.slots.high.length < total) f.slots.high.push(null);
    for (let i = 0; i < total && left > 0; i++) {
      if (f.slots.high[i]) continue;
      f.slots.high[i] = { typeId, state: 'active', chargeId } as FitModule;
      left--;
    }
    return f;
  }

  function fitWeapons(): 'turret' | 'missile' | 'none' {
    const highs = free('high');
    if (highs <= 0) return 'none';
    const ship = dogma(fit).ship;
    const turretSlots = Math.round(ship.get('turretSlotsLeft'));
    const launcherSlots = Math.round(ship.get('launcherSlotsLeft'));
    const candidates = pool.filter((t) => t.categoryId === Category.Module && slotOf(sde, t.id) === 'high').filter((t) => {
      if (sde.hasEffect(t.id, 'turretFitted')) {
        const size = Math.round(base(t.id, 'chargeSize'));
        return turretSlots > 0 && (size === 0 || size === hullSize || size === hullSize + 1);
      }
      return launcherSlots > 0 && sde.hasEffect(t.id, 'launcherFitted');
    });
    const empty = resources(sde, fit, dogma(fit));
    const powerCap = empty.power.total * 0.62;
    const cpuCap = empty.cpu.total * 0.55;
    const options: { t: TypeInfo; n: number; score: number }[] = [];
    for (const t of candidates) {
      const loads = chargesFor(t.id);
      if (!loads.length) continue;
      const maxN = Math.min(highs, sde.hasEffect(t.id, 'turretFitted') ? turretSlots : launcherSlots);
      const probe = loads.reduce((a, c) => (damageOf(c) > damageOf(a) ? c : a), loads[0]);
      for (let n = maxN; n >= 1; n--) {
        const f = withWeapons(t.id, n, probe.id);
        const d = dogma(f);
        const r = resources(sde, f, d);
        if (r.power.used > powerCap || r.cpu.used > cpuCap) continue;
        const score = weaponScore(d);
        if (score > 0 || kind === 'pve') options.push({ t, n, score: score * (bonused(t.id, probe.id) ? 1.35 : 1) });
        break;
      }
    }
    if (!options.length) return 'none';
    const ranked = options.sort((a, b) => b.score - a.score);
    const shortlist = ranked.filter((o, i) => i < 6 || bonused(o.t.id, ...chargesFor(o.t.id).map((c) => c.id)));
    let pick: { t: TypeInfo; n: number; chargeId: number; score: number; cost: number } | null = null;
    for (const o of shortlist) {
      for (const c of chargesFor(o.t.id)) {
        const score = weaponScore(dogma(withWeapons(o.t.id, o.n, c.id))) * (bonused(o.t.id, c.id) ? 1.35 : 1);
        const cost = fitting(o.t) * o.n;
        if (score > 0 && (!pick || score > pick.score * 1.02 || (score > pick.score * 0.98 && (tier(o.t) < tier(pick.t) || (tier(o.t) === tier(pick.t) && cost < pick.cost))))) pick = { t: o.t, n: o.n, chargeId: c.id, score, cost };
      }
    }
    if (!pick) return 'none';
    const chosen = pick;
    applyChecked(sde, fit, skills, (draft) => {
      draft.slots.high = withWeapons(chosen.t.id, chosen.n, chosen.chargeId).slots.high;
    }, implants);
    return sde.hasEffect(chosen.t.id, 'turretFitted') ? 'turret' : 'missile';
  }

  function bonused(...ids: number[]): boolean {
    return ids.some((id) => [1, 2, 3].some((k) => bonusSkills.has(base(id, `requiredSkill${k}`))));
  }

  function damageOf(c: TypeInfo): number {
    return ['emDamage', 'thermalDamage', 'kineticDamage', 'explosiveDamage'].reduce((a, n) => a + base(c.id, n), 0);
  }

  function fitMiners(): 'none' {
    const highs = free('high');
    if (highs <= 0) return 'none';
    const candidates = pool.filter((t) => t.categoryId === Category.Module && slotOf(sde, t.id) === 'high' && base(t.id, 'miningAmount') > 0 && sde.hasEffect(t.id, 'miningLaser') && !/\b(Ice|Gas)\b/.test(t.name));
    let best: { typeId: number; n: number; score: number } | null = null;
    for (const t of candidates) {
      for (let n = highs; n >= 1; n--) {
        const f = withWeapons(t.id, n);
        if (violations(sde, f, skills, implants).size) continue;
        const d = dogma(f);
        const score = d.modules.reduce((a, m) => a + (m.get('speed') || m.get('duration') ? m.get('miningAmount') / ((m.get('duration') || m.get('speed')) / 1000) : 0), 0);
        if (!best || score > best.score) best = { typeId: t.id, n, score };
        break;
      }
    }
    if (best) {
      const pick = best;
      applyChecked(sde, fit, skills, (draft) => { draft.slots.high = withWeapons(pick.typeId, pick.n).slots.high; }, implants);
    }
    return 'none';
  }

  function inGroup(...groups: string[]) {
    return (t: TypeInfo) => groups.includes(t.groupName) && sizeOk(t);
  }

  function named(group: string, re: RegExp) {
    return (t: TypeInfo) => t.groupName === group && re.test(t.name) && sizeOk(t);
  }

  function rig(re: RegExp) {
    return (t: TypeInfo) => slotOf(sde, t.id) === 'rig' && re.test(t.name) && base(t.id, 'rigSize') === base(shipId, 'rigSize');
  }

  function damageModRole(max: number): Role {
    let chosen: string | null | undefined;
    const pickGroup = () => {
      if (chosen !== undefined) return chosen;
      chosen = null;
      const before = offense(sde, dogma(fit)).totalDps;
      let gain = 0;
      for (const g of [...DAMAGE_MOD_GROUPS, 'Drone Damage Modules', 'Fighter Support Unit']) {
        const t = pool.filter((x) => x.groupName === g && slotOf(sde, x.id) === 'low').sort((a, b) => tier(a) - tier(b))[0];
        if (!t) continue;
        const probe: Fit = { ...fit, slots: { ...fit.slots, low: [...fit.slots.low, { typeId: t.id, state: 'online' }] } };
        const after = offense(sde, dogma(probe)).totalDps;
        if (after - before > gain + 1e-6) { gain = after - before; chosen = g; }
      }
      return chosen;
    };
    return { slot: 'low', max, match: (t) => t.groupName === pickGroup(), strength: (t) => -base(t.id, 'cpu') };
  }

  function roles(): Role[] {
    const ab = named('Propulsion Module', /Afterburner/);
    const mwd = named('Propulsion Module', /Microwarpdrive/);
    const lows = counts.low;
    const helper: Role = weaponKind === 'turret'
      ? { slot: 'mid', max: 1, match: inGroup('Tracking Computer') }
      : weaponKind === 'missile' ? { slot: 'mid', max: 1, match: inGroup('Missile Guidance Computer') } : { slot: 'mid', max: 1, match: inGroup('Sensor Booster') };
    const capStable = () => capacitor(sde, dogma(fit)).stable;
    const shieldHardener = named('Shield Hardener', /Multispectrum|Adaptive/);
    const membrane = named('Energized Armor Membrane', /Multispectrum|Adaptive/);
    const extender: Role = { slot: 'mid', max: 1, match: inGroup('Shield Extender'), strength: (t) => base(t.id, 'capacityBonus'), powerShare: 0.3 };
    const plate: Role = { slot: 'low', max: 1, match: inGroup('Armor Plate'), strength: (t) => base(t.id, 'armorHPBonusAdd'), powerShare: 0.3 };
    if (hauler) {
      return [
        { slot: 'mid', max: 1, match: kind === 'pve' ? ab : mwd, strength: (t) => -fitting(t) },
        { ...extender, max: undefined },
        { slot: 'mid', match: shieldHardener },
        { slot: 'low', max: 1, match: inGroup('Damage Control'), when: () => kind === 'pvp' },
        { slot: 'low', match: inGroup(kind === 'pve' ? 'Expanded Cargohold' : 'Reinforced Bulkhead') },
        { slot: 'rig', match: rig(kind === 'pve' ? /Cargohold Optimization/ : /Core Defense Field Extender/) },
      ];
    }
    if (mining && kind === 'pve') {
      return [
        { slot: 'mid', max: 1, match: ab },
        { slot: 'mid', max: 1, match: inGroup('Shield Extender'), strength: (t) => base(t.id, 'capacityBonus'), powerShare: 0.3 },
        { slot: 'mid', match: shieldHardener },
        { slot: 'low', max: 2, match: inGroup('Mining Upgrade'), strength: (t) => -base(t.id, 'cpu') },
        { slot: 'low', match: inGroup('Damage Control') , max: 1 },
        { slot: 'low', match: inGroup('Reinforced Bulkhead') },
        { slot: 'rig', match: rig(/Core Defense Field Extender/) },
      ];
    }
    if (kind === 'pve' && tank === 'shield') {
      return [
        { slot: 'mid', max: 1, match: ab, strength: (t) => -fitting(t) },
        { slot: 'mid', max: 1, match: inGroup('Shield Booster'), strength: (t) => base(t.id, 'shieldBonus') / Math.max(1, base(t.id, 'duration')), powerShare: 0.3 },
        { slot: 'mid', max: 2, match: shieldHardener },
        { slot: 'mid', max: 1, match: inGroup('Capacitor Recharger'), when: () => !capStable() },
        { slot: 'mid', max: 1, match: shieldHardener },
        { slot: 'mid', match: inGroup('Capacitor Recharger') },
        damageModRole(3),
        { slot: 'low', max: 1, match: inGroup('Damage Control') },
        { slot: 'low', match: inGroup('Power Diagnostic System') },
        { slot: 'rig', match: rig(/Core Defense Field Extender/) },
        { slot: 'rig', match: rig(/Capacitor Control Circuit/) },
      ];
    }
    if (kind === 'pve') {
      return [
        { slot: 'mid', max: 1, match: ab, strength: (t) => -fitting(t) },
        { slot: 'mid', max: 1, match: inGroup('Capacitor Recharger') },
        helper,
        { slot: 'mid', match: inGroup('Capacitor Recharger') },
        { slot: 'low', max: lows >= 6 ? 2 : 1, match: inGroup('Armor Repair Unit'), strength: (t) => base(t.id, 'armorDamageAmount') / Math.max(1, base(t.id, 'duration')), powerShare: 0.3 },
        { slot: 'low', max: lows >= 4 ? 2 : 1, match: membrane },
        damageModRole(lows >= 5 ? 2 : 1),
        { slot: 'low', max: 1, match: inGroup('Damage Control') },
        { slot: 'low', match: membrane },
        { slot: 'rig', match: rig(/Auxiliary Nano Pump/) },
        { slot: 'rig', match: rig(/Capacitor Control Circuit/) },
      ];
    }
    const tackle: Role[] = [
      { slot: 'mid', max: 1, match: named('Warp Scrambler', /Scrambler/) },
      { slot: 'mid', max: 1, match: inGroup('Stasis Web') },
    ];
    if (tank === 'shield') {
      return [
        { slot: 'mid', max: 1, match: mwd, strength: (t) => -fitting(t) },
        tackle[0],
        extender,
        tackle[1],
        { ...extender, max: 2 },
        { slot: 'mid', match: shieldHardener },
        { slot: 'low', max: 1, match: inGroup('Damage Control') },
        damageModRole(3),
        { slot: 'low', max: 1, match: inGroup('Nanofiber Internal Structure') },
        { slot: 'rig', match: rig(/Core Defense Field Extender/) },
      ];
    }
    return [
      { slot: 'mid', max: 1, match: hullSize === 1 ? ab : mwd, strength: (t) => -fitting(t) },
      ...tackle,
      { slot: 'mid', max: 1, match: inGroup('Capacitor Battery'), powerShare: 0.2 },
      { slot: 'mid', match: inGroup('Capacitor Recharger') },
      { slot: 'low', max: 1, match: inGroup('Damage Control') },
      plate,
      { slot: 'low', max: 1, match: membrane },
      damageModRole(lows >= 6 ? 2 : 1),
      plate,
      { slot: 'low', match: membrane },
      { slot: 'rig', match: rig(/Trimark Armor Pump/) },
    ];
  }

  function fallbackRoles(): Role[] {
    const sameRig = (t: TypeInfo) => slotOf(sde, t.id) === 'rig' && base(t.id, 'rigSize') === base(shipId, 'rigSize');
    const has = (group: string) => fit.slots.low.some((m) => m && sde.types.get(m.typeId)?.groupName === group);
    const combat = weaponKind !== 'none';
    return [
      { slot: 'high', max: 1, match: inGroup(kind === 'pvp' ? 'Energy Neutralizer' : 'Energy Nosferatu'), strength: (t) => -fitting(t), when: () => combat },
      { slot: 'high', match: inGroup('Energy Nosferatu'), strength: (t) => -fitting(t), when: () => combat },
      { slot: 'high', match: (t) => t.groupName === 'Energy Nosferatu', strength: (t) => -fitting(t), when: () => combat },
      { slot: 'high', match: inGroup(kind === 'pve' ? 'Salvager' : 'Energy Neutralizer'), strength: (t) => -fitting(t), when: () => combat },
      { slot: 'mid', match: tank === 'shield' ? named('Shield Hardener', /Multispectrum|Adaptive/) : inGroup('Capacitor Battery'), powerShare: 0.2 },
      { slot: 'mid', match: inGroup('Capacitor Recharger') },
      { slot: 'mid', match: inGroup('Sensor Booster') },
      { slot: 'mid', match: inGroup(kind === 'pvp' ? 'Stasis Web' : 'Capacitor Battery'), strength: (t) => -fitting(t) },
      { slot: 'mid', match: inGroup(weaponKind === 'turret' ? 'Tracking Computer' : weaponKind === 'missile' ? 'Missile Guidance Computer' : 'Sensor Booster', 'Target Painter') },
      { slot: 'low', max: 1, match: inGroup('Damage Control'), when: () => !has('Damage Control') },
      { slot: 'low', match: tank === 'shield' ? inGroup('Power Diagnostic System') : named('Energized Armor Membrane', /Multispectrum|Adaptive/) },
      { slot: 'low', match: inGroup('Power Diagnostic System', 'Reactor Control Unit', 'CPU Enhancer') },
      { slot: 'low', max: 1, match: inGroup('Nanofiber Internal Structure', 'Inertial Stabilizer'), when: () => !has('Nanofiber Internal Structure') && !has('Overdrive Injector System') },
      { slot: 'low', match: inGroup('Reinforced Bulkhead') },
      { slot: 'rig', match: (t) => sameRig(t) && t.groupName === (tank === 'shield' ? 'Rig Shield' : 'Rig Armor') },
      { slot: 'rig', match: (t) => sameRig(t) && /^Rig (Core|Navigation)$/.test(t.groupName) },
    ];
  }

  function fillRoles(list: Role[]) {
    for (const role of list) {
      if (role.when && !role.when()) continue;
      const options = pool.filter((t) => t.categoryId === Category.Module && slotOf(sde, t.id) === role.slot && role.match(t))
        .sort((a, b) => tier(a) - tier(b) || (role.strength ? role.strength(b) - role.strength(a) : 0) || fitting(a) - fitting(b) || a.id - b.id);
      if (!options.length) continue;
      let added = 0;
      while (free(role.slot) > 0 && added < (role.max ?? Infinity)) {
        const ok = options.find((t) => tryAdd(t.id, role.powerShare));
        if (!ok) break;
        added++;
      }
    }
  }

  function fitDrones() {
    const d = dogma(fit);
    let bandwidth = d.ship.get('droneBandwidth');
    let bay = d.ship.get('droneCapacity');
    const maxActive = Math.max(1, Math.round(d.character.get('maxActiveDrones')) || 5);
    if (bandwidth <= 0 || bay <= 0) return;
    const drones = pool.filter((t) => t.categoryId === Category.Drone && /Combat Drone/.test(t.groupName) && base(t.id, 'droneBandwidthUsed') > 0 && base(t.id, 'maxVelocity') >= 1);
    const volume = (t: TypeInfo) => Math.max(1, base(t.id, 'volume'));
    let best: { t: TypeInfo; n: number; dps: number } | null = null;
    for (const t of drones) {
      const n = Math.min(maxActive, Math.floor(bandwidth / base(t.id, 'droneBandwidthUsed')), Math.floor(bay / volume(t)));
      if (n <= 0) continue;
      const f: Fit = { ...fit, drones: [{ typeId: t.id, count: n, active: n }] };
      const dps = offense(sde, dogma(f)).droneDps;
      if (!best || dps > best.dps * 1.01 || (dps > best.dps * 0.99 && tier(t) < tier(best.t))) best = { t, n, dps };
    }
    if (!best) return;
    const main = best;
    applyChecked(sde, fit, skills, (draft) => { draft.drones = [{ typeId: main.t.id, count: main.n, active: main.n }]; }, implants);
    bandwidth -= main.n * base(main.t.id, 'droneBandwidthUsed');
    bay -= main.n * volume(main.t);
    const light = drones.filter((t) => t.id !== main.t.id && volume(t) <= bay && volume(t) < volume(main.t))
      .sort((a, b) => volume(b) - volume(a) || damageScore(b) - damageScore(a))[0];
    if (!light) return;
    const n = Math.min(maxActive, Math.floor(bay / volume(light)));
    if (n > 0) applyChecked(sde, fit, skills, (draft) => { draft.drones.push({ typeId: light.id, count: n, active: 0 }); }, implants);
  }

  function fitFighters() {
    const d = dogma(fit);
    let tubes = Math.round(d.ship.get('fighterTubes'));
    if (tubes <= 0) return;
    const fighters = pool.filter((t) => t.categoryId === Category.Fighter);
    for (const [flag, limit] of [['fighterSquadronIsLight', 'fighterLightSlots'], ['fighterSquadronIsHeavy', 'fighterHeavySlots']]) {
      const n = Math.min(tubes, Math.round(d.ship.get(limit)));
      if (n <= 0) continue;
      let best: { t: TypeInfo; dps: number } | null = null;
      for (const t of fighters.filter((x) => base(x.id, flag) > 0)) {
        const dps = offense(sde, dogma({ ...fit, drones: [...fit.drones, { typeId: t.id, count: n, active: n }] })).droneDps;
        if (dps > 0 && (!best || dps > best.dps)) best = { t, dps };
      }
      if (!best) continue;
      const pick = best.t;
      for (let k = n; k >= 1; k--) {
        if (applyChecked(sde, fit, skills, (draft) => { draft.drones.push({ typeId: pick.id, count: k, active: k }); }, implants).ok) { tubes -= k; break; }
      }
    }
  }

  function damageScore(t: TypeInfo): number {
    return base(t.id, 'damageMultiplier') * ['emDamage', 'thermalDamage', 'kineticDamage', 'explosiveDamage'].reduce((a, n) => a + base(t.id, n), 0);
  }
}
