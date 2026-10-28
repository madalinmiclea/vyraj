import type { Sde } from '../data/sde';
import { penalizedProduct, type Dogma, type DogmaItem } from './dogma';
import { tx } from '../i18n';

export interface TargetProfile {
  id: string;
  name: string;
  signature: number;
  velocity: number;
}

export const TARGETS: TargetProfile[] = [
  { id: 'frigate', name: tx('Fregată'), signature: 35, velocity: 400 },
  { id: 'destroyer', name: tx('Distrugător'), signature: 65, velocity: 300 },
  { id: 'cruiser', name: tx('Crucișător'), signature: 125, velocity: 200 },
  { id: 'battlecruiser', name: tx('Crucișător de luptă'), signature: 270, velocity: 130 },
  { id: 'battleship', name: tx('Cuirasat'), signature: 400, velocity: 100 },
  { id: 'static', name: tx('Structură staționară'), signature: 5000, velocity: 0 },
];

export interface AppliedWeapon {
  name: string;
  kind: 'turret' | 'missile' | 'drone';
  rawDps: number;
  dps: number;
  factor: number;
}

export interface Applied {
  rawDps: number;
  dps: number;
  signature: number;
  painters: PainterEffect[];
  weapons: AppliedWeapon[];
}

const TURRET_EFFECTS = ['targetAttack', 'projectileFired', 'targetDisintegratorAttack'];
const DAMAGE_ATTRS = ['emDamage', 'thermalDamage', 'kineticDamage', 'explosiveDamage'];

function damageOf(item: DogmaItem) {
  return DAMAGE_ATTRS.reduce((a, n) => a + item.get(n), 0);
}

export interface PainterEffect {
  item: DogmaItem;
  reach: number;
  mult: number;
}

export function activePainters(sde: Sde, d: Dogma, distance = 0): PainterEffect[] {
  return d.modules
    .filter((m) => (m.state === 'active' || m.state === 'overheated') && m.type.effects.some((e) => /TargetPaint/i.test(sde.effects.get(e)?.name ?? '')))
    .map((item) => {
      const optimal = item.get('maxRange');
      const falloff = item.get('falloffEffectiveness');
      const reach = distance <= optimal ? 1 : falloff > 0 ? 0.5 ** (((distance - optimal) / falloff) ** 2) : 0;
      return { item, reach, mult: 1 + (item.get('signatureRadiusBonus') / 100) * reach };
    });
}

export function missileFactor(charge: DogmaItem, signature: number, velocity: number): number {
  const e = charge.get('aoeCloudSize');
  const ve = charge.get('aoeVelocity');
  const drf = charge.get('aoeDamageReductionFactor');
  if (e <= 0) return 1;
  const sigTerm = signature / e;
  const speedTerm = velocity > 0 && drf > 0 ? ((signature * ve) / (e * velocity)) ** drf : Infinity;
  return Math.max(0, Math.min(1, sigTerm, speedTerm));
}

export function turretMultiplier(chance: number): number {
  const wrecking = Math.min(chance, 0.01);
  const normal = chance - wrecking;
  const normalPart = normal > 0 ? normal * ((0.01 + chance) / 2 + 0.49) : 0;
  return normalPart + wrecking * 3;
}

export function turretChance(item: DogmaItem, signature: number, velocity: number, distance: number): number {
  const tracking = item.get('trackingSpeed');
  const optimal = item.get('maxRange');
  const falloff = item.get('falloff');
  const sigRes = item.get('optimalSigRadius') || 40000;
  const angular = distance > 0 ? velocity / distance : 0;
  const trackTerm = tracking > 0 && signature > 0 ? (angular * sigRes) / (tracking * signature) : 0;
  const rangeTerm = falloff > 0 ? Math.max(0, distance - optimal) / falloff : distance > optimal ? Infinity : 0;
  return 0.5 ** (trackTerm ** 2 + rangeTerm ** 2);
}

export function applied(sde: Sde, d: Dogma, target: TargetProfile, distance: number): Applied {
  const painters = activePainters(sde, d, distance);
  const signature = target.signature * penalizedProduct(painters.map((p) => p.mult));
  const weapons: AppliedWeapon[] = [];
  const push = (w: AppliedWeapon) => {
    const same = weapons.find((x) => x.name === w.name && x.kind === w.kind);
    if (same) {
      same.rawDps += w.rawDps;
      same.dps += w.dps;
      same.factor = same.rawDps ? same.dps / same.rawDps : 0;
    } else weapons.push(w);
  };

  for (const m of d.modules) {
    if (m.state !== 'active' && m.state !== 'overheated') continue;
    const cycle = m.get('speed') / 1000;
    if (cycle <= 0 || !m.other) continue;
    const name = `${m.type.name} · ${m.other.type.name}`;
    if (TURRET_EFFECTS.some((e) => sde.hasEffect(m.typeId, e))) {
      const raw = (damageOf(m.other) * m.get('damageMultiplier')) / cycle;
      const factor = turretMultiplier(turretChance(m, signature, target.velocity, distance));
      push({ name, kind: 'turret', rawDps: raw, dps: raw * factor, factor });
    } else if (sde.hasEffect(m.typeId, 'useMissiles')) {
      const raw = (damageOf(m.other) * d.character.get('missileDamageMultiplier')) / cycle;
      const range = m.other.get('maxVelocity') * (m.other.get('explosionDelay') / 1000);
      const factor = distance > range ? 0 : missileFactor(m.other, signature, target.velocity);
      push({ name, kind: 'missile', rawDps: raw, dps: raw * factor, factor });
    }
  }

  const controlRange = d.character.get('droneControlDistance');
  for (const { item, count } of d.drones) {
    if (!sde.hasEffect(item.typeId, 'targetAttack') && !sde.hasEffect(item.typeId, 'projectileFired')) continue;
    const cycle = item.get('speed') / 1000;
    if (cycle <= 0) continue;
    const raw = (damageOf(item) * item.get('damageMultiplier') * count) / cycle;
    const factor = controlRange && distance > controlRange ? 0 : 1;
    push({ name: item.type.name, kind: 'drone', rawDps: raw, dps: raw * factor, factor });
  }

  const rawDps = weapons.reduce((a, w) => a + w.rawDps, 0);
  return { rawDps, dps: weapons.reduce((a, w) => a + w.dps, 0), signature, painters, weapons };
}

export function maxEngagement(sde: Sde, d: Dogma): number {
  let max = 0;
  for (const m of d.modules) {
    if (m.state !== 'active' && m.state !== 'overheated' || !m.other) continue;
    if (TURRET_EFFECTS.some((e) => sde.hasEffect(m.typeId, e))) max = Math.max(max, m.get('maxRange') + 2.5 * m.get('falloff'));
    else if (sde.hasEffect(m.typeId, 'useMissiles')) max = Math.max(max, m.other.get('maxVelocity') * (m.other.get('explosionDelay') / 1000));
  }
  if (d.drones.length) max = Math.max(max, d.character.get('droneControlDistance'));
  return max || 50000;
}

export function dpsCurve(sde: Sde, d: Dogma, target: TargetProfile, points = 60): { distance: number; dps: number }[] {
  const max = maxEngagement(sde, d) * 1.15;
  return Array.from({ length: points + 1 }, (_, i) => {
    const distance = Math.max(500, (max * i) / points);
    return { distance, dps: applied(sde, d, target, distance).dps };
  });
}
