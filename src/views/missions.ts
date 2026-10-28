import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, windowTitle, emptyState, searchField, button } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { tx, lang } from '../i18n';
import { fold } from '../ui/fold';
import { canLoadCharge, type Fit } from '../engine/fit';
import { CURRENT_KEY } from '../fitting/shared';
import { Category } from '../data/sde';
import {
  loadMissions, pick, pickList, faction, sectionOf, intensities, dealtOf, weakOf, ewarOf, empiresOf, hasBlitz, searchText,
  SECTIONS, INTENSITY, CLASS_LABEL, FLAG_LABEL, EWAR_LABEL, EMPIRES, ES_URL, EU_URL, FACTIONS,
  type Mission, type MVariant, type MRoom, type Dmg, type Section, type Intensity,
} from '../services/missions';

const STATE_KEY = 'eve-missions:state';

interface State { section: Section | 'all'; q: string; level: Intensity | ''; empire: string; enemy: string; blitz: boolean; hideEmpire: boolean }

const DMG_NAME: Record<Dmg, string> = { em: 'EM', th: tx('Termic'), kin: tx('Cinetic'), exp: tx('Exploziv') };
const DMG_CLS: Record<Dmg, string> = { em: 'em', th: 'thermal', kin: 'kinetic', exp: 'explosive' };
const ATTR: Record<Dmg, string> = { em: 'emDamage', th: 'thermalDamage', kin: 'kineticDamage', exp: 'explosiveDamage' };

const chip = (d: Dmg) => `<span class="badge mis-dmg ${DMG_CLS[d]}">${DMG_NAME[d]}</span>`;
const chips = (list: Dmg[]) => (list.length ? list.map(chip).join(' ') : `<span class="dim">${tx('Omni: orice tip')}</span>`);

export interface MissionsView { show(): void }

export function createMissionsView(el: HTMLElement, ctx: AppContext, side: HTMLElement, opts: { onTank: (site: string, faction: string) => void }): MissionsView {
  const sde = ctx.sde;
  const state: State = { section: 'all', q: '', level: '', empire: '', enemy: '', blitz: false, hideEmpire: false, ...loadJson<Partial<State>>(STATE_KEY, {}) };
  let missions: Mission[] = [];
  let levels = new Map<string, Intensity>();
  let texts = new Map<string, string>();
  const chosen = new Map<string, number>();
  const ammoCache = new Map<string, string[]>();
  let fit: Fit | null = null;

  el.innerHTML = `${pageHead(tx('Misiuni și complexe DED'), tx('Ce faci în fiecare cameră, contra cui tragi și ce tank îți trebuie, pentru misiunile L1–L5 și complexele DED'), 'Lov')}
    <div id="misHelp"></div>
    <div id="misBar"></div>
    <div id="misList">${loader(tx('Încărcăm misiunile'))}</div>`;
  const help = el.querySelector<HTMLElement>('#misHelp')!;
  const bar = el.querySelector<HTMLElement>('#misBar')!;
  const list = el.querySelector<HTMLElement>('#misList')!;

  const save = () => saveJson(STATE_KEY, state);

  help.innerHTML = `<details class="mis-help panel">
      <summary>${tx('Cum afli contra cui e misiunea')}</summary>
      <div class="panel-body">
        <p>${tx('Multe misiuni au mai multe variante, iar standing-ul scade doar la variantele contra unui imperiu (Amarr, Caldari, Gallente, Minmatar). Variantele contra piraților nu te costă nimic.')}</p>
        <ol>
          <li>${tx('La oferta misiunii, fereastra agentului afișează un avertisment roșu dacă misiunea te poate costa standing la o facțiune. Dacă avertismentul lipsește, varianta e contra piraților.')}</li>
          <li>${tx('Briefing-ul misiunii numește inamicul, iar în jurnal, la obiective, apare facțiunea cu care te bați.')}</li>
          <li>${tx('Pe grid, navele imperiilor au prefixe precum Federation, Republic, Imperial sau State. Navele pirat au numele facțiunii lor (Guristas, Serpentis, Angel, Blood, Sansha).')}</li>
        </ol>
        <p>${tx('Alege mai jos facțiunea agentului tău: variantele contra ei nu ți se oferă, iar celelalte imperii apar marcate cu „scade standing”.')}</p>
      </div>
    </details>
    <details class="mis-help panel">
      <summary>${tx('Cum scanezi un complex DED')}</summary>
      <div class="panel-body">
        <p>${tx('Complexele DED sunt combat signatures: nu apar în lista de anomalii, trebuie găsite cu probe. Unele vin și ca escaladare din anomalii (Hideaway, Refuge, Den), iar asta e scris la fiecare complex.')}</p>
        <ol>
          <li>${tx('Montezi un Core Probe Launcher pe un slot high liber și iei în cargo Core Scanner Probes.')}</li>
          <li>${tx('În sistem deschizi Probe Scanner (Alt + P) și lansezi 8 probe. Folosești o formație largă ca să găsești semnătura, apoi una strânsă ca s-o fixezi.')}</li>
          <li>${tx('Filtrezi rezultatele după Combat. Apeși Analyze, muți probele peste semnătura aleasă, înjumătățești raza și apeși din nou Analyze.')}</li>
          <li>${tx('Repeți până semnătura ajunge la 100%. Atunci vezi numele complexului și poți face warp la ea. La final îți recuperezi probele.')}</li>
          <li>${tx('Înainte să intri, verifici pe poartă ce nave au voie. Fiecare complex scrie limita mai jos.')}</li>
        </ol>
        <p>${tx('Semnătura (20%, 10%, 5% sau 2.5%) arată cât de greu e de scanat. La 2.5% îți trebuie skill-urile de scanare cât mai sus: Astrometrics, Astrometric Rangefinding, Astrometric Pinpointing și Astrometric Acquisition.')}</p>
      </div>
    </details>`;

  function renderSide() {
    const counts = new Map<string, number>();
    for (const m of missions) {
      if (!visible(m, true)) continue;
      counts.set('all', (counts.get('all') ?? 0) + 1);
      const s = sectionOf(m);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Misiuni'))}</div>
      <div class="side-nav">${SECTIONS.map((s) => `<button class="side-link ${s.id === state.section ? 'active' : ''}" data-mis-section="${s.id}">${esc(s.label)}<span class="count">${missions.length ? counts.get(s.id) ?? 0 : ''}</span></button>`).join('')}</div>`;
  }

  function renderBar() {
    const enemies = FACTIONS.filter((f) => missions.some((m) => m.variants.some((v) => v.fac.includes(f.id))));
    bar.innerHTML = `<div class="mis-bar">
      ${searchField({ id: 'misSearch', placeholder: tx('Caută după numele misiunii… ( / )') })}
      <div class="mis-filters">
        <div class="chip-row" role="group" aria-label="${tx('Intensitate')}">
          ${([['', tx('Toate')], ['e', INTENSITY.e], ['m', INTENSITY.m], ['h', INTENSITY.h]] as [Intensity | '', string][]).map(([id, label]) => `<button class="chip-btn ${state.level === id ? 'active' : ''}" data-mis-level="${id}">${esc(label)}</button>`).join('')}
        </div>
        <label>${tx('Agentul tău')} <select class="input sm" id="misEmpire">
          <option value="">${tx('Oricare')}</option>
          ${EMPIRES.map((e) => `<option value="${e}" ${state.empire === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}
        </select></label>
        <label>${tx('Inamic')} <select class="input sm" id="misEnemy">
          <option value="">${tx('Oricare')}</option>
          ${enemies.map((f) => `<option value="${f.id}" ${state.enemy === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
        </select></label>
        <label class="check"><input type="checkbox" id="misBlitz" ${state.blitz ? 'checked' : ''} /> ${tx('Doar cu blitz')}</label>
        <label class="check"><input type="checkbox" id="misHideEmpire" ${state.hideEmpire ? 'checked' : ''} /> ${tx('Ascunde ce scade standing')}</label>
        <span class="mis-count dim" id="misCount"></span>
        <span class="mis-actions">${button(tx('Deschide tot'), { cls: 'sm', attrs: 'data-mis-open="1"' })} ${button(tx('Închide tot'), { cls: 'sm', attrs: 'data-mis-open="0"' })}</span>
      </div>
    </div>`;
    const input = bar.querySelector<HTMLInputElement>('#misSearch')!;
    input.value = state.q;
    let t = 0;
    input.addEventListener('input', () => { clearTimeout(t); t = window.setTimeout(() => { state.q = input.value; save(); apply(); }, 90); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; state.q = ''; save(); apply(); } });
  }

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
      const terms = fold(state.q.normalize('NFD').replace(/[̀-ͯ]/g, '')).split(/\s+/).filter(Boolean);
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
        <span class="mis-tags">${levelTag(m)}<span class="badge mis-int ${lvl}">${esc(INTENSITY[lvl])}</span>${m.story ? `<span class="badge gold">${tx('Storyline')}</span>` : ''}${hasBlitz(m) || m.guide?.blitz ? `<span class="badge ok">Blitz</span>` : ''}${m.courier ? `<span class="badge">${tx('Transport')}</span>` : ''}${facs.map((f) => `<span class="badge">${esc(faction(f).name)}</span>`).join('')}${emp ? `<span class="badge warn">${tx('scade standing')}</span>` : some ? `<span class="badge">${tx('standing doar la unele variante')}</span>` : ''}${m.ship ? `<span class="badge">${esc(tx('Maxim: {s}', { s: pick(m.ship) }))}</span>` : ''}</span>
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
    const obj = pick(v.obj) || (lang === 'ro' ? m.guide?.obj ?? '' : '');
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

  function roomHtml(r: MRoom, i: number) {
    const rows = r.g.map((g) => {
      const ships = g.s.map((s) => {
        const fl = s[3].map((f) => `<span class="badge mis-flag ${f}">${esc(FLAG_LABEL[f] ?? f)}</span>`).join(' ');
        return `<div class="mis-ship"><span class="num">${esc(s[0])}×</span> <span class="mis-cls">${esc(CLASS_LABEL[s[1]] ?? s[1])}</span> <span class="dim">${esc(s[2])}</span> ${fl}</div>`;
      }).join('');
      return `<tr><td class="mis-group">${esc(pick(g.l))}</td><td class="num">${esc(g.d ?? '')}</td><td>${ships}</td></tr>`;
    }).join('');
    const notes = pickList(r.x);
    return `<div class="mis-room">
      <div class="mis-room-head">${esc(pick(r.n) || tx('Camera {n}', { n: i + 1 }))}${r.gate ? ` <span class="dim">· ${esc(tx('poarta la {d}', { d: r.gate }))}</span>` : ''}</div>
      ${rows ? `<div class="table-scroll"><table class="table compact mis-table"><thead><tr><th>${tx('Grup')}</th><th>${tx('Distanță')}</th><th>${tx('Nave')}</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
      ${notes.length ? `<ul class="mis-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </div>`;
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
      ${v.fac.length ? combat(m, v) : ''}
      ${guide}
      ${listBlock('Blitz', pickList(v.blitz))}
      ${(v.rooms ?? []).map(roomHtml).join('')}
      ${listBlock(tx('Sfaturi'), pickList(v.tips))}
      ${listBlock(tx('Loot'), v.lootList ?? [])}
      ${!v.rooms?.length && !pickList(v.tips).length && !m.guide ? `<p class="dim">${tx('Sursa nu are încă detalii pentru misiunea asta. Vezi pagina completă.')}</p>` : ''}
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
    if (count) count.textContent = shown === 1 ? tx('1 misiune') : tx('{n} misiuni', { n: shown });
    list.querySelector('.mis-empty')?.toggleAttribute('hidden', shown !== 0);
    renderSide();
  }

  function renderList() {
    list.innerHTML = `${missions.map((m) => `<details class="mis-card panel" data-key="${esc(m.key)}">${summary(m)}<div class="mis-body"></div></details>`).join('')}
      <div class="mis-empty" hidden>${emptyState({ title: tx('Nicio misiune nu se potrivește'), text: tx('Încearcă doar o parte din nume, de exemplu „worlds” sau „angel”, sau scoate un filtru.'), vy: 'The Hunt Finds No Trail', vyText: 'No quarry answers these words. Loosen the snare and listen again.' })}</div>`;
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
    const lvl = t.closest<HTMLElement>('[data-mis-level]');
    if (lvl) { state.level = lvl.dataset.misLevel as Intensity | ''; save(); bar.querySelectorAll('[data-mis-level]').forEach((b) => b.classList.toggle('active', b === lvl)); apply(); return; }
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

  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.id === 'misEmpire') state.empire = t.value;
    else if (t.id === 'misEnemy') state.enemy = t.value;
    else if (t.id === 'misBlitz') state.blitz = (t as HTMLInputElement).checked;
    else if (t.id === 'misHideEmpire') state.hideEmpire = (t as HTMLInputElement).checked;
    else return;
    save();
    list.querySelectorAll<HTMLDetailsElement>('details.mis-card').forEach(refreshCard);
    apply();
  });

  side.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mis-section]');
    if (!b) return;
    state.section = b.dataset.misSection as Section | 'all';
    save();
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
  loadMissions().then((data) => {
    missions = [...data.missions].sort((a, b) => (a.rating ? 1 : 0) - (b.rating ? 1 : 0) || a.name.replace(/^(The|A|An) /, '').localeCompare(b.name.replace(/^(The|A|An) /, '')) || a.level - b.level || (a.rating ?? 0) - (b.rating ?? 0));
    levels = intensities(missions);
    texts = new Map(missions.map((m) => [m.key, searchText(m)]));
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
