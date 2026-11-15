import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatNum, badge, button, emptyState } from '../ui/components';
import { icon } from '../ui/icons';
import { tx } from '../i18n';
import { StarMap, type MapPainter } from '../ui/starMap';
import { loadMap, displaySec, secClass, type NavMap, type NavSystem } from '../services/navigation';
import { systemActivity, analyzeKills, type SystemActivity } from '../services/recon';
import { startKillStream, onKill, liveKills, type LiveKill } from '../services/killstream';
import { lastPosition, onVisitsChange, startVisitTracker } from '../services/visited';
import { loadSharedRoute, saveSharedRoute, type SharedRoute } from '../services/routePlanner';
import { hasScope } from '../character/sso';
import { permissionButtons } from '../character/permissions';
import { viewHref } from '../app/route';

const LOCATION_SCOPE = 'esi-location.read_location.v1';
const RECENT_MS = 15 * 60_000;
const AHEAD = 5;

const secSpan = (sec: number) => `<span class="num ${secClass(sec)}">${formatNum(displaySec(sec), 1)}</span>`;

export interface RoutePlannerView { show(): void }

export function createRoutePlanner(el: HTMLElement, ctx: AppContext): RoutePlannerView {
  let map: NavMap | null = null;
  let star: StarMap | null = null;
  let route: (SharedRoute & { reached?: number }) | null = null;
  let here: number | null = null;
  let act = new Map<number, SystemActivity>();
  let kills = new Map<number, LiveKill[]>();
  let started = false;

  const pathSet = () => new Set(route?.path ?? []);
  const reached = () => route?.reached ?? 0;

  function loadKills() {
    if (!route) return;
    const on = pathSet();
    kills = new Map();
    for (const k of liveKills()) if (on.has(k.systemId)) (kills.get(k.systemId) ?? kills.set(k.systemId, []).get(k.systemId)!).push(k);
  }

  function danger(id: number) {
    const list = kills.get(id) ?? [];
    const recent = list.filter((k) => Date.now() - k.time < RECENT_MS).length;
    const camp = list.length ? analyzeKills(list, () => false).camp : false;
    const a = act.get(id);
    const level = camp || recent >= 2 ? 3 : recent || list.length >= 3 ? 2 : list.length || (a && a.ship + a.pod > 0) ? 1 : 0;
    return { recent, hour: list.length, camp, level };
  }

  function track() {
    if (!route) return;
    const p = lastPosition(ctx.character.name);
    here = p && Date.now() - p.time < 6 * 3_600_000 ? p.systemId : null;
    if (here == null) return;
    const i = route.path.indexOf(here, reached());
    if (i > reached()) { route.reached = i; saveSharedRoute(route); }
  }

  function over(p: MapPainter) {
    if (!route || route.path.length < 2) return;
    const g = p.ctx;
    const r = Math.max(2.5, Math.min(6, p.spacing * 0.2));
    const line = (from: number, to: number, alpha: number, dash: number[]) => {
      g.save();
      g.globalAlpha = alpha;
      g.strokeStyle = p.css('--gold');
      g.lineWidth = Math.max(2, Math.min(4, p.spacing * 0.09));
      g.setLineDash(dash);
      g.beginPath();
      for (let i = from; i <= to; i++) {
        const pt = p.at(route!.path[i]);
        if (!pt) continue;
        if (i > from) g.lineTo(pt[0], pt[1]); else g.moveTo(pt[0], pt[1]);
      }
      g.stroke();
      g.restore();
    };
    line(0, reached(), 0.3, []);
    line(reached(), route.path.length - 1, 1, [7, 6]);
    route.path.forEach((id, i) => {
      const pt = p.at(id);
      if (!pt) return;
      const end = i === 0 || i === route!.path.length - 1;
      if (end || route!.stops.includes(id)) {
        g.fillStyle = p.css(end ? '--accent' : '--gold');
        g.beginPath();
        g.arc(pt[0], pt[1], r + (end ? 2 : 1), 0, Math.PI * 2);
        g.fill();
      }
      const d = i >= reached() ? danger(id).level : 0;
      if (d >= 2) {
        g.strokeStyle = p.css(d >= 3 ? '--danger' : '--warn');
        g.lineWidth = 2;
        g.beginPath();
        g.arc(pt[0], pt[1], r + 4, 0, Math.PI * 2);
        g.stroke();
      }
    });
    if (here != null) {
      const pt = p.at(here);
      if (pt) {
        const pulse = (Math.sin(p.time / 300) + 1) / 2;
        g.fillStyle = p.css('--accent');
        g.beginPath();
        g.arc(pt[0], pt[1], r + 2, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = p.css('--accent');
        g.globalAlpha = 1 - pulse;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(pt[0], pt[1], r + 4 + pulse * 10, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    }
  }

  function tooltip(s: NavSystem) {
    const d = danger(s.id);
    const a = act.get(s.id);
    return `<b>${esc(s.name)}</b> ${secSpan(s.sec)}<small>${esc(map!.region(s))} · ${esc(map!.constellation(s))}</small>
      ${d.hour ? `<span class="tip-row warn-text">${tx('{n} kill-uri live în ultima oră', { n: d.hour })}</span>` : ''}
      ${a && a.ship + a.pod ? `<span class="tip-row dim">${tx('ESI: {n} nave și capsule distruse în ultima oră', { n: a.ship + a.pod })}</span>` : ''}`;
  }

  function side() {
    const box = el.querySelector<HTMLElement>('#rpSide');
    if (!box || !map || !route) return;
    const pilot = ctx.character.characterId ? { characterId: ctx.character.characterId, name: ctx.character.name } : null;
    const tracked = !!pilot && hasScope(pilot.characterId, LOCATION_SCOPE);
    const left = route.path.length - 1 - reached();
    const offRoute = here != null && !route.path.includes(here);
    const ahead = route.path.slice(reached() + 1, reached() + 1 + AHEAD).map((id) => ({ id, d: danger(id) })).filter((x) => x.d.level >= 2);
    const verdict = left <= 0 ? `<div class="alert ok">${icon('check')}<span>${tx('Ai ajuns la destinație.')}</span></div>`
      : ahead.length ? alertBox(tx('Atenție în următoarele {n} sărituri: {list}', { n: AHEAD, list: ahead.map((x) => map!.systems.get(x.id)!.name).join(', ') }), ahead.some((x) => x.d.level >= 3) ? 'danger' : 'warn')
      : `<div class="alert ok">${icon('check')}<span>${tx('Liniște în următoarele {n} sărituri.', { n: AHEAD })}</span></div>`;
    box.innerHTML = `<div class="history-kpis">
        <div><span class="label">${tx('Rămase')}</span><span class="value">${tx('{n} sărituri', { n: Math.max(0, left) })}</span></div>
        <div><span class="label">${tx('Acum în')}</span><span class="value">${here != null ? esc(map.systems.get(here)?.name ?? '—') : '—'}</span></div>
      </div>
      ${!tracked ? (pilot ? permissionButtons('location', [pilot]) : '') : offRoute ? alertBox(tx('Ești în afara rutei.'), 'warn') : ''}
      ${verdict}
      <div class="vis-steps rp-steps">${route.path.map((id, i) => {
        const s = map!.systems.get(id)!;
        const d = danger(id);
        const done = i < reached();
        return `<div class="vis-step ${done ? 'rp-done' : ''} ${i === reached() ? 'new' : ''}" data-sys="${id}">
          <span class="num dim">${i}</span>${secSpan(s.sec)}<span class="vis-step-name">${esc(s.name)}</span>
          ${route!.stops.includes(id) ? badge(tx('Punct'), 'gold') : ''}
          ${!done && d.camp ? badge(tx('Posibil gatecamp'), 'danger', true) : !done && d.hour ? badge(d.recent ? tx('{n} în 15 min', { n: d.recent }) : tx('{n} / h', { n: d.hour }), d.level >= 3 ? 'danger' : 'warn', true) : ''}
        </div>`;
      }).join('')}</div>
      <div class="vis-route-actions">${button(tx('Șterge ruta'), { iconName: 'close', cls: 'ghost sm', attrs: 'data-rp-clear' })}</div>`;
  }

  function render() {
    route = loadSharedRoute();
    if (route && map && route.path.some((id) => !map!.systems.has(id))) route = null;
    star?.destroy();
    star = null;
    if (!map) return;
    if (!route) {
      el.innerHTML = panel({ body: emptyState({ title: tx('Nicio rută trimisă'), text: tx('Calculează ruta în Intel PvP > Rută și apasă „Arată în Navigație”.'), extra: `<a class="btn" href="${viewHref('recon')}">${icon('recon')}${tx('Deschide Intel PvP')}</a>`, vy: 'No Passage Charted' }) });
      return;
    }
    track();
    loadKills();
    el.innerHTML = `<div class="live-map vis-map">
      <div class="live-toolbar"><b>${esc(route.title)}</b><span class="live-status small dim">${tx('Kill-uri live din zKillboard, poziția din ESI')}</span></div>
      <div class="live-body">
        <div class="live-canvas">
          <div class="live-stage" id="rpStage"></div>
          <div class="live-zoom">
            <button class="icon-btn" data-zoom="in" aria-label="${esc(tx('Mărește'))}">+</button>
            <button class="icon-btn" data-zoom="out" aria-label="${esc(tx('Micșorează'))}">−</button>
            <button class="icon-btn" data-zoom="fit" aria-label="${esc(tx('Toată ruta'))}">${icon('refresh')}</button>
          </div>
        </div>
        <aside class="live-side"><div class="live-side-body" id="rpSide"></div></aside>
      </div>
    </div>`;
    const on = pathSet();
    star = new StarMap(el.querySelector<HTMLElement>('#rpStage')!, map, {
      over,
      tooltip,
      regionLabels: true,
      dim: (s) => !on.has(s.id),
      labelFirst: (id) => on.has(id),
      animate: () => here != null,
    });
    star.fitSystems(route.path);
    side();
  }

  const refresh = () => { track(); loadKills(); side(); star?.redraw(); };

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const z = t.closest<HTMLElement>('[data-zoom]');
    if (z && star && route) {
      if (z.dataset.zoom === 'in') star.zoomBy(1.6);
      else if (z.dataset.zoom === 'out') star.zoomBy(1 / 1.6);
      else star.fitSystems(route.path);
      return;
    }
    const step = t.closest<HTMLElement>('[data-sys]');
    if (step && star) { star.focus(Number(step.dataset.sys)); return; }
    if (t.closest('[data-rp-clear]')) { saveSharedRoute(null); render(); }
  });

  function start() {
    started = true;
    startVisitTracker();
    startKillStream();
    onVisitsChange(refresh);
    onKill((k) => { if (route?.path.includes(k.systemId)) refresh(); });
    ctx.onCharacterChange(refresh);
    systemActivity().then((a) => { act = a.map; refresh(); }).catch(() => null);
    setInterval(refresh, 60_000);
  }

  el.innerHTML = loader(tx('Încarc harta'));
  return {
    show() {
      const go = () => { if (!started) start(); render(); };
      if (map) { go(); return; }
      loadMap().then((m) => { map = m; go(); }).catch((err) => { el.innerHTML = panel({ body: alertBox((err as Error).message) }); });
    },
  };
}
