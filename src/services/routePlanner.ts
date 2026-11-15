import type { NavMap } from './navigation';
import type { RouteFlag } from './recon';
import { Heap } from './visited';
import { tx } from '../i18n';
import { loadJson, saveJson } from '../storage';

export const MAX_VIA = 12;
const SHARED_KEY = 'eve-nav:route';

export interface PlannedRoute { path: number[]; stops: number[] }
export interface SharedRoute { path: number[]; stops: number[]; title: string; at: number }

export const loadSharedRoute = () => loadJson<SharedRoute | null>(SHARED_KEY, null);
export const saveSharedRoute = (r: SharedRoute | null) => saveJson(SHARED_KEY, r);

export function planRoute(map: NavMap, from: number, to: number, via: number[], flag: RouteFlag, { avoid = new Set<number>(), extra = new Map<number, number[]>(), detour }: { avoid?: Set<number>; extra?: Map<number, number[]>; detour?: number } = {}): PlannedRoute {
  const mid = [...new Set(via)].filter((id) => id !== from && id !== to).slice(0, MAX_VIA);
  const nodes = [from, ...mid, to];
  const keep = new Set(nodes);
  const budgeted = flag === 'secure' && detour != null;
  const unsafe = (id: number) => ((map.systems.get(id)?.sec ?? 0) < 0.45 ? 1 : 0);
  const cost = (id: number) => (budgeted || flag === 'shortest' ? 1 : flag === 'secure' ? 1 + unsafe(id) * 999 : 1000 - unsafe(id) * 999);
  const next = (id: number) => [...(map.gates.get(id) ?? []), ...(extra.get(id) ?? [])].filter((n) => !avoid.has(n) || keep.has(n));
  const search = (src: number) => {
    const dist = new Map<number, number>([[src, 0]]);
    const prev = new Map<number, number>();
    const heap = new Heap();
    heap.push(0, src);
    while (heap.size) {
      const [d, id] = heap.pop();
      if (d > (dist.get(id) ?? Infinity)) continue;
      for (const n of next(id)) {
        const nd = d + cost(n);
        if (nd < (dist.get(n) ?? Infinity)) { dist.set(n, nd); prev.set(n, id); heap.push(nd, n); }
      }
    }
    return { dist, prev };
  };
  const runs = nodes.map(search);
  const D = (i: number, j: number) => runs[i].dist.get(nodes[j]) ?? Infinity;
  const k = mid.length;
  let order = mid.map((_, i) => i + 1);
  if (k > 1) {
    const full = 1 << k;
    const best = Array.from({ length: full }, () => new Array<number>(k).fill(Infinity));
    const back = Array.from({ length: full }, () => new Array<number>(k).fill(-1));
    for (let i = 0; i < k; i++) best[1 << i][i] = D(0, i + 1);
    for (let m = 1; m < full; m++) {
      for (let i = 0; i < k; i++) {
        if (!(m & (1 << i)) || best[m][i] === Infinity) continue;
        for (let j = 0; j < k; j++) {
          if (m & (1 << j)) continue;
          const c = best[m][i] + D(i + 1, j + 1);
          if (c < best[m | (1 << j)][j]) { best[m | (1 << j)][j] = c; back[m | (1 << j)][j] = i; }
        }
      }
    }
    const end = (i: number) => best[full - 1][i] + D(i + 1, k + 1);
    let last = 0;
    for (let i = 1; i < k; i++) if (end(i) < end(last)) last = i;
    order = [];
    for (let m = full - 1, i = last; i >= 0;) { order.unshift(i + 1); const p = back[m][i]; m ^= 1 << i; i = p; }
  }
  const seq = [0, ...order, k + 1];
  for (let i = 1; i < seq.length; i++) {
    if (D(seq[i - 1], seq[i]) === Infinity) throw new Error(tx('Nu există rută prin stargate-uri de la {from} la {to} (wormhole, sistem izolat sau ocolit).', { from: map.systems.get(nodes[seq[i - 1]])?.name ?? '', to: map.systems.get(nodes[seq[i]])?.name ?? '' }));
  }
  const stops = order.map((i) => nodes[i]);
  if (!budgeted) {
    const path = [from];
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1], b = seq[i];
      const leg: number[] = [];
      for (let x: number | undefined = nodes[b]; x != null && x !== nodes[a]; x = runs[a].prev.get(x)) leg.push(x);
      path.push(...leg.reverse());
    }
    return { path, stops };
  }
  const legs = seq.slice(1).map((b, i) => D(seq[i], b));
  const budget = legs.reduce((a, b) => a + b, 0) + Math.max(0, Math.round(detour!));
  let start = new Map<number, number>([[0, 0]]);
  const back: Map<number, number>[][] = [];
  for (let l = 0; l < legs.length; l++) {
    const src = nodes[seq[l]], dst = nodes[seq[l + 1]];
    const toDst = runs[seq[l + 1]].dist;
    const limit = budget - legs.slice(l + 1).reduce((a, b) => a + b, 0);
    const layers: Map<number, number>[] = [];
    const prev: Map<number, number>[] = [];
    for (let j = 0; j <= limit; j++) { layers.push(new Map()); prev.push(new Map()); }
    for (const [j, u] of start) if (j <= limit) layers[j].set(src, u);
    for (let j = 0; j < limit; j++) {
      for (const [sys, u] of layers[j]) {
        if (sys === dst) continue;
        for (const n of next(sys)) {
          if (n === src || j + 1 + (toDst.get(n) ?? Infinity) > limit) continue;
          const nu = u + unsafe(n);
          if (nu < (layers[j + 1].get(n) ?? Infinity)) { layers[j + 1].set(n, nu); prev[j + 1].set(n, sys); }
        }
      }
    }
    start = new Map();
    layers.forEach((m, j) => { const u = m.get(dst); if (u != null) start.set(j, u); });
    back.push(prev);
  }
  let bestJ = -1;
  for (const [j, u] of start) if (bestJ < 0 || u < start.get(bestJ)! || (u === start.get(bestJ)! && j < bestJ)) bestJ = j;
  const path: number[] = [];
  let j = bestJ;
  for (let l = legs.length - 1; l >= 0; l--) {
    const src = nodes[seq[l]];
    for (let x = nodes[seq[l + 1]]; x !== src; j--) { path.push(x); x = back[l][j].get(x)!; }
  }
  path.push(from);
  return { path: path.reverse(), stops };
}
