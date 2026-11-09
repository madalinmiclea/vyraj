import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, formatNum } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { hasScope, loginProblem } from '../character/sso';
import { loyaltyPoints } from '../character/esi';
import { loadMap, displaySec, secClass, type NavMap } from '../services/navigation';
import { loadAgents, STANDING_NEEDED, type AgentData, type Division } from '../services/agents';
import { pveOrigin, originBar, bindOrigin, type Origin } from '../services/pveOrigin';
import { loadNpcStandings, canReadNpcStandings, socialSkills, corpAccess, type NpcStandings } from '../services/npcStandings';
import { fold } from '../ui/fold';
import { tx } from '../i18n';

const STATE_KEY = 'eve-pve:agents';
const LP_SCOPE = 'esi-characters.read_loyalty.v1';
const LIMIT = 80;

type Div = Division | -1;
type Space = 'all' | 'high' | 'low' | 'null';
interface State { level: number; division: Div; faction: number; corp: number; range: number; space: Space; special: boolean; locator: boolean; q: string }

const DIVISIONS: { id: Div; label: string }[] = [
  { id: 2, label: tx('Securitate') },
  { id: 0, label: tx('Distribuție') },
  { id: 1, label: tx('Minerit') },
  { id: -1, label: tx('Toate') },
];
const DIV_NAME: Record<Division, string> = { 0: tx('Distribuție'), 1: tx('Minerit'), 2: tx('Securitate') };
const KIND_NAME: Record<number, string> = { 1: 'Storyline', 2: 'Faction Warfare', 3: 'CONCORD', 4: tx('Eveniment') };
const RANGES = [10, 20, 40, 0];

export function createAgentsPanel(el: HTMLElement, ctx: AppContext) {
  const state: State = { level: 4, division: 2, faction: 0, corp: 0, range: 20, space: 'all', special: false, locator: false, q: '', ...loadJson<Partial<State>>(STATE_KEY, {}) };
  let visible = false;
  let seq = 0;
  let data: AgentData | null = null;
  let map: NavMap | null = null;
  let origin: Origin = { system: null, esi: false, needScope: false };
  const lp = new Map<number, Map<number, number>>();
  let standings: NpcStandings | null = null;

  async function myLp(): Promise<Map<number, number> | null> {
    const c = ctx.character;
    if (loginProblem(c) || !c.characterId || !hasScope(c.characterId, LP_SCOPE)) return null;
    const cached = lp.get(c.characterId);
    if (cached) return cached;
    const list = await loyaltyPoints(c.characterId).catch(() => null);
    if (!list) return null;
    const m = new Map(list.map((x) => [x.corporation_id, x.loyalty_points]));
    lp.set(c.characterId, m);
    return m;
  }

  async function myStandings(): Promise<NpcStandings | null> {
    const c = ctx.character;
    if (loginProblem(c) || !c.characterId || !canReadNpcStandings(c.characterId)) return null;
    return loadNpcStandings(c.characterId).catch(() => null);
  }

  async function load() {
    if (!visible) return;
    const mine = ++seq;
    if (!data) el.innerHTML = panel({ body: loader(tx('Încarc agenții')) });
    try {
      const [d, m] = await Promise.all([loadAgents(), loadMap()]);
      data = d;
      map = m;
      origin = await pveOrigin(ctx, m);
      const [points, st] = await Promise.all([myLp(), myStandings()]);
      if (mine !== seq || !visible) return;
      standings = st;
      render(points);
    } catch (err) {
      if (mine === seq) el.innerHTML = panel({ body: alertBox((err as Error).message, 'danger') });
    }
  }

  function render(points: Map<number, number> | null) {
    if (!data || !map) return;
    const d = data;
    const m = map;
    const dist = origin.system ? m.gateDistances(origin.system.id, state.range || 200) : null;
    const terms = fold(state.q).split(/\s+/).filter(Boolean);
    const factions = [...new Set(d.agents.map((a) => d.corps.get(a.corp)?.faction ?? 0))].filter((f) => f && d.factions.has(f)).sort((a, b) => d.factions.get(a)!.localeCompare(d.factions.get(b)!));
    const corpIds = [...new Set(d.agents.map((a) => a.corp))].filter((c) => d.corps.has(c) && (!state.faction || d.corps.get(c)!.faction === state.faction)).sort((a, b) => d.corps.get(a)!.name.localeCompare(d.corps.get(b)!.name));
    if (state.corp && !corpIds.includes(state.corp)) state.corp = 0;
    const rows = d.agents.filter((a) => {
      if (state.level && a.level !== state.level) return false;
      if (state.division !== -1 && a.division !== state.division) return false;
      if (!state.special && a.kind !== 0) return false;
      if (state.locator && !a.locator) return false;
      const corp = d.corps.get(a.corp);
      if (state.faction && corp?.faction !== state.faction) return false;
      if (state.corp && a.corp !== state.corp) return false;
      const sys = m.systems.get(a.system);
      if (!sys) return false;
      if (state.space !== 'all' && (sys.sec >= 0.45 ? 'high' : sys.sec > 0 ? 'low' : 'null') !== state.space) return false;
      if (dist && !dist.has(a.system)) return false;
      if (terms.length) {
        const hay = fold(`${a.name} ${corp?.name ?? ''} ${sys.name}`);
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    }).map((a) => ({ a, sys: m.systems.get(a.system)!, jumps: dist?.get(a.system) ?? null }))
      .sort((x, y) => (x.jumps ?? 0) - (y.jumps ?? 0) || y.a.level - x.a.level || x.a.name.localeCompare(y.a.name));
    const corpCount = new Set(rows.map((r) => r.a.corp)).size;
    const maxIn = (ok: (corp: number) => boolean) => Math.max(0, ...d.agents.filter((a) => a.kind === 0 && ok(a.corp)).map((a) => a.level));
    const selFaction = state.faction || (d.corps.get(state.corp)?.faction ?? 0);
    const corpLacks = !!state.corp && maxIn((c) => c === state.corp) < state.level;
    const factionLacks = !!selFaction && maxIn((c) => d.corps.get(c)?.faction === selFaction) < state.level;
    const noLevel = !state.level || rows.length ? '' : factionLacks ? tx('Facțiunea nu are agenți L{l}', { l: state.level }) : corpLacks ? tx('Corporația nu are agenți L{l}', { l: state.level }) : '';
    const skills = standings ? socialSkills(ctx.sde, ctx.character) : null;
    const access = (corp: number, faction: number, id: number, level: number) => {
      if (!standings || !skills) return '';
      const acc = corpAccess(standings, skills, corp, faction, id);
      const low = [acc.agent != null && acc.agent <= -2 ? tx('agentul') : '', acc.corp <= -2 ? tx('corporația') : '', acc.faction <= -2 ? tx('facțiunea') : ''].filter(Boolean);
      const tip = acc.blocked ? ` title="${esc(tx('Blocat: {w} sub -2', { w: low.join(', ') }))}"` : '';
      return `<td class="r">${acc.level >= level ? `<span class="badge ok">${tx('Da')}</span>` : `<span class="badge ${acc.blocked ? 'danger' : 'warn'}"${tip}>${tx('Nu')}</span>`}</td>`;
    };
    el.innerHTML = panel({
      title: tx('Agenți de misiuni'),
      count: tx('{n} agenți · {c} corporații', { n: formatInt(rows.length), c: formatInt(corpCount) }),
      body: `${originBar(m, origin, 'agOrigin')}
        <div class="pve-filters">
          <div class="chip-row">${[1, 2, 3, 4, 5, 0].map((l) => `<button class="chip-btn ${l === state.level ? 'active' : ''}" data-ag-level="${l}">${l ? `L${l}` : tx('Toate')}</button>`).join('')}</div>
          <div class="chip-row">${DIVISIONS.map((x) => `<button class="chip-btn ${x.id === state.division ? 'active' : ''}" data-ag-div="${x.id}">${x.label}</button>`).join('')}</div>
          <label>${tx('Facțiune')} <select class="input sm" id="agFaction"><option value="0">${tx('Oricare')}</option>${factions.map((f) => `<option value="${f}" ${f === state.faction ? 'selected' : ''}>${esc(d.factions.get(f)!)}</option>`).join('')}</select></label>
          <label>${tx('Corporație')} <select class="input sm" id="agCorp"><option value="0">${tx('Oricare')}</option>${corpIds.map((c) => `<option value="${c}" ${c === state.corp ? 'selected' : ''}>${esc(d.corps.get(c)!.name)}</option>`).join('')}</select></label>
          <label>${tx('Spațiu')} <select class="input sm" id="agSpace">${(['all', 'high', 'low', 'null'] as Space[]).map((s) => `<option value="${s}" ${s === state.space ? 'selected' : ''}>${s === 'all' ? tx('Oricare') : s === 'high' ? 'Highsec' : s === 'low' ? 'Lowsec' : 'Nullsec'}</option>`).join('')}</select></label>
          <label>${tx('Distanță')} <select class="input sm" id="agRange" ${origin.system ? '' : 'disabled'}>${RANGES.map((r) => `<option value="${r}" ${r === state.range ? 'selected' : ''}>${r ? tx('{n} salturi', { n: r }) : tx('Oricât')}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" id="agLocator" ${state.locator ? 'checked' : ''} /> ${tx('Doar locatori')}</label>
          <label class="check"><input type="checkbox" id="agSpecial" ${state.special ? 'checked' : ''} /> ${tx('Și agenți speciali')}</label>
          <label class="field"><input class="input sm" id="agSearch" placeholder="${esc(tx('Caută agent, corporație sau sistem'))}" value="${esc(state.q)}" /></label>
        </div>
        <p class="dim small wallet-note">${state.level ? tx('Pentru agenții L{l} ai nevoie de standing efectiv cel puțin {s} la agent, la corporația sau la facțiunea lui.', { l: state.level, s: formatNum(STANDING_NEEDED[state.level], 1) }) : tx('Standing necesar: L2 1.0, L3 3.0, L4 5.0, L5 7.0 la agent, la corporația sau la facțiunea lui.')}</p>
        ${rows.length ? `<div class="wallet-scroll tall"><table class="table compact"><thead><tr><th>${tx('Agent')}</th><th>${tx('Corporație')}</th><th class="r">${tx('Nivel')}</th><th>${tx('Diviziune')}</th><th>${tx('Sistem')}</th>${dist ? `<th class="r">${tx('Salturi')}</th>` : ''}${points ? `<th class="r">${tx('LP-ul tău')}</th>` : ''}${standings ? `<th class="r">${tx('Acces')}</th>` : ''}</tr></thead><tbody>
          ${rows.slice(0, LIMIT).map(({ a, sys, jumps }) => {
            const corp = d.corps.get(a.corp);
            const st = a.station ? d.stations.get(a.station) : null;
            const tags = `${a.locator ? ` <span class="badge accent">${tx('Locator')}</span>` : ''}${a.kind ? ` <span class="badge gold">${esc(KIND_NAME[a.kind] ?? '')}</span>` : ''}`;
            return `<tr><td><span class="recon-ship"><img class="row-icon" src="https://images.evetech.net/characters/${a.id}/portrait?size=32" alt="" loading="lazy" /><span>${esc(a.name)}</span></span>${tags}</td>
              <td><span class="recon-ship"><img class="row-icon" src="https://images.evetech.net/corporations/${a.corp}/logo?size=32" alt="" loading="lazy" /><span>${esc(corp?.name ?? '')}</span></span><div class="small dim">${esc(d.factions.get(corp?.faction ?? 0) ?? '')}</div></td>
              <td class="r num">L${a.level}</td><td class="dim">${DIV_NAME[a.division]}</td>
              <td>${esc(sys.name)} <span class="sec ${secClass(sys.sec)}">${displaySec(sys.sec).toFixed(1)}</span><div class="small dim">${esc(m.region(sys))}${st ? ` · ${esc(sys.name)} ${esc(st.where)}` : ` · ${tx('în spațiu')}`}</div></td>
              ${dist ? `<td class="r num">${jumps}</td>` : ''}${points ? `<td class="r num ${points.get(a.corp) ? '' : 'dim'}">${points.get(a.corp) ? formatInt(points.get(a.corp)!) : '—'}</td>` : ''}${access(a.corp, corp?.faction ?? 0, a.id, a.level)}</tr>`;
          }).join('')}
        </tbody></table></div>${rows.length > LIMIT ? `<p class="dim small">${tx('Se văd primii {n}, cei mai apropiați.', { n: LIMIT })}</p>` : ''}` : `<p class="dim">${noLevel || tx('Niciun agent nu se potrivește cu filtrele alese.')}</p>`}`,
    });
    bindOrigin(el, m, 'agOrigin', load);
    const search = el.querySelector<HTMLInputElement>('#agSearch');
    let t = 0;
    search?.addEventListener('input', () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        state.q = search.value;
        save();
        const pos = search.selectionStart;
        render(points);
        const next = el.querySelector<HTMLInputElement>('#agSearch');
        next?.focus();
        if (next && pos != null) next.setSelectionRange(pos, pos);
      }, 200);
    });
  }

  const save = () => saveJson(STATE_KEY, state);

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const lv = t.closest<HTMLElement>('[data-ag-level]');
    if (lv) { state.level = Number(lv.dataset.agLevel); save(); load(); return; }
    const dv = t.closest<HTMLElement>('[data-ag-div]');
    if (dv) { state.division = Number(dv.dataset.agDiv) as Div; save(); load(); }
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'agFaction') { state.faction = Number(t.value); state.corp = 0; }
    else if (t.id === 'agCorp') state.corp = Number(t.value);
    else if (t.id === 'agSpace') state.space = t.value as Space;
    else if (t.id === 'agRange') state.range = Number(t.value);
    else if (t.id === 'agLocator') state.locator = t.checked;
    else if (t.id === 'agSpecial') state.special = t.checked;
    else return;
    save();
    load();
  });

  ctx.onCharacterChange(() => { if (visible) load(); });

  return {
    focus(corp: number, faction: number, level: number) {
      Object.assign(state, { corp, faction, level, division: -1 as Div, range: 0, space: 'all' as Space, q: '', special: false, locator: false });
      save();
    },
    show() { visible = true; load(); },
    hide() { visible = false; seq++; },
  };
}
