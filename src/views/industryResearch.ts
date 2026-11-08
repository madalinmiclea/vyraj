import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, formatNum, compactISK, emptyState, badge, dataStamp } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { fetchPrices, forgetPrices, pricesAt, typeIconUrl, type Aggregates } from '../services/market';
import { agentsResearch, universeNames, type AgentResearch } from '../character/esi';
import { hasScope, loginProblem } from '../character/sso';
import { permissionGate } from '../character/permissions';
import { loadAgents, type AgentData, type ResearchAgent } from '../services/agents';
import { loadMap, displaySec, secClass, type NavMap } from '../services/navigation';
import { pveOrigin, originBar, bindOrigin, type Origin } from '../services/pveOrigin';
import { loadNpcStandings, canReadNpcStandings, socialSkills, effective, type NpcStandings, type SocialSkills } from '../services/npcStandings';
import { fold } from '../ui/fold';
import { loadItems } from '../data/items';
import { roman } from '../ui/itemInfo';
import { tx } from '../i18n';

const RD_SCOPE = 'esi-characters.read_agents_research.v1';
const UI_KEY = 'eve-industry:research';
const RP_PER_CORE = 100;
const ISK_PER_CORE = 10_000;
const NEED: Record<number, number> = { 1: -2, 2: 1, 3: 3, 4: 5 };
const ROWS = 80;

interface Ui { level: number; field: number; only: boolean; q: string }

interface Pick { field: number; rp: number; isk: number }

export function createResearchPanel(pane: HTMLElement, ctx: AppContext, setStamp: (html: string) => void) {
  const ui: Ui = { level: 4, field: 0, only: false, q: '', ...loadJson<Partial<Ui>>(UI_KEY, {}) };
  const save = () => saveJson(UI_KEY, ui);
  const names = new Map<number, string>();
  let seq = 0;
  let fresh = false;
  let data: AgentData | null = null;
  let map: NavMap | null = null;
  let origin: Origin = { system: null, esi: false, needScope: false };
  let mine: AgentResearch[] | null = null;
  let mineError = '';
  let standings: NpcStandings | null = null;
  let prices = new Map<number, Aggregates>();
  let cores: number[] = [];
  let coreIds = new Map<string, number>();

  const level = (id: number | undefined) => (id ? ctx.character.skills.get(id) ?? 0 : 0);
  const skillId = (name: string) => ctx.sde.findType(name)?.id;
  const skillName = (id: number) => ctx.sde.types.get(id)?.name ?? `#${id}`;
  const coreOf = (field: number) => coreIds.get(`Datacore - ${skillName(field).replace('Amarr Starship', 'Amarrian Starship').replace('Gallente Starship', 'Gallentean Starship')}`);
  const corePrice = (field: number) => {
    const id = coreOf(field);
    return id ? prices.get(id)?.sellMin ?? 0 : 0;
  };
  const iskPerRp = (field: number) => Math.max(0, corePrice(field) - ISK_PER_CORE) / RP_PER_CORE;

  async function render() {
    const id = ++seq;
    const alive = () => id === seq;
    pane.innerHTML = loader(tx('Încarc agenții R&D'));
    try {
      const [d, m, items] = await Promise.all([loadAgents(), loadMap(), loadItems()]);
      coreIds = new Map(items.filter((i) => i.n.startsWith('Datacore - ')).map((i) => [i.n, i.t]));
      data = d;
      map = m;
      origin = await pveOrigin(ctx, m);
      const c = ctx.character;
      const logged = !loginProblem(c) && !!c.characterId;
      mine = null;
      mineError = '';
      const jobs: Promise<unknown>[] = [];
      if (logged && hasScope(c.characterId!, RD_SCOPE)) jobs.push(agentsResearch(c.characterId!).then((r) => { mine = r; }).catch((e) => { mineError = (e as Error).message; }));
      jobs.push((logged && canReadNpcStandings(c.characterId!) ? loadNpcStandings(c.characterId!).catch(() => null) : Promise.resolve(null)).then((s) => { standings = s; }));
      await Promise.all(jobs);
      cores = [...new Set(d.rd.flatMap((a) => a.fields).map(coreOf).filter((x): x is number => !!x))];
      prices = await fetchPrices(cores, { fresh });
      fresh = false;
      const unknown = ((mine as AgentResearch[] | null) ?? []).map((r) => r.agent_id).filter((a) => !d.rd.some((x) => x.id === a) && !names.has(a));
      if (unknown.length) for (const [k, v] of await universeNames(unknown).catch(() => new Map<number, string>())) names.set(k, v);
      if (!alive()) return;
      setStamp(dataStamp(pricesAt(cores), 'data-rd-prices'));
      draw();
    } catch (err) {
      if (alive()) pane.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  function refresh() {
    if (cores.length) forgetPrices(cores);
    fresh = true;
    render();
  }

  function draw() {
    if (!data || !map) return;
    const d = data;
    const m = map;
    const c = ctx.character;
    const logged = !loginProblem(c) && !!c.characterId;
    const skills: SocialSkills = socialSkills(ctx.sde, c);
    const negotiation = level(skillId('Negotiation'));
    const slots = 1 + level(skillId('Research Project Management'));
    const science = level(skillId('Science'));
    const byId = new Map(d.rd.map((a) => [a.id, a]));
    const factionOf = (corp: number) => d.corps.get(corp)?.faction ?? 0;
    const agentStanding = (a: ResearchAgent) => (standings ? effective(standings.agent.get(a.id), factionOf(a.corp), skills) : 0);
    const rpDay = (a: ResearchAgent, field: number) => {
      const sk = level(field);
      return sk ? (1 + (20 + 5 * negotiation + agentStanding(a)) / 100) * (sk + a.level) ** 2 : 0;
    };
    const pick = (a: ResearchAgent): Pick => {
      const list = ui.field ? a.fields.filter((f) => f === ui.field) : a.fields;
      return list.map((f) => { const rp = rpDay(a, f); return { field: f, rp, isk: rp * iskPerRp(f) }; }).sort((x, y) => y.isk - x.isk || y.rp - x.rp)[0] ?? { field: 0, rp: 0, isk: 0 };
    };
    const access = (a: ResearchAgent) => {
      if (!standings) return null;
      const f = factionOf(a.corp);
      const corp = effective(standings.corp.get(a.corp), f, skills);
      const faction = effective(standings.faction.get(f), f, skills);
      const agent = effective(standings.agent.get(a.id), f, skills);
      const need = NEED[a.level] ?? 5;
      const low = a.level > 1 && [corp, faction, agent].some((x) => x <= -2);
      const ok = !low && corp >= need - 2 && Math.max(corp, faction, agent) >= need;
      const tip = [`${tx('Corporația')}: ${formatNum(corp, 2)} / ${formatNum(need - 2, 2)}`, `${tx('Cel mai bun dintre agent, corporație, facțiune')}: ${formatNum(Math.max(corp, faction, agent), 2)} / ${formatNum(need, 2)}`].join('\n');
      return { ok, tip };
    };
    const corpName = (id: number) => d.corps.get(id)?.name ?? `#${id}`;
    const where = (a: { system: number; station: number }) => {
      const sys = m.systems.get(a.system);
      if (!sys) return '—';
      const st = a.station ? d.stations.get(a.station) : null;
      return `${esc(sys.name)} <span class="sec ${secClass(sys.sec)}">${displaySec(sys.sec).toFixed(1)}</span><div class="small dim">${esc(m.region(sys))}${st ? ` · ${esc(sys.name)} ${esc(st.where)}` : ''}</div>`;
    };
    const whereShort = (a: { system: number }) => {
      const sys = m.systems.get(a.system);
      return sys ? `<span title="${esc(m.region(sys))}">${esc(sys.name)} <span class="sec ${secClass(sys.sec)}">${displaySec(sys.sec).toFixed(1)}</span></span>` : '—';
    };
    const portrait = (id: number) => `<img class="row-icon" src="https://images.evetech.net/characters/${id}/portrait?size=32" alt="" loading="lazy" />`;
    const coreCell = (field: number) => {
      const id = coreOf(field);
      return `<span class="recon-ship">${id ? `<img class="row-icon" src="${typeIconUrl(id, 32)}" alt="" loading="lazy" />` : ''}<span>${esc(skillName(field))}</span></span>`;
    };

    let active = '';
    if (!logged) active = '';
    else if (!hasScope(c.characterId!, RD_SCOPE)) active = panel({ title: tx('Cercetările tale'), body: permissionGate('research', c.characterId!, c.name) });
    else if (mineError) active = panel({ title: tx('Cercetările tale'), body: alertBox(mineError) });
    else {
      const now = Date.now();
      const list = (mine ?? []).map((r) => {
        const a = byId.get(r.agent_id);
        const days = Math.max(0, (now - new Date(r.started_at).getTime()) / 86_400_000);
        const points = r.remainder_points + r.points_per_day * days;
        const n = Math.floor(points / RP_PER_CORE);
        return { r, a, points, n, value: n * Math.max(0, corePrice(r.skill_type_id) - ISK_PER_CORE), daily: r.points_per_day * iskPerRp(r.skill_type_id) };
      }).sort((x, y) => y.daily - x.daily);
      const rpTotal = list.reduce((s, x) => s + x.r.points_per_day, 0);
      const iskTotal = list.reduce((s, x) => s + x.daily, 0);
      const ready = list.reduce((s, x) => s + x.value, 0);
      active = panel({
        title: tx('Cercetările tale'),
        count: `${formatInt(list.length)} / ${formatInt(slots)}`,
        body: `<div class="history-kpis">
            <div><span class="label">${tx('Agenți folosiți')}</span><span class="value accent">${formatInt(list.length)} / ${formatInt(slots)}</span></div>
            <div><span class="label">${tx('RP pe zi')}</span><span class="value">${formatNum(rpTotal, 1)}</span></div>
            <div><span class="label">${tx('Datacore-uri pe zi')}</span><span class="value">${formatNum(rpTotal / RP_PER_CORE, 2)}</span></div>
            <div><span class="label">${tx('ISK pe zi')}</span><span class="value up">${compactISK(iskTotal)}</span></div>
            <div><span class="label">${tx('Gata de luat')}</span><span class="value">${compactISK(ready)}</span></div>
          </div>
          ${list.length ? `<div class="table-scroll"><table class="table compact ind-table"><thead><tr><th>${tx('Agent')}</th><th>${tx('Corporație')}</th><th class="r">${tx('Nivel')}</th><th>${tx('Domeniu')}</th><th class="r">${tx('RP pe zi')}</th><th class="r">${tx('RP strânse')}</th><th class="r">${tx('Datacore-uri')}</th><th class="r">${tx('Valoare')}</th><th class="r">${tx('ISK pe zi')}</th><th>${tx('Sistem')}</th></tr></thead><tbody>
            ${list.map(({ r, a, points, n, value, daily }) => `<tr><td><span class="recon-ship">${portrait(r.agent_id)}<span>${esc(a?.name ?? names.get(r.agent_id) ?? `#${r.agent_id}`)}</span></span></td><td>${a ? esc(corpName(a.corp)) : '—'}</td><td class="r num">${a ? `L${a.level}` : '—'}</td><td>${coreCell(r.skill_type_id)}</td><td class="r num">${formatNum(r.points_per_day, 2)}</td><td class="r num">${formatInt(Math.floor(points))}</td><td class="r num ${n ? 'up' : 'dim'}">${formatInt(n)}</td><td class="r num">${value ? compactISK(value) : '—'}</td><td class="r num">${compactISK(daily)}</td><td>${a ? where(a) : '—'}</td></tr>`).join('')}
          </tbody></table></div>` : emptyState({ title: tx('Nicio cercetare activă'), text: tx('Pornești o cercetare din fereastra agentului R&D, în joc.') })}`,
      });
    }

    const fields = [...new Set(d.rd.flatMap((a) => a.fields))].sort((x, y) => skillName(x).localeCompare(skillName(y)));
    if (ui.field && !fields.includes(ui.field)) ui.field = 0;
    const dist = origin.system ? m.gateDistances(origin.system.id, 200) : null;
    const terms = fold(ui.q).split(/\s+/).filter(Boolean);
    const rows = d.rd.filter((a) => {
      if (ui.level && a.level !== ui.level) return false;
      if (ui.field && !a.fields.includes(ui.field)) return false;
      if (terms.length) {
        const hay = fold(`${a.name} ${corpName(a.corp)} ${m.systems.get(a.system)?.name ?? ''}`);
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    }).map((a) => ({ a, p: pick(a), acc: access(a), jumps: dist?.get(a.system) ?? null }))
      .filter((r) => !ui.only || !r.acc || r.acc.ok)
      .sort((x, y) => y.p.isk - x.p.isk || y.p.rp - x.p.rp || (x.jumps ?? 999) - (y.jumps ?? 999));

    const finder = panel({
      title: tx('Găsește agenți R&D'),
      count: formatInt(rows.length),
      body: `${originBar(m, origin, 'rdOrigin')}
        <div class="corp-jobs-filters">
          <div class="advice-sort">${[1, 2, 3, 4, 0].map((l) => `<button type="button" class="chip-btn ${ui.level === l ? 'active' : ''}" data-rd-level="${l}">${l ? `L${l}` : tx('Toate')}</button>`).join('')}</div>
          <label>${tx('Domeniu')}<select class="input" name="rdField"><option value="0">${tx('Toate')}</option>${fields.map((f) => `<option value="${f}" ${ui.field === f ? 'selected' : ''}>${esc(skillName(f))} (${level(f) ? roman(level(f)) : '0'})</option>`).join('')}</select></label>
          ${standings ? `<label class="check"><input type="checkbox" name="rdOnly" ${ui.only ? 'checked' : ''} /> ${tx('Doar cu acces')}</label>` : ''}
          <label class="field"><input class="input sm" id="rdSearch" placeholder="${esc(tx('Caută agent, corporație sau sistem'))}" value="${esc(ui.q)}" /></label>
        </div>
        ${science < 5 ? `<p class="small dim">${tx('Agenții R&D cer Science V.')}</p>` : ''}
        ${rows.length ? `<div class="table-scroll"><table class="table compact ind-table"><thead><tr><th>${tx('Agent')}</th><th>${tx('Corporație')}</th><th class="r">${tx('Nivel')}</th><th>${tx('Domeniu')}</th><th>${tx('Sistem')}</th>${dist ? `<th class="r">${tx('Salturi')}</th>` : ''}<th class="r">${tx('RP pe zi')}</th><th class="r">${tx('ISK pe zi')}</th>${standings ? `<th class="r">${tx('Acces')}</th>` : ''}</tr></thead><tbody>
          ${rows.slice(0, ROWS).map(({ a, p, acc, jumps }) => `<tr><td><span class="recon-ship">${portrait(a.id)}<span>${esc(a.name)}</span></span></td><td>${esc(corpName(a.corp))}</td><td class="r num">L${a.level}</td>
            <td title="${esc(a.fields.map((f) => `${skillName(f)} ${level(f) ? roman(level(f)) : '0'}`).join('\n'))}">${p.field ? `${esc(skillName(p.field))} <span class="${level(p.field) ? 'dim' : 'neg'}">${level(p.field) ? roman(level(p.field)) : '0'}</span>` : '—'}${a.fields.length > 1 && !ui.field ? ` <span class="small dim">+${a.fields.length - 1}</span>` : ''}</td>
            <td>${whereShort(a)}</td>${dist ? `<td class="r num">${jumps ?? '—'}</td>` : ''}
            <td class="r num">${p.rp ? formatNum(p.rp, 1) : '—'}</td><td class="r num">${p.isk ? compactISK(p.isk) : '—'}</td>
            ${acc ? `<td class="r">${acc.ok ? `<span title="${esc(acc.tip)}">${badge(tx('Da'), 'ok')}</span>` : `<span title="${esc(acc.tip)}">${badge(tx('Nu'), 'warn')}</span>`}</td>` : ''}</tr>`).join('')}
        </tbody></table></div>${rows.length > ROWS ? `<p class="dim small">${tx('Se văd primii {n}.', { n: ROWS })}</p>` : ''}` : emptyState({ title: tx('Niciun agent nu se potrivește cu filtrele alese.') })}
        <p class="small dim">${tx('RP pe zi = (1 + (20 + 5 × Negotiation + standing agent) / 100) × (skill domeniu + nivel agent)². Un datacore costă {rp} RP și {isk} ISK.', { rp: RP_PER_CORE, isk: formatInt(ISK_PER_CORE) })}</p>`,
    });

    pane.innerHTML = `${active}${finder}`;
    bindOrigin(pane, m, 'rdOrigin', render);
    const search = pane.querySelector<HTMLInputElement>('#rdSearch');
    let t = 0;
    search?.addEventListener('input', () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        ui.q = search.value;
        save();
        const pos = search.selectionStart;
        draw();
        const next = pane.querySelector<HTMLInputElement>('#rdSearch');
        next?.focus();
        if (next && pos != null) next.setSelectionRange(pos, pos);
      }, 200);
    });
  }

  pane.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rd-level]');
    if (!b) return;
    ui.level = Number(b.dataset.rdLevel);
    save();
    draw();
  });
  pane.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'rdField') ui.field = Number(t.value) || 0;
    else if (t.name === 'rdOnly') ui.only = t.checked;
    else return;
    save();
    draw();
  });

  return { render, refresh };
}
