import type { AppContext } from '../app/context';
import { directRequirements, requirementTree, requirementsFor, skillsPlan, alphaRaces, type RequirementNode, type FitRequirements } from '../character/requirements';
import { formatDuration, durationHtml } from '../character/training';
import { typeIconUrl } from '../services/market';
import { shipMastery, masterySkills, type ShipMastery } from '../services/masteries';
import { shipTraits, type TraitGroup } from '../services/traits';
import { itemDescription } from '../services/descriptions';
import { itemSummaryHtml } from './itemSummary';
import { addToPlan, loadPlan, savePlan } from '../character/skillPlan';
import type { DogmaItem } from '../engine/dogma';
import { attributeSections } from './attributes';
import { openModal, badge, badgeHtml, button, esc, formatInt, copyText, toast } from './components';
import { icon } from './icons';
import { fold } from './fold';
import { tx } from '../i18n';

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];
const META_GROUPS: Record<number, string> = { 1: 'Tech I', 2: 'Tech II', 3: 'Storyline', 4: tx('Facțiune'), 5: tx('Ofițer'), 6: 'Deadspace', 14: 'Tech III', 15: tx('Abisal'), 17: 'Premium', 19: tx('Ediție limitată') };

const RACES: Record<number, string> = { 1: 'Caldari', 2: 'Minmatar', 4: 'Amarr', 8: 'Gallente', 16: 'Jove', 32: 'Pirate', 64: 'Sleepers', 128: 'ORE', 134: 'Rogue Drones', 135: 'Triglavian', 168: 'Upwell' };
const FACTIONS: Record<number, string> = {
  500001: 'Caldari State', 500002: 'Minmatar Republic', 500003: 'Amarr Empire', 500004: 'Gallente Federation', 500005: 'Jove Empire',
  500006: 'CONCORD Assembly', 500007: 'Ammatar Mandate', 500008: 'Khanid Kingdom', 500009: 'The Syndicate', 500010: 'Guristas Pirates',
  500011: 'Angel Cartel', 500012: 'Blood Raider Covenant', 500013: 'EverMore', 500014: 'ORE', 500015: 'Thukker Tribe',
  500016: 'Servant Sisters of EVE', 500017: 'The Society of Conscious Thought', 500018: "Mordu's Legion Command", 500019: "Sansha's Nation",
  500020: 'Serpentis', 500024: 'Drifters', 500025: 'Rogue Drones', 500026: 'Triglavian Collective', 500027: 'EDENCOM',
  500028: 'Association for Interdisciplinary Research', 500029: 'Deathless Circle',
};
const TECH_TAGS: Record<number, [string, string]> = { 2: ['t2', 'II'], 14: ['t3', 'III'], 3: ['story', ''], 4: ['faction', ''], 5: ['officer', ''], 6: ['deadspace', ''], 15: ['abyssal', ''], 17: ['premium', ''], 19: ['limited', ''] };

export const roman = (n: number) => ROMAN[n] ?? String(n);

export function techTag(metaGroupId?: number): string {
  const tag = metaGroupId ? TECH_TAGS[metaGroupId] : undefined;
  return tag ? `<span class="tech-tag ${tag[0]}">${tag[1]}</span>` : '';
}

export function requirementTreeHtml(ctx: AppContext, nodes: RequirementNode[]): string {
  if (!nodes.length) return '';
  const have = ctx.character.skills;
  return `<ul class="req-tree">${nodes.map((n) => {
    const level = have.get(n.skillId) ?? 0;
    const tone = level >= n.level ? 'ok' : level > 0 ? 'partial' : 'missing';
    return `<li class="${tone}"><span class="req-dot"></span><button class="link req-name" data-skill-info="${n.skillId}">${esc(n.name)}</button>
      <span class="req-level">${roman(n.level)}</span><span class="req-have dim">(${tx('ai {lvl}', { lvl: level ? roman(level) : '0' })})</span>
      ${requirementTreeHtml(ctx, n.children)}</li>`;
  }).join('')}</ul>`;
}

export function skillPlanText(steps: { name: string; required: number; current: number }[]): string {
  const lines: string[] = [];
  for (const s of steps) for (let l = s.current + 1; l <= s.required; l++) lines.push(`${s.name} ${l}`);
  return lines.join('\n');
}

function planTable(plan: FitRequirements): string {
  if (!plan.missing.length) return '';
  return `<h3 class="section-title">${tx('Plan de antrenament ({sp} SP)', { sp: formatInt(plan.totalSp) })}</h3>
      <table class="table compact">
        <thead><tr><th>${tx('Skill')}</th><th>${tx('Acum')}</th><th>${tx('Țintă')}</th><th class="r">${tx('Timp')}</th></tr></thead>
        <tbody>${plan.missing.map((s) => `<tr><td><button class="link" data-skill-info="${s.skillId}">${esc(s.name)}</button></td><td>${roman(s.current)}</td><td>${roman(s.required)}</td><td class="r num">${formatDuration(s.seconds)}</td></tr>`).join('')}</tbody>
      </table>`;
}

const CAPITAL_SHIPS = 3344;

export function withHullSkills(ctx: AppContext, shipId: number, mastery: ShipMastery): ShipMastery {
  const bonus = directRequirements(ctx.sde, shipId).filter((r) => r.skillId !== CAPITAL_SHIPS);
  if (!bonus.length) return mastery;
  const hull = { id: -shipId, name: tx('Skill-urile care dau bonusurile navei'), skills: bonus.map((r) => ({ skillId: r.skillId, levels: [1, 2, 3, 4, 5].map((l) => Math.max(r.level, l)) })) };
  return { levels: mastery.levels.map((certs) => [hull, ...certs]) };
}

function masteryHtml(ctx: AppContext, mastery: ShipMastery, level: number, plans: FitRequirements[]): string {
  const have = ctx.character.skills;
  const plan = plans[level - 1];
  const certs = mastery.levels[level - 1] ?? [];
  return `<div class="mastery-levels">${plans.map((p, i) => `<button class="mastery-level ${i + 1 === level ? 'active' : ''} ${p.canFly ? 'done' : ''}" data-mastery-level="${i + 1}">
      <span class="mastery-roman">${roman(i + 1)}</span><span class="mastery-state">${p.canFly ? '✓' : durationHtml(p.totalSeconds)}</span></button>`).join('')}</div>
    <div class="info-status">${plan.canFly
      ? badge(tx('Mastery {lvl} complet', { lvl: roman(level) }), 'ok', true)
      : badgeHtml(tx('Mastery {lvl}: lipsesc <span class="unit">{n}</span> skill-uri · {time}', { lvl: roman(level), n: plan.missing.length, time: durationHtml(plan.totalSeconds) }), 'accent', true)}</div>
    <div class="mastery-certs">${certs.map((c) => {
      const rows = c.skills.filter((s) => (s.levels[level - 1] ?? 0) > 0);
      const done = rows.every((s) => (have.get(s.skillId) ?? 0) >= s.levels[level - 1]);
      return `<div class="mastery-cert ${done ? 'ok' : ''}"><h3 class="section-title"><span class="req-dot"></span>${esc(c.name)}</h3>
        <table class="table compact attrs"><tbody>${rows.map((s) => {
          const need = s.levels[level - 1];
          const cur = have.get(s.skillId) ?? 0;
          return `<tr class="${cur >= need ? 'ok' : cur > 0 ? 'partial' : 'missing'}"><td><button class="link" data-skill-info="${s.skillId}">${esc(ctx.sde.types.get(s.skillId)?.name ?? tx('Skill {id}', { id: s.skillId }))}</button></td>
            <td class="r num">${roman(need)} <span class="dim">(${tx('ai {lvl}', { lvl: cur ? roman(cur) : '0' })})</span></td></tr>`;
        }).join('')}</tbody></table></div>`;
    }).join('')}</div>
    ${planTable(plan)}
    ${plan.missing.length ? `<div class="row-actions"><button class="btn ghost sm" data-plan-mastery>${tx('Adaugă în planul de skill-uri')}</button><button class="btn ghost sm" data-copy-mastery>${tx('Copiază planul')}</button></div>` : ''}`;
}

export interface FitSwap {
  fittedId: number;
  fitted: DogmaItem;
  preview: (typeId: number) => DogmaItem | undefined;
  replace: (typeId: number) => FitSwap | null;
}

function traitsHtml(ctx: AppContext, groups: TraitGroup[]): string {
  return groups.map((g) => {
    const skillName = /^(.+) bonuses \(per skill level\):?$/.exec(g.header)?.[1];
    const skill = skillName ? ctx.sde.findType(skillName) : undefined;
    const level = skill ? ctx.character.skills.get(skill.id) ?? 0 : 0;
    const head = skill
      ? `<button class="link" data-skill-info="${skill.id}">${esc(skill.name)}</button> ${esc(tx('bonusuri (pe nivel de skill)'))} ${badge(roman(level), level >= 5 ? 'ok' : level ? '' : 'accent')}`
      : esc(g.header === 'Role Bonus:' ? tx('Bonus de rol') : g.header === 'Misc bonus:' ? tx('Bonus divers') : g.header.replace(/:$/, ''));
    return `<div class="trait-group"><h3 class="section-title">${head}</h3>
      ${g.bonuses.map((b) => `<div class="trait-row"><span class="trait-amount num">${esc(b.amount)}</span><span>${esc(b.text)}</span></div>`).join('')}</div>`;
  }).join('');
}

export function hasItemInfo(sde: AppContext['sde'], typeId: number): boolean {
  return sde.types.has(typeId);
}

export function showItemInfo(ctx: AppContext, typeId: number, item?: DogmaItem, swap?: FitSwap, startTab = 'desc') {
  const sde = ctx.sde;
  const t = sde.types.get(typeId);
  if (!t) { toast(tx('Pentru itemul ăsta nu am date (informațiile există pentru nave, module, muniție, drone, implanturi și skill-uri)')); return; }
  const tree = requirementTree(sde, typeId);
  const plan = requirementsFor(sde, [typeId], ctx.character);
  const alpha = alphaRaces(sde, [typeId]);
  const meta = t.metaGroupId ? META_GROUPS[t.metaGroupId] ?? `Meta ${t.metaGroupId}` : 'Tech I';
  const race = t.raceId ? RACES[t.raceId] : undefined;
  const faction = t.factionId ? FACTIONS[t.factionId] : undefined;
  const identity = `<div class="info-identity">
      <div class="info-kind">${techTag(t.metaGroupId) || '<span class="tech-tag t1">I</span>'}<span>${esc([race, t.groupName].filter(Boolean).join(' '))}</span></div>
      <table class="table compact attrs"><tbody>
        <tr><td>${tx('Clasă')}</td><td class="r">${esc(t.groupName)}</td></tr>
        ${race ? `<tr><td>${tx('Rasă')}</td><td class="r">${esc(race)}</td></tr>` : ''}
        ${faction ? `<tr><td>${tx('Facțiune')}</td><td class="r">${esc(faction)}</td></tr>` : ''}
        <tr><td>${tx('Nivel tehnologic')}</td><td class="r">${esc(meta)}</td></tr>
        <tr><td>${tx('Nivel meta')}</td><td class="r num">${t.metaLevel ?? 0}</td></tr>
      </tbody></table>
    </div>`;
  const comparing = !!swap && swap.fittedId !== typeId;
  const sections = attributeSections(sde, typeId, item, comparing ? swap!.fitted : undefined);
  const fittedName = swap ? sde.types.get(swap.fittedId)?.name ?? '' : '';
  const family = sde.variations(typeId);
  const attributes = sections.length
    ? `<input class="input plain attr-filter" placeholder="${tx('Filtrează atribute...')}" data-attr-filter />
      ${sections.map((sec) => `<div class="attr-section"><h3 class="section-title">${esc(sec.title)}</h3>
        <table class="table compact attrs ${comparing ? 'compare' : ''}">${comparing ? `<thead><tr><th></th><th class="r">${esc(t.name)}</th><th class="r" title="${esc(fittedName)}">${tx('Montat acum')}</th></tr></thead>` : ''}<tbody>${sec.rows.map((r) => `<tr data-attr-name="${esc(fold(r.name))}"><td>${esc(r.name)}</td>
          ${comparing
            ? `<td class="r num ${r.delta ?? ''}">${esc(r.value)}</td><td class="r num dim">${esc(r.compare ?? '')}</td>`
            : `<td class="r num ${r.base ? (r.better ? 'better' : 'worse') : ''}">${r.base ? `<s class="dim">${esc(r.base)}</s> ` : ''}${esc(r.value)}</td>`}</tr>`).join('')}</tbody></table></div>`).join('')}
      <p class="dim hidden" data-attr-empty></p>`
    : `<p class="dim">${tx('Itemul nu are atribute afișabile.')}</p>`;
  const body = `
    <div class="info-head">
      <span class="info-icon"><img src="${typeIconUrl(typeId)}" alt="" />${techTag(t.metaGroupId)}</span>
      <div>
        <h2>${esc(t.name)}</h2>
        ${comparing ? `<p class="dim small">${tx('Comparat cu {name}, montat pe navă', { name: esc(fittedName) })}</p>` : ''}
      </div>
      ${comparing ? `<div class="info-head-actions">${button(tx('Înlocuiește în fit'), { iconName: 'swap', attrs: `data-swap="${typeId}"` })}</div>` : ''}
    </div>
    <div class="info-status">
      ${plan.canFly ? badge(tx('{name} poate folosi itemul', { name: ctx.character.name }), 'ok', true) : badgeHtml(tx('{name}: lipsesc <span class="unit">{n}</span> skill-uri · {time}', { name: esc(ctx.character.name), n: plan.missing.length, time: durationHtml(plan.totalSeconds) }), 'accent', true)}
      ${alpha.length ? badge('Alpha: ' + alpha.join(', '), 'accent') : badge('Omega', 'gold')}
    </div>
    <div class="tabs">
      ${t.categoryId === 6 ? `<button class="tab hidden" data-tab="traits">${tx('Bonusuri')}</button>` : `<button class="tab" data-tab="desc">${tx('Descriere')}</button>`}
      <button class="tab" data-tab="attrs">${tx('Atribute')}</button>
      ${family.length > 1 ? `<button class="tab" data-tab="var">${tx('Variante')} <span class="tab-count neutral">${family.length}</span></button>` : ''}
      <button class="tab" data-tab="req">${tx('Cerințe')}${plan.canFly ? '' : ` <span class="tab-count">${plan.missing.length}</span>`}</button>
      ${t.categoryId === 6 ? '<button class="tab hidden" data-tab="mastery">Mastery <span class="tab-count neutral" data-mastery-count></span></button>' : ''}
    </div>
    <div class="tab-panel hidden" data-panel="traits"></div>
    ${t.categoryId === 6 ? '' : `<div class="tab-panel hidden info-desc" data-panel="desc">${itemSummaryHtml(sde, typeId, item)}<div data-official></div></div>`}
    <div class="tab-panel hidden" data-panel="attrs">${identity}${attributes}</div>
    <div class="tab-panel hidden" data-panel="var">
      <table class="table compact variations"><thead><tr><th></th><th>${tx('Item')}</th><th>${tx('Tip')}</th><th class="r">Meta</th>${swap ? '<th></th>' : ''}</tr></thead><tbody>
        ${family.map((v) => `<tr class="${v.id === typeId ? 'current' : ''}" data-variation="${v.id}" title="${v.id === typeId ? tx('Itemul deschis') : tx('Deschide')}">
          <td><img src="${typeIconUrl(v.id, 32)}" alt="" loading="lazy" /></td>
          <td>${esc(v.name)}</td><td>${v.metaGroupId ? badge(META_GROUPS[v.metaGroupId] ?? `Meta ${v.metaGroupId}`, v.metaGroupId === 5 ? 'gold' : v.metaGroupId === 4 || v.metaGroupId === 6 ? 'accent' : '') : ''}</td>
          <td class="r num">${v.metaLevel ?? 0}</td>${swap ? `<td class="swap-cell">${v.id === swap.fittedId
            ? `<span class="swap-fitted" title="${tx('Montat pe navă')}">${icon('check')}</span>`
            : `<button class="icon-btn" data-swap="${v.id}" title="${tx('Înlocuiește în fit')}" aria-label="${tx('Înlocuiește în fit')}">${icon('swap')}</button>`}</td>` : ''}</tr>`).join('')}
      </tbody></table>
    </div>
    <div class="tab-panel hidden" data-panel="req">
    ${tree.length ? requirementTreeHtml(ctx, tree) : `<p class="dim">${tx('Nu cere niciun skill.')}</p>`}
    ${plan.missing.length ? `${planTable(plan)}
      <div class="row-actions"><button class="btn ghost sm" data-copy-plan>${tx('Copiază planul')}</button></div>` : ''}
    <p class="dim small">${tx('Cerințe directe')}: ${directRequirements(sde, typeId).map((r) => `<button class="link" data-skill-info="${r.skillId}">${esc(sde.types.get(r.skillId)?.name ?? r.skillId)}</button> ${roman(r.level)}`).join(', ') || '—'}</p>
    </div>
    <div class="tab-panel hidden" data-panel="mastery"></div>
  `;
  const el = openModal(tx('Info item'), body, { wide: true });
  const showTab = (name: string) => {
    const tab = el.querySelector<HTMLElement>(`[data-tab="${name}"]`) ?? el.querySelector<HTMLElement>('[data-tab="attrs"]')!;
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === tab));
    el.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
  };
  showTab(startTab);
  let mastery: ShipMastery | null = null;
  let masteryPlans: FitRequirements[] = [];
  let masteryLevel = 1;
  const renderMastery = () => {
    const panel = el.querySelector<HTMLElement>('[data-panel="mastery"]');
    if (panel && mastery) panel.innerHTML = masteryHtml(ctx, mastery, masteryLevel, masteryPlans);
  };
  let tabPicked = startTab !== 'desc';
  if (t.categoryId !== 6) {
    itemDescription(typeId).then((lines) => {
      const box = el.querySelector<HTMLElement>('[data-official]');
      if (!lines || !box || !el.isConnected) return;
      box.innerHTML = `<h3 class="section-title">${tx('Descriere din joc')}</h3>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}`;
    });
  }
  if (t.categoryId === 6) {
    shipTraits(typeId).then((groups) => {
      if (!groups || !el.isConnected) return;
      const panel = el.querySelector<HTMLElement>('[data-panel="traits"]');
      if (panel) panel.innerHTML = traitsHtml(ctx, groups);
      el.querySelector('[data-tab="traits"]')?.classList.remove('hidden');
      if (!tabPicked) showTab('traits');
    });
    shipMastery(typeId).then((raw) => {
      if (!raw || !el.isConnected) return;
      const m = withHullSkills(ctx, typeId, raw);
      mastery = m;
      masteryPlans = [1, 2, 3, 4, 5].map((l) => skillsPlan(sde, masterySkills(m, l), ctx.character));
      const reached = masteryPlans.findIndex((p) => !p.canFly);
      const achieved = reached === -1 ? 5 : reached;
      masteryLevel = Math.min(5, achieved + 1);
      const count = el.querySelector<HTMLElement>('[data-mastery-count]');
      if (count) count.textContent = roman(achieved);
      el.querySelector('[data-tab="mastery"]')?.classList.remove('hidden');
      renderMastery();
    });
  }
  el.addEventListener('click', (e) => {
    const skillInfo = (e.target as HTMLElement).closest<HTMLElement>('[data-skill-info]');
    if (skillInfo) { showItemInfo(ctx, Number(skillInfo.dataset.skillInfo)); return; }
    const lvl = (e.target as HTMLElement).closest<HTMLElement>('[data-mastery-level]');
    if (lvl) { masteryLevel = Number(lvl.dataset.masteryLevel); renderMastery(); return; }
    if ((e.target as HTMLElement).closest('[data-plan-mastery]')) {
      const steps = masteryPlans[masteryLevel - 1].missing;
      savePlan(ctx.character.id, steps.reduce((p, st) => addToPlan(sde, p, ctx.character, st.skillId, st.required), loadPlan(ctx.character.id)));
      toast(tx('Mastery {lvl} pentru {ship} adăugat în planul de skill-uri', { lvl: roman(masteryLevel), ship: t.name }));
      return;
    }
    if ((e.target as HTMLElement).closest('[data-copy-mastery]')) {
      copyText(skillPlanText(masteryPlans[masteryLevel - 1].missing), tx('Plan copiat (lipește-l în Skill Plans din joc)'));
      return;
    }
    const swapBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-swap]');
    if (swapBtn && swap) {
      const id = Number(swapBtn.dataset.swap);
      const next = swap.replace(id);
      if (next) showItemInfo(ctx, id, next.fitted, next, swapBtn.closest('[data-panel="var"]') ? 'var' : 'attrs');
      return;
    }
    const variation = (e.target as HTMLElement).closest<HTMLElement>('[data-variation]');
    if (variation && Number(variation.dataset.variation) !== typeId) {
      const id = Number(variation.dataset.variation);
      if (swap) showItemInfo(ctx, id, id === swap.fittedId ? swap.fitted : swap.preview(id), swap, 'attrs');
      else showItemInfo(ctx, id);
      return;
    }
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (!tab) return;
    tabPicked = true;
    showTab(tab.dataset.tab!);
  });
  el.querySelector<HTMLInputElement>('[data-attr-filter]')?.addEventListener('input', (e) => {
    const q = fold((e.target as HTMLInputElement).value.trim());
    el.querySelectorAll<HTMLElement>('[data-attr-name]').forEach((row) => row.classList.toggle('hidden', !row.dataset.attrName!.includes(q)));
    el.querySelectorAll<HTMLElement>('.attr-section').forEach((sec) => sec.classList.toggle('hidden', !sec.querySelector('[data-attr-name]:not(.hidden)')));
    const empty = el.querySelector<HTMLElement>('[data-attr-empty]');
    if (empty) {
      const none = !el.querySelector('.attr-section:not(.hidden)');
      empty.classList.toggle('hidden', !none);
      empty.textContent = none ? tx('Niciun atribut nu conține „{q}”.', { q: (e.target as HTMLInputElement).value.trim() }) : '';
    }
  });
  el.querySelector('[data-copy-plan]')?.addEventListener('click', () => copyText(skillPlanText(plan.missing), tx('Plan copiat (lipește-l în Skill Plans din joc)')));
}
