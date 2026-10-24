import { Category, type Sde } from '../data/sde';
import { emptyFit, launchDrones, slotOf, defaultState, canLoadCharge, chargesPerModule, SLOT_KINDS, type Fit, type SlotKind } from '../engine/fit';
import type { EsiFitting } from '../character/esi';
import { tx } from '../i18n';

const FLAG_PREFIX: Record<SlotKind, string> = { high: 'HiSlot', mid: 'MedSlot', low: 'LoSlot', rig: 'RigSlot', subsystem: 'SubSystemSlot' };

export function fromEsiFitting(sde: Sde, f: EsiFitting): Fit {
  const fit = emptyFit(f.ship_type_id, f.name);
  const charges: { typeId: number; quantity: number }[] = [];
  for (const item of f.items) {
    const t = sde.types.get(item.type_id);
    if (!t) continue;
    const kind = (Object.keys(FLAG_PREFIX) as SlotKind[]).find((k) => item.flag.startsWith(FLAG_PREFIX[k]));
    if (kind && slotOf(sde, t.id)) {
      const index = Number(item.flag.slice(FLAG_PREFIX[kind].length)) || 0;
      const list = fit.slots[kind];
      while (list.length <= index) list.push(null);
      list[index] = { typeId: t.id, state: defaultState(sde, t.id) };
    } else if (item.flag === 'DroneBay' || item.flag === 'FighterBay') {
      fit.drones.push({ typeId: t.id, count: item.quantity, active: 0 });
    } else if (t.categoryId === Category.Charge) {
      charges.push({ typeId: t.id, quantity: item.quantity });
      fit.cargo.push({ typeId: t.id, count: item.quantity });
    } else {
      fit.cargo.push({ typeId: t.id, count: item.quantity });
    }
  }
  launchDrones(sde, fit);
  for (const k of SLOT_KINDS) {
    for (const m of fit.slots[k]) {
      if (!m) continue;
      const c = charges.find((x) => canLoadCharge(sde, m.typeId, x.typeId));
      if (c) m.chargeId = c.typeId;
    }
  }
  return fit;
}

export function toEsiFitting(sde: Sde, fit: Fit): Omit<EsiFitting, 'fitting_id'> {
  const items: EsiFitting['items'] = [];
  for (const k of SLOT_KINDS) {
    fit.slots[k].forEach((m, i) => { if (m) items.push({ type_id: m.typeId, flag: `${FLAG_PREFIX[k]}${i}`, quantity: 1 }); });
  }
  for (const d of fit.drones) items.push({ type_id: d.typeId, flag: sde.types.get(d.typeId)?.categoryId === Category.Fighter ? 'FighterBay' : 'DroneBay', quantity: d.count });
  const cargo = new Map(fit.cargo.map((c) => [c.typeId, c.count]));
  for (const k of SLOT_KINDS) {
    for (const m of fit.slots[k]) {
      if (m?.chargeId && !fit.cargo.some((c) => c.typeId === m.chargeId)) cargo.set(m.chargeId, (cargo.get(m.chargeId) ?? 0) + chargesPerModule(sde, m.typeId, m.chargeId));
    }
  }
  for (const [typeId, count] of cargo) items.push({ type_id: typeId, flag: 'Cargo', quantity: count });
  return { name: fit.name.slice(0, 50), description: tx('Exportat din Vyraj'), ship_type_id: fit.shipId, items };
}
