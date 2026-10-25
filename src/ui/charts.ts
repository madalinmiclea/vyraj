import { compactISK, formatInt } from './components';
import { tx } from '../i18n';

export interface SeriesPoint {
  label: string;
  value: number;
  low?: number;
  high?: number;
  bar?: number;
}

export function seriesChart(points: SeriesPoint[], { bars: barsOnly = false } = {}) {
  if (!points.length) return '';
  const w = 760, h = 240, pl = 58, pr = 10, pt = 10, pb = 24, barH = 46;
  const plotH = barsOnly ? h - pt - pb : h - pt - pb - barH - 8;
  const lows = points.map((p) => p.low ?? p.value), highs = points.map((p) => p.high ?? p.value);
  let minY = Math.min(...lows), maxY = Math.max(...highs);
  if (minY === maxY) { minY *= 0.95; maxY = maxY * 1.05 || 1; }
  const pad = (maxY - minY) * 0.06;
  minY = barsOnly ? 0 : Math.max(0, minY - pad); maxY += pad;
  const maxBar = Math.max(1, ...points.map((p) => p.bar ?? 0));
  const step = (w - pl - pr) / points.length;
  const x = (i: number) => pl + step * (i + 0.5);
  const y = (v: number) => pt + (1 - (v - minY) / (maxY - minY)) * plotH;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const band = points.some((p) => p.low != null)
    ? `<path class="band" d="${points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.high ?? p.value).toFixed(1)}`).join('')}${points.map((_, i) => `L${x(points.length - 1 - i).toFixed(1)},${y(points[points.length - 1 - i].low ?? points[points.length - 1 - i].value).toFixed(1)}`).join('')}Z" />`
    : '';
  const barTop = h - pb - barH;
  const bars = points.map((p, i) => {
    const bh = ((p.bar ?? 0) / maxBar) * barH;
    return `<rect class="bar" x="${(x(i) - step * 0.4).toFixed(1)}" width="${Math.max(0.6, step * 0.8).toFixed(1)}" y="${(barTop + barH - bh).toFixed(1)}" height="${bh.toFixed(1)}" />`;
  }).join('');
  const valueBars = barsOnly ? points.map((p, i) => {
    const top = y(Math.max(0, p.value));
    return `<rect class="vbar" x="${(x(i) - step * 0.38).toFixed(1)}" width="${Math.max(0.6, step * 0.76).toFixed(1)}" y="${top.toFixed(1)}" height="${(pt + plotH - top).toFixed(1)}" />`;
  }).join('') : '';
  const ticksY = [0, 0.5, 1].map((f) => minY + (maxY - minY) * f);
  const every = Math.max(1, Math.ceil(points.length / 6));
  const hits = points.map((_, i) => `<rect class="hit" data-i="${i}" x="${(x(i) - step / 2).toFixed(1)}" width="${step.toFixed(1)}" y="${pt}" height="${h - pt - pb}" />`).join('');
  return `<div class="series-wrap"><svg class="series-chart" viewBox="0 0 ${w} ${h}" role="img">
    ${ticksY.map((v) => `<line x1="${pl}" x2="${w - pr}" y1="${y(v)}" y2="${y(v)}" class="grid" /><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${compactISK(v)}</text>`).join('')}
    ${points.map((p, i) => (i % every === 0 ? `<text x="${x(i)}" y="${h - 6}" text-anchor="middle">${p.label}</text>` : '')).join('')}
    ${barsOnly ? valueBars : `${band}${bars}<path d="${line}" class="curve" />`}
    <line class="cursor" x1="0" x2="0" y1="${pt}" y2="${h - pb}" style="display:none" />
    ${hits}
  </svg><div class="series-tip" style="display:none"></div></div>`;
}

export function bindSeriesChart(root: HTMLElement, points: SeriesPoint[], { barLabel = tx('Volum'), valueLabel = tx('Medie'), isk = true } = {}) {
  const wrap = root.querySelector<HTMLElement>('.series-wrap');
  if (!wrap) return;
  const svg = wrap.querySelector('svg')!, tip = wrap.querySelector<HTMLElement>('.series-tip')!, cursor = wrap.querySelector<SVGLineElement>('.cursor')!;
  const fmt = (v: number) => (isk ? `${compactISK(v)} ISK` : formatInt(v));
  svg.addEventListener('mousemove', (e) => {
    const r = (e.target as Element).closest<SVGRectElement>('.hit');
    if (!r) return;
    const p = points[Number(r.dataset.i)];
    const cx = Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2;
    cursor.setAttribute('x1', String(cx)); cursor.setAttribute('x2', String(cx)); cursor.style.display = '';
    tip.innerHTML = `<b>${p.label}</b><span>${valueLabel} ${fmt(p.value)}</span>${p.low != null ? `<span>Min ${fmt(p.low)} · Max ${fmt(p.high ?? p.value)}</span>` : ''}${p.bar != null ? `<span>${barLabel} ${formatInt(p.bar)}</span>` : ''}`;
    tip.style.display = '';
    const box = wrap.getBoundingClientRect();
    const left = e.clientX - box.left;
    tip.style.left = `${Math.min(box.width - tip.offsetWidth - 4, Math.max(4, left + 12))}px`;
  });
  svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; cursor.style.display = 'none'; });
}

export interface FlowPoint {
  label: string;
  earned: number;
  spent: number;
}

export function flowChart(points: FlowPoint[]) {
  if (!points.length) return '';
  const w = 760, h = 240, pl = 10, pr = 10, pt = 10, pb = 24;
  const maxIn = Math.max(0, ...points.map((p) => p.earned));
  const maxOut = Math.max(0, ...points.map((p) => p.spent));
  const total = maxIn + maxOut || 1;
  const plotH = h - pt - pb;
  const mid = pt + (maxIn / total) * plotH;
  const step = (w - pl - pr) / points.length;
  const x = (i: number) => pl + step * (i + 0.5);
  const bw = Math.max(0.6, step * 0.7);
  const bars = points.map((p, i) => {
    const up = (p.earned / total) * plotH, down = (p.spent / total) * plotH;
    const left = (x(i) - bw / 2).toFixed(1);
    return `<rect class="in" x="${left}" width="${bw.toFixed(1)}" y="${(mid - up).toFixed(1)}" height="${up.toFixed(1)}" /><rect class="out" x="${left}" width="${bw.toFixed(1)}" y="${mid.toFixed(1)}" height="${down.toFixed(1)}" />`;
  }).join('');
  const every = Math.max(1, Math.ceil(points.length / 8));
  const hits = points.map((_, i) => `<rect class="hit" data-i="${i}" x="${(x(i) - step / 2).toFixed(1)}" width="${step.toFixed(1)}" y="${pt}" height="${h - pt - pb}" />`).join('');
  const grid = [maxIn ? pt : null, maxOut ? pt + plotH : null].filter((y): y is number => y != null);
  return `<div class="series-wrap"><svg class="series-chart flow-chart" viewBox="0 0 ${w} ${h}" role="img">
    ${grid.map((y) => `<line x1="${pl}" x2="${w - pr}" y1="${y}" y2="${y}" class="grid faint" />`).join('')}
    ${points.map((p, i) => (i % every === 0 ? `<text x="${x(i)}" y="${h - 6}" text-anchor="middle">${p.label}</text>` : '')).join('')}
    ${bars}
    <line x1="${pl}" x2="${w - pr}" y1="${mid}" y2="${mid}" class="zero" />
    <line class="cursor" x1="0" x2="0" y1="${pt}" y2="${h - pb}" style="display:none" />
    ${hits}
  </svg><div class="series-tip" style="display:none"></div></div>`;
}

export function bindFlowChart(root: HTMLElement, points: FlowPoint[]) {
  const wrap = root.querySelector<HTMLElement>('.series-wrap');
  if (!wrap) return;
  const svg = wrap.querySelector('svg')!, tip = wrap.querySelector<HTMLElement>('.series-tip')!, cursor = wrap.querySelector<SVGLineElement>('.cursor')!;
  svg.addEventListener('mousemove', (e) => {
    const r = (e.target as Element).closest<SVGRectElement>('.hit');
    if (!r) return;
    const p = points[Number(r.dataset.i)];
    const cx = Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2;
    cursor.setAttribute('x1', String(cx)); cursor.setAttribute('x2', String(cx)); cursor.style.display = '';
    const net = p.earned - p.spent;
    tip.innerHTML = `<b>${p.label}</b><span class="up">${tx('Câștigat')} ${compactISK(p.earned)} ISK</span><span class="down">${tx('Cheltuit')} ${compactISK(p.spent)} ISK</span><span>Net ${net < 0 ? '−' : '+'}${compactISK(Math.abs(net))} ISK</span>`;
    tip.style.display = '';
    const box = wrap.getBoundingClientRect();
    tip.style.left = `${Math.min(box.width - tip.offsetWidth - 4, Math.max(4, e.clientX - box.left + 12))}px`;
  });
  svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; cursor.style.display = 'none'; });
}
