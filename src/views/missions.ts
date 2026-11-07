import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, windowTitle, emptyState, button } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { createToolPanel } from './tools';
import { createPveActivityPanel } from './pveActivity';
import { createIncursionsPanel } from './incursions';
import { createRattingPanel } from './pveRatting';
import { createAnomaliesPanel } from './pveAnomalies';
import { createAgentsPanel } from './pveAgents';
import { createStandingsPanel } from './pveStandings';
import { createEscalationsPanel } from './pveEscalations';
import { createAbyssGuidePanel } from './pveAbyss';
import { tx, lang } from '../i18n';
import { fold } from '../ui/fold';
import { canLoadCharge, type Fit } from '../engine/fit';
import { CURRENT_KEY } from '../fitting/shared';
import { Category } from '../data/sde';
import {
  loadMissions, pick, pickList, faction, sectionOf, intensities, dealtOf, weakOf, ewarOf, empiresOf, hasBlitz, searchText,
  SECTIONS, INTENSITY, CLASS_LABEL, FLAG_LABEL, EWAR_LABEL, EMPIRES, ES_URL, EU_URL, FACTIONS, INFO_LABEL, NPC_HEAD,
  type Mission, type MVariant, type MRoom, type MRow, type Dmg, type Section, type Intensity,
} from '../services/missions';

const STATE_KEY = 'eve-missions:state';

type MisTool = 'activity' | 'incursions' | 'ratting' | 'anomalies' | 'agents' | 'standings' | 'escalations' | 'abyss' | 'abyssal' | 'lp';
type OwnTool = Exclude<MisTool, 'abyssal' | 'lp'>;

const MIS_TOOLS: { id: MisTool; label: string }[] = [
  { id: 'activity', label: tx('Activitate PvE') },
  { id: 'incursions', label: tx('Incursiuni') },
  { id: 'ratting', label: tx('Unde faci ratting') },
  { id: 'anomalies', label: tx('Ghid de anomalii') },
  { id: 'agents', label: tx('Agenți') },
  { id: 'standings', label: tx('Standing-uri NPC') },
  { id: 'escalations', label: tx('Escaladări') },
  { id: 'abyss', label: tx('Ghid abisal') },
  { id: 'abyssal', label: tx('Jurnal abisal') },
  { id: 'lp', label: tx('Magazin LP') },
];

interface Tool { show(): void; hide(): void }

type Guide = 'enemy' | 'ded';

const GUIDES: { id: Guide; label: string }[] = [
  { id: 'enemy', label: tx('Contra cui e misiunea') },
  { id: 'ded', label: tx('Scanare complex DED') },
];

type Kind = 'section' | 'level' | 'enemy' | 'empire' | 'flag';
type Drop = 'section' | 'level' | 'enemy' | 'empire' | 'blitz' | 'hideEmpire';
interface Sug { kind: Kind; value: string; label: string; keys: string }
type SgItem = { s: Sug; m?: undefined } | { m: Mission; s?: undefined };

const KIND_LABEL: Record<Kind, string> = { section: tx('Nivel'), level: tx('Dificultate'), enemy: tx('Inamic'), empire: tx('Agentul tău'), flag: tx('Opțiuni') };
const LEVEL_KEYS: Record<'e' | 'm' | 'h', string> = { e: 'usor usoara easy', m: 'mediu medie average medium', h: 'greu grea hard' };
const norm = (s: string) => fold(s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')).trim();

interface State { section: Section | 'all'; tool?: MisTool | ''; guide?: Guide | ''; q: string; level: Intensity | ''; empire: string; enemy: string; blitz: boolean; hideEmpire: boolean }

const DMG_NAME: Record<Dmg, string> = { em: 'EM', th: tx('Termic'), kin: tx('Cinetic'), exp: tx('Exploziv') };
const DMG_CLS: Record<Dmg, string> = { em: 'em', th: 'thermal', kin: 'kinetic', exp: 'explosive' };
const ATTR: Record<Dmg, string> = { em: 'emDamage', th: 'thermalDamage', kin: 'kineticDamage', exp: 'explosiveDamage' };

const chip = (d: Dmg) => `<span class="badge mis-dmg ${DMG_CLS[d]}">${DMG_NAME[d]}</span>`;
const chips = (list: Dmg[]) => (list.length ? list.map(chip).join(' ') : `<span class="dim">${tx('Omni: orice tip')}</span>`);

export interface MissionsView { show(): void }

export function createMissionsView(el: HTMLElement, ctx: AppContext, side: HTMLElement, opts: { onTank: (site: string, faction: string) => void; openDoctrine?: (query: string) => boolean }): MissionsView {
  const sde = ctx.sde;
  const state: State = { section: 'all', q: '', level: '', empire: '', enemy: '', blitz: false, hideEmpire: false, ...loadJson<Partial<State>>(STATE_KEY, {}) };
  let missions: Mission[] = [];
  let levels = new Map<string, Intensity>();
  let texts = new Map<string, string>();
  const chosen = new Map<string, number>();
  const ammoCache = new Map<string, string[]>();
  let fit: Fit | null = null;

  el.innerHTML = `${pageHead('PvE', tx('Ghid pentru misiunile L1–L5 și complexele DED, activitatea ta PvE din portofel și unelte pentru LP și abisal'), 'Lov')}
    <div id="misHelp"></div>
    <div id="misBar"></div>
    <div id="misList">${loader(tx('Încărcăm misiunile'))}</div>
    <div id="misTool" hidden></div>
    <div id="misOwn" hidden></div>`;
  const help = el.querySelector<HTMLElement>('#misHelp')!;
  const bar = el.querySelector<HTMLElement>('#misBar')!;
  const list = el.querySelector<HTMLElement>('#misList')!;
  const toolBox = el.querySelector<HTMLElement>('#misTool')!;
  const tools = createToolPanel(toolBox, ctx);
  const ownBox = el.querySelector<HTMLElement>('#misOwn')!;
  const boxes = new Map<OwnTool, HTMLElement>();
  const box = (id: OwnTool) => {
    const b = document.createElement('div');
    b.hidden = true;
    ownBox.append(b);
    boxes.set(id, b);
    return b;
  };
  const incursionBox = box('incursions');
  const agents = createAgentsPanel(box('agents'), ctx);
  const incursions = createIncursionsPanel(incursionBox, ctx, { openDoctrine: opts.openDoctrine });
  const own: Record<OwnTool, Tool> = {
    activity: createPveActivityPanel(box('activity'), ctx),
    incursions: { show: () => incursions.show(), hide: () => {} },
    ratting: createRattingPanel(box('ratting'), ctx),
    anomalies: createAnomaliesPanel(box('anomalies'), { onTank: opts.onTank, openTool: (id) => openTool(id as MisTool) }),
    agents,
    standings: createStandingsPanel(box('standings'), ctx, { openAgents: (corp, faction, level) => { agents.focus(corp, faction, level); openTool('agents'); } }),
    escalations: createEscalationsPanel(box('escalations'), ctx, { dedNames: () => missions.filter((m) => sectionOf(m) === 'ded').map((m) => m.name), openMission }),
    abyss: createAbyssGuidePanel(box('abyss'), { onTank: opts.onTank, openTool: (id) => openTool(id as MisTool) }),
  };
  ctx.onCharacterChange(() => incursions.reset());
  const isOwn = (t: MisTool | null): t is OwnTool => !!t && t in own;
  if (!MIS_TOOLS.some((t) => t.id === state.tool)) state.tool = '';
  if (!GUIDES.some((g) => g.id === state.guide)) state.guide = '';

  function showTool() {
    const tool = state.tool || null;
    const guide = !tool && state.guide ? state.guide : null;
    help.hidden = !guide;
    help.querySelectorAll<HTMLElement>('[data-guide]').forEach((p) => { p.hidden = p.dataset.guide !== guide; });
    for (const x of [bar, list]) x.hidden = !!tool || !!guide;
    toolBox.hidden = !tool || isOwn(tool);
    ownBox.hidden = !isOwn(tool);
    if (tool && !isOwn(tool)) tools.show(tool); else tools.hide();
    for (const [id, b] of boxes) {
      const on = id === tool;
      if (b.hidden === !on && !on) continue;
      b.hidden = !on;
      if (on) own[id].show(); else own[id].hide();
    }
  }

  function openTool(id: MisTool) {
    if (!MIS_TOOLS.some((t) => t.id === id)) return;
    state.tool = id;
    state.guide = '';
    save();
    renderSide();
    showTool();
    el.closest('.main')?.scrollTo({ top: 0 });
  }

  function openMission(name: string) {
    state.tool = '';
    state.guide = '';
    state.section = 'ded';
    state.q = name;
    state.level = '';
    state.enemy = '';
    save();
    renderSide();
    showTool();
    if (missions.length) { renderBar(); apply(); }
    el.closest('.main')?.scrollTo({ top: 0 });
  }

  const save = () => saveJson(STATE_KEY, state);

  help.innerHTML = `<section class="mis-help panel" data-guide="enemy" hidden>
      <div class="panel-head">${windowTitle(tx('Cum afli contra cui e misiunea'))}</div>
      <div class="panel-body">
        <p>${tx('Multe misiuni au mai multe variante, iar standing-ul scade doar la variantele contra unui imperiu (Amarr, Caldari, Gallente, Minmatar). Variantele contra piraților nu te costă nimic.')}</p>
        <ol>
          <li>${tx('La oferta misiunii, fereastra agentului afișează un avertisment roșu dacă misiunea te poate costa standing la o facțiune. Dacă avertismentul lipsește, varianta e contra piraților.')}</li>
          <li>${tx('Briefing-ul misiunii numește inamicul, iar în jurnal, la obiective, apare facțiunea cu care te bați.')}</li>
          <li>${tx('Pe grid, navele imperiilor au prefixe precum Federation, Republic, Imperial sau State. Navele pirat au numele facțiunii lor (Guristas, Serpentis, Angel, Blood, Sansha).')}</li>
        </ol>
        <p>${tx('Adaugă în căutare filtrul „Agentul tău”: variantele contra facțiunii lui nu ți se oferă, iar celelalte imperii apar marcate cu „scade standing”.')}</p>
      </div>
    </section>
    <section class="mis-help panel" data-guide="ded" hidden>
      <div class="panel-head">${windowTitle(tx('Cum scanezi un complex DED'))}</div>
      <div class="panel-body">
        <p>${tx('Complexele DED sunt combat signatures: nu apar în lista de anomalii, trebuie găsite cu probe. Unele vin și ca escaladare din anomalii (Hideaway, Refuge, Den), iar asta e scris la fiecare complex.')}</p>
        <ol>
          <li>${tx('Montezi un Core Probe Launcher pe un slot high liber și iei în cargo Core Scanner Probes.')}</li>
          <li>${tx('În sistem deschizi Probe Scanner (Alt + P) și lansezi 8 probe. Folosești o formație largă ca să găsești semnătura, apoi una strânsă ca s-o fixezi.')}</li>
          <li>${tx('Filtrezi rezultatele după Combat. Apeși Analyze, muți probele peste semnătura aleasă, înjumătățești raza și apeși din nou Analyze.')}</li>
          <li>${tx('Repeți până semnătura ajunge la 100%. Atunci vezi numele complexului și poți face warp la ea. La final îți recuperezi probele.')}</li>
          <li>${tx('Înainte să intri, verifici pe poartă ce nave au voie. Limita apare și pe cardul fiecărui complex, în lista Complexe DED.')}</li>
        </ol>
        <p>${tx('Semnătura (20%, 10%, 5% sau 2.5%) arată cât de greu e de scanat. La 2.5% îți trebuie skill-urile de scanare cât mai sus: Astrometrics, Astrometric Rangefinding, Astrometric Pinpointing și Astrometric Acquisition.')}</p>
      </div>
    </section>`;

  function renderSide() {
    const counts = new Map<string, number>();
    for (const m of missions) {
      if (!visible(m, true)) continue;
      counts.set('all', (counts.get('all') ?? 0) + 1);
      const s = sectionOf(m);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    side.innerHTML = `<div class="sidebar-head">${windowTitle('PvE')}</div>
      <div class="side-nav"><div class="ord-side-label">${tx('Ghiduri')}</div>${GUIDES.map((g) => `<button class="side-link ${!state.tool && state.guide === g.id ? 'active' : ''}" data-mis-guide="${g.id}">${esc(g.label)}</button>`).join('')}
        <div class="ord-side-label">${tx('Misiuni și complexe DED')}</div>${SECTIONS.map((s) => `<button class="side-link ${!state.tool && !state.guide && s.id === state.section ? 'active' : ''}" data-mis-section="${s.id}">${esc(s.label)}<span class="count">${missions.length ? counts.get(s.id) ?? 0 : ''}</span></button>`).join('')}
        <div class="ord-side-label">${tx('Unelte PvE')}</div>
        ${MIS_TOOLS.map((t) => `<button class="side-link ${state.tool === t.id ? 'active' : ''}" data-mis-tool="${t.id}">${t.label}</button>`).join('')}</div>`;
  }

  let sgOpen = false;
  let sgKind: Kind | null = null;
  let sgItems: SgItem[] = [];
  let sgIndex = -1;
  let applyTimer = 0;

  const enemyList = () => FACTIONS.filter((f) => missions.some((m) => m.variants.some((v) => v.fac.includes(f.id))));
  const sectionShort = (id: Section) => (id === 'ded' ? 'DED' : id === 'story' ? tx('Storyline') : id.toUpperCase());

  function activeTokens(): [Drop, string][] {
    const out: [Drop, string][] = [];
    if (state.section !== 'all') out.push(['section', sectionShort(state.section)]);
    if (state.level) out.push(['level', INTENSITY[state.level]]);
    if (state.enemy) out.push(['enemy', `${tx('Inamic')}: ${faction(state.enemy).name}`]);
    if (state.empire) out.push(['empire', `${tx('Agentul tău')}: ${state.empire}`]);
    if (state.blitz) out.push(['blitz', 'Blitz']);
    if (state.hideEmpire) out.push(['hideEmpire', tx('Fără pierdere de standing')]);
    return out;
  }

  function renderBar() {
    bar.innerHTML = `<div class="mis-bar">
      <div class="mis-search-wrap">
      <div class="mis-search" id="misSearchBox">
        ${icon('search')}
        <span class="mis-tokens" id="misTokens"></span>
        <input id="misSearch" type="text" placeholder="${esc(tx('Caută misiune, facțiune sau nivel'))}" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="misSuggest" aria-autocomplete="list" />
        <span class="mis-count" id="misCount"></span>
        <kbd>/</kbd>
      </div>
      <div class="mis-suggest" id="misSuggest" role="listbox" hidden></div>
      </div>
      <div class="mis-quick" id="misQuick"></div>
    </div>`;
    const input = bar.querySelector<HTMLInputElement>('#misSearch')!;
    input.value = state.q;
    renderTokens();
    input.addEventListener('focus', () => openSg());
    input.addEventListener('input', () => {
      state.q = input.value;
      sgKind = null;
      openSg();
      clearTimeout(applyTimer);
      applyTimer = window.setTimeout(() => { save(); apply(); }, 90);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!sgOpen) { openSg(); return; }
        if (!sgItems.length) return;
        sgIndex = e.key === 'ArrowDown' ? (sgIndex + 1) % sgItems.length : (sgIndex <= 0 ? sgItems.length - 1 : sgIndex - 1);
        markSg();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = sgOpen ? sgItems[sgIndex] : undefined;
        if (it) pickSg(it); else closeSg();
      } else if (e.key === 'Escape') {
        if (sgOpen) { closeSg(); return; }
        input.value = '';
        state.q = '';
        save();
        apply();
      } else if (e.key === 'Backspace' && !input.value) {
        const last = activeTokens().pop();
        if (last) { e.preventDefault(); dropToken(last[0]); }
      } else if (e.key === 'Tab') closeSg();
    });
    const sg = bar.querySelector<HTMLElement>('#misSuggest')!;
    sg.addEventListener('mousedown', (e) => e.preventDefault());
    sg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sg]');
      if (b) pickSg(sgItems[Number(b.dataset.sg)]);
    });
    bar.querySelector<HTMLElement>('#misSearchBox')!.addEventListener('click', (e) => {
      const x = (e.target as HTMLElement).closest<HTMLElement>('[data-mis-drop]');
      if (x) { dropToken(x.dataset.misDrop as Drop); return; }
      input.focus();
    });
    bar.querySelector<HTMLElement>('#misQuick')!.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const k = t.closest<HTMLElement>('[data-mis-kind]');
      if (k) { sgKind = k.dataset.misKind as Kind; if (document.activeElement === input) openSg(); else input.focus(); return; }
      const f = t.closest<HTMLElement>('[data-mis-flag]');
      if (f) {
        const key = f.dataset.misFlag as 'blitz' | 'hideEmpire';
        state[key] = !state[key];
        afterFilter();
      }
    });
  }

  function renderTokens() {
    const tk = bar.querySelector<HTMLElement>('#misTokens');
    if (!tk) return;
    tk.innerHTML = activeTokens().map(([k, label]) => `<span class="mis-token">${esc(label)}<button type="button" class="mis-token-x" data-mis-drop="${k}" aria-label="${esc(tx('Scoate filtrul'))}">×</button></span>`).join('');
    const quick = bar.querySelector<HTMLElement>('#misQuick');
    if (quick) quick.innerHTML = `<span class="mis-quick-label">${tx('Adaugă filtru')}</span>
      ${(['section', 'level', 'enemy', 'empire'] as Kind[]).map((k) => `<button type="button" class="chip-btn" data-mis-kind="${k}">${esc(KIND_LABEL[k])}</button>`).join('')}
      <button type="button" class="chip-btn ${state.blitz ? 'active' : ''}" data-mis-flag="blitz">Blitz</button>
      <button type="button" class="chip-btn ${state.hideEmpire ? 'active' : ''}" data-mis-flag="hideEmpire">${tx('Fără pierdere de standing')}</button>
      <span class="mis-actions">${button(tx('Deschide tot'), { cls: 'sm ghost', attrs: 'data-mis-open="1"' })} ${button(tx('Închide tot'), { cls: 'sm ghost', attrs: 'data-mis-open="0"' })}</span>`;
  }

  function candidates(): Sug[] {
    const out: Sug[] = [];
    for (const s of SECTIONS) {
      if (s.id === 'all' || s.id === state.section) continue;
      const n = s.id.slice(1);
      out.push({ kind: 'section', value: s.id, label: s.label, keys: `${s.label} ${s.id} ${s.id === 'ded' ? 'ded complex' : s.id === 'story' ? 'storyline' : `level ${n} nivel ${n} l${n}`}` });
    }
    for (const id of ['e', 'm', 'h'] as const) if (state.level !== id) out.push({ kind: 'level', value: id, label: INTENSITY[id], keys: `${INTENSITY[id]} ${LEVEL_KEYS[id]}` });
    for (const f of enemyList()) if (state.enemy !== f.id) out.push({ kind: 'enemy', value: f.id, label: f.name, keys: `${f.name} ${f.id}` });
    for (const e of EMPIRES) if (state.empire !== e) out.push({ kind: 'empire', value: e, label: e, keys: e });
    if (!state.blitz) out.push({ kind: 'flag', value: 'blitz', label: 'Blitz', keys: 'blitz' });
    if (!state.hideEmpire) out.push({ kind: 'flag', value: 'hideEmpire', label: tx('Fără pierdere de standing'), keys: `${tx('Fără pierdere de standing')} standing` });
    return out;
  }

  function patchOf(s: Sug): Partial<State> {
    if (s.kind === 'section') return { section: s.value as Section };
    if (s.kind === 'level') return { level: s.value as Intensity };
    if (s.kind === 'enemy') return { enemy: s.value };
    if (s.kind === 'empire') return { empire: s.value };
    return { [s.value]: true } as Partial<State>;
  }

  function countWith(patch: Partial<State>) {
    const saved = { ...state };
    Object.assign(state, patch, { q: '' });
    let n = 0;
    for (const m of missions) if (visible(m)) n++;
    Object.assign(state, saved);
    return n;
  }

  const countLabel = (n: number) => (n === 1 ? tx('1 misiune') : tx('{n} misiuni', { n }));

  function hl(text: string, q: string) {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const low = text.toLowerCase();
    for (const t of terms) {
      const i = low.indexOf(t);
      if (i >= 0) return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + t.length))}</mark>${esc(text.slice(i + t.length))}`;
    }
    return esc(text);
  }

  function openSg() {
    const sg = bar.querySelector<HTMLElement>('#misSuggest');
    const input = bar.querySelector<HTMLInputElement>('#misSearch');
    if (!sg || !input || !missions.length) return;
    const q = norm(input.value);
    const terms = q.split(/\s+/).filter(Boolean);
    let filters = candidates();
    if (sgKind) filters = filters.filter((s) => s.kind === sgKind);
    if (terms.length) filters = filters.filter((s) => { const k = norm(s.keys); return terms.every((t) => k.includes(t)); });
    const byName = (m: Mission) => (terms.every((t) => norm(m.name).includes(t)) ? 0 : 1);
    const ms = terms.length && !sgKind ? missions.filter((m) => visible(m)).map((m) => [byName(m), m] as const).sort((x, y) => x[0] - y[0]).slice(0, 6).map(([, m]) => m) : [];
    sgItems = [...filters.map((s) => ({ s })), ...ms.map((m) => ({ m }))];
    sgIndex = terms.length && sgItems.length ? 0 : -1;
    if (!sgItems.length) {
      sg.innerHTML = terms.length ? `<div class="mis-sg-empty">${tx('Nicio misiune nu se potrivește')}</div>` : '';
      sg.hidden = !terms.length;
      sgOpen = !sg.hidden;
      input.setAttribute('aria-expanded', String(sgOpen));
      return;
    }
    let html = '';
    let group = '';
    sgItems.forEach((it, i) => {
      const g = it.s ? it.s.kind : 'mission';
      if (g !== group) { group = g; html += `<div class="mis-sg-group">${esc(it.s ? KIND_LABEL[it.s.kind] : tx('Misiuni'))}</div>`; }
      if (it.s) {
        html += `<button type="button" class="mis-sg" data-sg="${i}" role="option"><span class="mis-token sm">${esc(KIND_LABEL[it.s.kind])}</span><span class="mis-sg-name">${hl(it.s.label, input.value)}</span><span class="mis-sg-meta">${countLabel(countWith(patchOf(it.s)))}</span></button>`;
      } else {
        const lvl = levels.get(it.m.key) ?? 'x';
        html += `<button type="button" class="mis-sg" data-sg="${i}" role="option">${levelTag(it.m)}<span class="mis-sg-name">${hl(it.m.name, input.value)}</span><span class="mis-sg-meta">${esc(INTENSITY[lvl])}${hasBlitz(it.m) || it.m.guide?.blitz ? ' · Blitz' : ''}</span></button>`;
      }
    });
    sg.innerHTML = html;
    sg.hidden = false;
    sgOpen = true;
    input.setAttribute('aria-expanded', 'true');
    markSg();
  }

  function markSg() {
    const sg = bar.querySelector<HTMLElement>('#misSuggest');
    if (!sg) return;
    sg.querySelectorAll<HTMLElement>('[data-sg]').forEach((b) => {
      const on = Number(b.dataset.sg) === sgIndex;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView({ block: 'nearest' });
    });
  }

  function closeSg() {
    const sg = bar.querySelector<HTMLElement>('#misSuggest');
    if (sg) sg.hidden = true;
    sgOpen = false;
    sgKind = null;
    bar.querySelector('#misSearch')?.setAttribute('aria-expanded', 'false');
  }

  function afterFilter() {
    save();
    renderTokens();
    list.querySelectorAll<HTMLDetailsElement>('details.mis-card').forEach(refreshCard);
    apply();
  }

  function pickSg(it: SgItem) {
    const input = bar.querySelector<HTMLInputElement>('#misSearch')!;
    if (it.s) {
      Object.assign(state, patchOf(it.s));
      input.value = '';
      state.q = '';
      sgKind = null;
      afterFilter();
      openSg();
      return;
    }
    input.value = it.m.name;
    state.q = it.m.name;
    closeSg();
    save();
    apply();
    const d = list.querySelector<HTMLDetailsElement>(`details[data-key="${CSS.escape(it.m.key)}"]`);
    if (d && !d.hidden) { d.open = true; d.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }

  function dropToken(k: Drop) {
    if (k === 'section') state.section = 'all';
    else if (k === 'level') state.level = '';
    else if (k === 'enemy') state.enemy = '';
    else if (k === 'empire') state.empire = '';
    else state[k] = false;
    afterFilter();
    if (sgOpen) openSg();
  }

  document.addEventListener('pointerdown', (e) => { if (sgOpen && !bar.contains(e.target as Node)) closeSg(); });

  function variantsFor(m: Mission): MVariant[] {
    return m.variants.filter((v) => {
      if (state.empire && v.fac.some((f) => faction(f).empire === state.empire)) return false;
      if (state.hideEmpire && empiresOf(v).length) return false;
      return true;
    });
  }

  function visible(m: Mission, ignoreSection = false): boolean {
    if (!ignoreSection && state.section !== 'all' && sectionOf(m) !== state.section) return false;
    const vs = variantsFor(m);
    if (!vs.length && m.variants.length) return false;
    if (state.enemy && !vs.some((v) => v.fac.includes(state.enemy))) return false;
    if (state.blitz && !hasBlitz(m) && !m.guide?.blitz) return false;
    if (state.level && levels.get(m.key) !== state.level) return false;
    if (state.q) {
      const terms = norm(state.q).split(/\s+/).filter(Boolean);
      const hay = texts.get(m.key) ?? '';
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  }

  function levelTag(m: Mission) {
    if (m.rating) return `<span class="badge accent">DED ${m.rating}/10</span>`;
    return `<span class="badge accent">L${m.level}</span>`;
  }

  function summary(m: Mission) {
    const vs = variantsFor(m);
    const facs = [...new Set(vs.flatMap((v) => v.fac))];
    const lvl = levels.get(m.key) ?? 'x';
    const emp = vs.length > 0 && vs.every((v) => empiresOf(v).length > 0);
    const some = !emp && vs.some((v) => empiresOf(v).length > 0);
    const weak = vs.length === 1 ? weakOf(vs[0]).slice(0, 2) : [];
    return `<summary>
      <span class="mis-caret" aria-hidden="true"></span>
      <span class="mis-main">
        <span class="mis-name">${esc(m.name)}</span>
        <span class="mis-tags">${levelTag(m)}<span class="badge mis-int ${lvl}">${esc(INTENSITY[lvl])}</span>${m.story ? `<span class="badge gold">${tx('Storyline')}</span>` : ''}${m.bonus?.some((b) => b.k === 'room') ? `<span class="badge gold">${tx('Cameră bonus')}</span>` : ''}${hasBlitz(m) || m.guide?.blitz ? `<span class="badge ok">Blitz</span>` : ''}${m.courier ? `<span class="badge">${tx('Transport')}</span>` : ''}${facs.map((f) => `<span class="badge">${esc(faction(f).name)}</span>`).join('')}${emp ? `<span class="badge warn">${tx('scade standing')}</span>` : some ? `<span class="badge">${tx('standing doar la unele variante')}</span>` : ''}${m.ship ? `<span class="badge">${esc(tx('Maxim: {s}', { s: pick(m.ship) }))}</span>` : ''}</span>
      </span>
      <span class="mis-weak">${weak.map(chip).join('')}</span>
    </summary>`;
  }

  function currentFit(): Fit | null {
    const f = loadJson<Fit | null>(CURRENT_KEY, null);
    return f && sde.types.has(f.shipId) ? f : null;
  }

  function weaponIds(f: Fit): number[] {
    const ids = new Set<number>();
    for (const m of f.slots.high ?? []) if (m && hasCharges(m.typeId)) ids.add(m.typeId);
    return [...ids];
  }

  const chargeTypes = () => sde.typesInCategory(Category.Charge);

  function hasCharges(moduleId: number) {
    return ['chargeGroup1', 'chargeGroup2', 'chargeGroup3'].some((n) => sde.hasAttr(n) && sde.baseAttr(moduleId, sde.attrId(n)) > 0);
  }

  function ammoFor(weapon: number, d: Dmg): string[] {
    const key = `${weapon}:${d}`;
    const hit = ammoCache.get(key);
    if (hit) return hit;
    const attrs = (Object.keys(ATTR) as Dmg[]).map((k) => [k, sde.attrId(ATTR[k])] as const);
    const rows: { name: string; v: number; share: number }[] = [];
    for (const c of chargeTypes()) {
      if (!c.marketGroupId || !canLoadCharge(sde, weapon, c.id)) continue;
      const vals = attrs.map(([k, id]) => [k, sde.baseAttr(c.id, id)] as const);
      const total = vals.reduce((s, [, v]) => s + v, 0);
      const v = vals.find(([k]) => k === d)?.[1] ?? 0;
      if (total <= 0 || v <= 0) continue;
      rows.push({ name: c.name, v, share: v / total });
    }
    const best = rows.filter((r) => r.share >= 0.5).sort((a, b) => b.v - a.v);
    const out = (best.length ? best : rows.sort((a, b) => b.share - a.share || b.v - a.v)).slice(0, 3).map((r) => r.name);
    ammoCache.set(key, out);
    return out;
  }

  function ammoLines(v: MVariant) {
    if (!fit) return `<div class="mis-line"><span class="label">${tx('Muniție')}</span><span class="dim">${tx('Deschide un fit în Fitting și îți arăt aici muniția potrivită pentru armele lui.')}</span></div>`;
    const weak = weakOf(v);
    const weapons = weaponIds(fit);
    if (!weapons.length || !weak.length) return '';
    return weapons.map((w) => {
      const names = [...new Set(weak.slice(0, 2).flatMap((d) => ammoFor(w, d).slice(0, 2)))];
      if (!names.length) return '';
      return `<div class="mis-line"><span class="label">${esc(sde.types.get(w)?.name ?? '')}</span><span>${names.map((n) => `<span class="mis-ammo">${esc(n)}</span>`).join(' ')}</span></div>`;
    }).join('');
  }

  function hardeners(v: MVariant) {
    const dealt = dealtOf(v);
    if (!dealt.length) return tx('Multispectrum (damage amestecat)');
    const main = dealt.slice(0, 2).map((d) => DMG_NAME[d]).join(' + ');
    return tx('Hardener {d}, plus un Multispectrum dacă vrei siguranță', { d: main });
  }

  function npcSite(m: Mission): string {
    if (m.rating) return m.rating >= 10 ? 'ded/10' : m.rating >= 8 ? 'ded/8' : m.rating >= 6 ? 'ded/6' : m.rating >= 5 ? 'ded/5' : 'ded/3';
    return m.level >= 5 ? 'mission/l4h' : `mission/l${Math.max(1, m.level)}`;
  }

  function combat(m: Mission, v: MVariant) {
    const ewar = ewarOf(v);
    const emp = empiresOf(v);
    const npc = v.fac.map((f) => faction(f).npc).find(Boolean);
    return `<div class="mis-combat">
      <div class="mis-line"><span class="label">${tx('Trage cu')}</span><span>${chips(weakOf(v))}</span></div>
      ${ammoLines(v)}
      <div class="mis-line"><span class="label">${tx('Primești')}</span><span>${chips(dealtOf(v))} <span class="dim">${esc(hardeners(v))}</span></span></div>
      ${ewar.length ? `<div class="mis-line"><span class="label">EWAR</span><span>${ewar.map((e) => `<span class="badge warn">${esc(EWAR_LABEL[e])}</span>`).join(' ')}</span></div>` : ''}
      ${emp.length ? `<div class="mis-line"><span class="label">${tx('Standing')}</span><span class="warn">${esc(emp.map((e) => tx('Scade standing-ul cu {e}.', { e })).join(' '))}</span></div>` : ''}
      ${npc ? `<div class="mis-line"><span class="label"></span><span>${button(tx('Verifică tank-ul în Fitting'), { cls: 'sm', attrs: `data-mis-tank="${npcSite(m)}|${npc}"` })}</span></div>` : ''}
    </div>`;
  }

  function overview(m: Mission, v: MVariant) {
    const rows: [string, string][] = [];
    const obj = lang === 'ro' ? v.obj?.ro || m.guide?.obj || v.obj?.en || '' : pick(v.obj);
    if (obj) rows.push([tx('Obiectiv'), esc(obj)]);
    const roomCount = v.rooms?.filter((r) => r.g.length).length ?? 0;
    if (lang === 'ro' && m.guide?.rooms) rows.push([tx('Camere'), esc(m.guide.rooms)]);
    else if (roomCount) rows.push([tx('Camere'), String(roomCount)]);
    if (lang === 'ro' && m.guide?.gates) rows.push([tx('Poarta'), esc(tx('Distanța de la intrare până la poartă: {g}.', { g: m.guide.gates }))]);
    if (m.guide?.home) rows.push([tx('Locație'), tx('Mereu în sistemul agentului.')]);
    if (m.ship) rows.push([tx('Nave permise'), esc(pick(m.ship))]);
    if (m.sig) rows.push([tx('Puterea semnăturii'), esc(pick(m.sig))]);
    if (m.found) rows.push([tx('Unde apare'), esc(pick(m.found))]);
    if (m.escal) rows.push([tx('Escaladare din'), esc(m.escal)]);
    if (v.bounty) rows.push(['Bounty', esc(v.bounty)]);
    if (v.loot) rows.push([tx('Loot + salvage'), esc(v.loot)]);
    return rows.length ? `<div class="mis-overview">${rows.map(([k, val]) => `<div class="mis-line"><span class="label">${k}</span><span>${val}</span></div>`).join('')}</div>` : '';
  }

  function npcTable(rows: MRow[]) {
    const cell = (c: MRow['c'][number], head: boolean) => {
      const tag = head ? 'th' : 'td';
      const span = `${c[1] && c[1] > 1 ? ` colspan="${c[1]}"` : ''}${c[2] && c[2] > 1 ? ` rowspan="${c[2]}"` : ''}`;
      const text = head ? NPC_HEAD[c[0]] ?? c[0] : c[0];
      return `<${tag}${span}>${esc(text)}</${tag}>`;
    };
    const head = rows.filter((r) => r.h);
    const rest = rows.filter((r) => !r.h);
    return `<div class="table-scroll mis-npc"><table class="table compact">
      ${head.length ? `<thead>${head.map((r) => `<tr>${r.c.map((c) => cell(c, true)).join('')}</tr>`).join('')}</thead>` : ''}
      <tbody>${rest.map((r) => `<tr>${r.c.map((c) => cell(c, false)).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  function roomHtml(r: MRoom, i: number) {
    const rows = r.g.map((g) => {
      const ships = g.s.map((s) => {
        const fl = s[3].map((f) => `<span class="badge mis-flag ${f}">${esc(FLAG_LABEL[f] ?? f)}</span>`).join(' ');
        const cls = s[1] !== 'O' ? `<span class="mis-cls">${esc(CLASS_LABEL[s[1]] ?? s[1])}</span>` : '';
        return `<div class="mis-ship"><span class="num">${esc(s[0])}×</span> ${cls} ${s[2] ? `<span class="dim">${esc(s[2])}</span>` : ''} ${fl}</div>`;
      }).join('');
      return `<tr><td class="mis-group">${esc(pick(g.l))}</td><td class="num">${esc(g.d ?? '')}</td><td>${ships}</td></tr>`;
    }).join('');
    const notes = pickList(r.x);
    const info = (r.i ?? []).filter(([k]) => k in INFO_LABEL);
    return `<div class="mis-room">
      <div class="mis-room-head">${esc(pick(r.n) || tx('Camera {n}', { n: i + 1 }))}${r.gate ? ` <span class="dim">· ${esc(tx('poarta la {d}', { d: r.gate }))}</span>` : ''}</div>
      ${info.length ? `<div class="mis-info">${info.map(([k, val, ro]) => `<div class="mis-line"><span class="label">${esc(INFO_LABEL[k])}</span><span>${esc(lang === 'ro' && ro ? ro : val)}</span></div>`).join('')}</div>` : ''}
      ${rows ? `<div class="table-scroll"><table class="table compact mis-table"><thead><tr><th>${tx('Grup')}</th><th>${tx('Distanță')}</th><th>${tx('Nave')}</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
      ${notes.length ? `<ul class="mis-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${r.t?.length ? `<div class="mis-npc-head">${tx('Statistici NPC')}</div>${r.t.map(npcTable).join('')}` : ''}
    </div>`;
  }

  function bonusHtml(m: Mission) {
    if (!m.bonus?.length) return '';
    return m.bonus.map((b) => {
      const rows: [string, string][] = [];
      if (b.key) rows.push([tx('Cheie'), pick(b.key)]);
      if (b.get) rows.push([tx('Unde o găsești'), pick(b.get)]);
      if (b.gives) rows.push([tx('Ce primești'), pick(b.gives)]);
      if (b.opt !== undefined) rows.push([tx('Opțional'), b.opt ? tx('Da') : tx('Nu')]);
      if (b.used !== undefined) rows.push([tx('Se consumă'), b.used ? tx('Da') : tx('Nu')]);
      return `<div class="mis-bonus"><div class="mis-sec-head">${b.k === 'room' ? tx('Cameră bonus') : tx('Cheie / acces')}</div><p>${esc(pick(b.t))}</p>${rows.map(([k, val]) => `<div class="mis-line"><span class="label">${esc(k)}</span><span>${esc(val)}</span></div>`).join('')}</div>`;
    }).join('');
  }

  function listBlock(title: string, items: string[], ordered = false) {
    if (!items.length) return '';
    const tag = ordered ? 'ol' : 'ul';
    return `<div class="mis-sec"><div class="mis-sec-head">${esc(title)}</div><${tag} class="mis-notes">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</${tag}></div>`;
  }

  function body(m: Mission) {
    const vs = variantsFor(m);
    const all = vs.length ? vs : m.variants;
    const idx = Math.min(chosen.get(m.key) ?? 0, all.length - 1);
    const v = all[idx];
    const switcher = all.length > 1 ? `<div class="chip-row mis-variants">${all.map((x, i) => `<button class="chip-btn ${i === idx ? 'active' : ''}" data-mis-variant="${m.key}|${i}">${esc(x.fac.map((f) => faction(f).name).join(' + ') || tx('Varianta {n}', { n: i + 1 }))}</button>`).join('')}</div>` : '';
    const guide = lang === 'ro' && m.guide ? `${listBlock(m.guide.blitz ? tx('Pe scurt (blitz)') : tx('Pe scurt'), m.guide.steps ?? [], true)}${m.guide.stepsNote ? `<p class="dim small">${esc(m.guide.stepsNote)}</p>` : ''}${listBlock(tx('De reținut'), m.guide.notes ?? [])}` : '';
    const es = v.es ? `<a class="ext-link" href="${ES_URL}${encodeURIComponent(v.es)}" target="_blank" rel="noopener noreferrer">EVE Survival</a>` : '';
    const euPath = v.eu ?? m.eu;
    const eu = euPath ? `<a class="ext-link" href="${EU_URL}${encodeURI(euPath)}" target="_blank" rel="noopener noreferrer">EVE University</a>` : `<a class="ext-link" href="${EU_URL}index.php?search=${encodeURIComponent(m.name)}" target="_blank" rel="noopener noreferrer">EVE University</a>`;
    return `${switcher}
      ${overview(m, v)}
      ${bonusHtml(m)}
      ${v.fac.length ? combat(m, v) : ''}
      ${guide}
      ${listBlock('Blitz', pickList(v.blitz))}
      ${(v.rooms ?? []).map(roomHtml).join('')}
      ${listBlock(tx('Sfaturi'), pickList(v.tips))}
      ${listBlock(tx('Loot'), v.lootList ?? [])}
      ${!m.courier && !v.rooms?.length && !pickList(v.tips).length && !m.guide ? `<p class="dim">${tx('Sursa nu are încă detalii pentru misiunea asta. Vezi pagina completă.')}</p>` : ''}
      <div class="mis-links">${es}${eu}</div>`;
  }

  function apply() {
    let shown = 0;
    for (const m of missions) {
      const d = list.querySelector<HTMLDetailsElement>(`details[data-key="${CSS.escape(m.key)}"]`);
      if (!d) continue;
      const vis = visible(m);
      d.hidden = !vis;
      if (vis) shown++;
    }
    const count = bar.querySelector('#misCount');
    if (count) count.textContent = countLabel(shown);
    list.querySelector('.mis-empty')?.toggleAttribute('hidden', shown !== 0);
    renderSide();
  }

  function renderList() {
    list.innerHTML = `${missions.map((m) => `<details class="mis-card panel" data-key="${esc(m.key)}">${summary(m)}<div class="mis-body"></div></details>`).join('')}
      <div class="mis-empty" hidden>${emptyState({ title: tx('Nicio misiune nu se potrivește'), text: tx('Încearcă doar o parte din nume sau scoate un filtru.'), vy: 'The Hunt Finds No Trail', vyText: 'No quarry answers these words. Loosen the snare and listen again.' })}</div>`;
    apply();
  }

  function refreshCard(d: HTMLDetailsElement) {
    const m = missions.find((x) => x.key === d.dataset.key);
    if (!m) return;
    d.querySelector('summary')!.outerHTML = summary(m);
    if (d.open) d.querySelector<HTMLElement>('.mis-body')!.innerHTML = body(m);
    else d.querySelector<HTMLElement>('.mis-body')!.innerHTML = '';
  }

  list.addEventListener('toggle', (e) => {
    const d = e.target as HTMLDetailsElement;
    if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('mis-card')) return;
    const b = d.querySelector<HTMLElement>('.mis-body')!;
    if (d.open && !b.innerHTML) { const m = missions.find((x) => x.key === d.dataset.key); if (m) b.innerHTML = body(m); }
  }, true);

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const v = t.closest<HTMLElement>('[data-mis-variant]');
    if (v) {
      const [key, i] = v.dataset.misVariant!.split('|');
      chosen.set(key, Number(i));
      const d = list.querySelector<HTMLDetailsElement>(`details[data-key="${CSS.escape(key)}"]`);
      if (d) refreshCard(d);
      return;
    }
    const tank = t.closest<HTMLElement>('[data-mis-tank]');
    if (tank) { const [site, fac] = tank.dataset.misTank!.split('|'); opts.onTank(site, fac); return; }
    const open = t.closest<HTMLElement>('[data-mis-open]');
    if (open) {
      const on = open.dataset.misOpen === '1';
      list.querySelectorAll<HTMLDetailsElement>('details.mis-card').forEach((d) => { if (!on) d.open = false; else if (!d.hidden) d.open = true; });
    }
  });

  side.addEventListener('click', (e) => {
    const tb = (e.target as HTMLElement).closest<HTMLElement>('[data-mis-tool]');
    if (tb) {
      state.tool = tb.dataset.misTool as MisTool;
      state.guide = '';
      save();
      renderSide();
      showTool();
      el.closest('.main')?.scrollTo({ top: 0 });
      return;
    }
    const gb = (e.target as HTMLElement).closest<HTMLElement>('[data-mis-guide]');
    if (gb) {
      state.guide = gb.dataset.misGuide as Guide;
      state.tool = '';
      save();
      renderSide();
      showTool();
      el.closest('.main')?.scrollTo({ top: 0 });
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mis-section]');
    if (!b) return;
    const wasTool = !!state.tool || !!state.guide;
    state.section = b.dataset.misSection as Section | 'all';
    state.tool = '';
    state.guide = '';
    save();
    if (wasTool) showTool();
    renderTokens();
    apply();
    el.closest('.main')?.scrollTo({ top: 0 });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || !el.classList.contains('active')) return;
    const a = document.activeElement;
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    bar.querySelector<HTMLInputElement>('#misSearch')?.focus();
  });

  renderSide();
  showTool();
  loadMissions().then((data) => {
    const sortName = (n: string) => n.replace(/^(The|A|An) /i, '').replace(/[()[\]]/g, '').replace(/\s+/g, ' ').trim();
    missions = [...data.missions].sort((a, b) => (a.rating ? 1 : 0) - (b.rating ? 1 : 0) || sortName(a.name).localeCompare(sortName(b.name), 'en', { numeric: true, sensitivity: 'base' }) || a.level - b.level || (a.rating ?? 0) - (b.rating ?? 0));
    levels = intensities(missions);
    texts = new Map(missions.map((m) => [m.key, `${searchText(m)} ${norm([...new Set(m.variants.flatMap((v) => v.fac))].map((f) => faction(f).name).join(' '))} ${m.rating ? 'ded' : `l${m.level}`}`]));
    fit = currentFit();
    renderBar();
    renderList();
  }).catch(() => {
    list.innerHTML = panel({ body: alertBox(tx('Nu am putut încărca datele misiunilor. Reîncarcă pagina.'), 'danger') });
  });

  return {
    show() {
      const next = currentFit();
      if (JSON.stringify(next) === JSON.stringify(fit)) return;
      fit = next;
      ammoCache.clear();
      list.querySelectorAll<HTMLDetailsElement>('details.mis-card[open]').forEach(refreshCard);
    },
  };
}
