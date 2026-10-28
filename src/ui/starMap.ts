import type { NavMap, NavSystem } from '../services/navigation';
import { esc } from './components';

export interface MapPainter {
  ctx: CanvasRenderingContext2D;
  at: (id: number) => [number, number] | null;
  world: (x: number, y: number) => [number, number];
  scale: number;
  spacing: number;
  width: number;
  height: number;
  time: number;
  css: (name: string) => string;
}

export interface StarMapOptions {
  territory?: () => Map<number, string> | null;
  dim?: (s: NavSystem) => boolean;
  under?: (p: MapPainter) => void;
  over?: (p: MapPainter) => void;
  onSelect?: (id: number | null) => void;
  tooltip?: (s: NavSystem) => string;
  labelGap?: (id: number, gap: number) => number;
  labelFirst?: (id: number) => boolean;
  animate?: () => boolean;
  onView?: () => void;
  regionLabels?: boolean;
}

const SEC_COLORS = ['#8d3264', '#731f1f', '#bb1116', '#ce440f', '#dc6d07', '#f3fd82', '#71e554', '#60dba3', '#4ecef8', '#399aeb', '#2c75e1'];

export function secColor(sec: number): string {
  const r = sec > 0 && sec < 0.05 ? 0.1 : Math.round(sec * 10) / 10;
  return SEC_COLORS[Math.max(0, Math.min(10, Math.round(r * 10)))];
}

export class StarMap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tip: HTMLElement;
  private readonly list: NavSystem[];
  private readonly lines: [NavSystem, NavSystem, boolean][] = [];
  private readonly regionCenters: { name: string; x: number; y: number; n: number }[] = [];
  private readonly bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  readonly spacing: number;
  private scale = 1;
  private cx = 0;
  private cy = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private frame = 0;
  private selected: number | null = null;
  private hover: number | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: number; pinch?: number } | null = null;
  private territoryLayer: HTMLCanvasElement | null = null;
  private styles = new Map<string, string>();
  private resize: ResizeObserver;

  constructor(private readonly host: HTMLElement, readonly map: NavMap, private readonly opts: StarMapOptions = {}) {
    host.classList.add('starmap');
    host.innerHTML = '<canvas></canvas><div class="starmap-tip" hidden></div>';
    this.canvas = host.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.tip = host.querySelector('.starmap-tip')!;
    this.list = [...map.systems.values()];
    for (const s of this.list) {
      this.bounds.x0 = Math.min(this.bounds.x0, s.x2);
      this.bounds.x1 = Math.max(this.bounds.x1, s.x2);
      this.bounds.y0 = Math.min(this.bounds.y0, s.y2);
      this.bounds.y1 = Math.max(this.bounds.y1, s.y2);
    }
    const near: number[] = [];
    for (const [a, list] of map.gates) {
      const A = map.systems.get(a)!;
      for (const b of list) {
        if (b < a) continue;
        const B = map.systems.get(b);
        if (!B) continue;
        const cross = A.regionId !== B.regionId;
        this.lines.push([A, B, cross]);
        if (!cross) near.push(Math.hypot(A.x2 - B.x2, A.y2 - B.y2));
      }
    }
    near.sort((a, b) => a - b);
    this.spacing = near[Math.floor(near.length / 2)] || 1;
    const byRegion = new Map<number, { x: number; y: number; n: number }>();
    for (const s of this.list) {
      const r = byRegion.get(s.regionId) ?? { x: 0, y: 0, n: 0 };
      r.x += s.x2; r.y += s.y2; r.n++;
      byRegion.set(s.regionId, r);
    }
    for (const [id, r] of byRegion) this.regionCenters.push({ name: map.regions.get(id) ?? '', x: r.x / r.n, y: r.y / r.n, n: r.n });
    this.resize = new ResizeObserver(() => this.layout());
    this.resize.observe(host);
    this.bind();
    this.layout();
    this.fitAll();
  }

  private layout() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const first = !this.w;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    if (first) this.fitAll();
    this.territoryLayer = null;
    this.redraw();
  }

  private minScale() {
    const bw = this.bounds.x1 - this.bounds.x0 || 1, bh = this.bounds.y1 - this.bounds.y0 || 1;
    return Math.min(this.w / bw, this.h / bh) * 0.6;
  }

  private maxScale() {
    return 140 / this.spacing;
  }

  private clampScale(s: number) {
    return Math.max(this.minScale() || s, Math.min(this.maxScale(), s));
  }

  fitBox(x0: number, y0: number, x1: number, y1: number, pad = 0.08) {
    if (!this.w) return;
    const bw = Math.max(x1 - x0, this.spacing * 4), bh = Math.max(y1 - y0, this.spacing * 4);
    this.scale = this.clampScale(Math.min(this.w / (bw * (1 + pad * 2)), this.h / (bh * (1 + pad * 2))));
    this.cx = (x0 + x1) / 2;
    this.cy = (y0 + y1) / 2;
    this.changed();
  }

  fitAll() {
    this.fitBox(this.bounds.x0, this.bounds.y0, this.bounds.x1, this.bounds.y1, 0.02);
  }

  fitSystems(ids: number[]) {
    const pts = ids.map((id) => this.map.systems.get(id)).filter((s): s is NavSystem => !!s);
    if (!pts.length) return;
    this.fitBox(Math.min(...pts.map((s) => s.x2)), Math.min(...pts.map((s) => s.y2)), Math.max(...pts.map((s) => s.x2)), Math.max(...pts.map((s) => s.y2)));
  }

  fitRegion(regionId: number) {
    this.fitSystems(this.list.filter((s) => s.regionId === regionId).map((s) => s.id));
  }

  focus(id: number, closeUp = true) {
    const s = this.map.systems.get(id);
    if (!s) return;
    this.cx = s.x2;
    this.cy = s.y2;
    if (closeUp) this.scale = this.clampScale(Math.max(this.scale, 34 / this.spacing));
    this.changed();
  }

  centerOn(id: number) {
    const s = this.map.systems.get(id);
    if (!s) return;
    const [x, y] = this.toScreen(s.x2, s.y2);
    if (x > this.w * 0.2 && x < this.w * 0.8 && y > this.h * 0.2 && y < this.h * 0.8) return;
    this.focus(id, false);
  }

  select(id: number | null) {
    this.selected = id;
    this.redraw();
  }

  get selectedId() {
    return this.selected;
  }

  invalidateTerritory() {
    this.territoryLayer = null;
    this.redraw();
  }

  private changed() {
    this.territoryLayer = null;
    this.redraw();
    this.opts.onView?.();
  }

  private toScreen(x: number, y: number): [number, number] {
    return [(x - this.cx) * this.scale + this.w / 2, (y - this.cy) * this.scale + this.h / 2];
  }

  private toWorld(x: number, y: number): [number, number] {
    return [(x - this.w / 2) / this.scale + this.cx, (y - this.h / 2) / this.scale + this.cy];
  }

  private css(name: string) {
    let v = this.styles.get(name);
    if (v == null) {
      v = getComputedStyle(this.host).getPropertyValue(name).trim() || '#888';
      this.styles.set(name, v);
    }
    return v;
  }

  redraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
      if (this.opts.animate?.()) this.redraw();
    });
  }

  private hit(x: number, y: number): number | null {
    const [wx, wy] = this.toWorld(x, y);
    const max = Math.max(9, this.spacing * this.scale * 0.35) / this.scale;
    let best: NavSystem | null = null, bd = max;
    for (const s of this.list) {
      const d = Math.hypot(s.x2 - wx, s.y2 - wy);
      if (d < bd) { bd = d; best = s; }
    }
    return best?.id ?? null;
  }

  private bind() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)));
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const r = c.getBoundingClientRect();
      this.pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      const pts = [...this.pointers.values()];
      this.drag = { x: pts[0].x, y: pts[0].y, moved: this.drag?.moved ?? 0, pinch: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : undefined };
    });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (!this.pointers.has(e.pointerId)) { this.hoverAt(x, y); return; }
      const prev = this.pointers.get(e.pointerId)!;
      this.pointers.set(e.pointerId, { x, y });
      if (!this.drag) return;
      const pts = [...this.pointers.values()];
      if (pts.length === 2 && this.drag.pinch) {
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        this.zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, d / this.drag.pinch);
        this.drag.pinch = d;
        this.drag.moved += 10;
        return;
      }
      const dx = x - prev.x, dy = y - prev.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.cx -= dx / this.scale;
      this.cy -= dy / this.scale;
      this.tip.hidden = true;
      this.changed();
    });
    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size) return;
      const d = this.drag;
      this.drag = null;
      if (d && d.moved < 6 && e.type === 'pointerup') {
        const r = c.getBoundingClientRect();
        const id = this.hit(e.clientX - r.left, e.clientY - r.top);
        this.selected = id;
        this.redraw();
        this.opts.onSelect?.(id);
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (!this.pointers.size) { this.hover = null; this.tip.hidden = true; this.redraw(); } });
  }

  zoomAt(x: number, y: number, factor: number) {
    const [wx, wy] = this.toWorld(x, y);
    this.scale = this.clampScale(this.scale * factor);
    this.cx = wx - (x - this.w / 2) / this.scale;
    this.cy = wy - (y - this.h / 2) / this.scale;
    this.changed();
  }

  zoomBy(factor: number) {
    this.zoomAt(this.w / 2, this.h / 2, factor);
  }

  private hoverAt(x: number, y: number) {
    const id = this.hit(x, y);
    if (id !== this.hover) {
      this.hover = id;
      this.redraw();
    }
    const s = id ? this.map.systems.get(id) : null;
    if (!s) { this.tip.hidden = true; return; }
    this.tip.innerHTML = this.opts.tooltip?.(s) ?? `<b>${esc(s.name)}</b>`;
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    this.tip.style.left = `${Math.min(this.w - tw - 6, x + 14)}px`;
    this.tip.style.top = `${y + th + 20 > this.h ? y - th - 10 : y + 16}px`;
  }

  private drawTerritory(ctx: CanvasRenderingContext2D) {
    const groups = this.opts.territory?.();
    if (!groups?.size) return;
    if (!this.territoryLayer) {
      const layer = document.createElement('canvas');
      layer.width = this.canvas.width;
      layer.height = this.canvas.height;
      const g = layer.getContext('2d')!;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const r = Math.min(70, Math.max(5, this.spacing * this.scale * 1.05));
      const byColor = new Map<string, NavSystem[]>();
      for (const [id, color] of groups) {
        const s = this.map.systems.get(id);
        if (s) (byColor.get(color) ?? byColor.set(color, []).get(color)!).push(s);
      }
      for (const [color, list] of byColor) {
        g.fillStyle = color;
        g.beginPath();
        for (const s of list) {
          const [x, y] = this.toScreen(s.x2, s.y2);
          if (x < -r || y < -r || x > this.w + r || y > this.h + r) continue;
          g.moveTo(x + r, y);
          g.arc(x, y, r, 0, Math.PI * 2);
        }
        g.fill();
      }
      this.territoryLayer = layer;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.3;
    ctx.drawImage(this.territoryLayer, 0, 0);
    ctx.restore();
  }

  private draw() {
    const ctx = this.ctx;
    this.styles.clear();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const gap = this.spacing * this.scale;
    const painter: MapPainter = {
      ctx,
      at: (id) => {
        const s = this.map.systems.get(id);
        return s ? this.toScreen(s.x2, s.y2) : null;
      },
      world: (x, y) => this.toScreen(x, y),
      scale: this.scale,
      spacing: gap,
      width: this.w,
      height: this.h,
      time: performance.now(),
      css: (n) => this.css(n),
    };
    this.drawTerritory(ctx);
    this.opts.under?.(painter);
    const inView = (x: number, y: number, m = 40) => x > -m && y > -m && x < this.w + m && y < this.h + m;
    const line = this.css('--line-strong');
    ctx.lineWidth = gap > 30 ? 1.2 : 0.8;
    for (const cross of [false, true]) {
      ctx.strokeStyle = line;
      ctx.globalAlpha = cross ? 0.45 : gap > 14 ? 0.9 : 0.7;
      ctx.setLineDash(cross ? [4, 4] : []);
      ctx.beginPath();
      for (const [a, b, c] of this.lines) {
        if (c !== cross) continue;
        const [ax, ay] = this.toScreen(a.x2, a.y2);
        const [bx, by] = this.toScreen(b.x2, b.y2);
        if (Math.max(ax, bx) < 0 || Math.min(ax, bx) > this.w || Math.max(ay, by) < 0 || Math.min(ay, by) > this.h) continue;
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const r = Math.max(1.2, Math.min(4.5, gap * 0.16));
    const labels = gap > 26;
    for (const s of this.list) {
      const [x, y] = this.toScreen(s.x2, s.y2);
      if (!inView(x, y)) continue;
      const dim = this.opts.dim?.(s);
      ctx.globalAlpha = dim ? 0.28 : 1;
      ctx.fillStyle = secColor(s.sec);
      if (labels) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(x - r / 2 - 0.3, y - r / 2 - 0.3, r + 0.6, r + 0.6);
      }
    }
    ctx.globalAlpha = 1;
    if (labels) {
      const size = gap > 60 ? 12 : 11;
      ctx.font = `${size}px ${this.css('--font-mono')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const text = this.css('--text-dim');
      const cell = 48;
      const taken = new Map<string, [number, number, number, number][]>();
      const free = (x0: number, y0: number, x1: number, y1: number) => {
        for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) {
          for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
            for (const b of taken.get(`${gx}:${gy}`) ?? []) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return false;
          }
        }
        return true;
      };
      const take = (box: [number, number, number, number]) => {
        for (let gx = Math.floor(box[0] / cell); gx <= Math.floor(box[2] / cell); gx++) {
          for (let gy = Math.floor(box[1] / cell); gy <= Math.floor(box[3] / cell); gy++) {
            const k = `${gx}:${gy}`;
            (taken.get(k) ?? taken.set(k, []).get(k)!).push(box);
          }
        }
      };
      const order = this.opts.labelFirst ? [...this.list].sort((a, b) => Number(this.opts.labelFirst!(b.id)) - Number(this.opts.labelFirst!(a.id))) : this.list;
      for (const s of order) {
        const [x, y] = this.toScreen(s.x2, s.y2);
        if (!inView(x, y, 80)) continue;
        const top = y + Math.max(r + 3, this.opts.labelGap?.(s.id, gap) ?? 0);
        const w = ctx.measureText(s.name).width / 2 + 2;
        const box: [number, number, number, number] = [x - w, top, x + w, top + size + 1];
        if (!free(...box)) continue;
        take(box);
        ctx.globalAlpha = this.opts.dim?.(s) ? 0.35 : 1;
        ctx.fillStyle = text;
        ctx.fillText(s.name, x, top);
      }
      ctx.globalAlpha = 1;
    }
    if (gap < 40 && this.opts.regionLabels !== false) {
      ctx.font = `600 ${gap < 8 ? 11 : 13}px ${this.css('--font-heading')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = this.css('--bg-void');
      ctx.fillStyle = this.css('--text-bright');
      ctx.globalAlpha = gap < 26 ? 0.92 : 0.55;
      for (const c of this.regionCenters) {
        const [x, y] = this.toScreen(c.x, c.y);
        if (!inView(x, y, 60)) continue;
        ctx.strokeText(c.name, x, y);
        ctx.fillText(c.name, x, y);
      }
      ctx.globalAlpha = 1;
    }
    this.opts.over?.(painter);
    for (const [id, color, width] of [[this.hover, this.css('--text-bright'), 1.2], [this.selected, this.css('--accent'), 2]] as [number | null, string, number][]) {
      if (!id) continue;
      const p = painter.at(id);
      if (!p) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(p[0], p[1], Math.max(7, r + 5), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  destroy() {
    this.resize.disconnect();
    cancelAnimationFrame(this.frame);
  }
}
