import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, formatNum, formatISK, badge, button, toast, confirmDialog } from '../ui/components';
import { icon } from '../ui/icons';
import { tx, locale } from '../i18n';
import { loadJson, saveJson, isDemo } from '../storage';
import { DEMO_ID } from '../demo/identity';
import { DEMO_ROUTE } from '../demo/visitedRoute';
import { StarMap, type MapPainter } from '../ui/starMap';
import { loadMap, displaySec, secClass, POCHVEN_REGION, type NavMap, type NavSystem } from '../services/navigation';
import { systemActivity, type SystemActivity } from '../services/recon';
import { fetchPrices, typeIconUrl } from '../services/market';
import { loadStoredCharacters } from '../character/characters';
import { hasScope } from '../character/sso';
import { permissionButtons } from '../character/permissions';
import { formatDuration } from '../character/training';
import { cloneFit, newFitId, type Fit } from '../engine/fit';
import {
  visitedSet, visitCounts, pathFor, lastPosition, visitors, hasManual, importVisits, setManual, clearVisits, onVisitsChange, visitStats,
  parseLog, readLogFile, isLogFile, planExplore, allowedFor, isKspace, EXORDIUM_REGION, demoHistory, trackNow, startVisitTracker,
  type RiskLevel, type ExplorePlan, type VisitEntry,
} from '../services/visited';
import { travelFits, rankTravelFits, INSTA_ALIGN, type TravelFit } from '../services/travelFits';

type SideTab = 'progress' | 'route' | 'import';

interface Settings {
  who: string;
  days: number;
  trail: boolean;
  dim: boolean;
  tab: SideTab;
  level: RiskLevel;
  region: number;
  count: number;
  from: string;
}

interface Segment { a: NavSystem; b: NavSystem; gate: boolean; n: number; last: number; color: string }

const KEY = 'eve-nav:visited-ui';
const DEFAULTS: Settings = { who: '', days: 0, trail: true, dim: true, tab: 'progress', level: 'safe', region: 0, count: 10, from: '' };
const LOCATION_SCOPE = 'esi-location.read_location.v1';
const PERIODS: [number, string][] = [[0, tx('Tot')], [30, tx('30 zile')], [7, tx('7 zile')], [1, '24 h']];
const COUNTS = [5, 10, 20, 40];
const JUMP_GAP = 2 * 3_600_000;

const LEVELS: { id: RiskLevel; label: string; text: string }[] = [
  { id: 'safe', label: 'Safe', text: tx('Doar highsec. Ocolește sistemele cu nave sau capsule distruse în ultima oră.') },
  { id: 'risky', label: 'Not safe', text: tx('Highsec și lowsec. Ocolește gate camp-urile și sistemele cu multe kill-uri în ultima oră.') },
  { id: 'yolo', label: 'YOLO', text: tx('Oriunde în k-space, inclusiv nullsec și Pochven, pe drumul cel mai scurt.') },
];

const secSpan = (sec: number) => `<span class="num ${secClass(sec)}">${formatNum(displaySec(sec), 1)}</span>`;
const dateText = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
const dotlanRoute = (names: string[]) => `https://evemaps.dotlan.net/route/${names.map((n) => encodeURIComponent(n.replace(/ /g, '_'))).join(':')}`;

export interface VisitedMapView { show(): void }

export function createVisitedMap(el: HTMLElement, ctx: AppContext, opts: { openFit: (fit: Fit) => void }): VisitedMapView {
  const stored = loadJson<Partial<Settings>>(KEY, {});
  const settings: Settings = { ...DEFAULTS, ...stored };
  let map: NavMap | null = null;
  let star: StarMap | null = null;
  let started = false;
  let visited = new Map<number, number>();
  let counts = new Map<number, number>();
  let segments: Segment[] = [];
  let positions: { who: string; systemId: number; time: number; color: string }[] = [];
  let plan: ExplorePlan | null = null;
  let planSet = new Set<number>();
  let freshSet = new Set<number>();
  let activity: Map<number, SystemActivity> | null = null;
  let activityAt = 0;
  let fits: { charId: string; list: TravelFit[] } | null = null;
  let prices: Map<number, { sellMin: number }> | null = null;
  let selected: number | null = null;
  let importNote = '';
  let routeBusy = false;

  const save = () => saveJson(KEY, settings);
  const whoFilter = () => settings.who || undefined;
  const since = () => (settings.days ? Date.now() - settings.days * 86_400_000 : 0);
  const kspace = () => [...map!.systems.values()].filter(isKspace);
  const trackable = () => loadStoredCharacters().filter((c) => c.kind === 'esi' && c.characterId);

  el.innerHTML = loader(tx('Încarc harta sistemelor vizitate'));

  function pickWho() {
    const list = visitors();
    if (list.includes(settings.who)) return;
    settings.who = list.includes(ctx.character.name) ? ctx.character.name : list[0] ?? '';
  }

  function rebuild() {
    if (!map) return;
    pickWho();
    visited = visitedSet(whoFilter(), since());
    counts = visitCounts(whoFilter());
    const by = new Map<string, Segment>();
    const after = since();
    for (const { visits } of pathFor(whoFilter(), after)) {
      const color = '';
      for (let i = 1; i < visits.length; i++) {
        const a = map.systems.get(visits[i - 1].systemId);
        const b = map.systems.get(visits[i].systemId);
        if (!a || !b || a.id === b.id) continue;
        const gate = (map.gates.get(a.id) ?? []).includes(b.id);
        if (!gate && visits[i].time - visits[i - 1].time > JUMP_GAP) continue;
        const k = `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}:${color}`;
        const seg = by.get(k);
        if (seg) { seg.n++; seg.last = Math.max(seg.last, visits[i].time); } else by.set(k, { a, b, gate, n: 1, last: visits[i].time, color });
      }
    }
    segments = [...by.values()].sort((x, y) => x.last - y.last);
    positions = [];
    for (const who of settings.who ? [settings.who] : visitors()) {
      const p = lastPosition(who);
      if (p && Date.now() - p.time < 6 * 3_600_000) positions.push({ who, ...p, color: '' });
    }
    star?.redraw();
  }

  function under(p: MapPainter) {
    if (!settings.trail || !segments.length) return;
    const g = p.ctx;
    const accent = p.css('--accent');
    const w = Math.max(2.4, Math.min(7, p.spacing * 0.14));
    const now = Date.now();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const pass of [0, 1]) {
      for (const s of segments) {
        const A = p.at(s.a.id), B = p.at(s.b.id);
        if (!A || !B) continue;
        if (Math.max(A[0], B[0]) < -20 || Math.min(A[0], B[0]) > p.width + 20 || Math.max(A[1], B[1]) < -20 || Math.min(A[1], B[1]) > p.height + 20) continue;
        const width = s.gate ? w + Math.min(3, Math.log2(s.n)) : Math.max(1.4, w * 0.45);
        const age = (now - s.last) / 86_400_000;
        g.setLineDash(s.gate ? [] : [6, 5]);
        if (pass === 0) {
          if (!s.gate) continue;
          g.globalAlpha = 0.75;
          g.strokeStyle = p.css('--bg-void');
          g.lineWidth = width + 3;
        } else {
          g.globalAlpha = age < 1 ? 1 : age < 7 ? 0.85 : 0.6;
          g.strokeStyle = s.color || accent;
          g.lineWidth = width;
        }
        g.beginPath();
        g.moveTo(A[0], A[1]);
        g.lineTo(B[0], B[1]);
        g.stroke();
      }
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  function over(p: MapPainter) {
    const g = p.ctx;
    const accent = p.css('--accent');
    const gold = p.css('--gold');
    const r = Math.max(2.5, Math.min(6, p.spacing * 0.2));
    if (plan && plan.path.length > 1) {
      g.strokeStyle = gold;
      g.lineWidth = Math.max(2, Math.min(4, p.spacing * 0.09));
      g.setLineDash([7, 6]);
      g.beginPath();
      plan.path.forEach((id, i) => {
        const pt = p.at(id);
        if (!pt) return;
        if (i) g.lineTo(pt[0], pt[1]); else g.moveTo(pt[0], pt[1]);
      });
      g.stroke();
      g.setLineDash([]);
    }
    g.lineWidth = 1.6;
    for (const [id] of visited) {
      const pt = p.at(id);
      if (!pt || pt[0] < -10 || pt[1] < -10 || pt[0] > p.width + 10 || pt[1] > p.height + 10) continue;
      g.strokeStyle = accent;
      g.beginPath();
      g.arc(pt[0], pt[1], r + 1.5, 0, Math.PI * 2);
      g.stroke();
    }
    for (const id of freshSet) {
      const pt = p.at(id);
      if (!pt) continue;
      g.fillStyle = gold;
      g.beginPath();
      g.arc(pt[0], pt[1], r, 0, Math.PI * 2);
      g.fill();
    }
    const pulse = (Math.sin(p.time / 300) + 1) / 2;
    for (const pos of positions) {
      const pt = p.at(pos.systemId);
      if (!pt) continue;
      g.fillStyle = pos.color || accent;
      g.beginPath();
      g.arc(pt[0], pt[1], r + 2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = pos.color || accent;
      g.globalAlpha = 1 - pulse;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(pt[0], pt[1], r + 4 + pulse * 10, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
      if (p.spacing > 14 && (!settings.who || visitors().length > 1)) {
        g.font = `600 11px ${p.css('--font-body')}`;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.lineWidth = 3;
        g.strokeStyle = p.css('--bg-void');
        g.strokeText(pos.who, pt[0] + r + 6, pt[1] - r - 6);
        g.fillStyle = p.css('--text-bright');
        g.fillText(pos.who, pt[0] + r + 6, pt[1] - r - 6);
      }
    }
  }

  function tooltip(s: NavSystem) {
    const first = visited.get(s.id);
    const n = counts.get(s.id) ?? 0;
    const a = activity?.get(s.id);
    const pvp = a ? a.ship + a.pod : 0;
    return `<b>${esc(s.name)}</b> ${secSpan(s.sec)}<small>${esc(map!.region(s))} · ${esc(map!.constellation(s))}</small>
      ${first != null ? `<span class="tip-row">${tx('Vizitat din {date}', { date: dateText(first * 1000) })}${n > 1 ? ` · ${tx('de {n} ori', { n })}` : ''}</span>` : `<span class="tip-row dim">${tx('Nevizitat')}</span>`}
      ${s.regionId === EXORDIUM_REGION ? `<span class="tip-row dim">${tx('Zona tutorialului pentru caractere noi. Nu intră în progres și nici în rutele sugerate.')}</span>` : ''}
      ${freshSet.has(s.id) ? `<span class="tip-row">${tx('Sistem nou pe ruta sugerată')}</span>` : ''}
      ${pvp ? `<span class="tip-row warn-text">${tx('{n} nave și capsule distruse în ultima oră', { n: pvp })}</span>` : ''}`;
  }

  function regionStats() {
    const by = new Map<number, { id: number; name: string; total: number; seen: number; hi: number }>();
    for (const s of kspace()) {
      const r = by.get(s.regionId) ?? { id: s.regionId, name: map!.regions.get(s.regionId) ?? '', total: 0, seen: 0, hi: 0 };
      r.total++;
      if (visited.has(s.id)) r.seen++;
      if (s.sec >= 0.45) r.hi++;
      by.set(s.regionId, r);
    }
    return [...by.values()].sort((a, b) => b.seen / b.total - a.seen / a.total || a.name.localeCompare(b.name));
  }

  function progressHtml() {
    const all = kspace();
    const band = (f: (s: NavSystem) => boolean) => {
      const list = all.filter(f);
      return { seen: list.filter((s) => visited.has(s.id)).length, total: list.length };
    };
    const tot = band(() => true);
    const hi = band((s) => s.sec >= 0.45 && s.regionId !== POCHVEN_REGION);
    const lo = band((s) => s.sec > 0 && s.sec < 0.45);
    const nul = band((s) => s.sec <= 0 && s.regionId !== POCHVEN_REGION);
    const po = band((s) => s.regionId === POCHVEN_REGION);
    const kpi = (label: string, b: { seen: number; total: number }, cls = '') => `<div><span class="label">${label}</span><span class="value ${cls}">${formatInt(b.seen)}<span class="dim small"> / ${formatInt(b.total)}</span></span><span class="vis-bar"><i style="width:${b.total ? (b.seen / b.total) * 100 : 0}%"></i></span></div>`;
    const sel = selected ? map!.systems.get(selected) : null;
    const selBox = sel ? (() => {
      const first = visited.get(sel.id);
      const n = counts.get(sel.id) ?? 0;
      return `<div class="vis-sel">
        <div class="vis-sel-top"><b>${secSpan(sel.sec)} ${esc(sel.name)}</b><span class="dim small">${esc(map!.region(sel))}</span></div>
        <div class="small">${first != null ? `${tx('Vizitat din {date}', { date: dateText(first * 1000) })}${n ? ` · ${tx('de {n} ori', { n })}` : ''}` : `<span class="dim">${tx('Nevizitat')}</span>`}</div>
        <div class="vis-sel-actions">
          ${first != null ? button(tx('Marchează nevizitat'), { iconName: 'close', cls: 'ghost sm', attrs: `data-vis-mark="0" data-id="${sel.id}"` }) : button(tx('Marchează vizitat'), { iconName: 'check', cls: 'ghost sm', attrs: `data-vis-mark="1" data-id="${sel.id}"` })}
          ${button(tx('Pornește ruta de aici'), { iconName: 'jump', cls: 'ghost sm', attrs: `data-vis-from="${sel.id}"` })}
        </div>
      </div>`;
    })() : `<p class="dim small">${tx('Click pe un sistem ca să-l marchezi manual ca vizitat sau să pornești o rută de acolo.')}</p>`;
    const regions = regionStats();
    return `${selBox}
      <div class="history-kpis vis-kpis">
        ${kpi(tx('Total k-space'), tot, 'accent')}
        ${kpi('Highsec', hi)}
        ${kpi('Lowsec', lo)}
        ${kpi('Nullsec', nul)}
        ${kpi('Pochven', po)}
      </div>
      <div class="label">${tx('Regiuni ({n} începute)', { n: regions.filter((r) => r.seen).length })}</div>
      <div class="vis-regions">${regions.map((r) => `<button class="vis-region ${settings.region === r.id ? 'active' : ''}" data-vis-region="${r.id}" title="${esc(tx('{seen} din {total} sisteme', { seen: r.seen, total: r.total }))}">
          <span>${esc(r.name)}</span><span class="num dim">${r.seen}/${r.total}</span>
          <span class="vis-bar"><i style="width:${(r.seen / r.total) * 100}%"></i></span>
        </button>`).join('')}</div>`;
  }

  function startSystem(): NavSystem | null {
    if (!map) return null;
    if (settings.from) { const s = map.find(settings.from); if (s) return s; }
    for (const who of settings.who ? [settings.who] : visitors()) {
      const p = lastPosition(who);
      if (p) return map.systems.get(p.systemId) ?? null;
    }
    return null;
  }

  function routeHtml() {
    const start = startSystem();
    const regions = [...new Set(kspace().filter((s) => allowedFor(settings.level, s)).map((s) => s.regionId))]
      .map((id) => ({ id, name: map!.regions.get(id) ?? '' })).sort((a, b) => a.name.localeCompare(b.name));
    const level = LEVELS.find((l) => l.id === settings.level)!;
    const result = (() => {
      if (routeBusy) return loader(tx('Calculez ruta'));
      if (!plan) return '';
      if (!plan.fresh.length) return alertBox(tx('Nu am găsit sisteme nevizitate accesibile cu nivelul ales. Schimbă regiunea sau nivelul.'), 'warn');
      const names = plan.path.map((id) => map!.systems.get(id)!.name);
      const rows = plan.path.map((id, i) => {
        const s = map!.systems.get(id)!;
        const a = activity?.get(id);
        const pvp = a ? a.ship + a.pod : 0;
        const fresh = freshSet.has(id) && plan!.path.indexOf(id) === i;
        return `<div class="vis-step ${fresh ? 'new' : ''}" data-sys="${id}">
          <span class="num dim">${i || '·'}</span>${secSpan(s.sec)}<span class="vis-step-name">${esc(s.name)}</span>
          ${fresh ? badge(tx('nou'), 'gold') : ''}${pvp ? badge(tx('{n} kill-uri / h', { n: pvp }), plan!.risky.includes(id) ? 'danger' : 'warn') : ''}${i && !allowedFor(settings.level, s) ? badge(tx('peste nivel'), 'danger') : ''}
        </div>`;
      }).join('');
      return `<div class="history-kpis vis-kpis">
          <div><span class="label">${tx('Sisteme noi')}</span><span class="value accent">${plan.fresh.length}</span></div>
          <div><span class="label">${tx('Salturi')}</span><span class="value">${plan.jumps}</span></div>
          <div><span class="label">${tx('Sisteme riscante')}</span><span class="value ${plan.risky.length ? 'warn-text' : ''}">${plan.risky.length}</span></div>
        </div>
        <div class="vis-route-actions">
          <a class="btn ghost sm" href="${dotlanRoute(names.length > 60 ? [names[0], ...plan.waypoints.map((id) => map!.systems.get(id)!.name)] : names)}" target="_blank" rel="noopener noreferrer">${icon('external')}${tx('Deschide în Dotlan')}</a>
          ${button(tx('Copiază sistemele'), { iconName: 'copy', cls: 'ghost sm', attrs: 'data-vis-copy' })}
          ${button(tx('Șterge ruta'), { iconName: 'close', cls: 'ghost sm', attrs: 'data-vis-clear-route' })}
        </div>
        <div class="vis-steps">${rows}</div>
        ${plan.path.some((id, i) => i && !allowedFor(settings.level, map!.systems.get(id)!)) ? `<p class="small warn-text">${tx('Pornirea nu e legată de zona nivelului ales, așa că ruta trece și prin sisteme marcate „peste nivel”.')}</p>` : ''}
        ${activityAt ? `<p class="dim small">${tx('Kill-uri din ESI pe ultima oră, actualizate la {time}.', { time: new Date(activityAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</p>` : ''}`;
    })();
    return `<form class="vis-form" id="visRoute">
        <label>${tx('Pornire')}<input class="input" name="from" data-list="visSystems" value="${esc(settings.from || start?.name || '')}" placeholder="${esc(tx('Sistemul de start'))}" autocomplete="off" spellcheck="false" /></label>
        <div class="label">${tx('Nivel de risc')}</div>
        <div class="live-seg vis-levels" role="group">${LEVELS.map((l) => `<button type="button" class="chip-btn ${settings.level === l.id ? 'active' : ''}" data-vis-level="${l.id}">${l.label}</button>`).join('')}</div>
        <p class="dim small">${level.text}</p>
        <label>${tx('Regiune')}<select class="input" name="region"><option value="0">${tx('Oriunde')}</option>${regions.map((r) => `<option value="${r.id}" ${settings.region === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
        <label>${tx('Sisteme noi de vizitat')}<select class="input" name="count">${COUNTS.map((n) => `<option value="${n}" ${settings.count === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button class="btn" type="submit">${icon('jump')}${tx('Sugerează ruta')}</button>
      </form>
      ${result}`;
  }

  function importHtml() {
    const chars = trackable();
    const pilot = chars.find((c) => c.name === settings.who) ?? chars.find((c) => c.name === ctx.character.name);
    const tracked = !!pilot && hasScope(pilot.characterId!, LOCATION_SCOPE);
    const others = chars.filter((c) => c !== pilot && hasScope(c.characterId!, LOCATION_SCOPE)).length;
    const st = visitStats();
    const who = visitors();
    const liveHtml = !pilot
      ? `<p class="dim small">${settings.who ? tx('{name} nu e logat cu EVE în Vyraj, așa că sistemele lui vin doar din importul de loguri.', { name: esc(settings.who) }) : tx('Fă login cu EVE și permite locația ca Vyraj să noteze singur sistemele prin care treci.')}</p>`
      : tracked
        ? `<p class="small">${tx('Vyraj notează singur sistemul în care e {name}. Merge cât timp aplicația e deschisă, chiar și în fundal.', { name: `<b>${esc(pilot.name)}</b>` })}${others ? ` <span class="dim">${tx(others === 1 ? 'Încă un caracter e urmărit la fel.' : 'Încă {n} caractere sunt urmărite la fel.', { n: others })}</span>` : ''}</p>
          <div class="vis-route-actions">${button(tx('Verifică acum'), { iconName: 'refresh', cls: 'ghost sm', attrs: 'data-vis-track' })}</div>`
        : permissionButtons('location', [{ characterId: pilot.characterId!, name: pilot.name }]);
    return `<div class="label">${tx('Urmărire live')}</div>
      ${liveHtml}
      <div class="label">${tx('Import din loguri EVE')}</div>
      <p class="dim small">${tx('Pentru istoricul de dinainte, alege folderul logs al jocului (de obicei Documente/EVE/logs). Vyraj citește doar canalul Local din Chatlogs și salturile din Gamelogs, direct în browser; nimic nu pleacă de pe calculator.')}</p>
      <div class="vis-route-actions">
        ${button(tx('Alege folderul logs'), { iconName: 'upload', cls: 'sm', attrs: 'data-vis-import="dir"' })}
        ${button(tx('Alege fișiere'), { iconName: 'upload', cls: 'ghost sm', attrs: 'data-vis-import="files"' })}
      </div>
      ${importNote ? `<p class="small">${importNote}</p>` : ''}
      <div class="label">${tx('Date salvate')}</div>
      <p class="dim small">${tx('{n} intrări în istoric, {kb} KB în browser. Intră și în backup-ul de date.', { n: formatInt(st.entries), kb: formatInt(Math.round(st.bytes / 1024)) })}</p>
      <div class="vis-route-actions">
        ${settings.who ? button(tx('Șterge istoricul pentru {name}', { name: settings.who }), { iconName: 'trash', cls: 'ghost sm', attrs: 'data-vis-wipe="who"' }) : ''}
        ${who.length || hasManual() ? button(tx('Șterge tot istoricul'), { iconName: 'trash', cls: 'ghost sm danger', attrs: 'data-vis-wipe="all"' }) : ''}
      </div>`;
  }

  function renderSide() {
    const box = el.querySelector<HTMLElement>('#visSide');
    if (!box || !map) return;
    const scroll = box.scrollTop;
    box.innerHTML = settings.tab === 'progress' ? progressHtml() : settings.tab === 'route' ? routeHtml() : importHtml();
    box.scrollTop = scroll;
    el.querySelectorAll<HTMLElement>('[data-vis-tab]').forEach((b) => b.classList.toggle('active', b.dataset.visTab === settings.tab));
    const stamp = el.querySelector<HTMLElement>('#visStamp');
    if (stamp) {
      const total = kspace().length;
      stamp.textContent = tx('{n} din {total} sisteme vizitate', { n: formatInt([...visited.keys()].filter((id) => { const s = map!.systems.get(id); return !!s && isKspace(s); }).length), total: formatInt(total) });
    }
  }

  function renderWho() {
    const sel = el.querySelector<HTMLSelectElement>('#visWho');
    if (!sel) return;
    const list = visitors();
    if (settings.who && !list.includes(settings.who)) list.push(settings.who);
    sel.innerHTML = list.length ? list.map((w) => `<option value="${esc(w)}" ${settings.who === w ? 'selected' : ''}>${esc(w)}</option>`).join('') : '<option value="">—</option>';
  }

  function priceOf(f: TravelFit): number | null {
    if (!prices) return null;
    let total = 0;
    for (const [id, n] of f.contents) {
      const p = prices.get(id)?.sellMin;
      if (!p) return null;
      total += p * n;
    }
    return total;
  }

  function fitsHtml() {
    const level = LEVELS.find((l) => l.id === settings.level)!;
    if (!fits) return panel({ title: tx('Navă recomandată pentru drum'), body: loader(tx('Calculez fit-urile de călătorie cu skill-urile caracterului activ')) });
    const ranked = rankTravelFits(settings.level, fits.list, prices ? priceOf : undefined).slice(0, 4);
    const best = ranked.find((f) => f.req.canFly) ?? ranked[0];
    const why = settings.level === 'safe'
      ? tx('Pentru highsec contează să aliniezi repede ca să nu apuce nimeni să te țintească, iar nava să fie ieftină.')
      : settings.level === 'risky'
        ? tx('Pentru lowsec contează aliniere sub {s} s (pleci în warp înainte să te poată ținti cineva la poartă) sau cloak covert, cu care poți intra în warp invizibil.', { s: INSTA_ALIGN })
        : tx('Pentru nullsec ai nevoie de imunitate la bule (Interdiction Nullifier sau navă imună), plus aliniere rapidă sau cloak covert.');
    const rows = ranked.map((f) => {
      const price = priceOf(f);
      const mods = Object.values(f.fit.slots).flat().filter((m) => m).map((m) => ctx.sde.types.get(m!.typeId)?.name ?? '');
      const uniq = [...new Set(mods)].map((n) => `${mods.filter((x) => x === n).length > 1 ? `${mods.filter((x) => x === n).length}× ` : ''}${n}`);
      return `<tr class="${f === best ? 'vis-best' : ''}">
        <td><span class="recon-ship"><img class="row-icon" src="${typeIconUrl(f.ship.id, 32)}" alt="" /><span><b>${esc(f.ship.name)}</b> <span class="dim small">${esc(f.ship.groupName)}</span>${f === best ? ` ${badge(tx('recomandat'), 'gold')}` : ''}<br><span class="dim small">${esc(uniq.join(', ') || tx('fără module'))}</span></span></span></td>
        <td class="r num">${formatNum(f.align, 2)} s${f.align < INSTA_ALIGN ? ` ${badge(`< ${INSTA_ALIGN} s`, 'accent')}` : ''}</td>
        <td class="r num">${formatNum(f.warp, 1)}</td>
        <td class="r num">${formatInt(Math.round(f.speed))}</td>
        <td>${f.nullified ? badge(tx('imun'), 'accent') : '<span class="dim">—</span>'}</td>
        <td>${f.covert ? badge('covert', 'accent') : '<span class="dim">—</span>'}</td>
        <td class="r num">${price ? formatISK(price, 0) : '—'}</td>
        <td>${f.req.canFly ? badge(tx('poți zbura'), 'accent') : `<span class="warn-text small">${tx('mai ai {time}', { time: formatDuration(f.req.totalSeconds) })}</span>`}</td>
        <td class="r">${button(tx('Deschide'), { iconName: 'fitting', cls: 'sm ghost', attrs: `data-vis-fit="${fits!.list.indexOf(f)}"` })}</td>
      </tr>`;
    }).join('');
    return panel({
      title: tx('Navă recomandată pentru drum · {level}', { level: level.label }),
      count: ranked.length,
      body: `<p class="dim small">${why} ${tx('Calculat cu skill-urile lui {name}: cel mai bun fit din fiecare clasă (shuttle, interceptor, covert ops, fregată), cu MWD, stabilizatori inerțiali, nanofibre și rig-uri de agilitate și warp.', { name: esc(ctx.character.name) })}</p>
        <div class="table-scroll"><table class="table compact vis-fits"><thead><tr>
          <th>${tx('Navă')}</th><th class="r">${tx('Aliniere')}</th><th class="r">Warp AU/s</th><th class="r">${tx('Viteză m/s')}</th><th>${tx('Bule')}</th><th>Cloak</th><th class="r">${tx('Cost Jita')}</th><th>${tx('Skill-uri')}</th><th></th>
        </tr></thead><tbody>${rows}</tbody></table></div>`,
    });
  }

  function renderFits() {
    const box = el.querySelector<HTMLElement>('#visFits');
    if (box) box.innerHTML = fitsHtml();
  }

  function loadFits() {
    if (fits && fits.charId === ctx.character.id) return;
    fits = null;
    renderFits();
    setTimeout(() => {
      fits = { charId: ctx.character.id, list: travelFits(ctx.sde, ctx.character, (ship) => tx('{ship} de drum', { ship })) };
      renderFits();
      const ids = new Set<number>();
      for (const f of fits.list) for (const id of f.contents.keys()) ids.add(id);
      fetchPrices([...ids]).then((p) => { prices = p; renderFits(); }).catch(() => null);
    }, 30);
  }

  function refresh() {
    rebuild();
    renderWho();
    renderSide();
  }

  async function loadActivity() {
    try {
      const a = await Promise.race([systemActivity(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))]);
      activity = a.map;
      activityAt = a.asOf;
    } catch {
      activity = null;
    }
  }

  async function suggest() {
    if (!map) return;
    const start = startSystem();
    if (!start) { toast(tx('Alege sistemul de pornire.')); return; }
    routeBusy = true;
    renderSide();
    await loadActivity();
    routeBusy = false;
    plan = planExplore(map, start.id, new Set(visited.keys()), settings.level, settings.count, { region: settings.region || undefined, activity: activity ?? undefined });
    planSet = new Set(plan.path);
    freshSet = new Set(plan.fresh);
    renderSide();
    if (plan.path.length > 1) star?.fitSystems(plan.path);
    star?.redraw();
  }

  async function runImport(files: File[]) {
    if (!map) return;
    const logs = files.filter((f) => isLogFile(f.name));
    if (!logs.length) { toast(tx('Nu am găsit loguri Local sau Gamelogs în ce ai ales.')); return; }
    importNote = tx('Citesc {n} fișiere…', { n: logs.length });
    renderSide();
    toast(importNote);
    const entries: VisitEntry[] = [];
    let read = 0;
    for (const f of logs) {
      try {
        entries.push(...parseLog(await readLogFile(f), f.name, map));
      } catch {
        continue;
      }
      read++;
    }
    const r = importVisits(entries);
    importNote = tx('Am citit {files} fișiere: {n} intrări noi, {s} sisteme noi.', { files: read, n: formatInt(r.added), s: formatInt(r.systems) });
    toast(importNote);
    refresh();
  }

  function pickFiles(dir: boolean) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (dir) (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    else input.accept = '.txt,text/plain';
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = () => { const files = [...(input.files ?? [])]; input.remove(); if (files.length) runImport(files); else toast(tx('Nu am primit niciun fișier din folderul ales.')); };
    input.addEventListener('change', done, { once: true });
    input.addEventListener('cancel', () => input.remove(), { once: true });
    input.click();
  }

  function seedDemo() {
    if (!isDemo() || !map || visitStats().entries > 5) return;
    const demo = loadStoredCharacters().find((c) => c.characterId === DEMO_ID);
    if (!demo) return;
    importVisits(demoHistory(DEMO_ROUTE, demo.name));
  }

  async function init() {
    try {
      map = await loadMap();
    } catch (err) {
      el.innerHTML = panel({ body: alertBox((err as Error).message) });
      return;
    }
    if (!map.schematic) {
      el.innerHTML = panel({ body: alertBox(tx('Datele hărții sunt vechi și nu au poziții 2D. Rulează "npm run data" ca să le regenerezi.'), 'warn') });
      return;
    }
    seedDemo();
    el.innerHTML = `<div class="live-map vis-map">
      <div class="live-toolbar">
        <input class="input live-jump" id="visFind" data-list="visSystems" placeholder="${esc(tx('Caută sistem sau regiune'))}" autocomplete="off" spellcheck="false" />
        <label class="live-field">${tx('Caracter')}<select class="input" id="visWho"></select></label>
        <div class="live-seg" role="group">${PERIODS.map(([d, l]) => `<button class="chip-btn ${settings.days === d ? 'active' : ''}" data-vis-days="${d}">${l}</button>`).join('')}</div>
        <label class="check"><input type="checkbox" data-vis-opt="trail" ${settings.trail ? 'checked' : ''} /> ${tx('Traseu')}</label>
        <label class="check" title="${esc(tx('Estompează sistemele prin care nu ai trecut, ca să iasă în evidență cele vizitate.'))}"><input type="checkbox" data-vis-opt="dim" ${settings.dim ? 'checked' : ''} /> ${tx('Estompează nevizitate')}</label>
        <span class="live-status small dim" id="visStamp"></span>
      </div>
      <div class="live-body">
        <div class="live-canvas">
          <div class="live-stage" id="visStage"></div>
          <div class="live-zoom">
            <button class="icon-btn" data-zoom="in" aria-label="${esc(tx('Mărește'))}">+</button>
            <button class="icon-btn" data-zoom="out" aria-label="${esc(tx('Micșorează'))}">−</button>
            <button class="icon-btn" data-zoom="fit" aria-label="${esc(tx('Toată harta'))}">${icon('refresh')}</button>
          </div>
          <div class="live-legend small">
            <span><i class="vis-lg vis-lg-trail"></i>${tx('drum pe porți')}</span><span><i class="vis-lg vis-lg-jump"></i>${tx('salt fără poartă')}</span><span><i class="vis-lg vis-lg-seen"></i>${tx('vizitat')}</span><span><i class="vis-lg vis-lg-route"></i>${tx('rută sugerată')}</span>
          </div>
        </div>
        <aside class="live-side">
          <div class="live-tabs">${([['progress', tx('Progres')], ['route', tx('Rută')], ['import', tx('Import')]] as [SideTab, string][]).map(([id, l]) => `<button class="chip-btn" data-vis-tab="${id}">${l}</button>`).join('')}</div>
          <div class="live-side-body" id="visSide"></div>
        </aside>
      </div>
      <div id="visFits"></div>
      <datalist id="visSystems"></datalist>
    </div>`;
    star = new StarMap(el.querySelector<HTMLElement>('#visStage')!, map, {
      under,
      over,
      tooltip,
      regionLabels: true,
      dim: (s) => settings.dim && !visited.has(s.id) && !planSet.has(s.id),
      labelFirst: (id) => visited.has(id) || planSet.has(id),
      animate: () => positions.length > 0,
      onSelect: (id) => { selected = id; if (id) settings.tab = settings.tab === 'import' ? 'progress' : settings.tab; renderSide(); },
    });
    bind();
    refresh();
    const focusOn = [...visited.keys()];
    if (positions[0] && !isDemo()) star.focus(positions[0].systemId);
    else if (focusOn.length) star.fitSystems(focusOn);
    loadFits();
    loadActivity().then(() => star?.redraw());
    onVisitsChange(() => refresh());
    ctx.onCharacterChange(() => { if (visitors().includes(ctx.character.name)) settings.who = ctx.character.name; loadFits(); refresh(); });
    startVisitTracker();
  }

  function bind() {
    const find = el.querySelector<HTMLInputElement>('#visFind')!;
    const list = el.querySelector<HTMLDataListElement>('#visSystems')!;
    el.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.list !== 'visSystems' || !map) return;
      const q = input.value.trim().toLowerCase();
      const regions = input === find ? [...map.regions.values()].filter((n) => n.toLowerCase().startsWith(q)).slice(0, 4) : [];
      list.innerHTML = [
        ...regions.map((n) => `<option value="${esc(n)}">${tx('regiune')}</option>`),
        ...map.suggest(input.value, 8).map((s) => `<option value="${esc(s.name)}">${esc(map!.region(s))} · ${formatNum(displaySec(s.sec), 1)}</option>`),
      ].join('');
    });
    const go = () => {
      if (!map || !find.value.trim()) return;
      const region = [...map.regions.entries()].find(([, n]) => n.toLowerCase() === find.value.trim().toLowerCase());
      if (region) { star?.fitRegion(region[0]); return; }
      const s = map.find(find.value);
      if (s) { selected = s.id; star?.select(s.id); star?.focus(s.id); renderSide(); return; }
      toast(tx('Nu găsesc {name}', { name: find.value }));
    };
    find.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    find.addEventListener('change', go);
    el.querySelector<HTMLSelectElement>('#visWho')!.addEventListener('change', (e) => {
      settings.who = (e.target as HTMLSelectElement).value;
      settings.from = '';
      save();
      refresh();
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.visOpt) {
        const k = t.dataset.visOpt as 'trail' | 'dim';
        settings[k] = t.checked;
        save();
        star?.redraw();
        return;
      }
      if (t.closest('#visRoute')) {
        if (t.name === 'region') settings.region = Number(t.value) || 0;
        if (t.name === 'count') settings.count = Number(t.value) || 10;
        if (t.name === 'from') settings.from = t.value.trim();
        save();
      }
    });
    el.addEventListener('submit', (e) => {
      const form = (e.target as HTMLElement).closest<HTMLFormElement>('#visRoute');
      if (!form) return;
      e.preventDefault();
      const fd = new FormData(form);
      settings.from = String(fd.get('from') ?? '').trim();
      settings.region = Number(fd.get('region')) || 0;
      settings.count = Number(fd.get('count')) || 10;
      save();
      suggest();
    });
    el.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      const z = t.closest<HTMLElement>('[data-zoom]');
      if (z && star) { if (z.dataset.zoom === 'in') star.zoomBy(1.6); else if (z.dataset.zoom === 'out') star.zoomBy(1 / 1.6); else star.fitAll(); return; }
      const tab = t.closest<HTMLElement>('[data-vis-tab]');
      if (tab) { settings.tab = tab.dataset.visTab as SideTab; save(); renderSide(); return; }
      const days = t.closest<HTMLElement>('[data-vis-days]');
      if (days) {
        settings.days = Number(days.dataset.visDays);
        save();
        el.querySelectorAll<HTMLElement>('[data-vis-days]').forEach((b) => b.classList.toggle('active', b === days));
        refresh();
        return;
      }
      const lvl = t.closest<HTMLElement>('[data-vis-level]');
      if (lvl) {
        settings.level = lvl.dataset.visLevel as RiskLevel;
        if (settings.region && map && !kspace().some((s) => s.regionId === settings.region && allowedFor(settings.level, s))) settings.region = 0;
        plan = null; planSet = new Set(); freshSet = new Set();
        save();
        renderSide();
        renderFits();
        star?.redraw();
        return;
      }
      const reg = t.closest<HTMLElement>('[data-vis-region]');
      if (reg) {
        const id = Number(reg.dataset.visRegion);
        settings.region = settings.region === id ? 0 : id;
        save();
        star?.fitRegion(id);
        renderSide();
        return;
      }
      const mark = t.closest<HTMLElement>('[data-vis-mark]');
      if (mark) { setManual(Number(mark.dataset.id), mark.dataset.visMark === '1'); return; }
      const from = t.closest<HTMLElement>('[data-vis-from]');
      if (from && map) { settings.from = map.systems.get(Number(from.dataset.visFrom))?.name ?? ''; settings.tab = 'route'; save(); renderSide(); return; }
      if (t.closest('[data-vis-clear-route]')) { plan = null; planSet = new Set(); freshSet = new Set(); renderSide(); star?.redraw(); return; }
      if (t.closest('[data-vis-copy]') && plan && map) {
        const text = plan.path.map((id) => map!.systems.get(id)!.name).join('\n');
        navigator.clipboard?.writeText(text).then(() => toast(tx('Am copiat {n} sisteme', { n: plan!.path.length }))).catch(() => toast(tx('Nu pot copia în clipboard')));
        return;
      }
      const step = t.closest<HTMLElement>('.vis-step[data-sys]');
      if (step) { const id = Number(step.dataset.sys); star?.select(id); star?.focus(id, false); return; }
      const imp = t.closest<HTMLElement>('[data-vis-import]');
      if (imp) { pickFiles(imp.dataset.visImport === 'dir'); return; }
      if (t.closest('[data-vis-track]')) { await trackNow(); toast(tx('Locația a fost verificată')); return; }
      const wipe = t.closest<HTMLElement>('[data-vis-wipe]');
      if (wipe) {
        const all = wipe.dataset.visWipe === 'all';
        const ok = await confirmDialog(all ? tx('Ștergi tot istoricul de sisteme vizitate, pentru toate caracterele? Nu se poate anula.') : tx('Ștergi istoricul de sisteme vizitate pentru {name}? Nu se poate anula.', { name: settings.who }), { danger: true, ok: tx('Șterge') });
        if (!ok) return;
        clearVisits(all ? undefined : settings.who);
        if (all) settings.who = '';
        save();
        refresh();
        return;
      }
      const fitBtn = t.closest<HTMLElement>('[data-vis-fit]');
      if (fitBtn && fits) {
        const f = fits.list[Number(fitBtn.dataset.visFit)];
        if (f) { const copy = cloneFit(f.fit); copy.id = newFitId(); opts.openFit(copy); }
      }
    });
  }

  return {
    show() {
      if (started) { star?.redraw(); return; }
      started = true;
      init();
    },
  };
}
