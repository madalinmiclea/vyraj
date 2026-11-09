import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, windowTitle, emptyState, button } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { createToolPanel } from './tools';
import { createAgentsPanel } from './pveAgents';
import { createStandingsPanel } from './pveStandings';
import { createBlitzPanel } from './pveBlitz';
import { enemyGuide } from './pveGuides';
import { createEpicArcsPanel } from './epicArcs';
import { tx, lang } from '../i18n';
import { fold } from '../ui/fold';
import { canLoadCharge, type Fit } from '../engine/fit';
import { Category } from '../data/sde';
import {
  loadMissions, mergeChains, chainBase, rangeLabel, pick, pickList, faction, sectionOf, intensities, dealtOf, weakOf, ewarOf, empiresOf, hasBlitz, searchText,
  SECTIONS, INTENSITY, CLASS_LABEL, FLAG_LABEL, EWAR_LABEL, ES_URL, EU_URL, INFO_LABEL, NPC_HEAD,
  type Mission, type MVariant, type MRoom, type MRow, type Dmg, type Section, type Intensity,
} from '../services/missions';

const STATE_KEY = 'eve-missions:state';

type MisTool = 'anomic' | 'epic' | 'agents' | 'standings' | 'lp' | 'blitz';
type OwnTool = Exclude<MisTool, 'lp'>;

const GUIDE_TOOLS: { id: MisTool; label: string }[] = [{ id: 'anomic', label: tx('Misiuni Anomic') }];
const AGENT_TOOLS: { id: MisTool; label: string }[] = [
  { id: 'agents', label: tx('Agenți') },
  { id: 'standings', label: tx('Standing-uri NPC') },
  { id: 'lp', label: tx('Magazin LP') },
];
const BLITZ_TOOLS: { id: MisTool; label: string }[] = [{ id: 'blitz', label: tx('Ghid blitz') }];
const EPIC_TOOLS: { id: MisTool; label: string }[] = [{ id: 'epic', label: tx('Arcuri epice') }];
const MIS_TOOLS = [...GUIDE_TOOLS, ...EPIC_TOOLS, ...AGENT_TOOLS, ...BLITZ_TOOLS];

interface Tool { show(): void; hide(): void }

type Guide = 'enemy';

const GUIDES: { id: Guide; label: string }[] = [
  { id: 'enemy', label: tx('Contra cui e misiunea') },
];

const GROUP_ORDER = ['l1', 'l2', 'l3', 'l4', 'l5', 'story', ...Array.from({ length: 10 }, (_, i) => `ded${i + 1}`)];
const groupOf = (m: Mission) => (m.rating ? `ded${m.rating}` : sectionOf(m));
const groupLabel = (g: string) => (g.startsWith('ded') ? `DED ${g.slice(3)}/10` : SECTIONS.find((s) => s.id === g)?.label ?? g);
const norm = (s: string) => fold(s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')).trim();

interface State { section: Section | 'all'; tool?: MisTool | ''; guide?: Guide | ''; q: string; open?: string }

const DMG_NAME: Record<Dmg, string> = { em: 'EM', th: tx('Termic'), kin: tx('Cinetic'), exp: tx('Exploziv') };
const DMG_CLS: Record<Dmg, string> = { em: 'em', th: 'thermal', kin: 'kinetic', exp: 'explosive' };
const ATTR: Record<Dmg, string> = { em: 'emDamage', th: 'thermalDamage', kin: 'kineticDamage', exp: 'explosiveDamage' };

const chip = (d: Dmg) => `<span class="badge mis-dmg ${DMG_CLS[d]}">${DMG_NAME[d]}</span>`;
const chips = (list: Dmg[]) => (list.length ? list.map(chip).join(' ') : `<span class="dim">${tx('Omni: orice tip')}</span>`);

export interface MissionsView { openMission(name: string, section?: Section | 'all'): void; names(): string[] }

export function createMissionsView(el: HTMLElement, ctx: AppContext, side: HTMLElement, opts: { onTank: (site: string, faction: string) => void; openFit?: (fit: Fit) => void; scope?: 'ded' }): MissionsView {
  const sde = ctx.sde;
  const embedded = opts.scope === 'ded';
  const P = embedded ? 'ded' : 'mis';
  const key = embedded ? 'eve-pve:ded' : STATE_KEY;
  const sections = SECTIONS.filter((s) => (s.id === 'ded') === embedded);
  const saved = loadJson<Partial<State>>(key, {});
  const state: State = { section: embedded ? 'ded' : saved.section ?? 'all', tool: embedded ? '' : saved.tool ?? '', guide: embedded ? '' : saved.guide ?? '', q: saved.q ?? '', open: saved.open ?? '' };
  if (!sections.some((x) => x.id === state.section)) state.section = sections[0].id;
  let missions: Mission[] = [];
  let levels = new Map<string, Intensity>();
  let texts = new Map<string, string>();
  const chosen = new Map<string, number>();
  const ammoCache = new Map<string, string[]>();

  el.innerHTML = `${embedded ? '' : pageHead(tx('Misiuni'), tx('Ghid pentru misiunile L1–L5, storyline și arcuri epice, agenți, standing-uri, magazin LP și blitz'), 'Lov')}
    <div id="${P}Help"></div>
    <div id="${P}Bar"></div>
    <div id="${P}List">${loader(tx('Încărcăm misiunile'))}</div>
    <div id="${P}Tool" hidden></div>
    <div id="${P}Own" hidden></div>`;
  const help = el.querySelector<HTMLElement>(`#${P}Help`)!;
  const bar = el.querySelector<HTMLElement>(`#${P}Bar`)!;
  const list = el.querySelector<HTMLElement>(`#${P}List`)!;
  const toolBox = el.querySelector<HTMLElement>(`#${P}Tool`)!;
  const tools = embedded ? null : createToolPanel(toolBox, ctx);
  const ownBox = el.querySelector<HTMLElement>(`#${P}Own`)!;
  const boxes = new Map<OwnTool, HTMLElement>();
  const box = (id: OwnTool) => {
    const b = document.createElement('div');
    b.hidden = true;
    ownBox.append(b);
    boxes.set(id, b);
    return b;
  };
  const own: Partial<Record<OwnTool, Tool>> = {};
  if (!embedded) {
    const agents = createAgentsPanel(box('agents'), ctx);
    const blitzOpts = (only: 'blitz' | 'anomic') => ({
      openFit: (f: Fit) => opts.openFit?.(f),
      openMission: (name: string, section: string) => openMission(name, section as Section),
      openSection: (section: string) => openMission('', section as Section),
      openAgents: (corp: number, faction: number) => { agents.focus(corp, faction, 4); openTool('agents'); },
      openTool: (id: string) => openTool(id as MisTool),
      blitzCounts: () => {
        const n = new Map<number, number>();
        for (const m of missions) if (m.level && sectionOf(m) === `l${m.level}` && hasBlitz(m)) n.set(m.level, (n.get(m.level) ?? 0) + 1);
        return n;
      },
      only,
    });
    own.anomic = createBlitzPanel(box('anomic'), ctx, blitzOpts('anomic'));
    own.agents = agents;
    own.standings = createStandingsPanel(box('standings'), ctx, { openAgents: (corp, faction, level) => { agents.focus(corp, faction, level); openTool('agents'); } });
    own.blitz = createBlitzPanel(box('blitz'), ctx, blitzOpts('blitz'));
    own.epic = createEpicArcsPanel(box('epic'), ctx, { onTank: opts.onTank, openFit: (f: Fit) => opts.openFit?.(f) });
  }
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
    if (tool && !isOwn(tool)) tools?.show(tool); else tools?.hide();
    for (const [id, b] of boxes) {
      const on = id === tool;
      if (b.hidden === !on && !on) continue;
      b.hidden = !on;
      if (on) own[id]?.show(); else own[id]?.hide();
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

  function openMission(name: string, section: Section | 'all' = embedded ? 'ded' : 'all') {
    state.tool = '';
    state.guide = '';
    state.section = section;
    state.q = name ? chainBase(name) : name;
    state.open = '';
    save();
    renderSide();
    showTool();
    if (missions.length) { renderBar(); apply(); }
    el.closest('.main')?.scrollTo({ top: 0 });
  }

  const save = () => saveJson(key, state);

  help.innerHTML = embedded ? '' : `<div class="mis-help" data-guide="enemy" hidden>${enemyGuide()}</div>`;
  help.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-open-tool]');
    if (b) openTool(b.dataset.openTool as MisTool);
  });

  function renderSide() {
    const counts = new Map<string, number>();
    for (const m of missions) {
      if (!visible(m, true)) continue;
      counts.set('all', (counts.get('all') ?? 0) + 1);
      const s = sectionOf(m);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    if (embedded) return;
    const toolLinks = (list: { id: MisTool; label: string }[]) => list.map((t) => `<button class="side-link ${state.tool === t.id ? 'active' : ''}" data-mis-tool="${t.id}">${esc(t.label)}</button>`).join('');
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Misiuni'))}</div>
      <div class="side-nav"><div class="ord-side-label">${tx('Ghiduri')}</div>${GUIDES.map((g) => `<button class="side-link ${!state.tool && state.guide === g.id ? 'active' : ''}" data-mis-guide="${g.id}">${esc(g.label)}</button>`).join('')}${toolLinks(GUIDE_TOOLS)}
        <div class="ord-side-label">${tx('Misiuni')}</div>${sections.map((s) => `<button class="side-link ${!state.tool && !state.guide && s.id === state.section ? 'active' : ''}" data-mis-section="${s.id}">${esc(s.label)}<span class="count">${missions.length ? counts.get(s.id) ?? 0 : ''}</span></button>`).join('')}${toolLinks(EPIC_TOOLS)}
        <div class="ord-side-label">${tx('Agenți și LP')}</div>${toolLinks(AGENT_TOOLS)}
        <div class="ord-side-label">Blitz</div>${toolLinks(BLITZ_TOOLS)}</div>`;
  }

  const openGroups = new Set<string>();
  let sgOpen = false;
  let sgItems: Mission[] = [];
  let sgIndex = -1;
  let applyTimer = 0;
  const qActive = () => norm(state.q).length >= 2;

  function renderBar() {
    bar.innerHTML = `<div class="mis-bar">
      <div class="mis-search-wrap">
      <div class="mis-search" id="${P}SearchBox">
        ${icon('search')}
        <input id="${P}Search" type="text" placeholder="${esc(embedded ? tx('Caută după numele complexului') : tx('Caută după numele misiunii'))}" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="${P}Suggest" aria-autocomplete="list" />
        <button type="button" class="mis-clear" id="${P}Clear" aria-label="${esc(tx('Șterge căutarea'))}" hidden>×</button>
        <span class="mis-count" id="${P}Count"></span>
        <kbd>/</kbd>
      </div>
      <div class="mis-suggest" id="${P}Suggest" role="listbox" hidden></div>
      </div>
    </div>`;
    const input = bar.querySelector<HTMLInputElement>(`#${P}Search`)!;
    input.value = state.q;
    const clear = bar.querySelector<HTMLButtonElement>(`#${P}Clear`)!;
    const measure = document.createElement('span');
    measure.className = 'mis-measure';
    bar.querySelector(`#${P}SearchBox`)!.append(measure);
    const syncClear = () => {
      clear.hidden = !input.value;
      if (!input.value) { input.style.width = ''; input.classList.remove('sized'); return; }
      measure.textContent = input.value;
      const w = measure.getBoundingClientRect().width;
      if (!w) { input.style.width = ''; input.classList.remove('sized'); return; }
      input.style.width = `${Math.ceil(w) + 4}px`;
      input.classList.add('sized');
    };
    syncClear();
    input.addEventListener('sync', syncClear);
    const reset = () => { input.value = ''; state.q = ''; state.open = ''; syncClear(); closeSg(); save(); apply(); };
    clear.addEventListener('click', (e) => { e.stopPropagation(); reset(); input.focus(); });
    input.addEventListener('focus', () => openSg());
    input.addEventListener('input', () => {
      state.q = input.value;
      syncClear();
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
        const m = sgOpen ? sgItems[sgIndex] : undefined;
        if (m) pickSg(m); else closeSg();
      } else if (e.key === 'Escape') {
        if (sgOpen) { closeSg(); return; }
        reset();
      } else if (e.key === 'Tab') closeSg();
    });
    const sg = bar.querySelector<HTMLElement>(`#${P}Suggest`)!;
    sg.addEventListener('mousedown', (e) => e.preventDefault());
    sg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sg]');
      if (b) pickSg(sgItems[Number(b.dataset.sg)]);
    });
    bar.querySelector<HTMLElement>(`#${P}SearchBox`)!.addEventListener('click', () => input.focus());
  }

  const countLabel = (n: number) => (embedded ? (n === 1 ? tx('1 complex') : tx('{n} complexe', { n })) : n === 1 ? tx('1 misiune') : tx('{n} misiuni', { n }));

  function hl(text: string, q: string) {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
    const low = text.toLowerCase();
    const marks: [number, number][] = [];
    for (const t of terms) {
      const i = low.indexOf(t);
      if (i >= 0 && !marks.some(([a, b]) => i < b && i + t.length > a)) marks.push([i, i + t.length]);
    }
    marks.sort((a, b) => a[0] - b[0]);
    let out = '';
    let pos = 0;
    for (const [a, b] of marks) { out += `${esc(text.slice(pos, a))}<mark>${esc(text.slice(a, b))}</mark>`; pos = b; }
    return out + esc(text.slice(pos));
  }

  function openSg() {
    const sg = bar.querySelector<HTMLElement>(`#${P}Suggest`);
    const input = bar.querySelector<HTMLInputElement>(`#${P}Search`);
    if (!sg || !input || !missions.length) return;
    if (!qActive()) { closeSg(); return; }
    sgItems = missions.filter((m) => visible(m)).slice(0, 30);
    sgIndex = sgItems.length ? 0 : -1;
    sg.innerHTML = sgItems.length
      ? sgItems.map((m, i) => {
        const lvl = levels.get(m.key) ?? 'x';
        return `<button type="button" class="mis-sg" data-sg="${i}" role="option">${levelTag(m)}<span class="mis-sg-name">${hl(m.name, input.value)}${m.range ? ` <span class="mis-range">${rangeLabel(m)}</span>` : ''}</span><span class="mis-sg-meta">${esc(INTENSITY[lvl])}</span></button>`;
      }).join('')
      : `<div class="mis-sg-empty">${tx('Nicio misiune nu se potrivește')}</div>`;
    sg.hidden = false;
    sgOpen = true;
    input.setAttribute('aria-expanded', 'true');
    markSg();
  }

  function markSg() {
    const sg = bar.querySelector<HTMLElement>(`#${P}Suggest`);
    if (!sg) return;
    sg.querySelectorAll<HTMLElement>('[data-sg]').forEach((b) => {
      const on = Number(b.dataset.sg) === sgIndex;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView({ block: 'nearest' });
    });
  }

  function closeSg() {
    const sg = bar.querySelector<HTMLElement>(`#${P}Suggest`);
    if (sg) sg.hidden = true;
    sgOpen = false;
    bar.querySelector(`#${P}Search`)?.setAttribute('aria-expanded', 'false');
  }

  function pickSg(m: Mission) {
    const input = bar.querySelector<HTMLInputElement>(`#${P}Search`)!;
    input.value = m.name;
    state.q = m.name;
    state.open = m.key;
    input.dispatchEvent(new Event('sync'));
    input.blur();
    closeSg();
    save();
    apply();
    const d = list.querySelector<HTMLDetailsElement>(`details[data-key="${CSS.escape(m.key)}"]`);
    if (d && !d.hidden) { const g = d.closest<HTMLDetailsElement>('details.mis-group'); if (g) g.open = true; d.open = true; d.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }

  document.addEventListener('pointerdown', (e) => { if (sgOpen && !bar.contains(e.target as Node)) closeSg(); });

  function variantsFor(m: Mission): MVariant[] {
    return m.variants;
  }

  function visible(m: Mission, ignoreSection = false): boolean {
    if (!ignoreSection && state.section !== 'all' && sectionOf(m) !== state.section) return false;
    if (qActive()) {
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
        <span class="mis-name">${esc(m.name)}${m.range ? ` <span class="mis-range">${rangeLabel(m)}</span>` : ''}</span>
        <span class="mis-tags">${levelTag(m)}<span class="badge mis-int ${lvl}">${esc(INTENSITY[lvl])}</span>${m.story ? `<span class="badge gold">${tx('Storyline')}</span>` : ''}${m.bonus?.some((b) => b.k === 'room') ? `<span class="badge gold">${tx('Cameră bonus')}</span>` : ''}${hasBlitz(m) || m.guide?.blitz ? `<span class="badge ok">Blitz</span>` : ''}${m.courier ? `<span class="badge">${tx('Curier')}</span>` : ''}${facs.map((f) => `<span class="badge">${esc(faction(f).name)}</span>`).join('')}${emp ? `<span class="badge warn">${tx('scade standing')}</span>` : some ? `<span class="badge">${tx('standing doar la unele variante')}</span>` : ''}${m.ship ? `<span class="badge">${esc(tx('Maxim: {s}', { s: pick(m.ship) }))}</span>` : ''}</span>
      </span>
      <span class="mis-weak">${weak.map(chip).join('')}</span>
    </summary>`;
  }

  const chargeTypes = () => sde.typesInCategory(Category.Charge);

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
    const out = rows.filter((r) => r.share >= 0.5).sort((a, b) => b.v - a.v).slice(0, 3).map((r) => r.name);
    ammoCache.set(key, out);
    return out;
  }

  function weaponTier(m: Mission): 0 | 1 | 2 {
    if (m.rating) return m.rating <= 3 ? 0 : m.rating <= 6 ? 1 : 2;
    return m.level <= 1 ? 0 : m.level <= 3 ? 1 : 2;
  }

  function ammoFamilies(m: Mission): [string, string][] {
    const t = weaponTier(m);
    const rows: [[string, string, string], [string, string, string]][] = [
      [[tx('Rachete light'), tx('Rachete heavy'), tx('Rachete cruise')], ['Light Missile Launcher II', 'Heavy Missile Launcher II', 'Cruise Missile Launcher II']],
      [['Rockets', 'HAM', tx('Torpile')], ['Rocket Launcher II', 'Heavy Assault Missile Launcher II', 'Torpedo Launcher II']],
      [[tx('Hibride'), tx('Hibride'), tx('Hibride')], ['Light Neutron Blaster II', 'Heavy Neutron Blaster II', 'Neutron Blaster Cannon II']],
      [[tx('Lasere'), tx('Lasere'), tx('Lasere')], ['Small Focused Pulse Laser II', 'Focused Medium Pulse Laser II', 'Mega Pulse Laser II']],
      [[tx('Proiectile'), tx('Proiectile'), tx('Proiectile')], ['200mm AutoCannon II', '425mm AutoCannon II', '800mm Repeating Cannon II']],
    ];
    return rows.map(([labels, names]) => [labels[t], names[t]] as [string, string]);
  }

  function ammoLines(m: Mission, v: MVariant) {
    const weak = weakOf(v).slice(0, 2);
    if (!weak.length) return '';
    return ammoFamilies(m).map(([label, weaponName]) => {
      const w = sde.findType(weaponName)?.id;
      if (w == null) return '';
      const names = [...new Set(weak.flatMap((d) => ammoFor(w, d).slice(0, 1)))];
      if (!names.length) return '';
      return `<div class="mis-line"><span class="label">${esc(label)}</span><span>${names.map((n) => `<span class="mis-ammo">${esc(n)}</span>`).join(' ')}</span></div>`;
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
      ${ammoLines(m, v)}
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
    const warns = pickList(r.w);
    const info = (r.i ?? []).filter(([k]) => k in INFO_LABEL);
    return `<div class="mis-room">
      <div class="mis-room-head">${esc(pick(r.n) || tx('Camera {n}', { n: i + 1 }))}${r.gate ? ` <span class="dim">· ${esc(tx('poarta la {d}', { d: r.gate }))}</span>` : ''}</div>
      ${warns.length ? `<ul class="mis-notes mis-warn">${warns.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
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

  function partHead(p: Mission) {
    const [a, b] = p.range ?? [1, 1];
    const t = p.total ?? b;
    return a === b ? tx('Partea {n} din {t}', { n: a, t }) : tx('Părțile {a}-{b} din {t}', { a, b, t });
  }

  function body(m: Mission): string {
    if (m.parts?.length) return m.parts.map((p) => `<section class="mis-part"><div class="mis-part-head">${esc(partHead(p))}</div>${body(p)}</section>`).join('');
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
    const grouped = state.section === 'all' || state.section === 'ded';
    list.classList.toggle('mis-flat', !grouped);
    list.querySelectorAll<HTMLDetailsElement>('details.mis-group').forEach((g) => {
      const n = g.querySelectorAll('details.mis-card:not([hidden])').length;
      g.hidden = n === 0;
      g.querySelector('.mis-group-count')!.textContent = String(n);
      const want = !grouped || qActive() || openGroups.has(g.dataset.group!);
      if (g.open !== want) g.open = want;
    });
    const count = bar.querySelector(`#${P}Count`);
    if (count) count.textContent = countLabel(shown);
    list.querySelector('.mis-empty')?.toggleAttribute('hidden', shown !== 0);
    renderSide();
  }

  function renderList() {
    const groups = new Map<string, Mission[]>();
    for (const m of missions) { const g = groupOf(m); const arr = groups.get(g); if (arr) arr.push(m); else groups.set(g, [m]); }
    list.innerHTML = `${[...groups].map(([g, ms]) => `<details class="mis-group" data-group="${g}">
        <summary class="mis-group-head"><span class="mis-caret" aria-hidden="true"></span><span class="mis-group-name">${esc(groupLabel(g))}</span><span class="mis-group-count"></span></summary>
        <div class="mis-group-body">${ms.map((m) => `<details class="mis-card panel" data-key="${esc(m.key)}">${summary(m)}<div class="mis-body"></div></details>`).join('')}</div>
      </details>`).join('')}
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
    const g = e.target as HTMLDetailsElement;
    if (g instanceof HTMLDetailsElement && g.classList.contains('mis-group')) {
      if ((state.section === 'all' || state.section === 'ded') && !qActive()) { if (g.open) openGroups.add(g.dataset.group!); else openGroups.delete(g.dataset.group!); }
      return;
    }
    const d = e.target as HTMLDetailsElement;
    if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('mis-card')) return;
    if (d.open && state.open !== d.dataset.key) { state.open = d.dataset.key; save(); }
    const b = d.querySelector<HTMLElement>('.mis-body')!;
    if (d.open && !b.innerHTML) { const m = missions.find((x) => x.key === d.dataset.key); if (m) b.innerHTML = body(m); }
  }, true);

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const v = t.closest<HTMLElement>('[data-mis-variant]');
    if (v) {
      const [key, i] = v.dataset.misVariant!.split('|');
      chosen.set(key, Number(i));
      const d = v.closest<HTMLDetailsElement>('details.mis-card');
      if (d) refreshCard(d);
      return;
    }
    const tank = t.closest<HTMLElement>('[data-mis-tank]');
    if (tank) { const [site, fac] = tank.dataset.misTank!.split('|'); opts.onTank(site, fac); return; }
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
    apply();
    el.closest('.main')?.scrollTo({ top: 0 });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || (embedded ? el.hidden || !el.closest('.view.active') : !el.classList.contains('active'))) return;
    const a = document.activeElement;
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    bar.querySelector<HTMLInputElement>(`#${P}Search`)?.focus();
  });

  renderSide();
  showTool();
  loadMissions().then((data) => {
    const sortName = (n: string) => n.replace(/^(The|A|An) /i, '').replace(/[()[\]]/g, '').replace(/\s+/g, ' ').trim();
    missions = mergeChains(data.missions).filter((m) => (sectionOf(m) === 'ded') === embedded).sort((a, b) => GROUP_ORDER.indexOf(groupOf(a)) - GROUP_ORDER.indexOf(groupOf(b)) || sortName(a.name).localeCompare(sortName(b.name), 'en', { numeric: true, sensitivity: 'base' }));
    levels = intensities(missions);
    texts = new Map(missions.map((m) => [m.key, searchText(m)]));
    renderBar();
    renderList();
    const d = state.open ? list.querySelector<HTMLDetailsElement>(`details[data-key="${CSS.escape(state.open)}"]`) : null;
    if (d && !d.hidden) d.open = true;
  }).catch(() => {
    list.innerHTML = panel({ body: alertBox(tx('Nu am putut încărca datele misiunilor. Reîncarcă pagina.'), 'danger') });
  });

  return {
    openMission,
    names: () => missions.map((m) => m.name),
  };
}
