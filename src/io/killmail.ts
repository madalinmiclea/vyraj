import type { Sde } from '../data/sde';
import type { Fit } from '../engine/fit';
import { ESI, esiFetch } from '../services/esiClient';
import { fromEsiFitting } from './esiFit';
import { tx } from '../i18n';

interface KmItem { item_type_id: number; flag: number; quantity_destroyed?: number; quantity_dropped?: number }
interface Killmail { killmail_id: number; killmail_time: string; victim: { ship_type_id: number; items?: KmItem[] } }

const ZKILL = /zkillboard\.com\/kill\/(\d+)/i;
const ESI_LINK = /killmails\/(\d+)\/([0-9a-f]{40})/i;

export const isKillLink = (text: string) => ZKILL.test(text) || ESI_LINK.test(text);

function flagName(flag: number): string {
  if (flag >= 11 && flag <= 18) return `LoSlot${flag - 11}`;
  if (flag >= 19 && flag <= 26) return `MedSlot${flag - 19}`;
  if (flag >= 27 && flag <= 34) return `HiSlot${flag - 27}`;
  if (flag >= 92 && flag <= 99) return `RigSlot${flag - 92}`;
  if (flag >= 125 && flag <= 132) return `SubSystemSlot${flag - 125}`;
  if (flag === 87) return 'DroneBay';
  if (flag === 158) return 'FighterBay';
  return 'Cargo';
}

async function locate(text: string): Promise<{ id: number; hash: string }> {
  const esi = text.match(ESI_LINK);
  if (esi) return { id: Number(esi[1]), hash: esi[2] };
  const z = text.match(ZKILL);
  if (!z) throw new Error(tx('Linkul nu e un killmail de pe zKillboard sau din EVE.'));
  const res = await fetch(`https://zkillboard.com/api/killID/${z[1]}/`).catch(() => null);
  const list = res?.ok ? (await res.json()) as { killmail_id: number; zkb: { hash: string } }[] : null;
  const hit = Array.isArray(list) ? list.find((k) => k.killmail_id === Number(z[1])) ?? list[0] : null;
  if (!hit) throw new Error(tx('zKillboard nu a răspuns. Încearcă linkul extern din joc (Copy External Kill Link).'));
  return { id: hit.killmail_id, hash: hit.zkb.hash };
}

export async function fitFromKillmail(sde: Sde, text: string): Promise<Fit> {
  const { id, hash } = await locate(text.trim());
  const res = await esiFetch(`${ESI}/killmails/${id}/${hash}/`);
  if (!res.ok) throw new Error(tx('ESI nu a găsit killmail-ul ({status}).', { status: res.status }));
  const km = (await res.json()) as Killmail;
  const ship = sde.types.get(km.victim.ship_type_id);
  if (!ship) throw new Error(tx('Nava din killmail nu e în datele de fitting.'));
  const items = new Map<string, { type_id: number; flag: string; quantity: number }>();
  for (const i of km.victim.items ?? []) {
    const flag = flagName(i.flag);
    const key = `${flag}:${i.item_type_id}`;
    const quantity = (i.quantity_destroyed ?? 0) + (i.quantity_dropped ?? 0);
    const prev = items.get(key);
    if (prev) prev.quantity += quantity; else items.set(key, { type_id: i.item_type_id, flag, quantity });
  }
  return fromEsiFitting(sde, { fitting_id: 0, name: tx('{ship} din killmail {id}', { ship: ship.name, id }), description: '', ship_type_id: km.victim.ship_type_id, items: [...items.values()] });
}
