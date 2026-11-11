import { compactISK } from '../ui/components';
import { tx } from '../i18n';
import type { MapPainter } from '../ui/starMap';
import { ringRadius, type LiveEnv } from './liveMapShared';

export function createLivePainters(env: LiveEnv) {
  const { settings, followed } = env;

  function painterUnder(p: MapPainter) {
    const { dist, links } = env;
    const { ctx: g } = p;
    if (dist && p.spacing > 3) {
      g.fillStyle = p.css('--accent');
      for (const [id, d] of dist) {
        if (d > settings.range) continue;
        const pt = p.at(id);
        if (!pt || pt[0] < -20 || pt[1] < -20 || pt[0] > p.width + 20 || pt[1] > p.height + 20) continue;
        g.globalAlpha = 0.24 - (d / (settings.range + 1)) * 0.14;
        g.beginPath();
        g.arc(pt[0], pt[1], Math.max(4, p.spacing * 0.5), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    if (settings.wh && links.length) {
      g.strokeStyle = p.css('--gold');
      g.lineWidth = 1.3;
      g.setLineDash([3, 4]);
      g.globalAlpha = 0.8;
      g.beginPath();
      for (const l of links) {
        const a = p.at(l.hubId), b = p.at(l.systemId);
        if (!a || !b) continue;
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
      }
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
  }

  function painterOver(p: MapPainter) {
    const { stats, battles, intel } = env;
    const { ctx: g } = p;
    const now = Date.now();
    const tones = [p.css('--gold'), p.css('--warn'), p.css('--danger')];
    const big = p.spacing >= 16;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [id, st] of stats) {
      const pt = p.at(id);
      if (!pt || pt[0] < -30 || pt[1] < -30 || pt[0] > p.width + 30 || pt[1] > p.height + 30) continue;
      const tone = tones[st.n >= 8 ? 2 : st.n >= 3 ? 1 : 0];
      const r = big ? ringRadius(st.n, true, p.spacing) : 2.5 + Math.min(7, Math.sqrt(st.n) * 1.8);
      g.fillStyle = tone;
      g.globalAlpha = 0.2;
      g.beginPath();
      g.arc(pt[0], pt[1], r, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = tone;
      g.lineWidth = big ? 2 : 1.4;
      g.stroke();
      if (big) {
        g.font = `700 ${r > 11 ? 11 : 10}px ${p.css('--font-mono')}`;
        g.fillStyle = p.css('--text-bright');
        g.fillText(String(st.n), pt[0], pt[1] + 0.5);
      }
      if (st.camp) {
        g.strokeStyle = p.css('--danger');
        g.lineWidth = 1.6;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.arc(pt[0], pt[1], r + 4, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      const age = now - st.last;
      if (age < 120_000) {
        const phase = ((p.time / 1400) % 1);
        g.globalAlpha = (1 - phase) * (1 - age / 120_000) * 0.9;
        g.strokeStyle = tone;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(pt[0], pt[1], r + 2 + phase * (big ? 22 : 14), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    if (settings.labels) drawHourly(p, tones);
    if (settings.battles && battles.length) drawBattles(p);
    const intelColor = p.css('--slot-rig');
    const okColor = p.css('--ok');
    const shown = new Set<number>();
    for (const r of intel) {
      if (now - r.time > 15 * 60_000) continue;
      for (const id of r.systems) {
        if (shown.has(id)) continue;
        shown.add(id);
        const pt = p.at(id);
        if (!pt) continue;
        const fade = 1 - (now - r.time) / (15 * 60_000);
        g.globalAlpha = 0.35 + fade * 0.65;
        g.strokeStyle = r.clear ? okColor : intelColor;
        g.lineWidth = 2;
        const s = big ? 11 : 6;
        g.beginPath();
        g.moveTo(pt[0], pt[1] - s);
        g.lineTo(pt[0] + s, pt[1]);
        g.lineTo(pt[0], pt[1] + s);
        g.lineTo(pt[0] - s, pt[1]);
        g.closePath();
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    const accent = p.css('--accent');
    g.font = `600 12px ${p.css('--font-body')}`;
    g.textBaseline = 'bottom';
    const bySystem = new Map<number, string[]>();
    for (const f of followed.values()) if (f.systemId) (bySystem.get(f.systemId) ?? bySystem.set(f.systemId, []).get(f.systemId)!).push(f.name);
    for (const [id, names] of bySystem) {
      const pt = p.at(id);
      if (!pt) continue;
      const s = 7;
      g.fillStyle = accent;
      g.strokeStyle = p.css('--map-halo');
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(pt[0], pt[1] - s - 8);
      g.lineTo(pt[0] + s, pt[1] - 8);
      g.lineTo(pt[0], pt[1] + s - 8);
      g.lineTo(pt[0] - s, pt[1] - 8);
      g.closePath();
      g.stroke();
      g.fill();
      const label = names.join(', ');
      g.lineWidth = 3;
      g.strokeText(label, pt[0], pt[1] - 18);
      g.fillStyle = p.css('--text-bright');
      g.fillText(label, pt[0], pt[1] - 18);
    }
    g.textBaseline = 'alphabetic';
  }

  function pill(g: CanvasRenderingContext2D, text: string, x: number, y: number, fg: string, bg: string, border: string) {
    const w = g.measureText(text).width + 10;
    const h = 15;
    g.fillStyle = bg;
    g.globalAlpha = 0.86;
    g.fillRect(x - w / 2, y - h / 2, w, h);
    g.globalAlpha = 1;
    g.strokeStyle = border;
    g.lineWidth = 1;
    g.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
    g.fillStyle = fg;
    g.fillText(text, x, y + 0.5);
    return w;
  }

  function drawHourly(p: MapPainter, tones: string[]) {
    const { hourly, stats } = env;
    const { ctx: g } = p;
    const min = p.spacing >= 16 ? 1 : p.spacing >= 7 ? 3 : 10;
    const placed: [number, number, number, number][] = [];
    const big = p.spacing >= 16;
    const bg = p.css('--map-halo');
    g.font = `600 10px ${p.css('--font-mono')}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const list = [...hourly.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]);
    for (const [id, n] of list) {
      const pt = p.at(id);
      if (!pt || pt[0] < -40 || pt[1] < -20 || pt[0] > p.width + 40 || pt[1] > p.height + 20) continue;
      const st = stats.get(id);
      const r = st ? (big ? ringRadius(st.n, true, p.spacing) : 2.5 + Math.min(7, Math.sqrt(st.n) * 1.8)) : 3;
      const text = tx('Kill-uri {n}', { n });
      const w = g.measureText(text).width + 10;
      const x = pt[0], y = pt[1] - r - 11;
      const box: [number, number, number, number] = [x - w / 2, y - 8, x + w / 2, y + 8];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      if (!st) {
        g.fillStyle = tones[n >= 8 ? 2 : n >= 3 ? 1 : 0];
        g.globalAlpha = 0.55;
        g.beginPath();
        g.arc(pt[0], pt[1], 2.5, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
      const tone = tones[n >= 8 ? 2 : n >= 3 ? 1 : 0];
      pill(g, text, x, y, tone, bg, tone);
    }
  }

  function drawBattles(p: MapPainter) {
    const { battles, stats } = env;
    const { ctx: g } = p;
    const danger = p.css('--danger');
    const bg = p.css('--map-halo');
    const bright = p.css('--text-bright');
    const big = p.spacing >= 16;
    g.font = `700 11px ${p.css('--font-body')}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const b of battles) {
      const pt = p.at(b.main);
      if (!pt || pt[0] < -80 || pt[1] < -80 || pt[0] > p.width + 80 || pt[1] > p.height + 80) continue;
      const st = stats.get(b.main);
      const r = st ? (big ? ringRadius(st.n, true, p.spacing) : 2.5 + Math.min(7, Math.sqrt(st.n) * 1.8)) : 3;
      g.globalAlpha = Date.now() - b.end < 10 * 60_000 ? 1 : 0.6;
      pill(g, `${tx('Bătălie')} · ${compactISK(b.value)} ISK`, pt[0], pt[1] - r - 30, bright, bg, danger);
      g.globalAlpha = 1;
    }
  }

  return { painterUnder, painterOver };
}
