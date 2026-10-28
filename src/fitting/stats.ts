import { buildDogma, canLoadCharge, cloneFit, SLOT_KINDS, type Fit } from '../engine/fit';
import { Category } from '../data/sde';
import type { Dogma, DogmaItem } from '../engine/dogma';
import { lockTime, DAMAGE_TYPES, LAYERS, type FitStats } from '../engine/stats';
import { DAMAGE_PROFILES, profileText } from '../engine/profiles';
import { requirementsFor, alphaRaces, fitTypeIds } from '../character/requirements';
import { formatDuration } from '../character/training';
import { icon } from '../ui/icons';
import { alertBox, badge, esc, formatInt, formatNum, meter, panel } from '../ui/components';
import { roman } from '../ui/itemInfo';
import { breakdownHtml, derive, single, type Breakdown } from '../ui/breakdown';
import { applied, dpsCurve, TARGETS, type Applied, type TargetProfile } from '../engine/application';
import { stackingFactor } from '../engine/dogma';
import { tx } from '../i18n';
import { DMG_LABEL, LAYER_LABEL, capTime, sum, damageBar, groupBy, type FitEnv } from './shared';
import { turretGroups } from './tracking';

const CURVE_COLORS = 4;
const DAMAGE_ATTRS = ['emDamage', 'thermalDamage', 'kineticDamage', 'explosiveDamage'];

export function createStatsPanels(env: FitEnv, tips: Map<string, string>) {
  const { sde, ctx } = env;
  let compareWeapon = 0;
  let compare: number[] = [];
  const ammoCache = new Map<number, number[]>();

  function mainWeapon(fit: Fit): { typeId: number; chargeId?: number } | null {
    const counts = new Map<number, { n: number; chargeId?: number }>();
    for (const k of SLOT_KINDS) for (const m of fit.slots[k]) {
      if (!m || !m.chargeId || m.state === 'offline') continue;
      if (!DAMAGE_ATTRS.some((a) => sde.baseAttr(m.chargeId!, sde.attrId(a)) > 0)) continue;
      const c = counts.get(m.typeId) ?? { n: 0, chargeId: m.chargeId };
      c.n++;
      counts.set(m.typeId, c);
    }
    const best = [...counts].sort((a, b) => b[1].n - a[1].n)[0];
    return best ? { typeId: best[0], chargeId: best[1].chargeId } : null;
  }

  function ammoFor(moduleId: number): number[] {
    if (!ammoCache.has(moduleId)) {
      ammoCache.set(moduleId, sde.typesInCategory(Category.Charge)
        .filter((c) => canLoadCharge(sde, moduleId, c.id) && DAMAGE_ATTRS.some((a) => sde.baseAttr(c.id, sde.attrId(a)) > 0))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => c.id));
    }
    return ammoCache.get(moduleId)!;
  }

  function withAmmo(fit: Fit, moduleId: number, chargeId: number): Dogma {
    const copy = cloneFit(fit);
    for (const k of SLOT_KINDS) for (const m of copy.slots[k]) if (m && m.typeId === moduleId) m.chargeId = chargeId;
    return buildDogma(sde, copy, ctx.character);
  }

  function buildTips(d: Dogma) {
    tips.clear();
    const ship = d.ship;
    const id = (n: string) => sde.attrId(n);
    const tr = (n: string) => ship.trace(id(n));
    const online = d.modules.filter((m) => m.state !== 'offline');
    const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
    const f = (digits: number, unit = '') => (n: number) => formatNum(n, digits) + (unit ? ' ' + unit : '');
    const section = (title: string, html: string) => `<div class="bd-title">${esc(title)}</div>${html}`;
    const resource = (key: string, out: string, use: string, list: DogmaItem[], fmt: (n: number) => string) => {
      tips.set(key, section(tx('Disponibil'), breakdownHtml(single(tr(out)), fmt, tx('navă')))
        + section(tx('Folosit'), breakdownHtml(derive(list.map((m) => m.trace(id(use))), sum), fmt, tx('module'))));
    };
    resource('cpu', 'cpuOutput', 'cpu', online, f(1, 'tf'));
    resource('power', 'powerOutput', 'power', online, f(1, 'MW'));
    resource('calibration', 'upgradeCapacity', 'upgradeCost', d.modules, f(0));
    const one = (key: string, attr: string, fmt: (n: number) => string) => tips.set(key, breakdownHtml(single(tr(attr)), fmt));
    one('velocity', 'maxVelocity', f(0, 'm/s'));
    one('signature', 'signatureRadius', f(0, 'm'));
    one('agility', 'agility', f(3));
    one('range', 'maxTargetRange', (n) => formatNum(n / 1000, 1) + ' km');
    one('scan', 'scanResolution', f(0, 'mm'));
    tips.set('mass', breakdownHtml(derive([tr('mass')], (v) => v[0] / 1000), (n) => formatInt(n) + ' t'));
    tips.set('align', breakdownHtml(derive([tr('agility'), tr('mass')], (v) => (-Math.log(0.25) * v[0] * v[1]) / 1e6), f(2, 's')));
    tips.set('warp', breakdownHtml(derive([tr('warpSpeedMultiplier'), tr('baseWarpSpeed')], (v) => v[0] * v[1]), f(2, 'AU/s')));
    const shipTargets = tr('maxLockedTargets');
    const charTargets = d.character.trace(id('maxLockedTargets'));
    tips.set('targets', charTargets.value < shipTargets.value
      ? breakdownHtml(single(charTargets), f(0), tx('caracter')) + `<div class="bd-row dim">${tx('limita navei')}: ${formatNum(shipTargets.value, 0)}</div>`
      : breakdownHtml(single(shipTargets), f(0), tx('navă')));
    const sensor = ['scanRadarStrength', 'scanLadarStrength', 'scanMagnetometricStrength', 'scanGravimetricStrength']
      .reduce((a, b) => (ship.get(b) > ship.get(a) ? b : a));
    one('sensor', sensor, f(1));
    tips.set('lockF', breakdownHtml(derive([tr('scanResolution')], (v) => lockTime(v[0], 35)), f(1, 's')));
    tips.set('lockB', breakdownHtml(derive([tr('scanResolution')], (v) => lockTime(v[0], 400)), f(1, 's')));
  }

  function currentTarget(): TargetProfile {
    const preset = TARGETS.find((t) => t.id === env.targetState().id);
    return preset ?? { id: 'custom', name: tx('Personalizat'), signature: env.targetState().signature, velocity: env.targetState().velocity };
  }

  function dpsChart(points: { distance: number; dps: number }[], raw: number, at: number, extra: { distance: number; dps: number }[][] = []) {
    const w = 520, h = 170, pl = 44, pb = 22, pt = 8, pr = 10;
    const maxX = Math.max(points[points.length - 1].distance, ...extra.map((c) => c[c.length - 1].distance));
    const maxY = Math.max(raw, ...points.map((p) => p.dps), ...extra.flat().map((p) => p.dps), 1);
    const x = (v: number) => pl + (v / maxX) * (w - pl - pr);
    const y = (v: number) => pt + (1 - v / maxY) * (h - pt - pb);
    const path = (pts: { distance: number; dps: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.distance).toFixed(1)},${y(p.dps).toFixed(1)}`).join('');
    const line = path(points);
    const ticksX = [0, 0.25, 0.5, 0.75, 1].map((f) => maxX * f);
    const ticksY = [0, 0.5, 1].map((f) => maxY * f);
    return `<svg class="dps-chart" viewBox="0 0 ${w} ${h}" role="img">
      ${ticksY.map((v) => `<line x1="${pl}" x2="${w - pr}" y1="${y(v)}" y2="${y(v)}" class="grid" /><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${formatNum(v, 0)}</text>`).join('')}
      ${ticksX.map((v) => `<text x="${x(v)}" y="${h - 6}" text-anchor="middle">${formatNum(v / 1000, 0)} km</text>`).join('')}
      <line x1="${pl}" x2="${w - pr}" y1="${y(raw)}" y2="${y(raw)}" class="raw" />
      ${extra.map((c, i) => `<path d="${path(c)}" class="curve alt c${i % CURVE_COLORS}" />`).join('')}
      <path d="${line}" class="curve" />
      ${at <= maxX ? `<line x1="${x(at)}" x2="${x(at)}" y1="${pt}" y2="${h - pb}" class="marker" />` : ''}
    </svg>`;
  }

  function paintTip(target: TargetProfile, a: Applied) {
    const sorted = [...a.painters].sort((x, y) => y.mult - x.mult);
    let value = target.signature;
    const parts: Breakdown['parts'] = sorted.map((p, i) => {
      const next = value * (1 + (p.mult - 1) * stackingFactor(i));
      const part = { label: p.item.type.name, delta: next - value };
      value = next;
      return part;
    });
    const m = (n: number) => formatNum(n, 0) + ' m';
    const pctFmt = (n: number) => formatNum(n, 1) + '%';
    const seen = new Set<string>();
    const modules = sorted.filter((p) => !seen.has(p.item.type.name) && seen.add(p.item.type.name)).map((p) =>
      `<div class="bd-title">${esc(p.item.type.name)}</div>${breakdownHtml(single(p.item.trace(sde.attrId('signatureRadiusBonus'))), pctFmt, tx('modul'))}`
      + (p.reach < 1 ? `<div class="bd-row dim">${tx('Eficiență la distanță')}: ${formatNum(p.reach * 100, 0)}%</div>` : '')).join('');
    tips.set('paint', `<div class="bd-title">${tx('Semnătură țintă')}</div>${breakdownHtml({ base: target.signature, parts, value: a.signature }, m, tx('țintă'))}${modules}`);
  }

  function ammoCompare(d: Dogma, target: TargetProfile, distance: number, raw: number) {
    const fit = env.getFit();
    const main = fit ? mainWeapon(fit) : null;
    if (!fit || !main) return dpsChart(dpsCurve(sde, d, target), raw, distance);
    if (compareWeapon !== main.typeId) { compareWeapon = main.typeId; compare = []; }
    const options = ammoFor(main.typeId).filter((id) => id !== main.chargeId);
    const shown = compare.filter((id) => options.includes(id));
    const curves = shown.map((id) => {
      const dd = withAmmo(fit, main.typeId, id);
      return { id, curve: dpsCurve(sde, dd, target), now: applied(sde, dd, target, distance).dps };
    });
    const nowMain = applied(sde, d, target, distance).dps;
    const legend = `<div class="ammo-legend">
      <span class="ammo-key main"><i></i>${esc(env.name(main.chargeId!))}<b class="num">${formatNum(nowMain, 0)}</b></span>
      ${curves.map((c, i) => `<span class="ammo-key c${i % CURVE_COLORS}"><i></i>${esc(env.name(c.id))}<b class="num">${formatNum(c.now, 0)}</b><button class="ammo-del" data-ammo-del="${c.id}" aria-label="${tx('Scoate din grafic')}">${icon('close')}</button></span>`).join('')}
    </div>`;
    const picker = options.length && shown.length < CURVE_COLORS
      ? `<label class="ammo-pick">${tx('Compară cu altă muniție')}<select class="input plain sm" data-ammo-add><option value="">${tx('Alege muniția')}</option>${options.filter((id) => !shown.includes(id)).map((id) => `<option value="${id}">${esc(env.name(id))}</option>`).join('')}</select></label>`
      : '';
    return dpsChart(dpsCurve(sde, d, target), raw, distance, curves.map((c) => c.curve)) + legend + picker;
  }

  function handleAmmo(t: HTMLElement): boolean {
    const add = t.closest<HTMLSelectElement>('[data-ammo-add]');
    if (add && add.value) { compare = [...compare, Number(add.value)].slice(-CURVE_COLORS); return true; }
    const del = t.closest<HTMLElement>('[data-ammo-del]');
    if (del) { compare = compare.filter((id) => id !== Number(del.dataset.ammoDel)); return true; }
    return false;
  }

  function applicationPanel(d: Dogma) {
    const target = currentTarget();
    const distance = env.targetState().distanceKm * 1000;
    const a = applied(sde, d, target, distance);
    if (!a.weapons.length) return '';
    const pct = a.rawDps ? (a.dps / a.rawDps) * 100 : 0;
    const custom = target.id === 'custom';
    if (a.painters.length) paintTip(target, a);
    return panel({
      title: tx('DPS aplicat'),
      actions: `<select class="input plain sm" id="fitTarget">
        ${TARGETS.map((t) => `<option value="${t.id}" ${t.id === env.targetState().id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        <option value="custom" ${custom ? 'selected' : ''}>${tx('Personalizat')}</option>
      </select>`,
      body: `<div class="target-inputs">
          <label>${tx('Semnătură')} <input class="input plain sm num" type="number" min="1" data-target-field="signature" value="${target.signature}" ${custom ? '' : 'disabled'} /> m</label>
          <label>${tx('Viteză')} <input class="input plain sm num" type="number" min="0" data-target-field="velocity" value="${target.velocity}" ${custom ? '' : 'disabled'} /> m/s</label>
          <label>${tx('Distanță')} <input class="input plain sm num" type="number" min="0" step="1" data-target-field="distanceKm" value="${env.targetState().distanceKm}" /> km</label>
        </div>
        <div class="big-stats">
          <div><span class="label">${tx('DPS aplicat')}</span><span class="value num">${formatNum(a.dps, 1)}</span></div>
          <div><span class="label">${tx('Din brut')}</span><span class="value num">${formatNum(pct, 0)}%</span></div>
          ${a.painters.length ? `<div data-bd="paint"><span class="label">${tx('Semnătură cu painter')}</span><span class="value num">${formatNum(a.signature, 0)} m</span></div>` : ''}
        </div>
        ${ammoCompare(d, target, distance, a.rawDps)}
        <table class="table compact"><tbody>${a.weapons.map((w) => `<tr><td>${esc(w.name)}</td><td class="r num">${formatNum(w.dps, 1)}</td><td class="r num dim">${formatNum(w.factor * 100, 0)}%</td></tr>`).join('')}</tbody></table>`,
    });
  }

  function statsPanels(s: FitStats, d: Dogma) {
    const r = s.resources;
    const res = `
      <div data-bd="cpu">${meter('CPU', r.cpu.used, r.cpu.total, 'tf')}</div>
      <div data-bd="power">${meter('Powergrid', r.power.used, r.power.total, 'MW')}</div>
      <div data-bd="calibration">${meter(tx('Calibrare'), r.calibration.used, r.calibration.total, '', 0)}</div>
      <div class="mini-kv">
        <span>${tx('Turele')} <b class="num">${r.turrets.used}/${r.turrets.total}</b></span>
        <span>${tx('Lansatoare')} <b class="num">${r.launchers.used}/${r.launchers.total}</b></span>
        ${r.droneBandwidth.total > 0 ? `<span>${tx('Lățime de bandă')} <b class="num">${formatNum(r.droneBandwidth.used, 0)}/${formatNum(r.droneBandwidth.total, 0)}</b></span>` : ''}
      </div>`;
    const warnings = s.warnings.length ? `<div class="stack-sm">${s.warnings.map((w) => alertBox(w)).join('')}</div>` : '';

    const o = s.offense;
    const weapons = o.weapons.map((w) => `<tr><td>${esc(w.name)} <span class="dim">×${w.count}</span></td>
      <td class="r num">${formatNum(sum(w.dps), 1)}</td><td class="r num">${formatNum(sum(w.volley), 0)}</td>
      <td class="r num dim">${w.range ? formatNum(w.range / 1000, 1) + (w.falloff ? ' + ' + formatNum(w.falloff / 1000, 1) : '') + ' km' : ''}</td></tr>`).join('');
    const offensePanel = panel({
      title: tx('Ofensivă'),
      actions: env.getFit() && turretGroups(sde, env.getFit()!).length ? `<button class="btn ghost sm" data-action="tracking" title="${tx('Optimal, falloff, tracking și cum scad daunele cu distanța')}">${icon('target')}${tx('Tracking')}</button>` : '',
      body: `<div class="big-stats">
          <div><span class="label">DPS total</span><span class="value num">${formatNum(o.totalDps, 1)}</span></div>
          <div><span class="label">${tx('Arme')}</span><span class="value num">${formatNum(o.weaponDps, 1)}</span></div>
          <div><span class="label">${tx('Drone')}</span><span class="value num">${formatNum(o.droneDps, 1)}</span></div>
          <div><span class="label">${tx('Salvă')}</span><span class="value num">${formatNum(o.totalVolley, 0)}</span></div>
        </div>
        ${o.startDps < o.totalDps - 0.05 ? `<p class="dim small">${tx('DPS la spool maxim; la pornire: {dps}', { dps: formatNum(o.startDps, 1) })}</p>` : ''}
        ${damageBar(o.dps)}
        ${weapons ? `<table class="table compact"><thead><tr><th>${tx('Armă')}</th><th class="r">DPS</th><th class="r">${tx('Salvă')}</th><th class="r">${tx('Rază')}</th></tr></thead><tbody>${weapons}</tbody></table>` : `<p class="dim small">${tx('Nicio armă activă.')}</p>`}`,
    });

    const def = s.defense;
    const resistRows = LAYERS.map((l) => {
      const layer = def.layers[l];
      return `<tr><th>${LAYER_LABEL[l]}</th><td class="r num">${formatInt(layer.hp)}</td>
        ${DAMAGE_TYPES.map((t) => `<td class="r"><span class="resist ${t}" style="--p:${(layer.resists[t] * 100).toFixed(1)}%">${formatNum(layer.resists[t] * 100, 1)}</span></td>`).join('')}
        <td class="r num">${formatInt(layer.ehp)}</td></tr>`;
    }).join('');
    const tankRows = LAYERS.filter((l) => def.repairs[l].raw > 0).map((l) =>
      `<span>${tx('Reparare {layer}', { layer: LAYER_LABEL[l].toLowerCase() })} <b class="num">${formatNum(def.repairs[l].effective, 1)}</b> EHP/s</span>`).join('')
      + (def.passiveShield.raw > 0 ? `<span>${tx('Scut pasiv')} <b class="num">${formatNum(def.passiveShield.raw, 1)}</b> HP/s</span>` : '');
    const defensePanel = panel({
      title: tx('Defensivă'),
      actions: `<select class="input plain sm" id="fitProfile" title="${tx('Profil de daune (inamicul)')}">
        ${groupBy(DAMAGE_PROFILES, (p) => p.group).map(([g, list]) => `<optgroup label="${esc(profileText(g))}">${list.map((p) => `<option value="${esc(p.id)}" ${p.id === env.profileId() ? 'selected' : ''}>${esc(profileText(p.name))}</option>`).join('')}</optgroup>`).join('')}
      </select>`,
      body: `<div class="big-stats">
          <div><span class="label">EHP</span><span class="value num">${formatInt(def.ehp)}</span></div>
          <div><span class="label">HP</span><span class="value num">${formatInt(def.hp)}</span></div>
          <div><span class="label">${tx('Tank activ')} · EHP/s</span><span class="value num">${formatNum(def.activeTank, 1)}</span></div>
          <div><span class="label">${tx('Scut pasiv')} · EHP/s</span><span class="value num">${formatNum(def.passiveShield.effective, 1)}</span></div>
        </div>
        <table class="table compact resists">
          <thead><tr><th></th><th class="r">HP</th>${DAMAGE_TYPES.map((t) => `<th class="r">${DMG_LABEL[t]}</th>`).join('')}<th class="r">EHP</th></tr></thead>
          <tbody>${resistRows}</tbody>
        </table>
        ${tankRows ? `<div class="mini-kv">${tankRows}</div>` : ''}`,
    });

    const c = s.capacitor;
    const capPanel = panel({
      title: 'Capacitor',
      body: `<div class="cap-row">
          <div class="cap-ring ${c.stable ? 'ok' : 'bad'}" style="--p:${c.stable ? ((c.stableAt ?? 1) * 100).toFixed(0) : 0}%"><span class="num">${c.stable ? formatNum((c.stableAt ?? 1) * 100, 1) + '%' : capTime(c.lastsSeconds ?? 0)}</span></div>
          <dl class="mini-dl">
            <div><dt>${tx('Capacitate')}</dt><dd class="num">${formatInt(c.capacity)} GJ</dd></div>
            <div><dt>${tx('Reîncărcare')}</dt><dd class="num">${formatNum(c.rechargeTime, 1)} s</dd></div>
            <div><dt>${tx('Vârf reîncărcare')}</dt><dd class="num">${formatNum(c.peakRecharge, 1)} GJ/s</dd></div>
            <div><dt>${tx('Consum net')}</dt><dd class="num">${formatNum(c.usage, 1)} GJ/s</dd></div>
          </dl>
        </div>
        ${c.drains.length ? `<table class="table compact"><tbody>${c.drains.map((x) => `<tr><td>${esc(x.name)}</td><td class="r num ${x.perSecond < 0 ? 'pos' : ''}">${x.perSecond < 0 ? '+' + formatNum(-x.perSecond, 2) : '−' + formatNum(x.perSecond, 2)} GJ/s</td></tr>`).join('')}</tbody></table>` : ''}`,
    });

    const n = s.navigation;
    const t = s.targeting;
    const navPanel = panel({
      title: tx('Navigație și țintire'),
      body: `<dl class="mini-dl grid">
        <div data-bd="velocity"><dt>${tx('Viteză')}</dt><dd class="num">${formatNum(n.maxVelocity, 0)} m/s</dd></div>
        <div data-bd="align"><dt>${tx('Aliniere')}</dt><dd class="num">${formatNum(n.alignTime, 2)} s</dd></div>
        <div data-bd="warp"><dt>${tx('Viteză warp')}</dt><dd class="num">${formatNum(n.warpSpeed, 2)} AU/s</dd></div>
        <div data-bd="signature"><dt>${tx('Semnătură')}</dt><dd class="num">${formatNum(n.signatureRadius, 0)} m</dd></div>
        <div data-bd="mass"><dt>${tx('Masă')}</dt><dd class="num">${formatInt(n.mass / 1000)} t</dd></div>
        <div data-bd="agility"><dt>${tx('Agilitate')}</dt><dd class="num">${formatNum(n.agility, 3)}</dd></div>
        <div data-bd="range"><dt>${tx('Rază țintire')}</dt><dd class="num">${formatNum(t.maxRange / 1000, 1)} km</dd></div>
        <div data-bd="scan"><dt>${tx('Rezoluție scan')}</dt><dd class="num">${formatNum(t.scanResolution, 0)} mm</dd></div>
        <div data-bd="targets"><dt>${tx('Ținte')}</dt><dd class="num">${t.maxLocked}</dd></div>
        <div data-bd="sensor"><dt>${esc(t.sensorType)}</dt><dd class="num">${formatNum(t.sensorStrength, 1)}</dd></div>
        <div data-bd="lockF"><dt>${tx('Țintire fregată')}</dt><dd class="num">${formatNum(lockTime(t.scanResolution, 35), 1)} s</dd></div>
        <div data-bd="lockB"><dt>${tx('Țintire cuirasat')}</dt><dd class="num">${formatNum(lockTime(t.scanResolution, 400), 1)} s</dd></div>
      </dl>`,
    });

    return panel({ title: tx('Resurse'), body: res + warnings }) + offensePanel + applicationPanel(d) + defensePanel + capPanel + navPanel;
  }

  function requirementsPanel(f: Fit) {
    const ids = fitTypeIds(f);
    const req = requirementsFor(sde, ids, ctx.character);
    const alpha = alphaRaces(sde, ids);
    const rows = req.missing.map((st) => `<tr class="${st.status}"><td><button class="link" data-info="${st.skillId}">${esc(st.name)}</button></td><td>${roman(st.current)} → ${roman(st.required)}</td><td class="r num">${formatDuration(st.seconds)}</td></tr>`).join('');
    return panel({
      title: tx('Cerințe'),
      count: ctx.character.name,
      body: `<div class="req-summary">
          ${req.canFly ? badge(tx('Poți zbura fit-ul'), 'ok', true) : badge(tx('Lipsesc {n} skill-uri', { n: req.missing.length }), 'warn', true)}
          ${alpha.length ? badge('Alpha: ' + alpha.join(', '), 'accent') : badge('Omega', 'gold')}
        </div>
        ${req.missing.length ? `
          <p class="req-total">${tx('<span class="num">{time}</span> de antrenament · <span class="num">{sp}</span> SP', { time: formatDuration(req.totalSeconds), sp: formatInt(req.totalSp) })}</p>
          <table class="table compact"><tbody>${rows}</tbody></table>
          <div class="row-actions"><button class="btn ghost sm" data-action="copy-plan">${icon('copy')}${tx('Copiază planul')}</button><button class="btn ghost sm" data-action="plan-fit">${icon('skills')}${tx('Adaugă în planul de skill-uri')}</button></div>
          <div id="skillbookCost" class="dim small"></div>` : ''}
        ${ctx.character.kind === 'all5' ? `<p class="dim small">${tx('Statisticile sunt calculate cu toate skill-urile la V. Fă login în Caracter ca să vezi cifrele tale.')}</p>` : ''}`,
    });
  }

  return { buildTips, statsPanels, requirementsPanel, handleAmmo };
}
