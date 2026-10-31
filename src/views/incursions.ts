import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, formatNum, compactISK, emptyState, badge, dataStamp, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { hasScope, loginProblem } from '../character/sso';
import { permissionGate } from '../character/permissions';
import { characterLocation, walletJournal } from '../character/esi';
import { archiveJournal } from '../services/wallet';
import { loadMap, type NavMap, type NavSystem } from '../services/navigation';
import { resolveNames, cachedName, displaySec, secClass } from '../services/recon';
import { StarMap, type MapPainter } from '../ui/starMap';
import {
  incursions, layout, track, loadLog, latestEnd, respawnWindow, safeDistances, sanshaInfluence, payout, payoutSessions, spaceOf,
  EFFECTS, SITES, PAYOUTS,
  type Incursion, type IncLog, type IncState, type Observed, type Role, type SiteKind, type Space, type PaySession,
} from '../services/incursions';
import { tx, locale } from '../i18n';

type Sub = 'active' | 'map' | 'sites' | 'calc' | 'log';

const SUBS: { id: Sub; label: string }[] = [
  { id: 'active', label: tx('Active') },
  { id: 'map', label: tx('Hartă') },
  { id: 'sites', label: tx('Site-uri și payout') },
  { id: 'calc', label: tx('Calculator ISK/h') },
  { id: 'log', label: tx('Istoric') },
];

const SUB_KEY = 'eve-ops:inc-sub';
const FROM_KEY = 'eve-ops:inc-from';
const CALC_KEY = 'eve-ops:inc-calc';
const LOCATION_SCOPE = 'esi-location.read_location.v1';
const WALLET_SCOPE = 'esi-wallet.read_character_wallet.v1';
const H = 3_600_000;

const STATE: Record<IncState, [string, string]> = {
  established: ['Established', 'ok'],
  mobilizing: ['Mobilizing', 'gold'],
  withdrawing: ['Withdrawing', 'warn'],
};
const SPACE: Record<Space, [string, string]> = {
  high: ['Highsec', 'ok'], low: ['Lowsec', 'warn'], null: ['Nullsec', 'danger'], pochven: ['Pochven', 'danger'],
};
const ROLE: Record<Role, string> = { staging: 'Staging', hq: 'Headquarters', assault: 'Assault', vanguard: 'Vanguard' };
const SITE: Record<SiteKind, string> = { staging: 'Staging', vanguard: 'Vanguard', assault: 'Assault', hq: 'Headquarters', mothership: tx('Nava-mamă') };
const ROLE_ORDER: Role[] = ['staging', 'vanguard', 'assault', 'hq'];
const ROLE_COLOR: Record<Role, string> = { staging: '--accent', vanguard: '--ok', assault: '--gold', hq: '--danger' };

const secSpan = (sec: number) => `<span class="num ${secClass(sec)}">${formatNum(displaySec(sec), 1)}</span>`;
const pctText = (v: number) => `${formatNum(v * 100, 1)}%`;
const when = (t: number) => `${new Date(t).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} EVE`;
const span = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return tx('{n} min', { n: m });
  const h = Math.floor(m / 60);
  return h < 48 ? tx('{h} h {m} min', { h, m: m % 60 }) : tx('{d} zile {h} h', { d: Math.floor(h / 24), h: h % 24 });
};
const ago = (t: number) => span(Date.now() - t);
const until = (t: number) => (t <= Date.now() ? tx('acum') : tx('în {t}', { t: span(t - Date.now()) }));

interface CalcState { band: 'high' | 'lownull'; kind: SiteKind; pilots: number; minutes: number; lpIsk: number }
const CALC_DEFAULT: CalcState = { band: 'high', kind: 'vanguard', pilots: 10, minutes: 8, lpIsk: 0 };

export interface IncursionsPanel { show(force?: boolean): void; reset(): void }

export function createIncursionsPanel(body: HTMLElement, ctx: AppContext, opts: { openDoctrine?: (query: string) => boolean }): IncursionsPanel {
  let sub = loadJson<Sub>(SUB_KEY, 'active');
  if (!SUBS.some((s) => s.id === sub)) sub = 'active';
  let map: NavMap | null = null;
  let list: Incursion[] = [];
  let at = 0;
  let log: IncLog = loadLog();
  let roles = new Map<number, Map<number, Role>>();
  let here: { id: number; esi: boolean } | null = null;
  let hereNote = '';
  let star: StarMap | null = null;
  let focusC: number | null = null;
  const calc: CalcState = { ...CALC_DEFAULT, ...loadJson<Partial<CalcState>>(CALC_KEY, {}) };
  let sessions: PaySession[] | string | null = null;
  let run = 0;

  const sys = (id: number) => map?.systems.get(id);
  const sysName = (id: number) => sys(id)?.name ?? `#${id}`;
  const constName = (c: number) => map?.constellations.get(c) ?? `#${c}`;
  const regionOf = (id: number) => { const s = sys(id); return s && map ? map.region(s) : ''; };
  const dotlan = (name: string) => `<a class="ext-link" href="https://evemaps.dotlan.net/system/${encodeURIComponent(name.replace(/ /g, '_'))}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>`;
  const observed = (c: number) => log.active.find((o) => o.c === c);
  const hqOf = (inc: Incursion) => { const r = roles.get(inc.constellationId); return r ? [...r].find(([, x]) => x === 'hq')?.[0] : undefined; };

  function frame(inner: string) {
    return `<div class="inc-subs advice-sort">${SUBS.map((s) => `<button class="chip-btn ${s.id === sub ? 'active' : ''}" data-inc-sub="${s.id}">${s.label}</button>`).join('')}</div><div id="incBody">${inner}</div>`;
  }

  function charState(scope: string): { id: number } | 'scope' | null {
    const c = ctx.character;
    if (loginProblem(c) || !c.characterId) return null;
    return hasScope(c.characterId, scope) ? { id: c.characterId } : 'scope';
  }

  async function locate() {
    here = null;
    hereNote = '';
    const who = charState(LOCATION_SCOPE);
    if (who && who !== 'scope') {
      try {
        const loc = await characterLocation(who.id);
        here = { id: loc.solar_system_id, esi: true };
        return;
      } catch (err) {
        hereNote = (err as Error).message;
      }
    } else if (who === 'scope') hereNote = 'scope';
    const saved = loadJson<string>(FROM_KEY, '');
    const s = saved && map ? map.find(saved) : undefined;
    if (s) here = { id: s.id, esi: false };
  }

  async function load(force = false) {
    const mine = ++run;
    if (!list.length || force) body.innerHTML = frame(loader(tx('Citim incursiunile active din ESI')));
    try {
      const [r, m] = await Promise.all([incursions(force), loadMap()]);
      map = m;
      list = r.list;
      at = r.at;
      log = track(m, list);
      roles = new Map(list.map((inc) => [inc.constellationId, layout(m, inc)]));
      await Promise.all([resolveNames([...new Set(list.map((i) => i.factionId))]).catch(() => null), locate()]);
      if (mine !== run) return;
      render();
    } catch (err) {
      if (mine === run) body.innerHTML = frame(panel({ body: alertBox((err as Error).message) }));
    }
  }

  function render() {
    star?.destroy();
    star = null;
    const html = ({ active: activeHtml, map: mapHtml, sites: sitesHtml, calc: calcHtml, log: logHtml } as Record<Sub, () => string>)[sub]();
    body.innerHTML = frame(html);
    if (sub === 'map') mountMap();
    if (sub === 'calc') { wireCalc(); if (sessions === null) loadSessions(); }
    if (sub === 'active') wireFrom();
  }

  function fromPanel() {
    const note = here?.esi
      ? tx('Locația caracterului {name}, citită din ESI.', { name: ctx.character.name })
      : tx('Scrie sistemul din care pleci ca să vezi câte salturi sunt până la fiecare incursiune.');
    return `<div class="inc-from">
        <label class="label" for="incFrom">${tx('Pleci din')}</label>
        <input class="input" id="incFrom" list="incFromNames" placeholder="${esc(tx('Sistem, de exemplu Jita'))}" value="${esc(here ? sysName(here.id) : loadJson<string>(FROM_KEY, ''))}" autocomplete="off" spellcheck="false" ${here?.esi ? 'disabled' : ''} />
        <datalist id="incFromNames"></datalist>
        <span class="dim small">${esc(note)}</span>
      </div>
      ${hereNote === 'scope' && ctx.character.characterId ? `<div class="inc-gate">${permissionGate('location', ctx.character.characterId, ctx.character.name)}</div>` : ''}`;
  }

  function wireFrom() {
    const input = body.querySelector<HTMLInputElement>('#incFrom');
    const dl = body.querySelector<HTMLDataListElement>('#incFromNames');
    if (!input || !dl || !map) return;
    const m = map;
    input.addEventListener('input', () => { dl.innerHTML = m.suggest(input.value, 8).map((s) => `<option value="${esc(s.name)}">${esc(m.region(s))}</option>`).join(''); });
    const go = () => {
      if (!input.value.trim()) { saveJson(FROM_KEY, ''); here = null; render(); return; }
      const s = m.find(input.value);
      if (!s) { toast(tx('Nu găsesc {name}', { name: input.value })); return; }
      saveJson(FROM_KEY, s.name);
      here = { id: s.id, esi: false };
      render();
    };
    input.addEventListener('change', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }

  let jumpCache: { from: number; all: Map<number, number>; safe: Map<number, number> | null } | null = null;

  function jumpsFrom() {
    if (!here || !map) return null;
    if (jumpCache?.from !== here.id) {
      const start = sys(here.id);
      jumpCache = { from: here.id, all: map.gateDistances(here.id, 150), safe: start && start.sec >= 0.45 ? safeDistances(map, here.id, 150) : null };
    }
    return jumpCache;
  }

  function sorted() {
    const rank: Record<Space, number> = { high: 0, low: 1, null: 2, pochven: 3 };
    const d = jumpsFrom();
    return [...list].sort((a, b) => (d ? (d.all.get(a.staging) ?? 999) - (d.all.get(b.staging) ?? 999) : 0) || rank[spaceOf(map!, a.staging)] - rank[spaceOf(map!, b.staging)]);
  }

  function respawnHtml() {
    const spaces: Space[] = ['high', 'low', 'null'];
    const rows = spaces.map((s) => ({ s, w: respawnWindow(log, s) })).filter((x) => x.w);
    if (!rows.length) return '';
    const now = Date.now();
    return panel({
      title: tx('Ferestre de reapariție'),
      body: `<p class="dim small">${tx('După ce o incursiune se încheie, alta apare în același tip de spațiu în 12 până la 36 de ore. Calculat din ce a observat aplicația.')}</p>
        <div class="table-scroll"><table class="table compact ops-table"><thead><tr><th>${tx('Spațiu')}</th><th>${tx('Încheiată')}</th><th>${tx('Fereastra se deschide')}</th><th>${tx('Fereastra se închide')}</th><th>${tx('Stare')}</th></tr></thead><tbody>
        ${rows.map(({ s, w }) => {
          const st = now < w!.from ? badge(tx('se deschide {t}', { t: until(w!.from) }), 'gold') : now < w!.to ? badge(tx('deschisă, se închide {t}', { t: until(w!.to) }), 'ok', true) : badge(tx('întârziată'), 'warn');
          return `<tr><td>${badge(...SPACE[s])}</td><td class="small">${when(w!.end)}</td><td class="small">${when(w!.from)}</td><td class="small">${when(w!.to)}</td><td>${st}</td></tr>`;
        }).join('')}
        </tbody></table></div>`,
    });
  }

  function doctrineButtons(space: Space) {
    const q = space === 'high' ? ['HQ', 'Vanguard'] : ['HQ'];
    return q.map((x) => `<button class="btn ghost sm" data-inc-doctrine="${x}">${icon('doctrine')}${tx('Doctrina {x}', { x })}</button>`).join('');
  }

  function cardHtml(inc: Incursion) {
    const m = map!;
    const d = jumpsFrom();
    const r = roles.get(inc.constellationId) ?? new Map<number, Role>();
    const space = spaceOf(m, inc.staging);
    const o = observed(inc.constellationId);
    const hq = hqOf(inc);
    const sansha = sanshaInfluence(inc);
    const fromStaging = m.distances([inc.staging], 40);
    const end = o ? latestEnd(o) : null;
    const jumps = (id: number) => {
      if (!d) return '—';
      const a = d.all.get(id);
      if (a == null) return '—';
      const target = sys(id);
      if (!d.safe || !target || target.sec < 0.45) return `${a}`;
      const s = d.safe.get(id);
      return s === a ? `${a}` : `${a}<span class="dim small"> · ${s == null ? tx('fără rută highsec') : tx('{n} highsec', { n: s })}</span>`;
    };
    const rows = [...inc.systems].sort((a, b) => ROLE_ORDER.indexOf(r.get(a) ?? 'vanguard') - ROLE_ORDER.indexOf(r.get(b) ?? 'vanguard') || (fromStaging.get(a) ?? 0) - (fromStaging.get(b) ?? 0));
    const effect = (role: Role) => (role === 'staging' ? '<span class="dim">—</span>' : `<span class="num neg-text">−${formatNum(EFFECTS[role] * sansha, 1)}%</span>`);
    const sysCell = (id: number) => { const s = sys(id); return s ? `${dotlan(s.name)} ${secSpan(s.sec)}` : '—'; };
    return panel({
      title: `${constName(inc.constellationId)} · ${regionOf(inc.staging)}`,
      cls: 'inc-card',
      actions: `${badge(...SPACE[space])}${badge(...STATE[inc.state], true)}${inc.boss ? badge(tx('Nava-mamă activă'), 'danger', true) : ''}`,
      body: `<div class="ops-facts">
          <div><span class="label">${tx('Facțiune')}</span><span>${esc(cachedName(inc.factionId) || `#${inc.factionId}`)}</span></div>
          <div><span class="label">Staging</span><span>${sysCell(inc.staging)}</span></div>
          <div><span class="label">Headquarters</span><span>${hq ? sysCell(hq) : '—'}</span></div>
          <div><span class="label">${tx('Salturi până la staging')}</span><span class="num">${jumps(inc.staging)}</span></div>
          <div><span class="label">${o?.fresh ? tx('A apărut') : tx('Urmărită de')}</span><span>${o ? (o.fresh ? `${when(o.first)} <span class="dim small">(${tx('acum {t}', { t: ago(o.first) })})</span>` : ago(o.first)) : '—'}</span></div>
          <div><span class="label">${tx('Se încheie cel târziu')}</span><span>${end ? `${when(end)} <span class="dim small">(${until(end)})</span>` : `<span class="dim">${tx('necunoscut încă')}</span>`}</span></div>
        </div>
        <div class="inc-influence" title="${esc(tx('Scade pe măsură ce flotele termină site-uri. La 0% poate apărea nava-mamă în HQ.'))}">
          <span class="label">${tx('Influență Sansha')}</span>
          <div class="ops-bar inc-bar"><span style="width:${(sansha * 100).toFixed(1)}%"></span></div>
          <span class="num">${pctText(sansha)}</span>
        </div>
        <div class="table-scroll"><table class="table compact ops-table inc-systems"><thead><tr><th>${tx('Rol')}</th><th>${tx('Sistem')}</th><th class="r" title="${esc(tx('Salturi prin stargate de la sistemul de staging.'))}">${tx('De la staging')}</th><th class="r">${tx('De la tine')}</th><th class="r" title="${esc(tx('Penalizare la influența curentă: rezistențe și daune −X%, daune primite +X%.'))}">${tx('Penalizare')}</th></tr></thead><tbody>
          ${rows.map((id) => {
            const role = r.get(id) ?? 'vanguard';
            return `<tr><td><span class="inc-role" style="--role: var(${ROLE_COLOR[role]})">${ROLE[role]}</span></td><td>${sysCell(id)}</td><td class="r num">${fromStaging.get(id) ?? '—'}</td><td class="r num">${jumps(id)}</td><td class="r">${effect(role)}</td></tr>`;
          }).join('')}
        </tbody></table></div>
        <div class="inc-actions">
          <button class="btn ghost sm" data-inc-show="${inc.constellationId}">${icon('jump')}${tx('Arată pe hartă')}</button>
          ${doctrineButtons(space)}
          <a class="btn ghost sm" href="https://evemaps.dotlan.net/map/${encodeURIComponent(regionOf(inc.staging).replace(/ /g, '_'))}/${encodeURIComponent(constName(inc.constellationId).replace(/ /g, '_'))}" target="_blank" rel="noopener noreferrer">${icon('external')}Dotlan</a>
        </div>`,
    });
  }

  function activeHtml() {
    if (!map) return loader(tx('Citim incursiunile active din ESI'));
    const by = (s: Space) => list.filter((i) => spaceOf(map!, i.staging) === s).length;
    return `${panel({
      title: tx('Incursiuni active'),
      count: list.length,
      actions: dataStamp(at, 'data-inc-refresh', { label: tx('Date din {time}'), title: tx('ESI actualizează incursiunile la 5 minute. Click pentru a le citi din nou.') }),
      body: `<div class="history-kpis">
          <div><span class="label">Highsec</span><span class="value">${by('high')}</span></div>
          <div><span class="label">Lowsec</span><span class="value">${by('low')}</span></div>
          <div><span class="label">Nullsec</span><span class="value">${by('null') + by('pochven')}</span></div>
          <div><span class="label">${tx('Cu nava-mamă')}</span><span class="value">${list.filter((i) => i.boss).length}</span></div>
        </div>
        ${fromPanel()}
        <p class="dim small">${tx('Rolurile sistemelor (Vanguard, Assault, HQ) sunt deduse din hartă: HQ e cel mai departe de staging, Vanguard lângă staging. Confirmă în joc în fereastra Agency > Incursions.')}</p>`,
    })}${respawnHtml()}${list.length ? sorted().map(cardHtml).join('') : panel({ body: emptyState({ title: tx('Nicio incursiune activă acum') }) })}${lifecycleHtml()}`;
  }

  function lifecycleHtml() {
    const rows: [string, string, string][] = [
      [STATE.established[0], tx('până la 5 zile'), tx('Starea de la apariție. Flotele scad influența terminând site-uri; când ajunge la 0% și s-a terminat un site HQ, apare nava-mamă.')],
      [STATE.mobilizing[0], tx('48 de ore'), tx('Faza a doua. Nava-mamă poate apărea și acum; dacă e distrusă, incursiunea se încheie mai devreme.')],
      [STATE.withdrawing[0], tx('24 de ore'), tx('Ultima fază. Dacă nava-mamă nu e terminată până la final, LP-ul strâns nu se mai plătește.')],
    ];
    return panel({
      title: tx('Cum evoluează o incursiune'),
      body: `<div class="table-scroll"><table class="table compact ops-table"><thead><tr><th>${tx('Stare')}</th><th>${tx('Durată')}</th><th>${tx('Ce se întâmplă')}</th></tr></thead><tbody>
        ${rows.map(([a, b, c]) => `<tr><td><b>${esc(a)}</b></td><td class="nowrap">${esc(b)}</td><td class="small">${esc(c)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="dim small">${tx('Pot exista cel mult cinci incursiuni simultan: una în highsec, una în lowsec și trei în nullsec. În highsec nava-mamă nu poate apărea în primele 3 zile, în lowsec în prima zi. În toate sistemele infestate recompensele CONCORD pentru NPC sunt la jumătate și cyno-urile normale sunt blocate.')}</p>`,
    });
  }

  function mapHtml() {
    if (!map) return loader(tx('Citim incursiunile active din ESI'));
    if (!map.schematic) return panel({ body: alertBox(tx('Datele hărții sunt vechi și nu au poziții 2D. Rulează "npm run data" ca să le regenerezi.'), 'warn') });
    const legend = ROLE_ORDER.map((r) => `<span class="inc-role" style="--role: var(${ROLE_COLOR[r]})">${ROLE[r]}</span>`).join('');
    const d = jumpsFrom();
    return `<div class="live-map inc-map">
      <div class="live-toolbar"><span class="inc-legend">${legend}</span><span class="small dim">${tx('✦ nava-mamă')}${here ? ` · ${tx('cerc punctat = {name}', { name: sysName(here.id) })}` : ''}</span></div>
      <div class="live-body">
        <div class="live-canvas">
          <div class="live-stage" id="incStage"></div>
          <div class="live-zoom">
            <button class="icon-btn" data-zoom="in" aria-label="${esc(tx('Mărește'))}">+</button>
            <button class="icon-btn" data-zoom="out" aria-label="${esc(tx('Micșorează'))}">−</button>
            <button class="icon-btn" data-zoom="fit" aria-label="${esc(tx('Toată harta'))}">${icon('refresh')}</button>
          </div>
        </div>
        <aside class="live-side"><div class="live-side-body">
          <div class="label">${tx('{n} incursiuni active', { n: list.length })}</div>
          <div class="live-events">${sorted().map((inc) => {
            const sp = spaceOf(map!, inc.staging);
            const j = d?.all.get(inc.staging);
            return `<div class="live-ev intel inc-ev ${focusC === inc.constellationId ? 'active' : ''}" data-inc-focus="${inc.constellationId}">
              <div class="live-ev-main">
                <div class="live-ev-top"><b>${esc(constName(inc.constellationId))}</b>${badge(...SPACE[sp])}</div>
                <div class="live-ev-sub dim">${esc(regionOf(inc.staging))} · Staging ${esc(sysName(inc.staging))}${j != null ? ` · ${tx('{n} salturi', { n: j })}` : ''}</div>
                <div class="live-ev-sub">${badge(...STATE[inc.state])} ${inc.boss ? badge(tx('Nava-mamă activă'), 'danger') : ''}</div>
                <div class="sov-score" title="${esc(tx('Influență Sansha'))}"><span style="width:${(sanshaInfluence(inc) * 100).toFixed(1)}%"></span></div>
              </div>
            </div>`;
          }).join('') || `<p class="dim small">${tx('Nicio incursiune activă acum')}</p>`}</div>
        </div></aside>
      </div>
    </div>`;
  }

  function mountMap() {
    const stage = body.querySelector<HTMLElement>('#incStage');
    if (!stage || !map) return;
    const m = map;
    const territory = new Map<number, string>();
    const css = (v: string) => getComputedStyle(stage).getPropertyValue(v).trim() || '#888';
    for (const r of roles.values()) for (const [id, role] of r) territory.set(id, css(ROLE_COLOR[role]));
    const owner = new Map<number, Incursion>();
    for (const inc of list) for (const id of inc.systems) owner.set(id, inc);
    star = new StarMap(stage, m, {
      territory: () => territory,
      regionLabels: true,
      labelFirst: (id) => owner.has(id),
      over: (p: MapPainter) => {
        const g = p.ctx;
        const big = p.spacing > 20;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (const inc of list) {
          const pt = p.at(inc.staging);
          if (pt) {
            g.strokeStyle = p.css('--accent');
            g.lineWidth = 1.6;
            g.beginPath();
            g.arc(pt[0], pt[1], big ? 12 : 7, 0, Math.PI * 2);
            g.stroke();
          }
          const hq = inc.boss ? hqOf(inc) : undefined;
          const h = hq ? p.at(hq) : null;
          if (h) {
            g.fillStyle = p.css('--danger');
            g.font = `${big ? 15 : 11}px ${p.css('--font-body')}`;
            g.fillText('✦', h[0], h[1] - (big ? 15 : 9));
          }
        }
        const pt = here ? p.at(here.id) : null;
        if (pt) {
          g.strokeStyle = p.css('--text-bright');
          g.lineWidth = 2;
          g.setLineDash([3, 3]);
          g.beginPath();
          g.arc(pt[0], pt[1], big ? 15 : 9, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
      },
      tooltip: (s: NavSystem) => {
        const inc = owner.get(s.id);
        const role = inc ? roles.get(inc.constellationId)?.get(s.id) : undefined;
        const j = jumpsFrom()?.all.get(s.id);
        return `<b>${esc(s.name)}</b> ${secSpan(s.sec)}<small>${esc(m.region(s))} · ${esc(m.constellation(s))}</small>
          ${inc && role ? `<span class="tip-row">${ROLE[role]} · ${STATE[inc.state][0]} · ${tx('influență {p}', { p: pctText(sanshaInfluence(inc)) })}</span>` : ''}
          ${j != null && here ? `<span class="tip-row dim">${tx('{n} salturi de la {name}', { n: j, name: sysName(here.id) })}</span>` : ''}`;
      },
      onSelect: (id) => {
        const inc = id ? owner.get(id) : undefined;
        if (inc) { focusC = inc.constellationId; syncFocus(); }
      },
    });
    const inc = focusC ? list.find((i) => i.constellationId === focusC) : undefined;
    if (inc) star.fitSystems(inc.systems);
    else if (list.length) star.fitSystems(list.flatMap((i) => i.systems));
  }

  function syncFocus() {
    body.querySelectorAll<HTMLElement>('[data-inc-focus]').forEach((el) => el.classList.toggle('active', Number(el.dataset.incFocus) === focusC));
  }

  function sitesHtml() {
    const tiers = (band: 'high' | 'lownull', kind: SiteKind) => {
      const p = PAYOUTS[band][kind];
      if (!p) return '—';
      let lo = p.min;
      return p.tiers.map((t) => {
        const range = lo === t.upTo ? `${t.upTo}` : `${lo}–${t.upTo}`;
        lo = t.upTo + 1;
        return `<div class="inc-tier"><span class="dim small">${tx('{r} piloți', { r: range })}</span><span class="num">${compactISK(t.isk)}</span><span class="num dim small">${formatInt(t.lp)} LP</span></div>`;
      }).join('');
    };
    return `${panel({
      title: tx('Site-uri de incursiune'),
      body: `<div class="table-scroll"><table class="table compact ops-table inc-sites"><thead><tr><th>${tx('Tip')}</th><th>${tx('Site-uri')}</th><th>${tx('Flotă highsec')}</th><th>${tx('Flotă low/null')}</th><th>${tx('Durată')}</th><th>${tx('Payout highsec')}</th><th>${tx('Payout low/null')}</th></tr></thead><tbody>
        ${SITES.map((s) => `<tr>
          <td><b>${SITE[s.kind]}</b><div class="dim small">${tx('cel mult {n} pe sistem', { n: s.perSystem })}</div></td>
          <td class="small">${s.names.map(esc).join('<br>')}</td>
          <td class="num">${s.fleet}</td>
          <td class="num">${s.fleetLowNull}</td>
          <td class="nowrap">${s.minutes[0]}–${s.minutes[1]} min</td>
          <td>${tiers('high', s.kind)}</td>
          <td>${tiers('lownull', s.kind)}</td>
        </tr>`).join('')}
        </tbody></table></div>
        <p class="dim small">${tx('Payout pe pilot, în ISK plus LP CONCORD. Plătește flota care a făcut cele mai multe daune, doar piloții aflați pe grid la final. Peste numărul de piloți din tabel payout-ul scade mult sau dispare. Staging: plătește doar primii contribuitori. Nation Mining Colony cere Lyavite. Nava-mamă: The Kundalini Manifest în highsec și nullsec, Uroborus în lowsec. Valori de referință după EVE University; CCP le poate schimba.')}</p>`,
    })}${panel({
      title: tx('Penalizări în sistemele infestate'),
      body: `<div class="table-scroll"><table class="table compact ops-table"><thead><tr><th>${tx('Sistem')}</th><th class="r">${tx('Rezistențe')}</th><th class="r">${tx('Daunele tale')}</th><th class="r">${tx('Daune primite')}</th></tr></thead><tbody>
        ${(['vanguard', 'assault', 'hq'] as const).map((k) => `<tr><td>${ROLE[k]}</td><td class="r num neg-text">−${EFFECTS[k]}%</td><td class="r num neg-text">−${EFFECTS[k]}%</td><td class="r num neg-text">+${EFFECTS[k]}%</td></tr>`).join('')}
        </tbody></table></div>
        <p class="dim small">${tx('Valorile sunt la influență Sansha 100% și scad proporțional cu ea; la 0% nu mai există penalizare. Recompensele CONCORD pentru NPC sunt la jumătate în toate sistemele infestate, indiferent de influență.')}</p>
        <div class="inc-actions">${doctrineButtons('high')}<a class="btn ghost sm" href="https://wtmincursions.com/doctrines" target="_blank" rel="noopener noreferrer">${icon('external')}Warp To Me</a><a class="btn ghost sm" href="https://wiki.eveuniversity.org/Incursions" target="_blank" rel="noopener noreferrer">${icon('external')}EVE University</a></div>`,
    })}`;
  }

  function calcResult() {
    const t = payout(calc.band, calc.kind, calc.pilots);
    const perHour = calc.minutes > 0 ? 60 / calc.minutes : 0;
    if (!t) return alertBox(tx('Pentru {n} piloți site-ul nu plătește conform tabelului de referință.', { n: calc.pilots }), 'warn');
    const iskH = t.isk * perHour;
    const lpH = t.lp * perHour;
    return `<div class="history-kpis">
        <div><span class="label">${tx('Pe site')}</span><span class="value">${compactISK(t.isk)} · ${formatInt(t.lp)} LP</span></div>
        <div><span class="label">${tx('Site-uri pe oră')}</span><span class="value">${formatNum(perHour, 1)}</span></div>
        <div><span class="label">ISK/h</span><span class="value">${compactISK(iskH)}</span></div>
        <div><span class="label">LP/h</span><span class="value">${formatInt(lpH)}</span></div>
        ${calc.lpIsk > 0 ? `<div><span class="label">${tx('Total cu LP')}</span><span class="value">${compactISK(iskH + lpH * calc.lpIsk)}</span></div>` : ''}
      </div>
      <p class="dim small">${tx('LP-ul se plătește doar dacă nava-mamă e distrusă înainte de finalul incursiunii.')}</p>`;
  }

  function calcHtml() {
    const opt = (v: string, l: string, cur: string) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
    const kinds: SiteKind[] = ['vanguard', 'assault', 'hq', 'mothership', 'staging'];
    return `${panel({
      title: tx('Calculator ISK/h'),
      body: `<div class="inc-calc">
          <label><span class="label">${tx('Spațiu')}</span><select class="input" data-calc="band">${opt('high', 'Highsec', calc.band)}${opt('lownull', 'Lowsec / Nullsec', calc.band)}</select></label>
          <label><span class="label">${tx('Tip site')}</span><select class="input" data-calc="kind">${kinds.map((k) => opt(k, SITE[k], calc.kind)).join('')}</select></label>
          <label><span class="label">${tx('Piloți în flotă')}</span><input class="input" type="number" min="1" max="200" data-calc="pilots" value="${calc.pilots}" /></label>
          <label><span class="label">${tx('Minute pe site, cu warp')}</span><input class="input" type="number" min="1" max="120" step="0.5" data-calc="minutes" value="${calc.minutes}" /></label>
          <label><span class="label">${tx('ISK pe LP (opțional)')}</span><input class="input" type="number" min="0" step="50" data-calc="lpIsk" value="${calc.lpIsk || ''}" /></label>
        </div>
        <div id="incCalcOut">${calcResult()}</div>`,
    })}${panel({ title: tx('Sesiunile tale de incursiuni'), body: `<div id="incSessions">${sessionsHtml()}</div>` })}`;
  }

  function wireCalc() {
    body.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-calc]').forEach((el) => {
      el.addEventListener('input', () => {
        const k = el.dataset.calc as keyof CalcState;
        if (k === 'band') calc.band = el.value as CalcState['band'];
        else if (k === 'kind') calc.kind = el.value as SiteKind;
        else calc[k] = Math.max(0, Number(el.value) || 0);
        if (k === 'kind' || k === 'band') {
          const site = SITES.find((s) => s.kind === calc.kind)!;
          if (k === 'kind') calc.minutes = Math.round((site.minutes[0] + site.minutes[1]) / 2);
          calc.pilots = PAYOUTS[calc.band][calc.kind]?.tiers[0].upTo ?? calc.pilots;
          const mi = body.querySelector<HTMLInputElement>('[data-calc="minutes"]');
          const pi = body.querySelector<HTMLInputElement>('[data-calc="pilots"]');
          if (mi) mi.value = String(calc.minutes);
          if (pi) pi.value = String(calc.pilots);
        }
        saveJson(CALC_KEY, calc);
        const out = body.querySelector<HTMLElement>('#incCalcOut');
        if (out) out.innerHTML = calcResult();
      });
    });
  }

  function sessionsHtml() {
    if (sessions === null) return loader(tx('Citim jurnalul portofelului'));
    if (sessions === 'scope') return ctx.character.characterId ? permissionGate('wallet', ctx.character.characterId, ctx.character.name) : '';
    if (sessions === 'login') return `<p class="dim">${tx('Importă un caracter din EVE ca să vezi ISK/h real din plățile CONCORD pentru site-uri.')}</p>`;
    if (typeof sessions === 'string') return alertBox(sessions, 'warn');
    if (!sessions.length) return `<p class="dim">${tx('Nicio plată CONCORD pentru site-uri de incursiune în jurnalul portofelului.')}</p>`;
    const total = sessions.reduce((a, s) => a + s.isk, 0);
    const timed = sessions.filter((s) => s.perHour);
    const avg = timed.length ? timed.reduce((a, s) => a + s.perHour!, 0) / timed.length : 0;
    return `<div class="history-kpis">
        <div><span class="label">${tx('Sesiuni')}</span><span class="value">${sessions.length}</span></div>
        <div><span class="label">${tx('Site-uri plătite')}</span><span class="value">${formatInt(sessions.reduce((a, s) => a + s.n, 0))}</span></div>
        <div><span class="label">${tx('ISK total')}</span><span class="value">${compactISK(total)}</span></div>
        <div><span class="label">${tx('ISK/h mediu')}</span><span class="value">${avg ? compactISK(avg) : '—'}</span></div>
      </div>
      <div class="table-scroll"><table class="table compact ops-table"><thead><tr><th>${tx('Început')}</th><th class="r">${tx('Durată')}</th><th class="r">${tx('Site-uri')}</th><th class="r">ISK</th><th class="r">${tx('ISK / site')}</th><th class="r">ISK/h</th></tr></thead><tbody>
      ${sessions.slice(0, 40).map((s) => `<tr><td class="small">${when(s.start)}</td><td class="r num">${s.n > 1 ? `${formatNum((s.end - s.start) / H, 1)} h` : '—'}</td><td class="r num">${s.n}</td><td class="r num">${compactISK(s.isk)}</td><td class="r num">${compactISK(s.isk / s.n)}</td><td class="r num">${s.perHour ? compactISK(s.perHour) : '—'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="dim small">${tx('Plățile de tip Corporate Reward Payout la mai puțin de 30 de minute una de alta formează o sesiune.')}</p>`;
  }

  async function loadSessions() {
    const who = charState(WALLET_SCOPE);
    if (!who) { sessions = 'login'; paintSessions(); return; }
    if (who === 'scope') { sessions = 'scope'; paintSessions(); return; }
    try {
      const fresh = await walletJournal(who.id);
      sessions = payoutSessions(archiveJournal(who.id, fresh));
    } catch (err) {
      sessions = (err as Error).message;
    }
    paintSessions();
  }

  function paintSessions() {
    const box = body.querySelector<HTMLElement>('#incSessions');
    if (box) box.innerHTML = sessionsHtml();
  }

  function logHtml() {
    const evText = (k: string, s?: IncState) => (k === 'new' ? tx('A apărut') : k === 'boss' ? tx('Nava-mamă a apărut') : k === 'end' ? tx('S-a încheiat') : tx('Stare nouă: {s}', { s: s ? STATE[s][0] : '' }));
    const evTone = (k: string) => (k === 'new' ? 'accent' : k === 'boss' ? 'danger' : k === 'end' ? '' : 'gold');
    const events = [...log.events].sort((a, b) => b.t - a.t);
    const ended = [...log.ended].sort((a, b) => b.end - a.end);
    const where = (c: number, staging: number) => `${esc(constName(c))} <span class="dim small">· ${esc(regionOf(staging))}</span>`;
    const dur = (o: Observed & { end: number }) => `${o.fresh ? '' : '≥ '}${formatNum((o.end - o.first) / (24 * H), 1)} ${tx('zile')}`;
    return `${panel({
      title: tx('Incursiuni încheiate'),
      count: ended.length,
      body: ended.length ? `<div class="table-scroll"><table class="table compact ops-table"><thead><tr><th>${tx('Constelație')}</th><th>${tx('Spațiu')}</th><th>${tx('A apărut')}</th><th>${tx('Încheiată')}</th><th class="r">${tx('Durată')}</th><th>${tx('Ultima stare')}</th></tr></thead><tbody>
        ${ended.map((o) => `<tr><td>${where(o.c, o.staging)}</td><td>${badge(...SPACE[o.space])}</td><td class="small">${o.fresh ? when(o.first) : `<span class="dim">${tx('înainte de {t}', { t: when(o.first) })}</span>`}</td><td class="small">${when(o.end)}</td><td class="r num">${dur(o)}</td><td>${badge(...STATE[o.state])}${o.bossAt ? ` ${badge(tx('nava-mamă'), 'danger')}` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : `<p class="dim">${tx('Nicio incursiune încheiată de când urmărește aplicația.')}</p>`,
    })}${panel({
      title: tx('Schimbări observate'),
      count: events.length,
      body: `${events.length ? `<div class="table-scroll"><table class="table compact ops-table"><thead><tr><th>${tx('Când')}</th><th>${tx('Eveniment')}</th><th>${tx('Constelație')}</th><th>${tx('Spațiu')}</th></tr></thead><tbody>
        ${events.slice(0, 150).map((e) => `<tr><td class="small nowrap">${when(e.t)}</td><td>${badge(evText(e.kind, e.state), evTone(e.kind))}</td><td>${where(e.c, e.staging)}</td><td>${badge(...SPACE[e.space])}</td></tr>`).join('')}
        </tbody></table></div>` : `<p class="dim">${tx('Încă nu s-a schimbat nimic.')}</p>`}
        <p class="dim small">${tx('Aplicația notează aparițiile, schimbările de stare, nava-mamă și finalul incursiunilor de fiecare dată când citește lista din ESI, și le păstrează 30 de zile pe acest dispozitiv.')}</p>`,
    })}`;
  }

  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const s = t.closest<HTMLElement>('[data-inc-sub]');
    if (s) { sub = s.dataset.incSub as Sub; saveJson(SUB_KEY, sub); render(); return; }
    if (t.closest('[data-inc-refresh]')) { load(true); return; }
    const show = t.closest<HTMLElement>('[data-inc-show]');
    if (show) { focusC = Number(show.dataset.incShow); sub = 'map'; saveJson(SUB_KEY, sub); render(); return; }
    const f = t.closest<HTMLElement>('[data-inc-focus]');
    if (f && star) {
      focusC = Number(f.dataset.incFocus);
      const inc = list.find((i) => i.constellationId === focusC);
      if (inc) star.fitSystems(inc.systems);
      syncFocus();
      return;
    }
    const z = t.closest<HTMLElement>('[data-zoom]');
    if (z && star) { if (z.dataset.zoom === 'in') star.zoomBy(1.6); else if (z.dataset.zoom === 'out') star.zoomBy(1 / 1.6); else star.fitAll(); return; }
    const doc = t.closest<HTMLElement>('[data-inc-doctrine]');
    if (doc && !opts.openDoctrine?.(`incursion ${doc.dataset.incDoctrine}`)) window.open('https://wtmincursions.com/doctrines', '_blank', 'noopener');
  });

  return {
    show(force = false) {
      if (!list.length || force || Date.now() - at > 5 * 60 * 1000) load(force);
      else render();
    },
    reset() {
      sessions = null;
      jumpCache = null;
      if (list.length) locate().then(render);
    },
  };
}
