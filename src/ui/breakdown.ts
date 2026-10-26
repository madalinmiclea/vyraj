import type { AttrTrace, DogmaItem } from '../engine/dogma';
import { esc } from './components';
import { roman } from './itemInfo';
import { tx } from '../i18n';

export interface Breakdown {
  base: number;
  parts: { label: string; delta: number }[];
  value: number;
}

export function sourceLabel(item: DogmaItem): string {
  if (item.kind === 'buff') return item.label ?? tx('boost flotă');
  const name = item.type.name;
  if (item.dogma.ship.typeId === 0) return tx('proiectat: {name}', { name });
  if (item.kind === 'skill') return `${name} ${roman(item.get('skillLevel'))}`;
  if (item.kind === 'ship') return tx('bonus {name}', { name });
  return name;
}

export function derive(traces: AttrTrace[], fn: (v: number[]) => number, value?: number): Breakdown {
  const vals = traces.map((t) => t.base);
  const base = fn(vals);
  let prev = base;
  const parts: Breakdown['parts'] = [];
  traces.forEach((t, i) => {
    let j = 0;
    while (j < t.steps.length) {
      const s = t.steps[j];
      if (!s.mult || !s.before || s.after / s.before <= 0) {
        vals[i] = s.after;
        const next = fn(vals);
        parts.push({ label: sourceLabel(s.source), delta: next - prev });
        prev = next;
        j++;
        continue;
      }
      let k = j;
      while (k < t.steps.length && t.steps[k].mult && t.steps[k].before && t.steps[k].after / t.steps[k].before > 0) k++;
      const run = t.steps.slice(j, k);
      vals[i] = run[run.length - 1].after;
      const next = fn(vals);
      const logs = run.map((r) => Math.log(r.after / r.before));
      const total = logs.reduce((a, b) => a + b, 0);
      run.forEach((r, n) => parts.push({ label: sourceLabel(r.source), delta: total ? ((next - prev) * logs[n]) / total : 0 }));
      prev = next;
      j = k;
    }
  });
  return { base, parts, value: value ?? fn(traces.map((t) => t.value)) };
}

export function single(t: AttrTrace): Breakdown {
  return derive([t], (v) => v[0], t.value);
}

export function breakdownHtml(b: Breakdown, fmt: (n: number) => string, baseLabel = tx('Bază')): string {
  const grouped = new Map<string, { delta: number }>();
  for (const p of b.parts) {
    const g = grouped.get(p.label);
    if (g) g.delta += p.delta; else grouped.set(p.label, { delta: p.delta });
  }
  const scale = Math.max(Math.abs(b.base), Math.abs(b.value), 1e-9);
  const rows = [...grouped].filter(([, g]) => Math.abs(g.delta) / scale > 1e-5).map(([label, g]) =>
    `<div class="bd-row"><span class="num ${g.delta > 0 ? 'up' : 'down'}">${g.delta > 0 ? '+' : '−'}${fmt(Math.abs(g.delta))}</span><span class="dim">(${esc(label)})</span></div>`).join('');
  return `<div class="bd-row"><span class="num">${fmt(b.base)}</span><span class="dim">(${esc(baseLabel)})</span></div>${rows}<div class="bd-row bd-total"><span class="num">${fmt(b.value)}</span><span class="dim">(${tx('total')})</span></div>`;
}

export function bindBreakdownTips(root: HTMLElement, lookup: (key: string) => string | undefined) {
  let tip: HTMLElement | undefined;
  const hide = () => { tip?.remove(); tip = undefined; };
  root.addEventListener('mouseover', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-bd]');
    if (!target) { hide(); return; }
    const html = lookup(target.dataset.bd!);
    if (!html) return;
    hide();
    tip = document.createElement('div');
    tip.className = 'bd-tip';
    tip.innerHTML = html;
    document.body.appendChild(tip);
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    const top = r.bottom + 6 + h > window.innerHeight ? r.top - h - 6 : r.bottom + 6;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  });
  root.addEventListener('mouseleave', hide);
  root.addEventListener('mouseout', (e) => {
    const to = (e.relatedTarget as HTMLElement | null)?.closest?.('[data-bd]');
    if (!to) hide();
  });
}
