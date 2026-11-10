import { Category, type Mutaplasmid, type Sde } from '../data/sde';
import type { DynamicItem, EsiAsset } from '../character/esi';
import { launchDrones, type Fit, type FitDrone, type SlotKind } from '../engine/fit';
import { mutate, mutationRows, type Mutable } from '../engine/mutation';
import { fromEsiFitting } from './esiFit';

const FIT_FLAGS = /^(HiSlot|MedSlot|LoSlot|RigSlot|SubSystemSlot)\d+$|^(DroneBay|FighterBay|Cargo)$/;

export interface OwnedShip {
  itemId: number;
  typeId: number;
  name: string;
  locationId: number;
  contents: EsiAsset[];
}

export function assembledShips(sde: Sde, assets: EsiAsset[]): OwnedShip[] {
  const byLocation = new Map<number, EsiAsset[]>();
  for (const a of assets) {
    if (!byLocation.has(a.location_id)) byLocation.set(a.location_id, []);
    byLocation.get(a.location_id)!.push(a);
  }
  return assets
    .filter((a) => a.is_singleton && sde.types.get(a.type_id)?.categoryId === Category.Ship)
    .map((a) => ({
      itemId: a.item_id,
      typeId: a.type_id,
      name: sde.types.get(a.type_id)!.name,
      locationId: a.location_id,
      contents: (byLocation.get(a.item_id) ?? []).filter((x) => FIT_FLAGS.test(x.location_flag)),
    }));
}

const FLAG_SLOT: [RegExp, SlotKind][] = [[/^HiSlot(\d+)$/, 'high'], [/^MedSlot(\d+)$/, 'mid'], [/^LoSlot(\d+)$/, 'low'], [/^RigSlot(\d+)$/, 'rig']];

export async function fitFromShipWithAbyssal(sde: Sde, ship: OwnedShip, fitName: string, load: (typeId: number, itemId: number) => Promise<DynamicItem>): Promise<Fit> {
  const dynamics = new Map<string, DynamicItem>();
  await Promise.all(ship.contents.filter((a) => sde.isAbyssal(a.type_id) && /Slot/.test(a.location_flag)).map(async (a) => {
    try { dynamics.set(a.location_flag, await load(a.type_id, a.item_id)); } catch { }
  }));
  const droneBay = ship.contents.filter((a) => a.location_flag === 'DroneBay' && sde.isAbyssal(a.type_id));
  const mutatedDrones = (await Promise.all(droneBay.map(async (a) => {
    try { return { asset: a, d: await load(a.type_id, a.item_id) }; } catch { return null; }
  }))).filter((x): x is { asset: EsiAsset; d: DynamicItem } => !!x);
  const contents = ship.contents.filter((a) => !droneBay.includes(a)).map((a) => {
    const d = dynamics.get(a.location_flag);
    return d && sde.types.has(d.source_type_id) ? { ...a, type_id: d.source_type_id } : a;
  });
  const fit = fitFromShip(sde, { ...ship, contents }, fitName);
  for (const { asset, d } of mutatedDrones) {
    const mp = sde.mutaplasmids.get(d.mutator_type_id);
    if (!sde.types.has(d.source_type_id)) continue;
    const drone: FitDrone = { typeId: d.source_type_id, count: Math.max(1, asset.quantity), active: 0 };
    if (mp) applyDynamic(sde, drone, mp, d);
    fit.drones.push(drone);
  }
  if (mutatedDrones.length) launchDrones(sde, fit);
  for (const [flag, d] of dynamics) {
    const slot = FLAG_SLOT.find(([re]) => re.test(flag));
    const m = slot && fit.slots[slot[1]][Number(flag.match(slot[0])![1])];
    const mp = sde.mutaplasmids.get(d.mutator_type_id);
    if (!m || !mp || m.typeId !== d.source_type_id) continue;
    applyDynamic(sde, m, mp, d);
  }
  return fit;
}

function applyDynamic(sde: Sde, m: Mutable, mp: Mutaplasmid, d: DynamicItem) {
  mutate(sde, m, mp);
  const values = new Map(d.dogma_attributes.map((x) => [x.attribute_id, x.value]));
  for (const row of mutationRows(sde, m)) {
    const v = values.get(row.attrId);
    if (v != null) m.mutation!.values[row.attrId] = v;
  }
}

export function fitFromShip(sde: Sde, ship: OwnedShip, fitName: string): Fit {
  const loaded = new Map<string, number>();
  const items: { type_id: number; flag: string; quantity: number }[] = [];
  for (const a of ship.contents) {
    if (a.location_flag === 'Cargo') continue;
    const isCharge = sde.types.get(a.type_id)?.categoryId === Category.Charge;
    if (isCharge) loaded.set(a.location_flag, a.type_id);
    else items.push({ type_id: a.type_id, flag: a.location_flag, quantity: a.quantity });
  }
  const merged = new Map<string, { type_id: number; flag: string; quantity: number }>();
  for (const it of items) {
    const key = /Slot/.test(it.flag) ? `${it.flag}` : `${it.flag}:${it.type_id}`;
    const prev = merged.get(key);
    if (prev && !/Slot/.test(it.flag)) prev.quantity += it.quantity;
    else merged.set(key, { ...it });
  }
  const fit = fromEsiFitting(sde, { fitting_id: 0, name: fitName, description: '', ship_type_id: ship.typeId, items: [...merged.values()] });
  const prefix: Record<string, string> = { high: 'HiSlot', mid: 'MedSlot', low: 'LoSlot' };
  for (const [kind, p] of Object.entries(prefix)) {
    fit.slots[kind as 'high' | 'mid' | 'low'].forEach((m, i) => {
      const charge = loaded.get(`${p}${i}`);
      if (m && charge) m.chargeId = charge;
    });
  }
  return fit;
}
