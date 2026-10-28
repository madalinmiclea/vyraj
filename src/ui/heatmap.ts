import { locale } from '../i18n';
import { esc } from './components';

export interface HeatCell { day: number; value: number; tip: string }

export function heatmap(cells: HeatCell[]): string {
  if (!cells.length) return '';
  const max = Math.max(...cells.map((c) => c.value));
  const lead = (new Date(cells[0].day).getUTCDay() + 6) % 7;
  const slots: (HeatCell | null)[] = [...Array.from({ length: lead }, () => null), ...cells];
  const weeks = Math.ceil(slots.length / 7);
  const months: string[] = [];
  let shown = -1;
  for (let w = 0; w < weeks; w++) {
    const week = slots.slice(w * 7, w * 7 + 7).filter((c): c is HeatCell => !!c);
    const start = week.find((c) => new Date(c.day).getUTCDate() === 1) ?? (w === 0 && week[0] && new Date(week[0].day).getUTCDate() <= 7 ? week[0] : undefined);
    const month = start ? new Date(start.day).getUTCMonth() : -1;
    const label = start && month !== shown ? new Date(start.day).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' }) : '';
    if (label) shown = month;
    months.push(`<span>${esc(label)}</span>`);
  }
  const days = [0, 2, 4].map((i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }));
  const level = (v: number) => (v <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((v / max) * 4)));
  return `<div class="heatmap" style="--weeks:${weeks}">
    <div class="heatmap-months">${months.join('')}</div>
    <div class="heatmap-body">
      <div class="heatmap-days"><span>${esc(days[0])}</span><span></span><span>${esc(days[1])}</span><span></span><span>${esc(days[2])}</span><span></span><span></span></div>
      <div class="heatmap-grid">${slots.map((c) => (c ? `<i class="l${level(c.value)}" title="${esc(c.tip)}"></i>` : '<i class="pad"></i>')).join('')}</div>
    </div>
  </div>`;
}
