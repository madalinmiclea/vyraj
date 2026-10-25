import type { Sde } from '../data/sde';
import { cloneFit, isFighterType, toDogmaInput, SLOT_KINDS, type Fit } from './fit';
import { Dogma } from './dogma';
import { resources } from './stats';
import { tx } from '../i18n';

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US');

export function violations(sde: Sde, fit: Fit, skills: Map<number, number>, implants: number[] = []): Map<string, string> {
  const d = new Dogma(sde, toDogmaInput(sde, fit, skills, implants));
  const r = resources(sde, fit, d);
  const out = new Map<string, string>();
  const over = (key: string, used: number, total: number, message: string) => { if (used > total + 1e-6) out.set(key, message); };
  over('cpu', r.cpu.used, r.cpu.total, tx('Nu ajunge CPU: ar fi {used} / {total} tf', { used: fmt(r.cpu.used), total: fmt(r.cpu.total) }));
  over('power', r.power.used, r.power.total, tx('Nu ajunge powergrid: ar fi {used} / {total} MW', { used: fmt(r.power.used), total: fmt(r.power.total) }));
  over('calibration', r.calibration.used, r.calibration.total, tx('Nu ajunge calibrarea: ar fi {used} / {total}', { used: fmt(r.calibration.used), total: fmt(r.calibration.total) }));
  over('turrets', r.turrets.used, r.turrets.total, tx('Nu mai ai turret hardpoints libere ({n})', { n: r.turrets.total }));
  over('launchers', r.launchers.used, r.launchers.total, tx('Nu mai ai launcher hardpoints libere ({n})', { n: r.launchers.total }));
  over('bandwidth', r.droneBandwidth.used, r.droneBandwidth.total, tx('Nu ajunge drone bandwidth: ar fi {used} / {total} Mbit/s', { used: fmt(r.droneBandwidth.used), total: fmt(r.droneBandwidth.total) }));
  over('dronebay', r.droneBay.used, r.droneBay.total, tx('Nu mai e loc în drone bay: ar fi {used} / {total} m³', { used: fmt(r.droneBay.used), total: fmt(r.droneBay.total) }));
  over('fighterbay', r.fighterBay.used, r.fighterBay.total, tx('Nu mai e loc în fighter bay: ar fi {used} / {total} m³', { used: fmt(r.fighterBay.used), total: fmt(r.fighterBay.total) }));
  over('cargo', r.cargo.used, r.cargo.total, tx('Nu mai e loc în cargo: ar fi {used} / {total} m³', { used: fmt(r.cargo.used), total: fmt(r.cargo.total) }));
  over('tubes', r.fighterTubes.used, r.fighterTubes.total, tx('Nu mai ai tuburi de fighteri libere ({n})', { n: r.fighterTubes.total }));
  over('fighter-light', r.fighterLight.used, r.fighterLight.total, tx('Poți lansa maxim {n} escadrile {kind}', { n: r.fighterLight.total, kind: 'light' }));
  over('fighter-support', r.fighterSupport.used, r.fighterSupport.total, tx('Poți lansa maxim {n} escadrile {kind}', { n: r.fighterSupport.total, kind: 'support' }));
  over('fighter-heavy', r.fighterHeavy.used, r.fighterHeavy.total, tx('Poți lansa maxim {n} escadrile {kind}', { n: r.fighterHeavy.total, kind: 'heavy' }));
  for (const k of SLOT_KINDS) over(`slots-${k}`, r.slots[k].used, r.slots[k].total, tx('Nu mai sunt sloturi {k} libere', { k }));
  const maxDrones = d.character.get('maxActiveDrones');
  const launched = fit.drones.filter((x) => !isFighterType(sde, x.typeId)).reduce((a, x) => a + x.active, 0);
  if (launched > maxDrones) out.set('drones', tx('Poți lansa maxim {n} drone (skill-ul Drones)', { n: maxDrones }));
  return out;
}

export interface CheckedResult {
  ok: boolean;
  message: string;
}

export function applyChecked(
  sde: Sde,
  fit: Fit,
  skills: Map<number, number>,
  change: (draft: Fit) => CheckedResult | void,
  implants: number[] = [],
): CheckedResult {
  const before = violations(sde, fit, skills, implants);
  const draft = cloneFit(fit);
  const result = change(draft) ?? { ok: true, message: '' };
  if (!result.ok) return result;
  const after = violations(sde, draft, skills, implants);
  for (const [key, message] of after) {
    if (!before.has(key)) return { ok: false, message };
  }
  Object.assign(fit, draft);
  return result;
}
