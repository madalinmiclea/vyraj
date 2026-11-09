import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, formatNum, shortNum, button, confirmDialog } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { loadMap, displaySec, secClass, type NavMap } from '../services/navigation';
import { pveOrigin, originBar, bindOrigin, type Origin } from '../services/pveOrigin';
import { faction, FLAG_LABEL, EU_URL, type Dmg, type Ewar, EWAR_LABEL } from '../services/missions';
import {
  loadEpicArcs, loadArcDone, arcAccess, ARC_REQ, ARC_SHIPS, missionLimit, saveArcDone, pickArc, isChoice, arcStats, COOLDOWN_DAYS,
  type Arc, type ArcData, type ArcDone, type ArcMission, type ArcNode, type ArcProgress, type ArcWave, type ArcAccess, type GateCheck, type GateVia,
} from '../services/epicArcs';
import { tx, locale } from '../i18n';
import { loginProblem } from '../character/sso';
import { requirementsFor } from '../character/requirements';
import { formatDuration } from '../character/training';
import { emptyFit, type Fit } from '../engine/fit';
import { permissionGate } from '../character/permissions';
import { loadNpcStandings, cachedNpcStandings, canReadNpcStandings, socialSkills } from '../services/npcStandings';

const UI_KEY = 'eve-epic:ui';
const DAY = 86_400_000;

const DMG_NAME: Record<Dmg, string> = { em: 'EM', th: tx('Termic'), kin: tx('Cinetic'), exp: tx('Exploziv') };
const DMG_CLS: Record<Dmg, string> = { em: 'em', th: 'thermal', kin: 'kinetic', exp: 'explosive' };
const chip = (d: Dmg) => `<span class="badge mis-dmg ${DMG_CLS[d]}">${DMG_NAME[d]}</span>`;
const chips = (list: Dmg[]) => (list.length ? list.map(chip).join(' ') : `<span class="dim">${tx('Omni: orice tip')}</span>`);

const TYPE_LABEL: Record<ArcMission['t'], string> = { enc: tx('Luptă'), talk: tx('Discuție'), courier: tx('Curier'), choice: tx('Alegere') };

const CLS: Record<string, string> = {
  F: tx('Fregată'), EF: tx('Fregată elite'), D: tx('Distrugător'), C: tx('Crucișător'), EC: tx('Crucișător elite'), BC: tx('Battlecruiser'),
  BS: tx('Battleship'), EB: tx('Battleship elite'), ST: tx('Structură'), HK: tx('Se deschide cu hack'), GT: tx('Poartă'), TW: tx('Turn / santinelă'),
  DR: tx('Dronă'), CA: tx('Carrier'), IN: tx('Transportor'), O: '',
};

const FLAG: Record<string, string> = { ...FLAG_LABEL, friend: tx('Prietenos'), neutral: tx('Neutru') };

interface Ui { arc: string }

const FACTION_NAME: Record<number, string> = { 500001: 'Caldari State', 500002: 'Minmatar Republic', 500003: 'Amarr Empire', 500004: 'Gallente Federation', 500010: 'Guristas Pirates', 500011: 'Angel Cartel' };
const SKILL_NAME: Record<string, string> = { connections: 'Connections', diplomacy: 'Diplomacy', criminal: 'Criminal Connections' };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
const tone = (v: number) => (v <= -2 ? 'danger' : v < 0 ? 'warn' : v >= 5 ? 'ok' : v > 0 ? 'accent' : 'dim');
const stdNum = (v: number, base: number | undefined) => `<span class="std-val ${tone(v)}" title="${esc(tx('bază {v}', { v: formatNum(base ?? 0, 2) }))}">${formatNum(v, 2)}</span>`;

export function createEpicArcsPanel(el: HTMLElement, ctx: AppContext, opts: { onTank: (site: string, faction: string) => void; openFit?: (fit: Fit) => void }) {
  const ui: Ui = { arc: '', ...loadJson<Partial<Ui>>(UI_KEY, {}) };
  let visible = false;
  let seq = 0;
  let data: ArcData | null = null;
  let map: NavMap | null = null;
  let origin: Origin = { system: null, esi: false, needScope: false };
  const charKey = () => ctx.character.id;
  let done: ArcDone = loadArcDone(charKey());
  const saveUi = () => saveJson(UI_KEY, ui);
  const logged = () => !loginProblem(ctx.character) && !!ctx.character.characterId;
  const canRead = () => logged() && canReadNpcStandings(ctx.character.characterId!);

  function access(a: Arc): ArcAccess | null | undefined {
    if (!ARC_REQ[a.id]) return null;
    const st = canRead() ? cachedNpcStandings(ctx.character.characterId!) : null;
    return st ? arcAccess(a.id, st, socialSkills(ctx.sde, ctx.character)) : undefined;
  }

  function gateName(a: Arc, c: GateCheck, via: GateVia) {
    const s = a.starts?.[c.i];
    if (via === 'agent') return s?.agent ?? a.start.agent;
    if (via === 'corp') return s?.corp ?? a.start.corp;
    return FACTION_NAME[ARC_REQ[a.id].starts[c.i].faction] ?? '';
  }

  function verdict(a: Arc, r: ArcAccess) {
    const c = r.top;
    if (r.ok) return `<span class="badge ok">${tx('Poți începe')}</span> <span>${esc(gateName(a, c, c.via))} ${stdNum(c.v[c.via], c.base[c.via])}</span>`;
    const hint = r.unlock ? ` <span class="std-hint">${esc(tx('Cu {skill} {lvl}: deblocat', { skill: SKILL_NAME[r.unlock.skill], lvl: ROMAN[r.unlock.level] }))}</span>` : '';
    if (c.low.length) {
      const k = c.low[0];
      return `<span class="badge danger">${tx('Blocat')}</span> <span>${esc(tx('{name} sub -2', { name: gateName(a, c, k) }))} ${stdNum(c.v[k], c.base[k])}</span>${hint}`;
    }
    return `<span class="badge warn">${tx('Nu încă')}</span> <span>${esc(tx('lipsesc {x}', { x: formatNum(r.need - c.best, 2) }))} · ${esc(gateName(a, c, c.via))} ${stdNum(c.v[c.via], c.base[c.via])} ${esc(tx('din {n}', { n: formatNum(r.need, 2) }))}</span>${hint}`;
  }

  function shipsHtml(a: Arc) {
    const s = ARC_SHIPS[a.id];
    if (!s) return esc(pickArc(a.ship));
    const me = logged();
    const chips = s.ships.map((name) => {
      const t = ctx.sde.findType(name);
      if (!t) return '';
      const r = me ? requirementsFor(ctx.sde, [t.id], ctx.character) : null;
      const st = r ? (r.canFly ? `<span class="badge ok">${tx('Poți zbura')}</span>` : `<span class="dim">${esc(formatDuration(r.totalSeconds))}</span>`) : '';
      return `<button class="epic-ship" data-epic-ship="${t.id}" title="${esc(tx('Deschide în Fitting'))}"><img src="https://images.evetech.net/types/${t.id}/icon?size=64" alt="" width="28" height="28" loading="lazy" /><span>${esc(t.name)}</span>${st}</button>`;
    }).join('');
    const limits = s.limits.map((l) => `<li><span class="badge warn">${esc(pickArc(l.r))}</span> ${esc(l.m.join(', '))}</li>`).join('');
    return `<div><b>${esc(pickArc(s.hull))}</b> <span class="dim">· ${esc(pickArc(s.tier))}</span></div>
      <div>${esc(pickArc(a.ship))}</div>
      <div class="epic-ships">${chips}</div>
      ${limits ? `<div class="epic-limits"><span class="label">${tx('Limite de navă')}</span><ul>${limits}</ul></div>` : `<div class="small dim">${tx('Fără limită de navă la porți')}</div>`}`;
  }

  function standingCard(a: Arc) {
    const r = access(a);
    if (r === null) return `<span class="badge ok">${tx('Poți începe')}</span> <span class="dim">${tx('fără standing')}</span>`;
    if (!r) return esc(pickArc(a.standing));
    return verdict(a, r);
  }

  function standingPage(a: Arc) {
    const r = access(a);
    const text = esc(pickArc(a.standing));
    if (r === null) return `<div>${text}</div><div class="epic-std"><span class="badge ok">${tx('Poți începe')}</span></div>`;
    if (!r) {
      if (!logged()) return `<div>${text}</div><div class="small dim">${tx('Loghează un caracter ca să afli dacă poți începe.')}</div>`;
      if (!canRead()) return `<div>${text}</div>${permissionGate('npcstandings', ctx.character.characterId!, ctx.character.name)}`;
      return `<div>${text}</div>`;
    }
    const rows = r.checks.map((c) => {
      const cells = (['agent', 'corp', 'faction'] as GateVia[]).map((k) => `<span class="epic-std-cell"><span class="dim">${esc(gateName(a, c, k))}</span> ${stdNum(c.v[k], c.base[k])}</span>`).join('');
      const mark = c.ok ? `<span class="badge ok">${tx('Da')}</span>` : c.low.length ? `<span class="badge danger">${tx('Blocat')}</span>` : `<span class="badge warn">${tx('Nu')}</span>`;
      return `<div class="epic-std-row">${mark}${cells}</div>`;
    }).join('');
    return `<div>${text}</div><div class="epic-std">${verdict(a, r)}</div><div class="epic-std-rows">${rows}</div>`;
  }

  async function load() {
    if (!visible) return;
    const mine = ++seq;
    if (!data) el.innerHTML = panel({ title: tx('Arcuri epice'), body: loader(tx('Încarc arcurile epice')) });
    try {
      const [d, m] = await Promise.all([loadEpicArcs(), loadMap()]);
      origin = await pveOrigin(ctx, m);
      if (mine !== seq || !visible) return;
      if (canRead() && !cachedNpcStandings(ctx.character.characterId!)) {
        loadNpcStandings(ctx.character.characterId!).then(() => { if (mine === seq && visible) render(); }).catch(() => {});
      }
      data = d;
      map = m;
      if (ui.arc && !d.arcs.some((a) => a.id === ui.arc)) ui.arc = '';
      render();
    } catch (err) {
      if (mine === seq) el.innerHTML = panel({ title: tx('Arcuri epice'), body: alertBox((err as Error).message, 'danger') });
    }
  }

  const prog = (id: string): ArcProgress => (done[id] ??= { d: [], p: {} });
  const dist = () => (origin.system && map ? map.gateDistances(origin.system.id, 80) : null);

  function sysHtml(name: string | undefined, d: Map<number, number> | null) {
    if (!name) return '';
    const s = map?.find(name);
    if (!s) return esc(name);
    const j = d ? (d.has(s.id) ? tx('{n} salturi', { n: d.get(s.id)! }) : tx('peste 80 de salturi')) : '';
    return `${esc(s.name)} <span class="sec ${secClass(s.sec)}">${formatNum(displaySec(s.sec) || 0, 1)}</span>${j ? ` <span class="dim">· ${esc(j)}</span>` : ''}`;
  }

  const fmtDate = (t: number) => new Date(t).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });

  function statusBadge(a: Arc) {
    const p = done[a.id];
    const st = arcStats(a, p);
    if (st.finished) {
      const again = (p?.at ?? 0) + COOLDOWN_DAYS * DAY;
      return again > Date.now() ? `<span class="badge">${esc(tx('Din nou de pe {d}', { d: fmtDate(again) }))}</span>` : `<span class="badge ok">${tx('Terminat')}</span>`;
    }
    return st.sum ? `<span class="badge accent">${esc(tx('{d} din {n}', { d: st.sum, n: st.total }))}</span>` : '';
  }

  function listHtml(d: ArcData) {
    const dd = dist();
    const cards = d.arcs.map((a) => {
      const st = arcStats(a, done[a.id]);
      const pct = st.total ? Math.round((st.sum / st.total) * 100) : 0;
      return `<button class="epic-card" data-epic-arc="${a.id}">
        <span class="epic-card-head"><span class="epic-card-name">${esc(a.name)}</span>${statusBadge(a)}</span>
        <span class="mis-tags"><span class="badge">${esc(a.fac)}</span><span class="badge accent">L${a.level}</span><span class="badge">${esc(tx('{n} misiuni', { n: Object.keys(a.m).length }))}</span></span>
        <span class="epic-card-line"><span class="label">${tx('Start')}</span><span>${esc(a.start.agent)} · ${sysHtml(a.start.sys, dd)}${a.starts && a.starts.length > 1 ? ` <span class="dim">${esc(tx('și încă {n}', { n: a.starts.length - 1 }))}</span>` : ''}</span></span>
        ${ARC_SHIPS[a.id] ? `<span class="epic-card-line"><span class="label">${tx('Navă')}</span><span>${esc(pickArc(ARC_SHIPS[a.id].hull))} <span class="dim">· ${esc(pickArc(ARC_SHIPS[a.id].tier))}</span>${ARC_SHIPS[a.id].limits.length ? ` <span class="badge warn">${tx('Limite de navă')}</span>` : ''}</span></span>` : ''}
        <span class="epic-card-line"><span class="label">${tx('Standing')}</span><span>${standingCard(a)}</span></span>
        <span class="epic-card-line"><span class="label">${tx('Recompensă')}</span><span class="epic-clamp">${esc(pickArc(a.reward))}</span></span>
        <span class="cos-meter"><span style="width:${pct}%"></span></span>
      </button>`;
    }).join('');
    return panel({
      title: tx('Arcuri epice'),
      count: tx('{n} arcuri', { n: d.arcs.length }),
      body: `<div class="cos-rules"><span>${tx('Fiecare arc o dată la {n} de zile', { n: COOLDOWN_DAYS })}</span><span>${tx('Progresul se salvează pe caracter')}</span></div>
        ${originBar(map!, origin, 'epicOrigin')}
        <div class="epic-grid">${cards}</div>
        <p class="small dim">${tx('Surse: EVE University Wiki (CC BY-SA 4.0) și EVE Survival')}</p>`,
    });
  }

  function iskLine(m: ArcMission) {
    const r = m.rw;
    if (!r?.isk && !r?.bonus) return '';
    const v = (x: number[]) => (x.length > 1 ? `${shortNum(x[0])}-${shortNum(x[1])}` : shortNum(x[0]));
    const parts: string[] = [];
    if (r.isk) parts.push(`${v(r.isk)} ISK`);
    if (r.bonus) parts.push(r.bh ? tx('bonus {v} ISK în {h} h', { v: v(r.bonus), h: r.bh }) : tx('bonus {v} ISK', { v: v(r.bonus) }));
    else if (r.bonus === null) parts.push(tx('bonus de timp'));
    return parts.join(' + ');
  }

  function fight(a: Arc, m: ArcMission) {
    if (m.t !== 'enc' || (!m.fac?.length && !m.dealt?.length)) return '';
    const facs = m.fac ?? [];
    const weak = m.weak?.length ? m.weak : [...new Set(facs.flatMap((f) => faction(f).weak))];
    const dealt = m.dealt?.length ? m.dealt : [...new Set(facs.flatMap((f) => faction(f).shoot))];
    const ew = new Set<Ewar>();
    for (const w of m.w ?? []) for (const s of w.s) for (const f of s[3]) if (f in EWAR_LABEL && !s[3].includes('friend')) ew.add(f as Ewar);
    if (!m.w?.length) for (const f of facs) for (const e of faction(f).ewar) ew.add(e);
    const npc = facs.map((f) => faction(f).npc).find(Boolean);
    const site = m.hard ? 'mission/l4h' : `mission/l${Math.min(4, Math.max(1, a.level))}`;
    return `<div class="mis-combat">
      ${facs.length ? `<div class="mis-line"><span class="label">${tx('Inamic')}</span><span>${facs.map((f) => `<span class="badge">${esc(faction(f).name)}</span>`).join(' ')}</span></div>` : ''}
      <div class="mis-line"><span class="label">${tx('Trage cu')}</span><span>${chips(weak)}</span></div>
      <div class="mis-line"><span class="label">${tx('Primești')}</span><span>${chips(dealt)}</span></div>
      ${ew.size ? `<div class="mis-line"><span class="label">EWAR</span><span>${[...ew].map((e) => `<span class="badge warn">${esc(EWAR_LABEL[e])}</span>`).join(' ')}</span></div>` : ''}
      ${npc ? `<div class="mis-line"><span class="label"></span><span>${button(tx('Verifică tank-ul în Fitting'), { cls: 'sm', attrs: `data-epic-tank="${site}|${npc}"` })}</span></div>` : ''}
    </div>`;
  }

  function wavesHtml(w: ArcWave[]) {
    const rows = w.map((g) => {
      const ships = g.s.map((s) => {
        const fl = s[3].map((f) => `<span class="badge mis-flag ${f}">${esc(FLAG[f] ?? f)}</span>`).join(' ');
        const cls = CLS[s[1]] ? `<span class="mis-cls">${esc(CLS[s[1]])}</span>` : '';
        return `<div class="mis-ship"><span class="num">${esc(s[0])}×</span> ${cls} <span class="dim">${esc(s[2])}</span> ${fl}${s[4] ? `<div class="epic-ship-note">${esc(s[4])}</div>` : ''}</div>`;
      }).join('');
      return `<tr><td class="mis-group">${esc(pickArc(g.l))}</td><td class="num">${esc(g.d)}</td><td>${ships}</td></tr>`;
    }).join('');
    return `<div class="mis-room"><div class="mis-room-head">${tx('Inamici și structuri')}</div>
      <div class="table-scroll"><table class="table compact mis-table"><thead><tr><th>${tx('Grup')}</th><th>${tx('Distanță')}</th><th>${tx('Nave')}</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  const listBlock = (title: string, items: string[], ordered = false) => {
    if (!items.length) return '';
    const tag = ordered ? 'ol' : 'ul';
    return `<div class="mis-sec"><div class="mis-sec-head">${esc(title)}</div><${tag} class="mis-notes">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</${tag}></div>`;
  };

  function missionBody(a: Arc, m: ArcMission, d: Map<number, number> | null) {
    const rows: [string, string][] = [];
    if (m.obj) rows.push([tx('Obiectiv'), esc(pickArc(m.obj))]);
    if (m.agent) rows.push([tx('Agent'), `${esc(m.agent)}${m.to ? ` <span class="dim">→ ${esc(m.to)}</span>` : ''}`]);
    if (m.sys) rows.push([tx('Sistem'), sysHtml(m.sys, d)]);
    if (m.carry) rows.push([tx('Ia cu tine'), esc(pickArc(m.carry))]);
    if (m.ship) rows.push([tx('Navă'), esc(pickArc(m.ship))]);
    const isk = iskLine(m);
    if (isk) rows.push([tx('Recompensă'), esc(isk)]);
    const eu = m.eu ? `<a class="ext-link" href="${EU_URL}${encodeURI(m.eu.replace(/ /g, '_'))}" target="_blank" rel="noopener noreferrer">EVE University</a>` : '';
    return `<div class="mis-overview">${rows.map(([k, v]) => `<div class="mis-line"><span class="label">${k}</span><span>${v}</span></div>`).join('')}</div>
      ${fight(a, m)}
      ${listBlock(tx('Pași'), m.steps.map(pickArc), true)}
      ${listBlock(tx('De reținut'), (m.notes ?? []).map(pickArc))}
      ${m.w?.length ? wavesHtml(m.w) : ''}
      ${eu ? `<div class="mis-links">${eu}</div>` : ''}`;
  }

  const limitBadge = (a: Arc, title: string) => {
    const l = missionLimit(a.id, title);
    return l ? `<span class="badge warn">${esc(pickArc(l))}</span>` : '';
  };

  function missionCard(a: Arc, title: string, anc: string, d: Map<number, number> | null, isNext: boolean) {
    const m = a.m[title];
    if (!m) return '';
    const p = done[a.id];
    const isDone = !!p?.d.includes(title);
    const weak = m.t === 'enc' ? (m.weak?.length ? m.weak : [...new Set((m.fac ?? []).flatMap((f) => faction(f).weak))]).slice(0, 2) : [];
    const s = m.sys ? map?.find(m.sys) : undefined;
    return `<details class="mis-card panel epic-mis ${isDone ? 'done' : ''} ${isNext ? 'next' : ''}" data-epic-m="${esc(title)}">
      <summary>
        <input type="checkbox" class="epic-chk" data-epic-done="${esc(title)}" data-epic-anc="${esc(anc)}" ${isDone ? 'checked' : ''} aria-label="${esc(tx('{name} terminată', { name: title }))}" />
        <span class="mis-caret" aria-hidden="true"></span>
        <span class="mis-main">
          <span class="mis-name"><span class="mis-range">${esc(m.n)}</span> ${esc(title)}</span>
          <span class="mis-tags"><span class="badge">${esc(TYPE_LABEL[m.t])}</span>${isNext ? `<span class="badge accent">${tx('Urmează')}</span>` : ''}${m.hard ? `<span class="badge danger">${tx('Grea')}</span>` : ''}${limitBadge(a, title)}${m.remote ? `<span class="badge">${tx('Se predă de la distanță')}</span>` : ''}${s ? `<span class="badge">${esc(s.name)} <span class="sec ${secClass(s.sec)}">${formatNum(displaySec(s.sec) || 0, 1)}</span></span>` : ''}</span>
        </span>
        <span class="mis-weak">${weak.map(chip).join('')}</span>
      </summary>
      <div class="mis-body">${missionBody(a, m, d)}</div>
    </details>`;
  }

  function nodesHtml(a: Arc, nodes: ArcNode[], prefix: string, anc: string, d: Map<number, number> | null, next: string): string {
    return nodes.map((n, i) => {
      if (!isChoice(n)) return missionCard(a, n, anc, d, n === next);
      const k = `${prefix}.${i}`;
      const chosen = done[a.id]?.p[k];
      const show = chosen ?? 0;
      return `<div class="epic-choice ${chosen == null ? 'open' : ''}">
        <div class="epic-choice-q">${esc(pickArc(n.c))}</div>
        <div class="chip-row">${n.p.map((p, j) => `<button class="chip-btn ${j === show ? 'active' : ''}" data-epic-pick="${k}|${j}">${esc(pickArc(p.l))}${chosen === j ? ` <span class="epic-pick">${tx('aleasă')}</span>` : ''}</button>`).join('')}</div>
        ${chosen == null ? `<p class="small dim">${tx('Nu ai ales încă. Lista arată prima variantă.')}</p>` : ''}
        <div class="epic-path">${nodesHtml(a, n.p[show].s, `${k}.${show}`, `${anc}${anc ? ',' : ''}${k}:${show}`, d, next)}</div>
      </div>`;
    }).join('');
  }

  function nextCard(a: Arc, d: Map<number, number> | null) {
    const p = done[a.id];
    const st = arcStats(a, p);
    const items: string[] = [];
    if (st.finished) {
      const again = (p?.at ?? Date.now()) + COOLDOWN_DAYS * DAY;
      items.push(again > Date.now() ? tx('Ai terminat arcul. Îl poți relua de pe {d}.', { d: fmtDate(again) }) : tx('Ai terminat arcul și îl poți relua acum.'));
    } else if (st.next?.k === 'c') {
      const { node: n, key: k } = st.next;
      items.push(`${esc(pickArc(n.c))}<div class="chip-row epic-next-picks">${n.p.map((x, j) => button(pickArc(x.l), { cls: 'sm ghost', attrs: `data-epic-pick="${k}|${j}"` })).join('')}</div>`);
    } else if (st.next?.k === 'm') {
      const m = a.m[st.next.title];
      if (!st.sum && a.starts?.length) {
        items.push(tx('Alege de la cine pornești: {list}.', { list: a.starts.map((s) => `<b>${esc(s.agent)}</b> (${sysHtml(s.sys, d)})`).join(', ') }));
      }
      items.push(`<b>${esc(m?.n ?? '')} ${esc(st.next.title)}</b> · ${esc(a.chapters[st.next.ch]?.name ?? '')}${m?.obj ? `<div>${esc(pickArc(m.obj))}</div>` : ''}`);
      if (m?.sys) items.push(`${tx('Unde')}: ${sysHtml(m.sys, d)}`);
      if (m?.carry) items.push(`${tx('Ia cu tine')}: ${esc(pickArc(m.carry))}`);
      items.push(`${button(tx('Am terminat-o'), { cls: 'sm', attrs: `data-epic-finish="${esc(st.next.title)}"` })} ${button(tx('Arată misiunea'), { cls: 'sm ghost', attrs: `data-epic-show="${esc(st.next.title)}"` })}`);
    }
    return `<div class="cos-next"><div class="cos-next-head"><b>${tx('Pasul următor')}</b></div><ol>${items.map((x) => `<li>${x}</li>`).join('')}</ol></div>`;
  }

  function arcHtml(a: Arc) {
    const d = dist();
    const p = done[a.id];
    const st = arcStats(a, p);
    const pct = st.total ? Math.round((st.sum / st.total) * 100) : 0;
    const next = st.next?.k === 'm' ? st.next.title : '';
    const info: [string, string][] = [
      [tx('Facțiune'), `${esc(a.fac)} · L${a.level}`],
      [tx('Start'), a.starts?.length ? a.starts.map((s) => `<div>${esc(s.agent)}, ${esc(s.corp)} · ${sysHtml(s.sys, d)}${s.where ? ` <span class="dim">· ${esc(s.where)}</span>` : ''} <span class="dim">· ${esc(pickArc(s.need))}</span></div>`).join('') : `${esc(a.start.agent)}, ${esc(a.start.corp)} · ${sysHtml(a.start.sys, d)} <span class="dim">· ${esc(a.start.station)}</span>`],
      [tx('Standing'), standingPage(a)],
      [tx('Spațiu'), esc(pickArc(a.space))],
      [tx('Durată'), esc(pickArc(a.time))],
      [tx('Navă'), shipsHtml(a)],
      [tx('Recompensă'), esc(pickArc(a.reward))],
    ];
    const eu = a.eu ? `<a class="ext-link" href="${EU_URL}${encodeURI(a.eu.replace(/ /g, '_'))}" target="_blank" rel="noopener noreferrer">EVE University</a>` : '';
    const chapters = a.chapters.map((c, i) => `<section class="epic-ch">
        <div class="epic-ch-head"><span class="epic-ch-n">${esc(tx('Capitolul {n}', { n: i + 1 }))}</span>${esc(c.name)}</div>
        ${nodesHtml(a, c.steps, String(i), '', d, next)}
      </section>`).join('');
    return `${button(tx('Toate arcurile'), { cls: 'ghost sm epic-back', attrs: 'data-epic-back' })}
      ${panel({
        title: a.name,
        count: tx('{d} din {n} gata', { d: formatInt(st.sum), n: formatInt(st.total) }),
        actions: button(tx('Resetează arcul'), { cls: 'ghost sm', attrs: 'data-epic-reset' }),
        body: `<p class="epic-intro">${esc(pickArc(a.intro))}</p>
          <div class="cos-meter"><span style="width:${pct}%"></span></div>
          ${nextCard(a, d)}
          ${originBar(map!, origin, 'epicOrigin')}
          <div class="mis-overview">${info.map(([k, v]) => `<div class="mis-line"><span class="label">${k}</span><span>${v}</span></div>`).join('')}</div>
          ${listBlock(tx('De reținut'), a.tips.map(pickArc))}
          ${eu ? `<div class="mis-links">${eu}</div>` : ''}`,
      })}
      ${chapters}
      <p class="small dim">${tx('Surse: EVE University Wiki (CC BY-SA 4.0) și EVE Survival')}</p>`;
  }

  function render() {
    if (!data || !map) return;
    const open = new Set([...el.querySelectorAll<HTMLDetailsElement>('details.epic-mis[open]')].map((x) => x.dataset.epicM!));
    const a = data.arcs.find((x) => x.id === ui.arc);
    el.innerHTML = a ? arcHtml(a) : listHtml(data);
    if (a) el.querySelectorAll<HTMLDetailsElement>('details.epic-mis').forEach((x) => { if (open.has(x.dataset.epicM!)) x.open = true; });
    bindOrigin(el, map, 'epicOrigin', async () => { origin = await pveOrigin(ctx, map!); render(); });
  }

  function current(): Arc | undefined {
    return data?.arcs.find((x) => x.id === ui.arc);
  }

  function settle(a: Arc) {
    const p = prog(a.id);
    const st = arcStats(a, p);
    if (st.finished) p.at ??= Date.now();
    else delete p.at;
    saveArcDone(charKey(), done);
  }

  function setDone(a: Arc, title: string, on: boolean, anc: string) {
    const p = prog(a.id);
    const set = new Set(p.d);
    if (on) set.add(title); else set.delete(title);
    p.d = [...set];
    if (on && anc) for (const part of anc.split(',')) { const [k, v] = part.split(':'); if (k && p.p[k] == null) p.p[k] = Number(v); }
    settle(a);
    render();
  }

  function ancOf(title: string) {
    return el.querySelector<HTMLInputElement>(`input[data-epic-done="${CSS.escape(title)}"]`)?.dataset.epicAnc ?? '';
  }

  el.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.epic-chk')) { e.stopPropagation(); return; }
    const ship = t.closest<HTMLElement>('[data-epic-ship]');
    if (ship) {
      const id = Number(ship.dataset.epicShip);
      if (id && opts.openFit) opts.openFit(emptyFit(id, ctx.sde.types.get(id)?.name ?? tx('Fit nou')));
      return;
    }
    const card = t.closest<HTMLElement>('[data-epic-arc]');
    if (card) { ui.arc = card.dataset.epicArc!; saveUi(); render(); el.closest('.main')?.scrollTo({ top: 0 }); return; }
    if (t.closest('[data-epic-back]')) { ui.arc = ''; saveUi(); render(); el.closest('.main')?.scrollTo({ top: 0 }); return; }
    const a = current();
    if (!a) return;
    const pick = t.closest<HTMLElement>('[data-epic-pick]');
    if (pick) {
      const [k, v] = pick.dataset.epicPick!.split('|');
      if (!k) return;
      const p = prog(a.id);
      const keep = Object.fromEntries(Object.entries(p.p).filter(([x]) => x === k || !x.startsWith(`${k}.`)));
      p.p = { ...keep, [k]: Number(v) };
      settle(a);
      render();
      return;
    }
    const fin = t.closest<HTMLElement>('[data-epic-finish]');
    if (fin) { const title = fin.dataset.epicFinish!; setDone(a, title, true, ancOf(title)); return; }
    const show = t.closest<HTMLElement>('[data-epic-show]');
    if (show) {
      const d = el.querySelector<HTMLDetailsElement>(`details[data-epic-m="${CSS.escape(show.dataset.epicShow!)}"]`);
      if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      return;
    }
    const tank = t.closest<HTMLElement>('[data-epic-tank]');
    if (tank) { const [site, fac] = tank.dataset.epicTank!.split('|'); opts.onTank(site, fac); return; }
    if (t.closest('[data-epic-reset]')) {
      if (!(await confirmDialog(tx('Ștergi progresul pentru {name}?', { name: a.name }), { ok: tx('Resetează'), danger: true }))) return;
      delete done[a.id];
      saveArcDone(charKey(), done);
      render();
    }
  });

  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const a = current();
    if (!a || !t.classList.contains('epic-chk')) return;
    setDone(a, t.dataset.epicDone!, t.checked, t.dataset.epicAnc ?? '');
  });

  ctx.onCharacterChange(() => { done = loadArcDone(charKey()); if (visible) load(); });

  return {
    show() { visible = true; done = loadArcDone(charKey()); load(); },
    hide() { visible = false; seq++; },
  };
}
