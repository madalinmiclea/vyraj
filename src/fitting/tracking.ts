import { buildDogma, canLoadCharge, cloneFit, SLOT_KINDS, type Fit } from '../engine/fit';
import { Category } from '../data/sde';
import { penalizedProduct, type Dogma, type DogmaItem } from '../engine/dogma';
import { activePainters, damageOf, TARGETS, TURRET_EFFECTS, turretChance, turretMultiplier } from '../engine/application';
import { esc, formatNum, openModal } from '../ui/components';
import { tx } from '../i18n';
import type { FitEnv } from './shared';

interface WeaponGroup { typeId: number; chargeId: number | null; count: number }

interface TrackState {
  weapon: number;
  ammo: number;
  target: string;
  signature: number;
  velocity: number;
  angle: number;
  distance: number;
}

interface Gun {
  item: DogmaItem;
  dogma: Dogma;
  optimal: number;
  falloff: number;
  tracking: number;
  sigRes: number;
  rawDps: number;
  volley: number;
}

const GOOD_HIT = Math.sqrt(Math.log2(1 / 0.9));
const W = 760, H = 260, PL = 46, PR = 14, PT = 38, PB = 26;
const SW = 520, SH = 270;
const HEAT_X = 48, HEAT_Y = 30;

export function turretGroups(sde: FitEnv['sde'], fit: Fit): WeaponGroup[] {
  const groups = new Map<number, WeaponGroup>();
  for (const k of SLOT_KINDS) for (const m of fit.slots[k]) {
    if (!m || m.state === 'offline' || !TURRET_EFFECTS.some((e) => sde.hasEffect(m.typeId, e))) continue;
    const g = groups.get(m.typeId) ?? { typeId: m.typeId, chargeId: m.chargeId ?? null, count: 0 };
    g.count++;
    if (!g.chargeId && m.chargeId) g.chargeId = m.chargeId;
    groups.set(m.typeId, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export function openTracking(env: FitEnv) {
  const { sde, ctx } = env;
  const fit = env.getFit();
  if (!fit) return;
  const groups = turretGroups(sde, fit);
  if (!groups.length) return;
  const ammoCache = new Map<number, number[]>();
  const dogmaCache = new Map<string, Dogma>();
  const ts = env.targetState();
  const preset = TARGETS.find((t) => t.id === ts.id);
  const st: TrackState = {
    weapon: groups[0].typeId,
    ammo: 0,
    target: preset ? preset.id : 'custom',
    signature: preset ? preset.signature : ts.signature,
    velocity: preset ? preset.velocity : ts.velocity,
    angle: 90,
    distance: ts.distanceKm * 1000,
  };

  const ammoFor = (moduleId: number) => {
    if (!ammoCache.has(moduleId)) {
      ammoCache.set(moduleId, sde.typesInCategory(Category.Charge)
        .filter((c) => canLoadCharge(sde, moduleId, c.id) && ['emDamage', 'thermalDamage', 'kineticDamage', 'explosiveDamage'].some((a) => sde.baseAttr(c.id, sde.attrId(a)) > 0))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => c.id));
    }
    return ammoCache.get(moduleId)!;
  };

  const group = () => groups.find((g) => g.typeId === st.weapon) ?? groups[0];

  function pickAmmo() {
    const options = ammoFor(st.weapon);
    if (!options.includes(st.ammo)) st.ammo = group().chargeId && options.includes(group().chargeId!) ? group().chargeId! : options[0] ?? 0;
  }

  function gun(): Gun | null {
    if (!st.ammo) return null;
    const key = `${st.weapon}:${st.ammo}`;
    let dogma = dogmaCache.get(key);
    if (!dogma) {
      const copy = cloneFit(fit!);
      for (const k of SLOT_KINDS) for (const m of copy.slots[k]) if (m && m.typeId === st.weapon) m.chargeId = st.ammo;
      dogma = buildDogma(sde, copy, ctx.character);
      dogmaCache.set(key, dogma);
    }
    const list = dogma.modules.filter((m) => m.typeId === st.weapon && m.other && m.state !== 'offline');
    if (!list.length) return null;
    const item = list[0];
    const shot = (m: DogmaItem) => damageOf(m.other!) * m.get('damageMultiplier');
    const volley = list.reduce((a, m) => a + shot(m), 0);
    const rawDps = list.reduce((a, m) => a + (m.get('speed') > 0 ? shot(m) / (m.get('speed') / 1000) : 0), 0);
    return {
      item,
      dogma,
      optimal: item.get('maxRange'),
      falloff: item.get('falloff'),
      tracking: item.get('trackingSpeed'),
      sigRes: item.get('optimalSigRadius') || 40000,
      rawDps,
      volley,
    };
  }

  const transversal = () => st.velocity * Math.sin((st.angle * Math.PI) / 180);
  const sigAt = (g: Gun, distance: number, base = st.signature) => base * penalizedProduct(activePainters(sde, g.dogma, distance).map((p) => p.mult));
  const chance = (g: Gun, distance: number, speed: number, sig?: number) => turretChance(g.item, sig ?? sigAt(g, distance), speed, distance);
  const dmg = (g: Gun, distance: number, speed: number, sig?: number) => turretMultiplier(chance(g, distance, speed, sig));
  const reach = (g: Gun) => Math.max(g.optimal + 3 * g.falloff, st.distance * 1.1, 5000);
  const km = (m: number, digits = 1) => `${formatNum(m / 1000, digits)} km`;
  const pct = (v: number, digits = 0) => `${formatNum(v * 100, digits)}%`;

  function controls() {
    const g = gun();
    const max = g ? Math.ceil(reach(g) / 1000) : 100;
    const ammo = ammoFor(st.weapon);
    return `<div class="trk-controls">
      <label class="trk-field wide"><span>${tx('Armă')}</span><select class="input plain sm" data-trk="weapon">${groups.map((w) => `<option value="${w.typeId}" ${w.typeId === st.weapon ? 'selected' : ''}>${esc(env.name(w.typeId))} ×${w.count}</option>`).join('')}</select></label>
      <label class="trk-field wide"><span>${tx('Muniție')}</span><select class="input plain sm" data-trk="ammo">${ammo.map((id) => `<option value="${id}" ${id === st.ammo ? 'selected' : ''}>${esc(env.name(id))}${id === group().chargeId ? ' · ' + tx('în fit') : ''}</option>`).join('')}</select></label>
      <label class="trk-field"><span>${tx('Țintă')}</span><select class="input plain sm" data-trk="target">${TARGETS.map((t) => `<option value="${t.id}" ${t.id === st.target ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}<option value="custom" ${st.target === 'custom' ? 'selected' : ''}>${tx('Personalizat')}</option></select></label>
      <label class="trk-field"><span>${tx('Semnătură')}</span><span class="trk-unit"><input class="input plain sm num" type="number" min="1" data-trk="signature" value="${st.signature}" />m</span></label>
      <label class="trk-field"><span>${tx('Viteză')}</span><span class="trk-unit"><input class="input plain sm num" type="number" min="0" data-trk="velocity" value="${st.velocity}" />m/s</span></label>
      <label class="trk-field slider"><span>${tx('Unghi de mișcare')} <b class="num" data-trk-out="angle">${st.angle}°</b></span><input type="range" min="0" max="90" step="1" data-trk="angle" value="${st.angle}" /><small class="dim">${tx('0° vine direct spre tine, 90° te orbitează')}</small></label>
      <label class="trk-field slider wide"><span>${tx('Distanță')} <b class="num" data-trk-out="distance">${km(st.distance)}</b></span><input type="range" min="0" max="${max * 10}" step="1" data-trk="distance" value="${Math.round(st.distance / 100)}" /></label>
    </div>`;
  }

  function statsRow(g: Gun) {
    const speed = transversal();
    const sig = sigAt(g, st.distance);
    const c = chance(g, st.distance, speed);
    const m = turretMultiplier(c);
    const angular = st.distance > 0 ? speed / st.distance : 0;
    const maxSpeed = (GOOD_HIT * g.tracking * sig * st.distance) / g.sigRes;
    const minOrbit = speed > 0 ? (speed * g.sigRes) / (GOOD_HIT * g.tracking * sig) : 0;
    const card = (label: string, value: string, sub = '', tone = '') => `<div class="${tone}"><span class="label">${label}</span><span class="value num">${value}</span>${sub ? `<span class="sub dim">${sub}</span>` : ''}</div>`;
    return `<div class="big-stats trk-stats">
      ${card('Optimal', km(g.optimal, 2))}
      ${card('Falloff', km(g.falloff, 2), tx('50% la {d}', { d: km(g.optimal + g.falloff) }))}
      ${card('Tracking', formatNum(g.tracking, 2), tx('{v} rad/s pe ținta asta', { v: formatNum((g.tracking * sig) / g.sigRes, 4) }))}
      ${card(tx('Rezoluție semnătură'), `${formatNum(g.sigRes, 0)} m`)}
      ${card(tx('Șansă de lovire'), pct(c, 1), tx('aici, la {d}', { d: km(st.distance) }), c >= 0.9 ? 'good' : c < 0.5 ? 'bad' : 'mid')}
      ${card(tx('DPS aplicat'), formatNum(g.rawDps * m, 1), tx('din {raw} brut ({p})', { raw: formatNum(g.rawDps, 0), p: pct(m) }))}
      ${card(tx('Viteză unghiulară'), formatNum(angular, 4), `rad/s · ${formatNum(speed, 0)} m/s ${tx('transversal')}`)}
      ${card(tx('Tracking bun (90%)'), speed > 0 ? km(minOrbit) : '—', tx('distanța minimă; aici ține pasul până la {v} m/s', { v: formatNum(maxSpeed, 0) }))}
    </div>`;
  }

  function axisX(maxX: number, x: (v: number) => number, h: number, w: number) {
    const step = niceStep(maxX / 1000, 6) * 1000;
    const ticks: number[] = [];
    for (let v = 0; v <= maxX + 1; v += step) ticks.push(v);
    return ticks.map((v) => `<line x1="${x(v)}" x2="${x(v)}" y1="${PT}" y2="${h - PB}" class="grid" /><text x="${x(v)}" y="${h - 8}" text-anchor="middle">${formatNum(v / 1000, step < 1000 ? 1 : 0)}</text>`).join('')
      + `<text x="${w - PR}" y="${h - 8}" text-anchor="end" class="unit">km</text>`;
  }

  function rangeChart(g: Gun) {
    const maxX = reach(g);
    const speed = transversal();
    const x = (v: number) => PL + (v / maxX) * (W - PL - PR);
    const y = (v: number) => PT + (1 - v / 1.05) * (H - PT - PB);
    const n = 160;
    const pts = (fn: (d: number) => number) => Array.from({ length: n + 1 }, (_, i) => (maxX * i) / n)
      .map((dist, i) => `${i ? 'L' : 'M'}${x(dist).toFixed(1)},${y(fn(dist)).toFixed(1)}`).join('');
    const still = pts((dist) => dmg(g, dist, 0));
    const moving = pts((dist) => dmg(g, dist, speed));
    const area = `${moving}L${x(maxX)},${y(0)}L${x(0)},${y(0)}Z`;
    const o = g.optimal, f = g.falloff;
    const band = (a: number, b: number, cls: string) => (a < maxX ? `<rect x="${x(a)}" y="${PT}" width="${Math.max(0, x(Math.min(b, maxX)) - x(a))}" height="${H - PT - PB}" class="${cls}" />` : '');
    const tag = (v: number, label: string, row: number) => (v <= maxX ? `<line x1="${x(v)}" x2="${x(v)}" y1="${PT - 6 - row * 12}" y2="${H - PB}" class="edge" /><text x="${x(v) + 4}" y="${PT - 8 - row * 12}" class="tag">${label}</text>` : '');
    const ticksY = [0, 0.25, 0.5, 0.75, 1];
    return `<div class="trk-chart-wrap">
      <div class="trk-chart-head"><b>${tx('Daune după distanță')}</b><span class="trk-legend"><i class="k-move"></i>${tx('cu mișcarea țintei')}<i class="k-still"></i>${tx('țintă oprită (doar rază)')}</span></div>
      <svg class="trk-chart" viewBox="0 0 ${W} ${H}" data-trk-chart="range" data-max="${maxX}" role="img">
        ${band(0, o, 'band-opt')}${band(o, o + f, 'band-f1')}${band(o + f, o + 2 * f, 'band-f2')}
        ${ticksY.map((v) => `<line x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}" class="grid" /><text x="${PL - 6}" y="${y(v) + 4}" text-anchor="end">${formatNum(v * 100, 0)}%</text>`).join('')}
        ${axisX(maxX, x, H, W)}
        ${tag(o, 'Optimal', 0)}${f > 0 ? tag(o + f, 'Falloff · 50%', 1) + tag(o + 2 * f, '2× falloff · 6%', 0) : ''}
        <path d="${area}" class="area" />
        <path d="${still}" class="curve still" />
        <path d="${moving}" class="curve" />
        ${st.distance <= maxX ? `<line x1="${x(st.distance)}" x2="${x(st.distance)}" y1="${PT}" y2="${H - PB}" class="marker" /><circle cx="${x(st.distance)}" cy="${y(dmg(g, st.distance, speed))}" r="4" class="dot" />` : ''}
        <line class="hover" x1="0" x2="0" y1="${PT}" y2="${H - PB}" />
        <rect x="${PL}" y="${PT}" width="${W - PL - PR}" height="${H - PT - PB}" class="hit" />
      </svg>
      <div class="trk-readout" data-trk-read="range">${tx('Mișcă mouse-ul peste grafic ca să vezi valorile.')}</div>
    </div>`;
  }

  function heatChart(g: Gun) {
    const maxX = reach(g);
    const maxV = Math.max(400, Math.ceil((st.velocity * 1.6) / 100) * 100);
    const pl = 44, pr = 10, pt = 22, pb = 26;
    const cw = (SW - pl - pr) / HEAT_X, ch = (SH - pt - pb) / HEAT_Y;
    const cells: string[] = [];
    for (let i = 0; i < HEAT_X; i++) for (let j = 0; j < HEAT_Y; j++) {
      const dist = ((i + 0.5) / HEAT_X) * maxX;
      const v = ((j + 0.5) / HEAT_Y) * maxV;
      const val = Math.min(1, dmg(g, dist, v));
      if (val < 0.02) continue;
      cells.push(`<rect x="${(pl + i * cw).toFixed(1)}" y="${(SH - pb - (j + 1) * ch).toFixed(1)}" width="${(cw + 0.4).toFixed(1)}" height="${(ch + 0.4).toFixed(1)}" style="fill-opacity:${(0.08 + val * 0.82).toFixed(2)}" />`);
    }
    const x = (v: number) => pl + (v / maxX) * (SW - pl - pr);
    const y = (v: number) => SH - pb - (v / maxV) * (SH - pt - pb);
    const step = niceStep(maxX / 1000, 4) * 1000;
    const tx0: number[] = [];
    for (let v = 0; v <= maxX + 1; v += step) tx0.push(v);
    const speed = transversal();
    return `<div class="trk-chart-wrap">
      <div class="trk-chart-head"><b>${tx('Hartă de aplicare')}</b><span class="dim small">${tx('distanță × viteză transversală, cu cât e mai aprins cu atât lovești mai bine')}</span></div>
      <svg class="trk-chart heat" viewBox="0 0 ${SW} ${SH}" data-trk-chart="heat" data-max="${maxX}" data-maxv="${maxV}" role="img">
        <g class="cells">${cells.join('')}</g>
        ${[0, 0.5, 1].map((f) => `<text x="${pl - 6}" y="${y(maxV * f) + 4}" text-anchor="end">${formatNum(maxV * f, 0)}</text>`).join('')}
        ${tx0.map((v) => `<text x="${x(v)}" y="${SH - 8}" text-anchor="middle">${formatNum(v / 1000, step < 1000 ? 1 : 0)}</text>`).join('')}
        <text x="${SW - pr}" y="${SH - 8}" text-anchor="end" class="unit">km</text>
        <text x="${pl}" y="${pt - 8}" text-anchor="start" class="unit">m/s</text>
        ${st.distance <= maxX && speed <= maxV ? `<circle cx="${x(st.distance)}" cy="${y(speed)}" r="5" class="dot ring" />` : ''}
        <rect x="${pl}" y="${pt}" width="${SW - pl - pr}" height="${SH - pt - pb}" class="hit" />
      </svg>
      <div class="trk-readout" data-trk-read="heat">&nbsp;</div>
    </div>`;
  }

  function sigChart(g: Gun) {
    const pl = 40, pr = 10, pt = 34, pb = 26;
    const lo = Math.log10(10), hi = Math.log10(5000);
    const x = (s: number) => pl + ((Math.log10(s) - lo) / (hi - lo)) * (SW - pl - pr);
    const y = (v: number) => pt + (1 - v / 1.05) * (SH - pt - pb);
    const speed = transversal();
    const n = 120;
    const line = Array.from({ length: n + 1 }, (_, i) => 10 ** (lo + ((hi - lo) * i) / n))
      .map((s, i) => `${i ? 'L' : 'M'}${x(s).toFixed(1)},${y(dmg(g, st.distance, speed, sigAt(g, st.distance, s))).toFixed(1)}`).join('');
    const marks = TARGETS.filter((t) => t.id !== 'static').map((t, i) => `<line x1="${x(t.signature)}" x2="${x(t.signature)}" y1="${pt}" y2="${SH - pb}" class="edge" /><text x="${x(t.signature)}" y="${i % 2 ? 12 : 26}" text-anchor="middle" class="tag">${esc(shortName(t.id))}</text>`).join('');
    return `<div class="trk-chart-wrap">
      <div class="trk-chart-head"><b>${tx('Daune după semnătura țintei')}</b><span class="dim small">${tx('la {d} și {v} m/s transversal', { d: km(st.distance), v: formatNum(speed, 0) })}</span></div>
      <svg class="trk-chart" viewBox="0 0 ${SW} ${SH}" data-trk-chart="sig" role="img">
        ${[0, 0.5, 1].map((v) => `<line x1="${pl}" x2="${SW - pr}" y1="${y(v)}" y2="${y(v)}" class="grid" /><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${formatNum(v * 100, 0)}%</text>`).join('')}
        ${[10, 100, 1000].map((s) => `<text x="${x(s)}" y="${SH - 8}" text-anchor="middle">${s}</text>`).join('')}
        <text x="${SW - pr}" y="${SH - 8}" text-anchor="end" class="unit">m</text>
        ${marks}
        <path d="${line}" class="curve" />
        <circle cx="${x(Math.min(5000, Math.max(10, st.signature)))}" cy="${y(dmg(g, st.distance, speed))}" r="4" class="dot" />
        <line class="hover" x1="0" x2="0" y1="${pt}" y2="${SH - pb}" />
        <rect x="${pl}" y="${pt}" width="${SW - pl - pr}" height="${SH - pt - pb}" class="hit" />
      </svg>
      <div class="trk-readout" data-trk-read="sig">&nbsp;</div>
    </div>`;
  }

  function shortName(id: string) {
    return ({ frigate: tx('Freg.'), destroyer: tx('Distr.'), cruiser: tx('Cruc.'), battlecruiser: 'BC', battleship: tx('Cuir.') } as Record<string, string>)[id] ?? id;
  }

  function output() {
    pickAmmo();
    const g = gun();
    if (!g) return `<p class="dim">${tx('Arma asta nu are muniție care face daune.')}</p>`;
    const painters = activePainters(sde, g.dogma, st.distance).length;
    return statsRow(g) + rangeChart(g)
      + `<div class="trk-grid">${heatChart(g)}${sigChart(g)}</div>`
      + `<p class="dim small trk-note">${tx('Șansa de lovire = 0,5 ^ ((ω × rezoluție semnătură ÷ (tracking × semnătură))² + (max(0, distanță − optimal) ÷ falloff)²), unde ω = viteza transversală ÷ distanță. Daunele medii includ loviturile wrecking.')}${painters ? ' ' + tx('Painterele active din fit sunt incluse.') : ''}</p>`;
  }

  const modal = openModal(tx('Calculator de tracking'), `<div class="trk"><div data-trk-controls></div><div data-trk-out></div></div>`, { wide: true });
  modal.querySelector('.modal')?.classList.add('trk-modal');
  const ctrlEl = modal.querySelector<HTMLElement>('[data-trk-controls]')!;
  const outEl = modal.querySelector<HTMLElement>('[data-trk-out]')!;

  function renderAll() {
    pickAmmo();
    ctrlEl.innerHTML = controls();
    outEl.innerHTML = output();
  }

  function renderOut() {
    outEl.innerHTML = output();
    const a = ctrlEl.querySelector<HTMLElement>('[data-trk-out="angle"]');
    if (a) a.textContent = `${st.angle}°`;
    const d = ctrlEl.querySelector<HTMLElement>('[data-trk-out="distance"]');
    if (d) d.textContent = km(st.distance);
  }

  modal.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const field = t.dataset.trk;
    if (!field || t.tagName === 'SELECT') return;
    const v = Number(t.value);
    const bad = !Number.isFinite(v) || t.value.trim() === '' || ((field === 'signature' || field === 'velocity') && v < (field === 'signature' ? 1 : 0));
    t.classList.toggle('invalid', bad);
    t.title = bad ? (field === 'signature' ? tx('Semnătura trebuie să fie cel puțin 1 m') : tx('Viteza nu poate fi negativă')) : '';
    if (bad) return;
    if (field === 'distance') st.distance = v * 100;
    else if (field === 'angle') st.angle = v;
    else if (field === 'signature' || field === 'velocity') {
      st[field] = v;
      if (st.target !== 'custom') {
        st.target = 'custom';
        const sel = ctrlEl.querySelector<HTMLSelectElement>('[data-trk="target"]');
        if (sel) sel.value = 'custom';
      }
    }
    renderOut();
  });

  modal.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    const field = t.dataset.trk;
    if (!field || t.tagName !== 'SELECT') return;
    if (field === 'weapon') { st.weapon = Number(t.value); st.ammo = 0; }
    else if (field === 'ammo') st.ammo = Number(t.value);
    else if (field === 'target') {
      st.target = t.value;
      const p = TARGETS.find((x) => x.id === t.value);
      if (p) { st.signature = p.signature; st.velocity = p.velocity; }
    }
    renderAll();
  });

  modal.addEventListener('pointermove', (e) => {
    const svg = (e.target as Element).closest<SVGSVGElement>('svg[data-trk-chart]');
    if (!svg) return;
    const g = gun();
    const ctm = svg.getScreenCTM();
    if (!g || !ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const kind = svg.dataset.trkChart!;
    const read = modal.querySelector<HTMLElement>(`[data-trk-read="${kind}"]`);
    const hover = svg.querySelector<SVGLineElement>('.hover');
    const speed = transversal();
    if (kind === 'range') {
      const maxX = Number(svg.dataset.max);
      const dist = Math.max(0, Math.min(maxX, ((p.x - PL) / (W - PL - PR)) * maxX));
      hover?.setAttribute('x1', String(p.x)); hover?.setAttribute('x2', String(p.x));
      const c = chance(g, dist, speed);
      const m = turretMultiplier(c);
      if (read) read.innerHTML = `<b class="num">${km(dist)}</b> · ${tx('lovire')} <b class="num">${pct(c, 1)}</b> · ${tx('daune')} <b class="num">${pct(m)}</b> · <b class="num">${formatNum(g.rawDps * m, 1)}</b> DPS · ${tx('oprită')} <b class="num">${pct(dmg(g, dist, 0))}</b>`;
    } else if (kind === 'heat') {
      const maxX = Number(svg.dataset.max), maxV = Number(svg.dataset.maxv);
      const dist = Math.max(0, Math.min(maxX, ((p.x - 44) / (SW - 54)) * maxX));
      const v = Math.max(0, Math.min(maxV, ((SH - 26 - p.y) / (SH - 48)) * maxV));
      const m = dmg(g, dist, v);
      if (read) read.innerHTML = `<b class="num">${km(dist)}</b> · <b class="num">${formatNum(v, 0)}</b> m/s · ${tx('daune')} <b class="num">${pct(m)}</b> · <b class="num">${formatNum(g.rawDps * m, 1)}</b> DPS`;
    } else if (kind === 'sig') {
      const lo = 1, hi = Math.log10(5000);
      const s = 10 ** (lo + ((p.x - 40) / (SW - 50)) * (hi - lo));
      const sig = Math.max(10, Math.min(5000, s));
      hover?.setAttribute('x1', String(p.x)); hover?.setAttribute('x2', String(p.x));
      const m = dmg(g, st.distance, speed, sigAt(g, st.distance, sig));
      if (read) read.innerHTML = `${tx('Semnătură')} <b class="num">${formatNum(sig, 0)} m</b> · ${tx('daune')} <b class="num">${pct(m)}</b> · <b class="num">${formatNum(g.rawDps * m, 1)}</b> DPS`;
    }
    svg.classList.add('hovering');
  });

  modal.addEventListener('pointerout', (e) => {
    const svg = (e.target as Element).closest<SVGSVGElement>('svg[data-trk-chart]');
    if (svg && !svg.contains(e.relatedTarget as Node)) svg.classList.remove('hovering');
  });

  renderAll();
}

function niceStep(range: number, count: number) {
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}
