export interface OreOption {
  id: number;
  cost: number;
  yields: Map<number, number>;
}

export interface OreSolution {
  batches: Map<number, number>;
  produced: Map<number, number>;
  cost: number;
  impossible: number[];
}

const EPS = 1e-9;

function relax(need: [number, number][], opts: OreOption[]): number[] | null {
  const m = need.length;
  const n = opts.length;
  const cols = m + n;
  const rows: number[][] = opts.map((o, j) => {
    const r = new Array(cols + 1).fill(0);
    need.forEach(([id, q], i) => { r[i] = (o.yields.get(id) ?? 0) / q; });
    r[m + j] = 1;
    r[cols] = o.cost;
    return r;
  });
  const obj = new Array(cols + 1).fill(0);
  for (let i = 0; i < m; i++) obj[i] = -1;
  for (let iter = 0; iter < 5000; iter++) {
    let enter = -1;
    let best = -EPS;
    for (let c = 0; c < cols; c++) if (obj[c] < best) { best = obj[c]; enter = c; }
    if (enter < 0) break;
    let leave = -1;
    let ratio = Infinity;
    for (let r = 0; r < n; r++) {
      const a = rows[r][enter];
      if (a > EPS) {
        const t = rows[r][cols] / a;
        if (t < ratio - EPS) { ratio = t; leave = r; }
      }
    }
    if (leave < 0) return null;
    const p = rows[leave];
    const pv = p[enter];
    for (let c = 0; c <= cols; c++) p[c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === leave) continue;
      const f = rows[r][enter];
      if (Math.abs(f) > EPS) for (let c = 0; c <= cols; c++) rows[r][c] -= f * p[c];
    }
    const f = obj[enter];
    for (let c = 0; c <= cols; c++) obj[c] -= f * p[c];
  }
  return opts.map((_, j) => Math.max(0, obj[m + j]));
}

function output(opts: OreOption[], batches: number[], exact: (o: OreOption, mineral: number, batches: number) => number) {
  const out = new Map<number, number>();
  opts.forEach((o, j) => {
    if (!batches[j]) return;
    for (const [id] of o.yields) out.set(id, (out.get(id) ?? 0) + exact(o, id, batches[j]));
  });
  return out;
}

export function solveOres(need: Map<number, number>, opts: OreOption[], exact: (o: OreOption, mineral: number, batches: number) => number): OreSolution {
  const wanted = [...need].filter(([, q]) => q > 0);
  const impossible = wanted.filter(([id]) => !opts.some((o) => (o.yields.get(id) ?? 0) > 0)).map(([id]) => id);
  const goal = wanted.filter(([id]) => !impossible.includes(id));
  const useful = opts.filter((o) => o.cost > 0 && goal.some(([id]) => (o.yields.get(id) ?? 0) > 0));
  const batches = new Array(useful.length).fill(0);
  if (goal.length && useful.length) {
    const x = relax(goal, useful) ?? [];
    x.forEach((v, j) => { batches[j] = v > EPS ? Math.ceil(v - 1e-7) : 0; });
  }
  const produced = () => output(useful, batches, exact);
  const short = (out: Map<number, number>) => goal.filter(([id, q]) => (out.get(id) ?? 0) < q);
  for (let guard = 0; guard < 20000; guard++) {
    const out = produced();
    const miss = short(out);
    if (!miss.length) break;
    let pick = -1;
    let score = 0;
    useful.forEach((o, j) => {
      const gain = miss.reduce((a, [id, q]) => a + Math.min(o.yields.get(id) ?? 0, q - (out.get(id) ?? 0)) / q, 0);
      const s = gain / o.cost;
      if (s > score) { score = s; pick = j; }
    });
    if (pick < 0) break;
    batches[pick] += Math.max(1, Math.floor(Math.min(...miss.map(([id, q]) => {
      const y = useful[pick].yields.get(id) ?? 0;
      return y > 0 ? (q - (out.get(id) ?? 0)) / y : Infinity;
    })) || 1));
  }
  let changed = true;
  while (changed) {
    changed = false;
    const order = useful.map((_, j) => j).filter((j) => batches[j] > 0).sort((a, b) => useful[b].cost - useful[a].cost);
    for (const j of order) {
      while (batches[j] > 0) {
        batches[j]--;
        if (short(produced()).length) { batches[j]++; break; }
        changed = true;
      }
    }
  }
  const result = new Map<number, number>();
  useful.forEach((o, j) => { if (batches[j]) result.set(o.id, batches[j]); });
  return {
    batches: result,
    produced: produced(),
    cost: useful.reduce((a, o, j) => a + o.cost * batches[j], 0),
    impossible,
  };
}
