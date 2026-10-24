import { allEveItems } from '../data/items';
import { fold } from '../ui/fold';

export interface AppraisalLine {
  typeId: number;
  name: string;
  quantity: number;
}

let index: Map<string, { t: number; n: string }> | null = null;

function lookup(name: string) {
  if (!index?.size) index = new Map(allEveItems.map((i) => [fold(i.n.trim()), { t: i.t, n: i.n.trim() }]));
  return index.get(fold(name.trim().replace(/\s+/g, ' ')));
}

const qty = (s: string) => {
  const n = Number(s.replace(/[\s.,'  ]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

function parseLine(raw: string): { name: string; quantity: number }[] {
  const line = raw.replace(/\r/g, '').trim();
  if (!line) return [];
  const ship = line.match(/^\[([^,\]]+)/);
  if (ship) return [{ name: ship[1], quantity: 1 }];
  const cells = line.split('\t').map((c) => c.trim());
  if (cells.length > 1) {
    const q = cells[1] === '' ? 1 : qty(cells[1]);
    return [{ name: cells[0].replace(/\*$/, ''), quantity: Number.isNaN(q) ? 1 : q }];
  }
  if (lookup(line)) return [{ name: line, quantity: 1 }];
  let m = line.match(/^(.*?)\s+x\s*([\d.,'\s]+)$/i);
  if (m && lookup(m[1])) return [{ name: m[1], quantity: qty(m[2]) || 1 }];
  m = line.match(/^([\d.,'\s]+?)\s*x?\s+(.+)$/i);
  if (m && lookup(m[2])) return [{ name: m[2], quantity: qty(m[1]) || 1 }];
  m = line.match(/^(.*?)\s+([\d.,']+)$/);
  if (m && lookup(m[1])) return [{ name: m[1], quantity: qty(m[2]) || 1 }];
  if (line.includes(',')) return line.split(',').map((p) => ({ name: p.trim(), quantity: 1 }));
  return [{ name: line, quantity: 1 }];
}

export function parseItems(text: string): { lines: AppraisalLine[]; unknown: string[] } {
  const totals = new Map<number, AppraisalLine>();
  const unknown: string[] = [];
  for (const raw of text.split('\n')) {
    for (const p of parseLine(raw)) {
      const hit = lookup(p.name);
      if (!hit) { if (!/^\[?empty/i.test(p.name) && !/^[\d.,'\s]*$/.test(p.name)) unknown.push(p.name); continue; }
      const cur = totals.get(hit.t);
      if (cur) cur.quantity += p.quantity;
      else totals.set(hit.t, { typeId: hit.t, name: hit.n, quantity: p.quantity });
    }
  }
  return { lines: [...totals.values()], unknown };
}
