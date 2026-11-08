import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, button, formatInt, copyText, toast } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { typeIconUrl } from '../services/market';
import { loadMap, displaySec, secClass, type NavMap } from '../services/navigation';
import { loadAgents, type AgentData } from '../services/agents';
import { pveOrigin, type Origin } from '../services/pveOrigin';
import { BLITZ_MISSIONS, BURNERS, BLITZ_SHIPS, BLITZ_FITS, NERGAL_FITS, type BlitzVerdict, type BlitzShip, type BlitzWhere, type BurnerKind, type Resist } from '../services/blitz';
import { parseEft } from '../io/eft';
import type { Fit } from '../engine/fit';
import { tx } from '../i18n';
import { requirementsFor, skillsPlan, fitTypeIds, type PlanStep } from '../character/requirements';
import { formatDuration } from '../character/training';
import { roman, showItemInfo } from '../ui/itemInfo';
import { loadPlan, savePlan, addToPlan } from '../character/skillPlan';

const STATE_KEY = 'eve-pve:blitz';
const HUB_LIMIT = 25;
const POPULAR = new Set(['Sisters of EVE', 'Caldari Navy', 'Republic Fleet']);

type Tab = 'missions' | 'burners' | 'nergal' | 'where' | 'ships';
interface State { tab: Tab; faction: number }

const TABS: { id: Tab; label: string }[] = [
  { id: 'missions', label: tx('Misiuni de blitz') },
  { id: 'burners', label: tx('Misiuni Anomic') },
  { id: 'nergal', label: tx('Setul Nergal') },
  { id: 'where', label: tx('Unde') },
  { id: 'ships', label: tx('Nave') },
];

const VERDICT: Record<BlitzVerdict, { label: string; cls: string }> = {
  always: { label: tx('Fă-o mereu'), cls: 'ok' },
  good: { label: tx('Bună'), cls: 'accent' },
  empire: { label: tx('Costă standing la imperiu'), cls: 'warn' },
  standing: { label: tx('Doar pentru standing'), cls: '' },
};
const SHIP: Record<BlitzShip, string> = { frig: tx('Fregată rapidă'), bs: tx('Machariel sau Marauder'), arty: tx('Machariel cu artilerie') };
const WHERE: Record<BlitzWhere, string> = { system: tx('în sistemul agentului'), adjacent: tx('în sistemul vecin'), const: tx('în constelație'), '': '' };
const KIND: Record<BurnerKind, string> = { agent: 'Anomic Agent', team: 'Anomic Team', base: 'Anomic Base' };
const KIND_NOTE: Record<BurnerKind, string> = { agent: tx('o fregată pirat'), team: tx('o fregată T2 cu doi logistici'), base: tx('mai multe nave, cruiser recomandat') };
const RESIST: Record<Resist, string> = { em: 'EM', thermal: tx('Termic'), kinetic: tx('Cinetic'), explosive: tx('Exploziv') };

const NERGAL_RECOMMENDED: [string, number][] = [
  ['Assault Frigates', 4], ['Small Disintegrator Specialization', 4], ['Surgical Strike', 4], ['Rapid Firing', 4], ['Motion Prediction', 4],
  ['Thermodynamics', 4], ['Nanite Operation', 4], ['Repair Systems', 4],
  ['EM Armor Compensation', 4], ['Thermal Armor Compensation', 4], ['Kinetic Armor Compensation', 4], ['Explosive Armor Compensation', 4],
  ['Acceleration Control', 4], ['High Speed Maneuvering', 4], ['Evasive Maneuvering', 4],
  ['Capacitor Management', 5], ['Capacitor Systems Operation', 5], ['Weapon Upgrades', 5], ['Advanced Weapon Upgrades', 4], ['Drone Interfacing', 4],
];

const fitShip = (id: string) => BLITZ_FITS[id].slice(1, BLITZ_FITS[id].indexOf(','));
const fitName = (id: string) => { const h = BLITZ_FITS[id].split('\n')[0]; return h.slice(h.indexOf(',') + 1, -1).trim(); };

export function createBlitzPanel(el: HTMLElement, ctx: AppContext, opts: {
  openFit: (fit: Fit) => void;
  openMission: (name: string, section: string) => void;
  openSection: (section: string) => void;
  openAgents: (corp: number, faction: number) => void;
  openTool: (id: string) => void;
  blitzCounts: () => Map<number, number>;
}) {
  const state: State = { tab: 'missions', faction: 0, ...loadJson<Partial<State>>(STATE_KEY, {}) };
  if (!TABS.some((t) => t.id === state.tab)) state.tab = 'missions';
  let visible = false;
  let seq = 0;
  let agents: AgentData | null = null;
  let map: NavMap | null = null;
  let origin: Origin = { system: null, esi: false, needScope: false };

  const shipIcon = (name: string, size = 32) => {
    const t = ctx.sde.findType(name);
    return t ? `<img class="row-icon" src="${typeIconUrl(t.id, size)}" alt="" loading="lazy" />` : '';
  };
  const fitBtn = (id: string, label = fitShip(id), cls = 'sm') => button(label, { cls, attrs: `data-bz-fit="${id}" title="${esc(tx('Deschide în Fitting'))}"` });

  function head() {
    return `<div class="pve-facts">
        <div><span class="label">${tx('Burner')}</span><span class="value">~5 min</span><span class="small dim">${tx('cu drumul inclus')}</span></div>
        <div><span class="label">${tx('LP pe burner')}</span><span class="value">~14k</span><span class="small dim">${tx('agent în 0.5, Security Connections V')}</span></div>
        <div><span class="label">${tx('Venit posibil')}</span><span class="value">200M+/h</span><span class="small dim">${tx('blitz L4 plus burnere, cu LP vândut')}</span></div>
      </div>
      <div class="chip-row bz-tabs">${TABS.map((t) => `<button class="chip-btn ${t.id === state.tab ? 'active' : ''}" data-bz-tab="${t.id}">${t.label}</button>`).join('')}</div>`;
  }

  function missionsTab() {
    const counts = opts.blitzCounts();
    return `<ul class="pve-list">
        <li>${tx('Faci doar ce e în listă, restul refuzi.')}</li>
        <li>${tx('Un refuz la 4 ore per agent e gratuit, după aceea scade standing-ul.')}</li>
        <li>${tx('Standing-ul la facțiune te ține la L4 chiar dacă cel la corporație scade.')}</li>
        <li>${tx('La 16 misiuni L4 terminate primești un storyline, care urcă standing-ul la facțiune.')}</li>
        <li>${tx('Lași loot-ul, în afară de epavele lui Zor și ale Talos.')}</li>
      </ul>
      <div class="bz-table"><table class="table compact"><thead><tr><th>${tx('Misiune')}</th><th>${tx('Verdict')}</th><th>${tx('Navă')}</th><th>${tx('Cum')}</th><th></th></tr></thead><tbody>
        ${BLITZ_MISSIONS.map((m) => `<tr>
          <td><b>${esc(m.name)}</b>${m.where ? `<div class="small dim">${WHERE[m.where]}</div>` : ''}</td>
          <td><span class="badge ${VERDICT[m.verdict].cls}">${VERDICT[m.verdict].label}</span></td>
          <td class="small">${SHIP[m.ship]}</td>
          <td class="small">${esc(m.how)}</td>
          <td class="r">${button(tx('Ghid'), { cls: 'sm ghost', attrs: `data-bz-mission="${esc(m.name)}"` })}</td>
        </tr>`).join('')}
      </tbody></table></div>
      <p class="small bz-levels"><span class="dim">${tx('Note de blitz pentru alte niveluri:')}</span> ${[1, 2, 3, 5].map((l) => `<button class="chip-btn" data-bz-section="l${l}">L${l} · ${formatInt(counts.get(l) ?? 0)}</button>`).join(' ')}</p>`;
  }

  function burnersTab() {
    const kinds: BurnerKind[] = ['agent', 'team', 'base'];
    return `<p class="small dim">${tx('Le dau doar agenții de securitate L4. Agent și Team acceptă doar nave mici, la baze intri cu cruiser.')}</p>
      ${kinds.map((k) => `<h4 class="bz-sub">${KIND[k]} <span class="dim small">· ${KIND_NOTE[k]}</span></h4>
      <div class="bz-table"><table class="table compact"><thead><tr><th>${tx('Inamic')}</th><th>${tx('Tank pe')}</th><th>${tx('Cum')}</th><th class="r">${tx('Fit')}</th></tr></thead><tbody>
        ${BURNERS.filter((b) => b.kind === k).map((b) => `<tr class="${b.skip ? 'dim' : ''}">
          <td><span class="recon-ship">${b.enemyId ? `<img class="row-icon" src="${typeIconUrl(b.enemyId, 32)}" alt="" loading="lazy" />` : ''}<span><b>${esc(b.enemy)}</b><div class="small dim">${esc(b.title)}</div></span></span></td>
          <td class="bz-tank">${b.tank.map((d) => `<span class="dmg-tag ${d}">${RESIST[d]}</span>`).join('')}</td>
          <td class="small">${esc(b.how)}</td>
          <td class="r bz-fits">${b.skip ? `<span class="badge warn">${tx('Refuz')}</span>` : `${b.fit ? fitBtn(b.fit) : ''}${b.alt ? ` ${fitBtn(b.alt, fitShip(b.alt), 'sm ghost')}` : ''}`}</td>
        </tr>`).join('')}
      </tbody></table></div>`).join('')}
      <p class="dim small wallet-note">${tx('Fiturile vin din ghidurile comunității. Verifică în Fitting dacă ai skill-urile și supraîncălzește doar cât scrie în pași.')}</p>`;
  }

  function shoppingList(): string {
    const max = new Map<string, number>();
    const add = (name: string, n: number, sum: Map<string, number>) => sum.set(name, (sum.get(name) ?? 0) + n);
    for (const id of NERGAL_FITS) {
      const sum = new Map<string, number>();
      for (const raw of BLITZ_FITS[id].split('\n').slice(1)) {
        const line = raw.trim();
        if (!line || line.startsWith('[')) continue;
        const m = line.match(/^(.*?) x(\d+)$/);
        const name = (m ? m[1] : line).split(',')[0].trim();
        add(name, m ? Number(m[2]) : 1, sum);
      }
      for (const [n, c] of sum) max.set(n, Math.max(max.get(n) ?? 0, c));
    }
    return [['Nergal', 1] as [string, number], ...max].map(([n, c]) => `${n} ${c}`).join('\n');
  }

  function nergalSkills() {
    const sde = ctx.sde;
    const c = ctx.character;
    const hullId = sde.findType('Nergal')?.id ?? 0;
    const mods = new Set<number>();
    for (const id of NERGAL_FITS) {
      try { for (const t of fitTypeIds(parseEft(sde, BLITZ_FITS[id]).fit)) if (t !== hullId) mods.add(t); } catch { continue; }
    }
    const hull = requirementsFor(sde, [hullId], c);
    const hullMax = new Map(hull.steps.map((x) => [x.skillId, x.required]));
    const all = requirementsFor(sde, [hullId, ...mods], c);
    const modSteps = all.steps.filter((x) => (hullMax.get(x.skillId) ?? 0) < x.required);
    const rec = new Map<number, number>();
    for (const [name, lvl] of NERGAL_RECOMMENDED) {
      const t = sde.findType(name);
      if (t && (all.steps.find((x) => x.skillId === t.id)?.required ?? 0) < lvl) rec.set(t.id, lvl);
    }
    const recPlan = skillsPlan(sde, rec, c);
    const recSteps = recPlan.steps.filter((x) => rec.has(x.skillId));
    return { hullId, hull, all, modSteps, rec, recPlan, recSteps };
  }

  function skillTable(steps: PlanStep[]) {
    return `<table class="table compact bz-skills"><thead><tr><th>${tx('Skill')}</th><th class="r">${tx('Necesar')}</th><th class="r">${tx('Tu')}</th><th class="r">${tx('Timp')}</th></tr></thead><tbody>
      ${steps.map((x) => `<tr><td><button class="link" data-bz-info="${x.skillId}">${esc(x.name)}</button></td><td class="r num">${roman(x.required)}</td><td class="r"><span class="badge ${x.status === 'ok' ? 'ok' : x.status === 'partial' ? 'warn' : 'danger'}">${x.current ? roman(x.current) : '0'}</span></td><td class="r num">${x.status === 'ok' ? '<span class="dim">—</span>' : formatDuration(x.seconds)}</td></tr>`).join('')}
    </tbody></table>`;
  }

  function nergalTab() {
    const k = nergalSkills();
    const missing = (steps: PlanStep[]) => steps.filter((x) => x.status !== 'ok');
    const summary = (steps: PlanStep[], total: number, plan: string) => {
      const m = missing(steps).length;
      return `<p class="small bz-skill-sum">${m ? `${tx('Îți lipsesc {n}', { n: m })} · <b>${formatDuration(total)}</b> ${button(tx('Adaugă în planul de skill-uri'), { cls: 'sm ghost', attrs: `data-bz-plan="${plan}"` })}` : `<span class="badge ok">${tx('Le ai pe toate')}</span>`}</p>`;
    };
    return `<div class="bz-hero">
        ${k.hullId ? `<img class="bz-hero-img" src="${typeIconUrl(k.hullId, 64)}" alt="" />` : ''}
        <div>
          <h4 class="bz-hero-title">${tx('Nergal: nava pentru misiunile Anomic Agent și Anomic Team')}</h4>
          <p class="small">${tx('Misiunile Anomic (numite și burnere) le dau agenții de securitate L4. În fiecare te bați cu o singură fregată pirat sau T2 mult mai puternică decât una normală și primești ~14k LP.')}</p>
          <p class="small">${tx('Nergal e o fregată de asalt Triglavian. Arma ei face tot mai mult damage cât timp trage în aceeași țintă, e rapidă și are tank bun pe armură. Cu aceleași rig-uri o refitezi pentru toate cele 9 misiuni de fregată.')}</p>
          <div class="row-actions">${button(tx('Informații despre Nergal'), { cls: 'sm ghost', iconName: 'info', attrs: `data-bz-info="${k.hullId}"` })}</div>
        </div>
      </div>
      <h4 class="bz-sub">${tx('1. Skill-uri obligatorii')}</h4>
      <p class="small dim">${tx('Fără ele nu poți zbura nava sau nu poți pune modulele din fituri.')}</p>
      <div class="bz-two">
        <div><div class="small"><b>${tx('Ca să zbori nava')}</b></div>${skillTable(k.hull.steps)}</div>
        <div><div class="small"><b>${tx('Ca să folosești modulele din fituri')}</b></div>${skillTable(k.modSteps)}</div>
      </div>
      ${summary(k.all.steps, k.all.totalSeconds, 'required')}
      <h4 class="bz-sub">${tx('2. Skill-uri recomandate')}</h4>
      <p class="small dim">${tx('Nava zboară și fără ele, dar cu ele ai damage, tank și viteză destule ca să termini misiunile fără să pierzi nava.')}</p>
      ${k.recSteps.length ? skillTable(k.recSteps) : ''}
      ${summary(k.recSteps, k.recPlan.totalSeconds, 'recommended')}
      <h4 class="bz-sub">${tx('3. Fitul pentru fiecare misiune')}</h4>
      <p class="small">${tx('Rig-urile rămân mereu pe navă:')} <b>Small Auxiliary Nano Pump II</b> · <b>Small Capacitor Control Circuit II</b>. ${tx('Pentru fiecare misiune schimbi modulele și muniția: hardener-ele pe damage-ul cu care trage inamicul.')}</p>
      <div class="bz-grid">${NERGAL_FITS.map((id) => {
        const b = BURNERS.find((x) => x.fit === id)!;
        return `<div class="bz-card">
          <div class="bz-card-head"><b>${KIND[b.kind]} · ${esc(b.title)}</b></div>
          <div class="bz-card-target small"><span class="dim">${tx('Țintă')}</span><img class="row-icon" src="${typeIconUrl(b.enemyId, 32)}" alt="" loading="lazy" /><span>${esc(b.enemy)}</span></div>
          <div class="small"><span class="dim">${tx('Trage cu')}</span> ${b.tank.map((d) => `<span class="dmg-tag ${d}">${RESIST[d]}</span>`).join('')}</div>
          <div class="small">${esc(b.how)}</div>
          <div>${fitBtn(id, tx('Deschide fitul'))}</div>
        </div>`;
      }).join('')}</div>
      <p>${button(tx('Copiază lista de cumpărături'), { cls: 'sm', iconName: 'copy', attrs: 'data-bz-shop' })} <span class="dim small">${tx('pentru Multibuy, cu tot ce trebuie pentru toate cele 9')}</span></p>
      <p class="dim small wallet-note">${tx('Ia mereu toate tipurile de muniție. Hardenerele de același meta au același efect, cumpără-l pe cel mai ieftin.')}</p>`;
  }

  function hubsTab() {
    if (!agents || !map) return loader(tx('Încarc agenții'));
    const d = agents;
    const m = map;
    const dist = origin.system ? m.gateDistances(origin.system.id, 200) : null;
    const byCorp = new Map<number, { sys: number; sec: number }[]>();
    for (const a of d.agents) {
      if (a.level !== 4 || a.division !== 2 || a.kind !== 0) continue;
      const s = m.systems.get(a.system);
      if (!s || s.sec < 0.45) continue;
      (byCorp.get(a.corp) ?? byCorp.set(a.corp, []).get(a.corp)!).push({ sys: s.id, sec: s.sec });
    }
    const factions = [...new Set([...byCorp.keys()].map((c) => d.corps.get(c)?.faction ?? 0))].filter((f) => d.factions.has(f)).sort((a, b) => d.factions.get(a)!.localeCompare(d.factions.get(b)!));
    if (state.faction && !factions.includes(state.faction)) state.faction = 0;
    const rows = [...byCorp].filter(([c]) => !state.faction || d.corps.get(c)?.faction === state.faction).map(([c, list]) => {
      const low = list.reduce((a, b) => (b.sec < a.sec ? b : a));
      const near = dist ? Math.min(...list.map((x) => dist.get(x.sys) ?? Infinity)) : null;
      return { c, n: list.length, systems: new Set(list.map((x) => x.sys)).size, low, near };
    }).sort((a, b) => b.n - a.n || a.low.sec - b.low.sec);
    return `<ul class="pve-list">
        <li>${tx('Cu cât securitatea sistemului agentului e mai mică, cu atât primești mai mult LP.')}</li>
        <li>${tx('Mulți agenți L4 aproape înseamnă mai puțin drum când un agent nu are misiuni bune.')}</li>
        <li>${tx('Valoarea LP-ului contează cât misiunile: compară magazinele în Magazin LP.')}</li>
      </ul>
      <div class="pve-filters"><label>${tx('Facțiune')} <select class="input sm" id="bzFaction"><option value="0">${tx('Oricare')}</option>${factions.map((f) => `<option value="${f}" ${f === state.faction ? 'selected' : ''}>${esc(d.factions.get(f)!)}</option>`).join('')}</select></label>
      ${button(tx('Magazin LP'), { cls: 'sm ghost', attrs: 'data-bz-lp' })}</div>
      <div class="wallet-scroll tall"><table class="table compact"><thead><tr><th>${tx('Corporație')}</th><th class="r">${tx('Agenți L4 highsec')}</th><th>${tx('Sec cel mai mic')}</th>${dist ? `<th class="r">${tx('Salturi')}</th>` : ''}<th></th></tr></thead><tbody>
        ${rows.slice(0, HUB_LIMIT).map((r) => {
          const corp = d.corps.get(r.c);
          const s = m.systems.get(r.low.sys)!;
          return `<tr><td><span class="recon-ship"><img class="row-icon" src="https://images.evetech.net/corporations/${r.c}/logo?size=32" alt="" loading="lazy" /><span>${esc(corp?.name ?? '')}${POPULAR.has(corp?.name ?? '') ? ` <span class="badge gold">${tx('Popular')}</span>` : ''}<div class="small dim">${esc(d.factions.get(corp?.faction ?? 0) ?? '')}</div></span></span></td>
            <td class="r num">${r.n}<div class="small dim">${tx('{n} sisteme', { n: r.systems })}</div></td>
            <td>${esc(s.name)} <span class="sec ${secClass(s.sec)}">${displaySec(s.sec).toFixed(1)}</span><div class="small dim">${esc(m.region(s))}</div></td>
            ${dist ? `<td class="r num">${r.near != null && Number.isFinite(r.near) ? r.near : '—'}</td>` : ''}
            <td class="r">${button(tx('Agenți'), { cls: 'sm ghost', attrs: `data-bz-agents="${r.c}" data-bz-fac="${corp?.faction ?? 0}"` })}</td></tr>`;
        }).join('')}
      </tbody></table></div>
      ${dist ? '' : `<p class="dim small wallet-note">${tx('Alege sistemul de pornire în Agenți ca să vezi salturile.')}</p>`}`;
  }

  function shipsTab() {
    const group = (role: 'blitz' | 'burner', title: string) => `<h4 class="bz-sub">${title}</h4>
      <div class="bz-grid">${BLITZ_SHIPS.filter((s) => s.role === role).map((s) => `<div class="bz-card">
        <div class="bz-card-head">${shipIcon(s.ship)}<b>${esc(s.ship)}</b></div>
        <div class="small">${esc(s.note)}</div>
        <div class="bz-fits">${s.tab ? button(tx('Vezi setul'), { cls: 'sm', attrs: `data-bz-tab="${s.tab}"` }) : s.fits.length ? s.fits.map((id) => fitBtn(id, fitName(id))).join(' ') : button(tx('Deschide nava'), { cls: 'sm ghost', attrs: `data-bz-ship="${esc(s.ship)}"` })}</div>
      </div>`).join('')}</div>`;
    return `${group('blitz', tx('Blitz L4'))}${group('burner', tx('Burnere'))}
      <ul class="pve-list">
        <li>${tx('Implanturi Ascendancy și WS-615 cresc viteza warp pe toate navele.')}</li>
        <li>${tx('Zor\'s Custom Navigation Hyper-Link ajută navele cu MWD sau AB.')}</li>
        <li>${tx('Marauderele scumpe atrag gankeri în sistemele aglomerate.')}</li>
      </ul>
      <p class="dim small wallet-note">${tx('Pentru navele fără fit, Fitting are butoanele PvE fit.')}</p>`;
  }

  function render() {
    const body = state.tab === 'missions' ? missionsTab() : state.tab === 'burners' ? burnersTab() : state.tab === 'nergal' ? nergalTab() : state.tab === 'where' ? hubsTab() : shipsTab();
    el.innerHTML = panel({ title: tx('Ghid blitz L4'), body: `${head()}<div class="bz-body">${body}</div>` });
  }

  async function loadHubs() {
    const mine = ++seq;
    try {
      const [d, m] = await Promise.all([loadAgents(), loadMap()]);
      const o = await pveOrigin(ctx, m);
      if (mine !== seq || !visible) return;
      agents = d;
      map = m;
      origin = o;
      if (state.tab === 'where') render();
    } catch (err) {
      if (mine === seq && state.tab === 'where') el.querySelector('.bz-body')!.innerHTML = alertBox((err as Error).message, 'danger');
    }
  }

  function openFit(id: string, text = BLITZ_FITS[id]) {
    try {
      const { fit, unknown } = parseEft(ctx.sde, text);
      opts.openFit(fit);
      if (unknown.length) toast(tx('Linii necunoscute: {list}', { list: unknown.join(', ') }));
    } catch (err) {
      toast((err as Error).message);
    }
  }

  const save = () => saveJson(STATE_KEY, state);

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>('[data-bz-tab]');
    if (tab) { state.tab = tab.dataset.bzTab as Tab; save(); render(); if (state.tab === 'where' && !agents) void loadHubs(); return; }
    const fit = t.closest<HTMLElement>('[data-bz-fit]');
    if (fit) { openFit(fit.dataset.bzFit!); return; }
    const ship = t.closest<HTMLElement>('[data-bz-ship]');
    if (ship) { openFit('', `[${ship.dataset.bzShip}, ${ship.dataset.bzShip}]`); return; }
    const mis = t.closest<HTMLElement>('[data-bz-mission]');
    if (mis) { opts.openMission(mis.dataset.bzMission!, 'l4'); return; }
    const sec = t.closest<HTMLElement>('[data-bz-section]');
    if (sec) { opts.openSection(sec.dataset.bzSection!); return; }
    const ag = t.closest<HTMLElement>('[data-bz-agents]');
    if (ag) { opts.openAgents(Number(ag.dataset.bzAgents), Number(ag.dataset.bzFac)); return; }
    if (t.closest('[data-bz-lp]')) { opts.openTool('lp'); return; }
    const info = t.closest<HTMLElement>('[data-bz-info]');
    if (info) { showItemInfo(ctx, Number(info.dataset.bzInfo)); return; }
    const plan = t.closest<HTMLElement>('[data-bz-plan]');
    if (plan) {
      const k = nergalSkills();
      const c = ctx.character;
      const want = plan.dataset.bzPlan === 'required' ? k.all.steps : k.recSteps;
      let next = loadPlan(c.id);
      for (const x of want) if (x.status !== 'ok') next = addToPlan(ctx.sde, next, c, x.skillId, x.required);
      savePlan(c.id, next);
      toast(tx('Adăugat în planul de skill-uri'));
      return;
    }
    if (t.closest('[data-bz-shop]')) void copyText(shoppingList(), tx('Lista e copiată. Lipește-o în Multibuy.'));
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'bzFaction') { state.faction = Number((t as HTMLSelectElement).value); save(); render(); }
  });

  return {
    show() { visible = true; render(); if (state.tab === 'where') void loadHubs(); },
    hide() { visible = false; },
  };
}
