import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, compactISK, emptyState, badge, dataStamp } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { typeIconUrl } from '../services/market';
import { universeNames } from '../character/esi';
import { loginProblem } from '../character/sso';
import { permissionGate } from '../character/permissions';
import { ACTIVITY } from '../services/industry';
import { corpJobsAccess, corpJobs, JOB_ROLES, type CorpJob } from '../services/corpIndustry';
import { tx, locale } from '../i18n';

type Status = 'active' | 'ready' | 'done' | 'all';

interface Ui { status: Status; activity: number; installer: number }

const UI_KEY = 'eve-industry:corp';
const ROWS = 300;

const STATUS = (): { id: Status; label: string }[] => [
  { id: 'active', label: tx('În lucru') },
  { id: 'ready', label: tx('Gata de livrat') },
  { id: 'done', label: tx('Terminate') },
  { id: 'all', label: tx('Toate') },
];

const left = (j: CorpJob) => (new Date(j.end_date).getTime() - Date.now()) / 1000;
const finished = (j: CorpJob) => j.status === 'delivered' || j.status === 'cancelled' || j.status === 'reverted';
const isReady = (j: CorpJob) => !finished(j) && (j.status === 'ready' || (j.status === 'active' && left(j) <= 0));
const isRunning = (j: CorpJob) => !finished(j) && !isReady(j);

function span(s: number) {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')} min`;
  return `${Math.floor(s / 86400)} z ${Math.floor((s % 86400) / 3600)} h`;
}

const when = (iso: string) => new Date(iso).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function createCorpJobsPanel(pane: HTMLElement, ctx: AppContext, nameOf: (id: number) => string, setStamp: (html: string) => void) {
  const ui: Ui = { status: 'active', activity: 0, installer: 0, ...loadJson<Partial<Ui>>(UI_KEY, {}) };
  const names = new Map<number, string>();
  let seq = 0;
  let fresh = false;

  pane.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-corp-status]');
    if (!b) return;
    ui.status = b.dataset.corpStatus as Status;
    saveJson(UI_KEY, ui);
    render();
  });
  pane.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.name === 'activity') ui.activity = Number(t.value) || 0;
    else if (t.name === 'installer') ui.installer = Number(t.value) || 0;
    else return;
    saveJson(UI_KEY, ui);
    render();
  });

  function refresh() {
    fresh = true;
    render();
  }

  async function render() {
    const id = ++seq;
    const alive = () => id === seq;
    const c = ctx.character;
    const problem = loginProblem(c);
    setStamp('');
    if (problem || !c.characterId) { pane.innerHTML = panel({ body: alertBox(problem || tx('Selectează un caracter importat din EVE (ecranul Caracter).')) }); return; }
    const who = c.characterId;
    pane.innerHTML = loader(tx('Citesc joburile corporației'));
    let access;
    try { access = await corpJobsAccess(who); } catch (err) { if (alive()) pane.innerHTML = panel({ body: alertBox((err as Error).message) }); return; }
    if (!alive()) return;
    if (access.state === 'scope') { pane.innerHTML = panel({ body: permissionGate('corpindustry', who, c.name) }); return; }
    if (access.state === 'npc') { pane.innerHTML = panel({ body: emptyState({ title: tx('Corporație NPC'), text: tx('Caracterul e într-o corporație NPC, care nu are joburi de industrie vizibile pentru jucători.') }) }); return; }
    if (access.state === 'role') {
      pane.innerHTML = panel({ body: emptyState({ title: tx('Lipsește rolul în corporație'), text: tx('Joburile corporației se văd doar cu unul dintre rolurile: {roles}. Rolurile tale: {mine}.', { roles: JOB_ROLES.join(', ').replace(/_/g, ' '), mine: access.roles.length ? access.roles.join(', ').replace(/_/g, ' ') : tx('niciunul') }) }) });
      return;
    }
    const completed = ui.status === 'done' || ui.status === 'all';
    const req = corpJobs(who, access.corporationId, completed, fresh);
    fresh = false;
    let jobs: CorpJob[];
    try { jobs = await req.jobs; } catch (err) { if (alive()) pane.innerHTML = panel({ body: alertBox((err as Error).message) }); return; }
    if (!alive()) return;
    const missing = [...new Set(jobs.flatMap((j) => [j.installer_id, j.facility_id, j.location_id]))].filter((x) => x && !names.has(x));
    if (missing.length) {
      const got = await universeNames(missing, who).catch(() => new Map<number, string>());
      for (const [k, v] of got) names.set(k, v);
      if (!alive()) return;
    }
    setStamp(dataStamp(req.at, 'data-corp-jobs', { label: tx('Date din {time}'), title: tx('Click pentru a citi din nou joburile corporației.') }));
    draw(jobs);
  }

  function draw(jobs: CorpJob[]) {
    const running = jobs.filter(isRunning);
    const ready = jobs.filter(isReady);
    const paused = running.filter((j) => j.status === 'paused');
    const done = jobs.filter(finished);
    const open = [...running, ...ready];
    const cost = open.reduce((a, j) => a + (j.cost ?? 0), 0);
    const byStatus = ui.status === 'active' ? running : ui.status === 'ready' ? ready : ui.status === 'done' ? done : jobs;
    const activities = [...new Set(jobs.map((j) => j.activity_id))].sort((a, b) => a - b);
    const installers = [...new Set(jobs.map((j) => j.installer_id))].sort((a, b) => who(a).localeCompare(who(b)));
    const list = byStatus
      .filter((j) => !ui.activity || j.activity_id === ui.activity)
      .filter((j) => !ui.installer || j.installer_id === ui.installer)
      .sort((a, b) => (ui.status === 'done' ? (b.completed_date ?? b.end_date).localeCompare(a.completed_date ?? a.end_date) : a.end_date.localeCompare(b.end_date)));

    const members = new Map<number, { running: number; ready: number; next: number; cost: number }>();
    for (const j of open) {
      const m = members.get(j.installer_id) ?? { running: 0, ready: 0, next: Infinity, cost: 0 };
      if (isReady(j)) m.ready++;
      else { m.running++; m.next = Math.min(m.next, left(j)); }
      m.cost += j.cost ?? 0;
      members.set(j.installer_id, m);
    }
    const memberRows = [...members].sort((a, b) => b[1].ready - a[1].ready || a[1].next - b[1].next);

    pane.innerHTML = `${panel({
      body: `<div class="history-kpis">
          <div><span class="label">${tx('În lucru')}</span><span class="value accent">${formatInt(running.length)}</span></div>
          <div><span class="label">${tx('Gata de livrat')}</span><span class="value ${ready.length ? 'up' : ''}">${formatInt(ready.length)}</span></div>
          <div><span class="label">${tx('Pe pauză')}</span><span class="value">${formatInt(paused.length)}</span></div>
          <div><span class="label">${tx('Cost joburi deschise')}</span><span class="value">${compactISK(cost)}</span></div>
          <div><span class="label">${tx('Membri cu joburi')}</span><span class="value">${formatInt(members.size)}</span></div>
        </div>
        <div class="corp-jobs-filters">
          <div class="advice-sort">${STATUS().map((s) => `<button type="button" class="chip-btn ${ui.status === s.id ? 'active' : ''}" data-corp-status="${s.id}">${s.label}</button>`).join('')}</div>
          <label>${tx('Activitate')}<select class="input" name="activity"><option value="0">${tx('Toate')}</option>${activities.map((a) => `<option value="${a}" ${ui.activity === a ? 'selected' : ''}>${esc(ACTIVITY[a] ?? `#${a}`)}</option>`).join('')}</select></label>
          <label>${tx('Membru')}<select class="input" name="installer"><option value="0">${tx('Toți')}</option>${installers.map((i) => `<option value="${i}" ${ui.installer === i ? 'selected' : ''}>${esc(who(i))}</option>`).join('')}</select></label>
        </div>`,
    })}
    ${memberRows.length ? panel({
      title: tx('Pe membri'),
      count: memberRows.length,
      body: `<div class="table-scroll"><table class="table compact ind-table"><thead><tr><th>${tx('Membru')}</th><th class="r">${tx('În lucru')}</th><th class="r">${tx('Gata de livrat')}</th><th class="r">${tx('Următorul gata în')}</th><th class="r">${tx('Cost')}</th></tr></thead><tbody>
        ${memberRows.map(([id, m]) => `<tr class="clickable" data-corp-member="${id}"><td>${esc(who(id))}</td><td class="r num">${formatInt(m.running)}</td><td class="r num ${m.ready ? 'up' : ''}">${formatInt(m.ready)}</td><td class="r num">${Number.isFinite(m.next) ? span(m.next) : '—'}</td><td class="r num">${compactISK(m.cost)}</td></tr>`).join('')}
      </tbody></table></div>`,
    }) : ''}
    ${panel({
      title: tx('Joburi'),
      count: list.length,
      body: list.length ? `<div class="table-scroll"><table class="table compact ind-table"><thead><tr><th>${tx('Activitate')}</th><th>Blueprint</th><th>${tx('Produs')}</th><th class="r">${tx('Run-uri')}</th><th>${tx('Membru')}</th><th>${tx('Locație')}</th><th>${tx('Stare')}</th><th class="r">${ui.status === 'done' ? tx('Terminat') : tx('Gata în')}</th><th class="r">${tx('Cost')}</th></tr></thead><tbody>
          ${list.slice(0, ROWS).map(row).join('')}
        </tbody></table></div>` : emptyState({ title: tx('Niciun job'), text: ui.status === 'done' ? '' : tx('Joburile pornite în joc apar aici după câteva minute (ESI le actualizează periodic).') }),
    })}`;
  }

  pane.addEventListener('click', (e) => {
    const m = (e.target as HTMLElement).closest<HTMLElement>('[data-corp-member]');
    if (!m) return;
    const id = Number(m.dataset.corpMember);
    ui.installer = ui.installer === id ? 0 : id;
    saveJson(UI_KEY, ui);
    render();
  });

  function who(id: number) {
    return names.get(id) ?? `#${id}`;
  }

  function place(j: CorpJob) {
    const id = j.facility_id || j.location_id;
    return names.get(id) ?? names.get(j.location_id) ?? tx('Structură fără acces');
  }

  function state(j: CorpJob) {
    if (j.status === 'delivered') return badge(tx('Livrat'), 'ok');
    if (j.status === 'cancelled') return badge(tx('Anulat'), 'warn');
    if (j.status === 'reverted') return badge(tx('Revocat'), 'warn');
    if (isReady(j)) return badge(tx('Gata'), 'ok');
    if (j.status === 'paused') return badge(tx('Pe pauză'), 'warn');
    return esc(tx('În lucru'));
  }

  function row(j: CorpJob) {
    const end = finished(j) ? when(j.completed_date ?? j.end_date) : isReady(j) || left(j) <= 0 ? '—' : span(left(j));
    const product = j.product_type_id && j.product_type_id !== j.blueprint_type_id ? esc(nameOf(j.product_type_id)) : '—';
    const runs = j.successful_runs != null && finished(j) && j.successful_runs !== j.runs ? `${formatInt(j.successful_runs)} / ${formatInt(j.runs)}` : formatInt(j.runs);
    return `<tr><td>${esc(ACTIVITY[j.activity_id] ?? `#${j.activity_id}`)}</td><td><img class="row-icon" src="${typeIconUrl(j.blueprint_type_id, 32, ' Blueprint')}" alt="" />${esc(nameOf(j.blueprint_type_id))}</td><td>${product}</td><td class="r num">${runs}</td><td>${esc(who(j.installer_id))}</td><td class="small">${esc(place(j))}</td><td>${state(j)}</td><td class="r num">${end}</td><td class="r num">${j.cost ? compactISK(j.cost) : '—'}</td></tr>`;
  }

  return { render, refresh };
}
