import { Category, MODE_GROUP, type Sde } from '../data/sde';
import { emptyFit, launchDrones, slotOf, defaultState, canLoadCharge, isFighterType, squadSize, squadsFromFighters, SLOT_KINDS, type Fit, type FitModule, type SlotKind } from '../engine/fit';
import { abyssalTypeId, mutate, mutationRows } from '../engine/mutation';
import { tx } from '../i18n';

interface MutationBlock {
  base?: string;
  mutaplasmid?: string;
  attrs: Map<string, number>;
}

function readMutations(lines: string[]): { blocks: Map<number, MutationBlock>; used: Set<number> } {
  const blocks = new Map<number, MutationBlock>();
  const used = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^\[(\d+)\]\s+(.+)$/);
    if (!head || /\]$/.test(lines[i])) continue;
    const block: MutationBlock = { attrs: new Map() };
    used.add(i);
    const rest: string[] = [];
    for (let j = i + 1; j < lines.length && rest.length < 3 && lines[j]; j++) { rest.push(lines[j]); used.add(j); }
    block.base = rest[0];
    block.mutaplasmid = rest[1];
    for (const part of (rest[2] ?? '').split(',')) {
      const m = part.trim().match(/^(\S+)\s+(-?[\d.eE+-]+)$/);
      if (m) block.attrs.set(m[1], Number(m[2]));
    }
    blocks.set(Number(head[1]), block);
  }
  return { blocks, used };
}

function applyBlock(sde: Sde, m: FitModule, block: MutationBlock | undefined) {
  if (!block?.mutaplasmid) return;
  const mp = [...sde.mutaplasmids.values()].find((x) => x.name.toLowerCase() === block.mutaplasmid!.toLowerCase());
  if (!mp || !mp.resultFor.has(m.typeId)) return;
  mutate(sde, m, mp);
  for (const row of mutationRows(sde, m)) {
    const name = sde.attributes.get(row.attrId)?.name;
    const v = name ? block.attrs.get(name) : undefined;
    if (v != null) m.mutation!.values[row.attrId] = Math.min(row.max, Math.max(row.min, v));
  }
}

export interface EftResult {
  fit: Fit;
  unknown: string[];
}

const EXPORT_ORDER: SlotKind[] = ['low', 'mid', 'high', 'rig', 'subsystem'];
const EMPTY_LABEL: Record<SlotKind, string> = { low: 'Low', mid: 'Med', high: 'High', rig: 'Rig', subsystem: 'Subsystem' };

export function parseEft(sde: Sde, text: string): EftResult {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim());
  const headerIdx = lines.findIndex((l) => /^\[.+\]$/.test(l));
  if (headerIdx < 0) throw new Error(tx('Nu găsesc antetul EFT, de forma [Navă, Nume fit].'));
  const header = lines[headerIdx].slice(1, -1);
  const comma = header.indexOf(',');
  const shipName = (comma >= 0 ? header.slice(0, comma) : header).trim();
  const fitName = comma >= 0 ? header.slice(comma + 1).trim() : shipName;
  const ship = sde.findType(shipName);
  if (!ship || ship.categoryId !== Category.Ship) throw new Error(tx('Nava „{name}” nu există în date.', { name: shipName }));

  const fit = emptyFit(ship.id, fitName || shipName);
  const unknown: string[] = [];
  const { blocks, used } = readMutations(lines);

  for (let idx = headerIdx + 1; idx < lines.length; idx++) {
    const raw = lines[idx];
    if (!raw || used.has(idx)) continue;
    if (/^\[Empty .+ slot\]$/i.test(raw)) {
      const m = raw.match(/^\[Empty (\w+) slot\]$/i);
      const kind = (Object.keys(EMPTY_LABEL) as SlotKind[]).find((k) => EMPTY_LABEL[k].toLowerCase() === m?.[1].toLowerCase());
      if (kind) fit.slots[kind].push(null);
      continue;
    }
    let line = raw;
    const offline = /\/\s*offline$/i.test(line);
    line = line.replace(/\/\s*offline$/i, '').trim();
    const ref = line.match(/\s*\[(\d+)\]/);
    if (ref) line = line.replace(ref[0], '').trim();
    const block = ref ? blocks.get(Number(ref[1])) : undefined;

    const qty = line.match(/^(.*?)\s+x(\d+)$/i);
    if (qty) {
      const t = sde.findType(qty[1]);
      const count = Number(qty[2]);
      if (!t) { unknown.push(raw); continue; }
      if (t.categoryId === Category.Fighter) {
        fit.drones.push({ typeId: t.id, count: squadsFromFighters(sde, t.id, count), active: 0 });
      } else if (t.categoryId === Category.Drone) {
        fit.drones.push({ typeId: t.id, count, active: 0 });
      } else {
        fit.cargo.push({ typeId: t.id, count });
      }
      continue;
    }

    const [modName, chargeName] = line.split(',').map((s) => s.trim());
    let t = sde.findType(modName);
    if (t && sde.isAbyssal(t.id)) t = (block?.base && sde.findType(block.base)) || sde.types.get(sde.abyssalBases(t.id)[0]) || t;
    if (!t) { unknown.push(raw); continue; }
    if (t.categoryId === Category.Implant) { fit.implants.push(t.id); continue; }
    if (t.groupId === MODE_GROUP) {
      if (sde.modesFor(ship.id).some((m) => m.id === t!.id)) fit.mode = t.id; else unknown.push(raw);
      continue;
    }
    const kind = slotOf(sde, t.id);
    if (!kind) { fit.cargo.push({ typeId: t.id, count: 1 }); continue; }
    const charge = chargeName ? sde.findType(chargeName) : undefined;
    if (chargeName && !charge) unknown.push(raw);
    const mod: FitModule = {
      typeId: t.id,
      state: offline ? 'offline' : defaultState(sde, t.id),
      chargeId: charge && canLoadCharge(sde, t.id, charge.id) ? charge.id : undefined,
    };
    applyBlock(sde, mod, block);
    fit.slots[kind].push(mod);
  }

  launchDrones(sde, fit);
  return { fit, unknown };
}

export function exportEft(sde: Sde, fit: Fit): string {
  const name = (id: number) => sde.types.get(id)?.name ?? `Type ${id}`;
  const out: string[] = [`[${name(fit.shipId)}, ${fit.name}]`];
  const mutated: FitModule[] = [];
  for (const kind of EXPORT_ORDER) {
    const list = fit.slots[kind];
    if (!list.length) continue;
    for (const m of list) {
      if (!m) { out.push(`[Empty ${EMPTY_LABEL[kind]} slot]`); continue; }
      let line = name(m.typeId);
      if (m.chargeId) line += `, ${name(m.chargeId)}`;
      if (m.mutation) { mutated.push(m); line += ` [${mutated.length}]`; }
      if (m.state === 'offline') line += ' /OFFLINE';
      out.push(line);
    }
    out.push('');
  }
  if (fit.mode && sde.types.has(fit.mode)) out.push(name(fit.mode), '');
  if (fit.drones.length) {
    for (const d of fit.drones) {
      if (isFighterType(sde, d.typeId)) for (let i = 0; i < d.count; i++) out.push(`${name(d.typeId)} x${squadSize(sde, d.typeId)}`);
      else out.push(`${name(d.typeId)} x${d.count}`);
    }
    out.push('');
  }
  if (fit.implants.length) {
    for (const i of fit.implants) out.push(name(i));
    out.push('');
  }
  if (fit.cargo.length) {
    for (const c of fit.cargo) out.push(`${name(c.typeId)} x${c.count}`);
    out.push('');
  }
  mutated.forEach((m, i) => {
    const attrs = Object.entries(m.mutation!.values)
      .map(([id, v]) => `${sde.attributes.get(Number(id))?.name ?? id} ${+v.toPrecision(6)}`)
      .join(', ');
    out.push('', `[${i + 1}] ${name(abyssalTypeId(sde, m) ?? m.typeId)}`, `  ${name(m.typeId)}`, `  ${sde.mutaplasmids.get(m.mutation!.mutaplasmidId)?.name ?? m.mutation!.mutaplasmidId}`, `  ${attrs}`);
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function exportMultibuy(sde: Sde, contents: Map<number, number>): string {
  return [...contents].map(([id, n]) => `${sde.types.get(id)?.name ?? id} ${n}`).join('\n');
}

export function exportDna(sde: Sde, fit: Fit): string {
  const counts = new Map<number, number>();
  const add = (id: number, n = 1) => counts.set(id, (counts.get(id) ?? 0) + n);
  const order: SlotKind[] = ['subsystem', 'high', 'mid', 'low', 'rig'];
  for (const k of order) for (const m of fit.slots[k]) if (m) add(m.typeId);
  const charges = new Map<number, number>();
  for (const k of SLOT_KINDS) for (const m of fit.slots[k]) if (m?.chargeId) charges.set(m.chargeId, (charges.get(m.chargeId) ?? 0) + 1);
  for (const d of fit.drones) add(d.typeId, isFighterType(sde, d.typeId) ? d.count * squadSize(sde, d.typeId) : d.count);
  const parts = [String(fit.shipId), ...[...counts].map(([id, n]) => `${id};${n}`), ...[...charges].map(([id, n]) => `${id};${n}`)];
  return parts.join(':') + '::';
}
