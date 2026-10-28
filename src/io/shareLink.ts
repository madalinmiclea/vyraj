import type { Sde } from '../data/sde';
import type { ModuleState } from '../engine/dogma';
import { SHIP_BONUSES } from '../engine/fleet';
import { canLoadCharge, defaultState, emptyFit, SLOT_KINDS, type Fit, type FitModule } from '../engine/fit';

const PREFIX = '#fit=';
const MAX_CODE = 16000;
const MAX_JSON = 200_000;
const STATES: ModuleState[] = ['offline', 'online', 'active', 'overheated'];

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const int = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : fallback);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): Uint8Array {
  const s = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function readLimited(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('too large'); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export function compactFit(fit: Fit): Raw {
  const slots: Raw = {};
  for (const k of SLOT_KINDS) if (fit.slots[k].length) slots[k] = fit.slots[k].map((m) => (m ? [m.typeId, STATES.indexOf(m.state), m.chargeId ?? 0, m.mutation ? [m.mutation.mutaplasmidId, m.mutation.values] : 0] : 0));
  const out: Raw = { v: 1, n: fit.name, s: fit.shipId, sl: slots };
  if (fit.drones.length) out.d = fit.drones.map((d) => [d.typeId, d.count, d.active]);
  if (fit.cargo.length) out.c = fit.cargo.map((c) => [c.typeId, c.count]);
  if (fit.implants.length) out.i = fit.implants;
  if (fit.boosterSides && Object.keys(fit.boosterSides).length) out.b = fit.boosterSides;
  if (fit.mode) out.m = fit.mode;
  if (fit.fleet) out.f = [fit.fleet.charges, fit.fleet.t2 ? 1 : 0, fit.fleet.shipBonus, fit.fleet.mindlink ? 1 : 0];
  if (fit.projected?.length) out.p = fit.projected.map((p) => [p.typeId, p.count]);
  if (fit.notes?.trim()) out.o = fit.notes;
  return out;
}

export function expandFit(sde: Sde, input: unknown): Fit | null {
  const raw = obj(input);
  const known = (v: unknown) => { const id = int(v, 0, 2 ** 31, 0); return id && sde.types.has(id) ? id : 0; };
  const shipId = known(raw.s);
  if (!shipId) return null;
  const fit = emptyFit(shipId, text(raw.n, 100).trim() || sde.types.get(shipId)!.name);
  const slots = obj(raw.sl);
  for (const k of SLOT_KINDS) {
    fit.slots[k] = list(slots[k], 16).map((entry): FitModule | null => {
      const e = list(entry, 4);
      const typeId = known(e[0]);
      if (!typeId) return null;
      const m: FitModule = { typeId, state: STATES[int(e[1], -1, 3, -1)] ?? defaultState(sde, typeId) };
      const charge = known(e[2]);
      if (charge && canLoadCharge(sde, typeId, charge)) m.chargeId = charge;
      const mut = list(e[3], 2);
      const mpId = int(mut[0], 0, 2 ** 31, 0);
      if (sde.mutaplasmids.has(mpId)) {
        const values: Record<string, number> = {};
        for (const [key, v] of Object.entries(obj(mut[1]))) if (/^\d+$/.test(key) && typeof v === 'number' && Number.isFinite(v)) values[key] = v;
        m.mutation = { mutaplasmidId: mpId, values };
      }
      return m;
    });
  }
  for (const entry of list(raw.d, 32)) {
    const e = list(entry, 3);
    const typeId = known(e[0]);
    const count = int(e[1], 1, 500, 1);
    if (typeId) fit.drones.push({ typeId, count, active: int(e[2], 0, count, 0) });
  }
  for (const entry of list(raw.c, 200)) {
    const e = list(entry, 2);
    const typeId = known(e[0]);
    if (typeId) fit.cargo.push({ typeId, count: int(e[1], 1, 10_000_000, 1) });
  }
  fit.implants = list(raw.i, 20).map(known).filter(Boolean);
  const sides: Record<string, string[]> = {};
  for (const [key, v] of Object.entries(obj(raw.b))) if (sde.types.has(Number(key))) sides[key] = list(v, 8).filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 100));
  if (Object.keys(sides).length) fit.boosterSides = sides;
  const mode = known(raw.m);
  if (mode) fit.mode = mode;
  const fleet = list(raw.f, 4);
  if (fleet.length) fit.fleet = { charges: list(fleet[0], 12).map(known).filter(Boolean), t2: fleet[1] === 1, shipBonus: SHIP_BONUSES.includes(fleet[2] as number) ? (fleet[2] as number) : 0, mindlink: fleet[3] === 1 };
  const projected = list(raw.p, 32).map((entry) => list(entry, 2)).map((e) => ({ typeId: known(e[0]), count: int(e[1], 1, 50, 1) })).filter((p) => p.typeId);
  if (projected.length) fit.projected = projected;
  const notes = text(raw.o, 4000);
  if (notes.trim()) fit.notes = notes;
  return fit;
}

export async function encodeCode(value: unknown, limit = MAX_JSON): Promise<string> {
  const stream = new Response(JSON.stringify(value)).body!.pipeThrough(new CompressionStream('deflate-raw'));
  return toBase64Url(await readLimited(stream, limit));
}

export async function decodeCode(code: string, maxCode = MAX_CODE, limit = MAX_JSON): Promise<unknown> {
  if (!code || code.length > maxCode || !/^[A-Za-z0-9_-]+$/.test(code)) throw new Error('invalid');
  const stream = new Blob([fromBase64Url(code) as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(await readLimited(stream, limit)));
}

export const appUrl = (hash: string) => `${location.origin}${import.meta.env.BASE_URL}${hash}`;

export async function shareUrl(fit: Fit): Promise<string> {
  return appUrl(PREFIX + await encodeCode(compactFit(fit)));
}

export function hasSharedFit(): boolean {
  return location.hash.startsWith(PREFIX);
}

export async function readSharedFit(sde: Sde): Promise<Fit | null> {
  if (!hasSharedFit()) return null;
  const code = location.hash.slice(PREFIX.length);
  history.replaceState(null, '', location.pathname + location.search);
  const fit = expandFit(sde, await decodeCode(code));
  if (!fit) throw new Error('invalid');
  return fit;
}
