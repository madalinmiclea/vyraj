import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, formatInt, formatNum, compactISK, emptyState, badge, windowTitle, dataStamp, searchField } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { hasScope, loginProblem } from '../character/sso';
import { permissionGate, type PermId } from '../character/permissions';
import {
  freelanceJobs, freelanceJob, myFreelanceJobs, militaryCampaigns, campaignObjectives, myObjectives, mercenaryDens, tacticalOperations, loadActivities,
  FREELANCE_SCOPE, CAMPAIGN_SCOPE, DENS_SCOPE, MTO_SCOPE,
  type FreelanceJob, type FreelanceDetail, type MyJob, type Campaign, type Objective, type MyObjective, type MercenaryDen, type TacticalOperation, type Activities, type EvolutionLevel,
} from '../services/operations';
import { raidableSkyhooks, sovereignty, resolveNames, cachedName, displaySec, secClass, type RaidableSkyhook, type SovClaim } from '../services/recon';
import { loadMap, type NavMap } from '../services/navigation';
import { planetNames } from '../services/pi';
import { fold } from '../ui/fold';
import { tx, locale } from '../i18n';

type Tab = 'jobs' | 'campaigns' | 'dens' | 'skyhooks';

const TABS: { id: Tab; label: string }[] = [
  { id: 'jobs', label: tx('Joburi freelance') },
  { id: 'campaigns', label: tx('Campanii militare') },
  { id: 'dens', label: tx('Mercenary Dens') },
  { id: 'skyhooks', label: tx('Skyhook-uri raidabile') },
];

const TAB_KEY = 'eve-ops:tab';

const JOB_STATE: Record<string, [string, string]> = {
  Active: [tx('Activ'), 'ok'], Closed: [tx('Închis'), ''], Completed: [tx('Terminat'), 'accent'], Expired: [tx('Expirat'), 'warn'], Deleted: [tx('Șters'), 'warn'], Unspecified: ['—', ''],
};
const CAMPAIGN_STATE: Record<string, [string, string]> = {
  Active: [tx('Activă'), 'ok'], Completed: [tx('Încheiată'), 'accent'], Expired: [tx('Expirată'), 'warn'], Unspecified: ['—', ''],
};
const DEN_STATE: Record<string, [string, string]> = {
  Running: [tx('Pornit'), 'ok'], Paused: [tx('Pe pauză'), 'warn'], Disabled: [tx('Oprit'), 'danger'], Unspecified: ['—', ''],
};
const MTO_STATE: Record<string, [string, string]> = {
  Available: [tx('Disponibilă'), 'ok'], Started: [tx('Pornită'), 'gold'], Completed: [tx('Terminată'), 'accent'], Expired: [tx('Expirată'), 'warn'], Removed: [tx('Scoasă'), ''], Unspecified: ['—', ''],
};
const CAREER: Record<string, string> = {
  Explorer: tx('Explorator'), Industrialist: tx('Industriaș'), Enforcer: tx('Enforcer'), 'Soldier of Fortune': tx('Soldat de profesie'),
  explorer: tx('Explorator'), industrialist: tx('Industriaș'), enforcer: tx('Enforcer'), soldier_of_fortune: tx('Soldat de profesie'), 'soldier-of-fortune': tx('Soldat de profesie'),
};
const LEVEL = (l: EvolutionLevel) => (l.startsWith('Level') ? tx('Nivel {n}', { n: l.slice(5) }) : '—');

const state = (map: Record<string, [string, string]>, s: string) => badge(...((map[s] ?? [s, '']) as [string, string]), true);
const isk = (v: number) => `<span class="num">${compactISK(v)}</span>`;
const pct = (cur: number, max: number) => (max > 0 ? Math.min(100, (cur / max) * 100) : 0);
const bar = (cur: number, max: number) => `<div class="ops-bar" title="${formatInt(cur)} / ${formatInt(max)}"><span style="width:${pct(cur, max).toFixed(1)}%"></span></div>`;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const span = (ms: number) => {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
const until = (ms: number) => (ms <= Date.now() ? tx('acum') : tx('în {t}', { t: span(ms) }));

export function createOperationsView(el: HTMLElement, ctx: AppContext, side: HTMLElement) {
  let tab = loadJson<Tab>(TAB_KEY, 'jobs');
  if (!TABS.some((t) => t.id === tab)) tab = 'jobs';
  let run = 0;

  el.innerHTML = `${pageHead(tx('Operațiuni'), tx('Joburi freelance, campanii militare, Mercenary Dens și skyhook-uri raidabile, direct din ESI'), 'Pohod')}
    <div id="opsBody"></div>`;
  const body = el.querySelector<HTMLElement>('#opsBody')!;

  function renderTabs() {
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Operațiuni'))}</div>
      <div class="side-nav">${TABS.map((t) => `<button class="side-link ${t.id === tab ? 'active' : ''}" data-ops-tab="${t.id}">${t.label}</button>`).join('')}</div>`;
  }

  function esiChar(scopes: string[]): { id: number } | 'scope' | string {
    const c = ctx.character;
    const problem = loginProblem(c);
    if (problem || !c.characterId) return problem ?? '';
    if (!scopes.every((s) => hasScope(c.characterId!, s))) return 'scope';
    return { id: c.characterId };
  }

  const gate = (perm: PermId) => permissionGate(perm, ctx.character.characterId!, ctx.character.name);

  function render() {
    renderTabs();
    run++;
    ({ jobs, campaigns, dens, skyhooks } as Record<Tab, () => void>)[tab]();
  }

  let jobList: FreelanceJob[] = [];
  let jobsAt = 0;
  let jobQuery = '';
  let myJobs: MyJob[] | string | null = null;
  const openJobs = new Set<string>();
  const details = new Map<string, FreelanceDetail | 'loading' | string>();

  async function jobs(force = false) {
    const mine = run;
    body.innerHTML = loader(tx('Citim joburile freelance din ESI'));
    try {
      const r = await freelanceJobs(force);
      if (mine !== run) return;
      jobList = r.list;
      jobsAt = r.at;
      const who = esiChar([FREELANCE_SCOPE]);
      myJobs = typeof who === 'object' ? null : who;
      renderJobs();
      if (typeof who === 'object') {
        myJobs = await myFreelanceJobs(who.id).catch((err) => (err as Error).message);
        if (mine === run) renderJobs();
      }
    } catch (err) {
      if (mine === run) body.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  function jobRows(list: FreelanceJob[], withMine: boolean) {
    return list.map((j) => {
      const perUnit = j.reward && j.progress.desired ? j.reward.initial / j.progress.desired : 0;
      const d = details.get(j.id);
      const p = (j as MyJob).participation;
      return `<tr class="ops-row" data-job="${esc(j.id)}" aria-expanded="${openJobs.has(j.id)}">
        <td><span class="asset-caret"></span>${esc(j.name)}</td>
        <td>${state(JOB_STATE, j.state)}</td>
        <td class="ops-progress">${bar(j.progress.current, j.progress.desired)}<span class="dim small num">${formatNum(pct(j.progress.current, j.progress.desired), 1)}%</span></td>
        <td class="r">${j.reward ? isk(j.reward.remaining) : '<span class="dim">—</span>'}</td>
        <td class="r">${perUnit ? isk(perUnit) : '<span class="dim">—</span>'}</td>
        ${withMine ? `<td class="r num">${p ? formatInt(p.contributed) : '—'}</td>` : ''}
      </tr>${openJobs.has(j.id) ? `<tr class="ops-detail"><td colspan="${withMine ? 6 : 5}">${jobDetail(d)}</td></tr>` : ''}`;
    }).join('');
  }

  function jobDetail(d: FreelanceDetail | 'loading' | string | undefined) {
    if (!d || d === 'loading') return loader(tx('Citim detaliile jobului'));
    if (typeof d === 'string') return alertBox(d, 'warn');
    const c = d.contribution;
    const places = d.access_and_visibility.broadcast_locations?.map((x) => x.name).join(', ');
    const facts = [
      [tx('Carieră'), CAREER[d.details.career] ?? d.details.career],
      [tx('Tip'), d.configuration.method.replace(/([a-z])([A-Z])/g, '$1 $2')],
      [tx('Creat de'), `${d.details.creator.character.name} · ${d.details.creator.corporation.name}`],
      [tx('Creat'), when(d.details.created)],
      [tx('Expiră'), when(d.details.expires)],
      [tx('Recompensă pe unitate'), c?.reward_per_contribution ? `${formatNum(c.reward_per_contribution, 2)} ISK` : '—'],
      [tx('Participanți maximi'), c ? formatInt(c.max_committed_participants) : '—'],
      [tx('Limită pe pilot'), c?.contribution_per_participant_limit ? formatInt(c.contribution_per_participant_limit) : '—'],
      [tx('Anunțat în'), places || '—'],
    ];
    return `<div class="ops-facts">${facts.map(([k, v]) => `<div><span class="label">${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>
      ${d.details.description ? `<p class="ops-desc">${esc(d.details.description)}</p>` : ''}
      <p class="dim small">${tx('Joburile se acceptă din fereastra Opportunities > Freelance Jobs din joc.')}</p>`;
  }

  function renderJobs() {
    const q = fold(jobQuery.trim());
    const list = jobList.filter((j) => !q || fold(j.name).includes(q)).sort((a, b) => (b.reward?.remaining ?? 0) - (a.reward?.remaining ?? 0));
    const total = jobList.reduce((s, j) => s + (j.reward?.remaining ?? 0), 0);
    const head = (mine: boolean) => `<thead><tr><th>${tx('Job')}</th><th>${tx('Stare')}</th><th>${tx('Progres')}</th><th class="r" title="${esc(tx('ISK rămas în job, încă neplătit.'))}">${tx('Rămas')}</th><th class="r" title="${esc(tx('Recompensa inițială împărțită la cantitatea cerută.'))}">${tx('ISK / unitate')}</th>${mine ? `<th class="r">${tx('Contribuția ta')}</th>` : ''}</tr></thead>`;
    const mineBlock = typeof myJobs === 'string'
      ? (myJobs === 'scope' ? panel({ body: gate('freelance') }) : myJobs && ctx.character.kind === 'esi' ? panel({ body: alertBox(myJobs, 'warn') }) : '')
      : myJobs ? panel({
        title: tx('Joburile tale'),
        count: myJobs.length,
        body: myJobs.length ? `<div class="table-scroll"><table class="table compact ops-table">${head(true)}<tbody>${jobRows(myJobs, true)}</tbody></table></div>` : `<p class="dim">${tx('Nu participi la niciun job freelance.')}</p>`,
      }) : '';
    body.innerHTML = `${mineBlock}${panel({
      title: tx('Joburi publice'),
      count: list.length,
      actions: dataStamp(jobsAt, 'data-ops-refresh', { label: tx('Date din {time}'), title: tx('Lista e păstrată 10 minute. Click pentru a o citi din nou.') }),
      body: `<div class="history-kpis">
          <div><span class="label">${tx('Joburi active')}</span><span class="value">${formatInt(jobList.filter((j) => j.state === 'Active').length)}</span></div>
          <div><span class="label">${tx('ISK rămas în total')}</span><span class="value">${compactISK(total)}</span></div>
        </div>
        <div class="ops-search">${searchField({ id: 'opsJobQuery', placeholder: tx('Caută după nume (minereu, sistem, tip)') })}</div>
        ${list.length ? `<div class="table-scroll"><table class="table compact ops-table">${head(false)}<tbody>${jobRows(list, false)}</tbody></table></div>` : emptyState({ title: tx('Niciun job găsit') })}`,
    })}`;
    const input = body.querySelector<HTMLInputElement>('#opsJobQuery');
    if (input) {
      input.value = jobQuery;
      input.addEventListener('input', () => { jobQuery = input.value; renderJobsKeepFocus(); });
    }
  }

  function renderJobsKeepFocus() {
    const pos = body.querySelector<HTMLInputElement>('#opsJobQuery')?.selectionStart ?? jobQuery.length;
    renderJobs();
    const input = body.querySelector<HTMLInputElement>('#opsJobQuery');
    if (input) { input.focus(); input.setSelectionRange(pos, pos); }
  }

  async function toggleJob(id: string) {
    if (openJobs.has(id)) { openJobs.delete(id); renderJobs(); return; }
    openJobs.add(id);
    if (!details.has(id) || typeof details.get(id) === 'string') {
      details.set(id, 'loading');
      renderJobs();
      const who = esiChar([FREELANCE_SCOPE]);
      try {
        details.set(id, await freelanceJob(id, typeof who === 'object' ? who.id : null));
      } catch (err) {
        details.set(id, (err as Error).message);
      }
    }
    if (tab === 'jobs') renderJobs();
  }

  let data: Activities | null = null;
  const objectives = new Map<string, Objective[] | 'loading' | string>();
  let mineObj: MyObjective[] | string | null = null;

  async function campaigns(force = false) {
    const mine = run;
    body.innerHTML = loader(tx('Citim campaniile militare'));
    try {
      const [r, d] = await Promise.all([militaryCampaigns(force), loadActivities()]);
      data = d;
      const factions = r.list.map((c) => d.campaigns[c.id]?.faction).filter(Boolean);
      const corps = Object.values(d.objectives).map((o) => o.lpCorp).filter(Boolean);
      await resolveNames([...factions, ...new Set(corps)]).catch(() => null);
      if (mine !== run) return;
      const who = esiChar([CAMPAIGN_SCOPE]);
      mineObj = typeof who === 'object' ? null : who;
      renderCampaigns(r.list, r.at);
      const active = r.list.filter((c) => c.state === 'Active');
      await Promise.all(active.map((c) => loadObjectives(c.id)));
      if (typeof who === 'object') mineObj = await myObjectives(who.id).catch((err) => (err as Error).message);
      if (mine === run) renderCampaigns(r.list, r.at);
    } catch (err) {
      if (mine === run) body.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  let shownCampaigns: { list: Campaign[]; at: number } = { list: [], at: 0 };

  async function loadObjectives(id: string) {
    if (objectives.get(id) === 'loading' || Array.isArray(objectives.get(id))) return;
    objectives.set(id, 'loading');
    try {
      objectives.set(id, await campaignObjectives(id));
    } catch (err) {
      objectives.set(id, (err as Error).message);
    }
  }

  function objectiveTable(id: string) {
    const o = objectives.get(id);
    if (!o) return `<button class="btn ghost sm" data-ops-objectives="${esc(id)}">${tx('Arată obiectivele')}</button>`;
    if (o === 'loading') return loader(tx('Citim obiectivele'));
    if (typeof o === 'string') return alertBox(o, 'warn');
    const mine = Array.isArray(mineObj) ? new Map(mineObj.map((x) => [x.id, x])) : null;
    const rows = o.map((x) => ({ x, info: data?.objectives[x.id] })).sort((a, b) => (a.x.state === 'Active' ? 0 : 1) - (b.x.state === 'Active' ? 0 : 1) || (b.info?.isk ?? 0) - (a.info?.isk ?? 0));
    return `<div class="table-scroll"><table class="table compact ops-table"><thead><tr><th>${tx('Obiectiv')}</th><th>${tx('Carieră')}</th><th>${tx('Stare')}</th><th>${tx('Progres')}</th><th class="r" title="${esc(tx('Piloți care au contribuit / care s-au înscris.'))}">${tx('Piloți')}</th><th class="r" title="${esc(tx('Recompensa pentru fiecare unitate de progres, din SDE.'))}">ISK / ${tx('unitate')}</th><th class="r">LP / ${tx('unitate')}</th>${mine ? `<th class="r">${tx('Contribuția ta')}</th>` : ''}</tr></thead><tbody>
      ${rows.map(({ x, info }) => {
        const m = mine?.get(x.id);
        return `<tr>
          <td><b>${esc(info?.title ?? x.id)}</b>${info?.subtitle ? `<div class="dim small">${esc(info.subtitle)}</div>` : ''}</td>
          <td class="small">${esc(CAREER[info?.career ?? ''] ?? info?.career ?? '')}</td>
          <td>${state(CAMPAIGN_STATE, x.state)}</td>
          <td class="ops-progress">${bar(x.progress, info?.target ?? 0)}<span class="dim small num">${formatInt(x.progress)} / ${formatInt(info?.target ?? 0)}</span></td>
          <td class="r num">${formatInt(x.participants.contributors)} / ${formatInt(x.participants.committed)}</td>
          <td class="r">${info?.isk ? isk(info.isk) : '—'}</td>
          <td class="r num" title="${esc(info?.lpCorp ? cachedName(info.lpCorp) : '')}">${info?.lp ? formatInt(info.lp) : '—'}</td>
          ${mine ? `<td class="r num">${m ? `${formatInt(m.contributed)}${m.is_committed ? ` ${badge(tx('înscris'), 'ok')}` : ''}` : '—'}</td>` : ''}
        </tr>`;
      }).join('')}
      </tbody></table></div>`;
  }

  function renderCampaigns(list: Campaign[], at: number) {
    shownCampaigns = { list, at };
    const sorted = [...list].sort((a, b) => (a.state === 'Active' ? 0 : 1) - (b.state === 'Active' ? 0 : 1) || (b.started ?? '').localeCompare(a.started ?? ''));
    const mineNote = typeof mineObj === 'string' ? (mineObj === 'scope' ? panel({ body: gate('campaigns') }) : mineObj && ctx.character.kind === 'esi' ? panel({ body: alertBox(mineObj, 'warn') }) : '') : '';
    body.innerHTML = `${mineNote}${sorted.length ? sorted.map((c) => {
      const info = data?.campaigns[c.id];
      return panel({
        title: info?.title ?? c.id,
        actions: `${state(CAMPAIGN_STATE, c.state)}${c === sorted[0] ? dataStamp(at, 'data-ops-refresh', { label: tx('Date din {time}'), title: tx('Click pentru a citi din nou din ESI.') }) : ''}`,
        body: `<div class="history-kpis">
            <div><span class="label">${tx('Facțiune')}</span><span class="value">${esc(info?.faction ? cachedName(info.faction) || '—' : '—')}</span></div>
            <div><span class="label">${tx('Progres')}</span><span class="value num">${formatInt(c.progress)} / ${formatInt(info?.target ?? 0)}</span></div>
            <div><span class="label">${tx('Început')}</span><span class="value">${when(c.started)}</span></div>
            <div><span class="label">${tx('Încheiat')}</span><span class="value">${when(c.finished)}</span></div>
          </div>
          ${bar(c.progress, info?.target ?? 0)}
          ${info?.subtitle ? `<p>${esc(info.subtitle)}</p>` : ''}
          ${info?.success ? `<p class="dim small"><b>${tx('Dacă reușește')}:</b> ${esc(info.success)}</p>` : ''}
          ${objectiveTable(c.id)}`,
      });
    }).join('') : panel({ body: emptyState({ title: tx('Nicio campanie militară în ESI acum') }) })}`;
  }

  async function dens() {
    const mine = run;
    const who = esiChar([DENS_SCOPE, MTO_SCOPE]);
    if (who === 'scope') { body.innerHTML = panel({ body: gate('mercenary') }); return; }
    if (typeof who === 'string') { body.innerHTML = panel({ body: alertBox(who || tx('Selectează un caracter importat din EVE (ecranul Caracter).'), 'warn') }); return; }
    body.innerHTML = loader(tx('Citim Mercenary Dens și operațiunile tactice'));
    try {
      const [list, ops, d] = await Promise.all([mercenaryDens(who.id), tacticalOperations(who.id), loadActivities()]);
      const planets = await planetNames(list.map((x) => x.skyhook.planet_id)).catch(() => new Map<number, string>());
      if (mine !== run) return;
      renderDens(list, ops, d, planets);
    } catch (err) {
      if (mine === run) body.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  function renderDens(list: MercenaryDen[], ops: TacticalOperation[], d: Activities, planets: Map<number, string>) {
    const planet = (id: number) => planets.get(id) ?? `#${id}`;
    const denPlanet = new Map(list.map((x) => [x.id, planet(x.skyhook.planet_id)]));
    body.innerHTML = `${panel({
      title: tx('Mercenary Dens'),
      count: list.length,
      body: list.length ? `<div class="table-scroll"><table class="table compact ops-table"><thead><tr><th>${tx('Planetă')}</th><th>${tx('Stare')}</th><th title="${esc(tx('Dezvoltarea crește cu operațiunile tactice terminate și mărește producția de infomorfi.'))}">${tx('Dezvoltare')}</th><th title="${esc(tx('Anarhia crește în timp; la nivel mare apar atacuri NPC asupra den-ului.'))}">${tx('Anarhie')}</th><th class="r">${tx('Infomorfi')}</th><th>${tx('Reinforce până la')}</th></tr></thead><tbody>
        ${list.map((x) => `<tr>
          <td>${esc(planet(x.skyhook.planet_id))}</td>
          <td>${state(DEN_STATE, x.state)}</td>
          <td>${LEVEL(x.evolution.development.level)} <span class="dim small num">${formatInt(x.evolution.development.amount)}</span></td>
          <td>${LEVEL(x.evolution.anarchy.level)} <span class="dim small num">${formatInt(x.evolution.anarchy.amount)}</span></td>
          <td class="r num">${formatInt(x.infomorphs.amount)}</td>
          <td>${x.reinforcement_timer ? when(x.reinforcement_timer.end) : '<span class="dim">—</span>'}</td>
        </tr>`).join('')}
        </tbody></table></div>` : emptyState({ title: tx('Niciun Mercenary Den'), text: tx('Caracterul nu deține niciun Mercenary Den ancorat.') }),
    })}${panel({
      title: tx('Operațiuni tactice (MTO)'),
      count: ops.length,
      body: ops.length ? `<div class="table-scroll"><table class="table compact ops-table"><thead><tr><th>${tx('Operațiune')}</th><th>${tx('Den')}</th><th>${tx('Stare')}</th><th>${tx('Expiră')}</th><th class="r" title="${esc(tx('Efectul asupra den-ului la terminare, din SDE.'))}">${tx('Dezvoltare')}</th><th class="r">${tx('Anarhie')}</th><th class="r">${tx('Infomorfi bonus')}</th></tr></thead><tbody>
        ${[...ops].sort((a, b) => a.expires.localeCompare(b.expires)).map((o) => {
          const info = d.operations[o.dungeon_type_id];
          return `<tr>
            <td><b>${esc(info?.name ?? `#${o.dungeon_type_id}`)}</b>${info?.description ? `<div class="dim small">${esc(info.description)}</div>` : ''}</td>
            <td>${esc(denPlanet.get(o.mercenary_den_id) ?? `#${o.mercenary_den_id}`)}</td>
            <td>${state(MTO_STATE, o.state)}</td>
            <td>${when(o.expires)}</td>
            <td class="r num pos-text">${info ? `+${info.development}` : '—'}</td>
            <td class="r num">${info ? info.anarchy : '—'}</td>
            <td class="r num">${info ? formatInt(info.infomorphs) : '—'}</td>
          </tr>`;
        }).join('')}
        </tbody></table></div>` : emptyState({ title: tx('Nicio operațiune tactică'), text: tx('Operațiunile apar când den-urile tale au misiuni disponibile.') }),
    })}`;
  }

  let hooks: { at: number; list: RaidableSkyhook[] } | null = null;
  let hookMap: NavMap | null = null;
  let hookPlanets = new Map<number, string>();
  let hookSov = new Map<number, SovClaim>();

  async function skyhooks(force = false) {
    const mine = run;
    body.innerHTML = loader(tx('Citim skyhook-urile raidabile'));
    try {
      const [list, map, claims] = await Promise.all([raidableSkyhooks(force), loadMap().catch(() => null), sovereignty().catch(() => new Map<number, SovClaim>())]);
      hooks = list;
      await resolveNames(list.list.map((h) => claims.get(h.systemId)?.id ?? 0).filter(Boolean)).catch(() => null);
      if (mine !== run) return;
      hookMap = map;
      hookSov = claims;
      renderSkyhooks();
      const planets = await planetNames(list.list.map((h) => h.planetId)).catch(() => null);
      if (planets && mine === run) { hookPlanets = planets; renderSkyhooks(); }
    } catch (err) {
      if (mine === run) body.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  function renderSkyhooks() {
    if (!hooks) return;
    const now = Date.now();
    const list = [...hooks.list].sort((a, b) => a.start - b.start);
    const open = list.filter((h) => h.start <= now && h.end > now).length;
    body.innerHTML = panel({
      title: tx('Skyhook-uri raidabile'),
      count: list.length,
      actions: dataStamp(hooks.at, 'data-ops-refresh', { label: tx('Date din {time}'), title: tx('ESI permite puține cereri aici, așa că lista e păstrată 5 minute. Click pentru a o citi din nou.') }),
      body: `<div class="history-kpis">
          <div><span class="label">${tx('Vulnerabile acum')}</span><span class="value">${open}</span></div>
          <div><span class="label">${tx('Următoarele')}</span><span class="value">${list.length - open}</span></div>
        </div>
        <p class="dim small">${tx('Skyhook-uri din null-sec care pot fi jefuite acum sau în curând (ESI). În fereastra de vulnerabilitate poți fura reagenții din skyhook.')}</p>
        ${list.length ? `<div class="table-scroll"><table class="table compact ops-table"><thead><tr><th>${tx('Sistem')}</th><th class="r">Sec</th><th>${tx('Regiune')}</th><th>${tx('Planetă')}</th><th>${tx('Suveran')}</th><th>${tx('Vulnerabil')}</th><th>${tx('Fereastră')}</th></tr></thead><tbody>
        ${list.map((h) => {
          const s = hookMap?.systems.get(h.systemId);
          const c = hookSov.get(h.systemId);
          const live = h.start <= now && h.end > now;
          return `<tr class="${live ? 'risk-hi' : ''}">
            <td><a class="ext-link" href="https://evemaps.dotlan.net/system/${encodeURIComponent(s?.name ?? String(h.systemId))}" target="_blank" rel="noopener noreferrer">${esc(s?.name ?? `#${h.systemId}`)}</a></td>
            <td class="r">${s ? `<span class="num ${secClass(s.sec)}">${formatNum(displaySec(s.sec), 1)}</span>` : '—'}</td>
            <td class="small">${esc(s ? hookMap?.regions.get(s.regionId) ?? '' : '')}</td>
            <td>${esc(hookPlanets.get(h.planetId) ?? '…')}</td>
            <td class="small">${c ? esc(cachedName(c.id) || `#${c.id}`) : '<span class="dim">—</span>'}</td>
            <td>${live ? badge(tx('acum, încă {t}', { t: span(h.end) }), 'danger', true) : badge(until(h.start), 'gold')}</td>
            <td class="dim small nowrap">${clock(h.start)} – ${clock(h.end)}</td>
          </tr>`;
        }).join('')}
        </tbody></table></div>` : emptyState({ title: tx('Niciun skyhook raidabil acum') })}`,
    });
  }

  side.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ops-tab]');
    if (!b) return;
    tab = b.dataset.opsTab as Tab;
    saveJson(TAB_KEY, tab);
    render();
  });

  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-ops-refresh]')) {
      run++;
      if (tab === 'jobs') { details.clear(); jobs(true); } else if (tab === 'campaigns') { objectives.clear(); campaigns(true); } else if (tab === 'skyhooks') skyhooks(true); else dens();
      return;
    }
    const job = t.closest<HTMLElement>('[data-job]');
    if (job) { toggleJob(job.dataset.job!); return; }
    const ob = t.closest<HTMLElement>('[data-ops-objectives]');
    if (ob) {
      const id = ob.dataset.opsObjectives!;
      loadObjectives(id).then(() => { if (tab === 'campaigns') renderCampaigns(shownCampaigns.list, shownCampaigns.at); });
      renderCampaigns(shownCampaigns.list, shownCampaigns.at);
    }
  });

  ctx.onCharacterChange(() => {
    myJobs = null;
    mineObj = null;
    render();
  });

  render();
}
