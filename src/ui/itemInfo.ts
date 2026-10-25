import type { AppContext } from '../app/context';
import { directRequirements, requirementTree, requirementsFor, skillsPlan, alphaRaces, type RequirementNode, type FitRequirements } from '../character/requirements';
import { formatDuration, durationHtml } from '../character/training';
import { typeIconUrl } from '../services/market';
import { shipMastery, masterySkills, type ShipMastery } from '../services/masteries';
import { addToPlan, loadPlan, savePlan } from '../character/skillPlan';
import type { DogmaItem } from '../engine/dogma';
import { attributeSections } from './attributes';
import { openModal, badge, badgeHtml, esc, formatInt, copyText, toast } from './components';
import { fold } from './fold';
import { tx } from '../i18n';

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];
const META_GROUPS: Record<number, string> = { 1: 'Tech I', 2: 'Tech II', 3: 'Storyline', 4: 'Faction', 5: 'Officer', 6: 'Deadspace', 14: 'Tech III', 15: 'Abyssal', 17: 'Premium', 19: 'Limited Time' };

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
    return `<li class="${tone}"><span class="req-dot"></span><span class="req-name">${esc(n.name)}</span>
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
        <thead><tr><th>Skill</th><th>${tx('Acum')}</th><th>${tx('Țintă')}</th><th class="r">${tx('Timp')}</th></tr></thead>
        <tbody>${plan.missing.map((s) => `<tr><td>${esc(s.name)}</td><td>${roman(s.current)}</td><td>${roman(s.required)}</td><td class="r num">${formatDuration(s.seconds)}</td></tr>`).join('')}</tbody>
      </table>`;
}

const CAPITAL_SHIPS = 3344;

function withHullSkills(ctx: AppContext, shipId: number, mastery: ShipMastery): ShipMastery {
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
      ? badge(tx('Mastery {lvl} completă', { lvl: roman(level) }), 'ok', true)
      : badgeHtml(tx('Mastery {lvl}: lipsesc <span class="unit">{n}</span> skill-uri · {time}', { lvl: roman(level), n: plan.missing.length, time: durationHtml(plan.totalSeconds) }), 'accent', true)}</div>
    <div class="mastery-certs">${certs.map((c) => {
      const rows = c.skills.filter((s) => (s.levels[level - 1] ?? 0) > 0);
      const done = rows.every((s) => (have.get(s.skillId) ?? 0) >= s.levels[level - 1]);
      return `<div class="mastery-cert ${done ? 'ok' : ''}"><h3 class="section-title"><span class="req-dot"></span>${esc(c.name)}</h3>
        <table class="table compact attrs"><tbody>${rows.map((s) => {
          const need = s.levels[level - 1];
          const cur = have.get(s.skillId) ?? 0;
          return `<tr class="${cur >= need ? 'ok' : cur > 0 ? 'partial' : 'missing'}"><td>${esc(ctx.sde.types.get(s.skillId)?.name ?? `Skill ${s.skillId}`)}</td>
            <td class="r num">${roman(need)} <span class="dim">(${tx('ai {lvl}', { lvl: cur ? roman(cur) : '0' })})</span></td></tr>`;
        }).join('')}</tbody></table></div>`;
    }).join('')}</div>
    ${planTable(plan)}
    ${plan.missing.length ? `<div class="row-actions"><button class="btn ghost sm" data-plan-mastery>${tx('Adaugă în skill plan')}</button><button class="btn ghost sm" data-copy-mastery>${tx('Copiază planul')}</button></div>` : ''}`;
}

export function showItemInfo(ctx: AppContext, typeId: number, item?: DogmaItem) {
  const sde = ctx.sde;
  const t = sde.types.get(typeId);
  if (!t) { toast(tx('Pentru itemul ăsta nu am date (Show Info merge la nave, module, muniție, drone, implanturi și skill-uri)')); return; }
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
        <tr><td>Tech</td><td class="r">${esc(meta)}</td></tr>
        <tr><td>Meta level</td><td class="r num">${t.metaLevel ?? 0}</td></tr>
      </tbody></table>
    </div>`;
  const sections = attributeSections(sde, typeId, item);
  const family = sde.variations(typeId);
  const attributes = sections.length
    ? `<input class="input plain attr-filter" placeholder="${tx('Filtrează atribute...')}" data-attr-filter />
      ${sections.map((sec) => `<div class="attr-section"><h3 class="section-title">${esc(sec.title)}</h3>
        <table class="table compact attrs"><tbody>${sec.rows.map((r) => `<tr data-attr-name="${esc(fold(r.name))}"><td>${esc(r.name)}</td>
          <td class="r num ${r.base ? (r.better ? 'better' : 'worse') : ''}">${r.base ? `<s class="dim">${esc(r.base)}</s> ` : ''}${esc(r.value)}</td></tr>`).join('')}</tbody></table></div>`).join('')}`
    : `<p class="dim">${tx('Itemul nu are atribute afișabile.')}</p>`;
  const body = `
    <div class="info-head">
      <span class="info-icon"><img src="${typeIconUrl(typeId)}" alt="" />${techTag(t.metaGroupId)}</span>
      <div>
        <h2>${esc(t.name)}</h2>
      </div>
    </div>
    <div class="info-status">
      ${plan.canFly ? badge(tx('{name} poate folosi itemul', { name: ctx.character.name }), 'ok', true) : badgeHtml(tx('{name}: lipsesc <span class="unit">{n}</span> skill-uri · {time}', { name: esc(ctx.character.name), n: plan.missing.length, time: durationHtml(plan.totalSeconds) }), 'accent', true)}
      ${alpha.length ? badge('Alpha: ' + alpha.join(', '), 'accent') : badge('Omega', 'gold')}
    </div>
    <div class="tabs">
      <button class="tab active" data-tab="attrs">${tx('Atribute')}</button>
      ${family.length > 1 ? `<button class="tab" data-tab="var">Variations <span class="tab-count neutral">${family.length}</span></button>` : ''}
      <button class="tab" data-tab="req">Requirements${plan.canFly ? '' : ` <span class="tab-count">${plan.missing.length}</span>`}</button>
      ${t.categoryId === 6 ? '<button class="tab hidden" data-tab="mastery">Mastery <span class="tab-count neutral" data-mastery-count></span></button>' : ''}
    </div>
    <div class="tab-panel" data-panel="attrs">${identity}${attributes}</div>
    <div class="tab-panel hidden" data-panel="var">
      <table class="table compact variations"><thead><tr><th></th><th>Item</th><th>${tx('Tip')}</th><th class="r">Meta</th></tr></thead><tbody>
        ${family.map((v) => `<tr class="${v.id === typeId ? 'current' : ''}" data-variation="${v.id}" title="${v.id === typeId ? tx('Itemul deschis') : tx('Deschide')}">
          <td><img src="${typeIconUrl(v.id, 32)}" alt="" loading="lazy" /></td>
          <td>${esc(v.name)}</td><td>${v.metaGroupId ? badge(META_GROUPS[v.metaGroupId] ?? `Meta ${v.metaGroupId}`, v.metaGroupId === 5 ? 'gold' : v.metaGroupId === 4 || v.metaGroupId === 6 ? 'accent' : '') : ''}</td>
          <td class="r num">${v.metaLevel ?? 0}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="tab-panel hidden" data-panel="req">
    ${tree.length ? requirementTreeHtml(ctx, tree) : `<p class="dim">${tx('Nu cere niciun skill.')}</p>`}
    ${plan.missing.length ? `${planTable(plan)}
      <div class="row-actions"><button class="btn ghost sm" data-copy-plan>${tx('Copiază planul')}</button></div>` : ''}
    <p class="dim small">${tx('Cerințe directe')}: ${directRequirements(sde, typeId).map((r) => `${esc(sde.types.get(r.skillId)?.name ?? r.skillId)} ${roman(r.level)}`).join(', ') || '—'}</p>
    </div>
    <div class="tab-panel hidden" data-panel="mastery"></div>
  `;
  const el = openModal(tx('Info item'), body, { wide: true });
  let mastery: ShipMastery | null = null;
  let masteryPlans: FitRequirements[] = [];
  let masteryLevel = 1;
  const renderMastery = () => {
    const panel = el.querySelector<HTMLElement>('[data-panel="mastery"]');
    if (panel && mastery) panel.innerHTML = masteryHtml(ctx, mastery, masteryLevel, masteryPlans);
  };
  if (t.categoryId === 6) {
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
    const lvl = (e.target as HTMLElement).closest<HTMLElement>('[data-mastery-level]');
    if (lvl) { masteryLevel = Number(lvl.dataset.masteryLevel); renderMastery(); return; }
    if ((e.target as HTMLElement).closest('[data-plan-mastery]')) {
      const steps = masteryPlans[masteryLevel - 1].missing;
      savePlan(ctx.character.id, steps.reduce((p, st) => addToPlan(sde, p, ctx.character, st.skillId, st.required), loadPlan(ctx.character.id)));
      toast(tx('Mastery {lvl} pentru {ship} adăugat în skill plan', { lvl: roman(masteryLevel), ship: t.name }));
      return;
    }
    if ((e.target as HTMLElement).closest('[data-copy-mastery]')) {
      copyText(skillPlanText(masteryPlans[masteryLevel - 1].missing), tx('Plan copiat (lipește-l în Skill Plans din joc)'));
      return;
    }
    const variation = (e.target as HTMLElement).closest<HTMLElement>('[data-variation]');
    if (variation && Number(variation.dataset.variation) !== typeId) { showItemInfo(ctx, Number(variation.dataset.variation)); return; }
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (!tab) return;
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === tab));
    el.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
  });
  el.querySelector<HTMLInputElement>('[data-attr-filter]')?.addEventListener('input', (e) => {
    const q = fold((e.target as HTMLInputElement).value.trim());
    el.querySelectorAll<HTMLElement>('[data-attr-name]').forEach((row) => row.classList.toggle('hidden', !row.dataset.attrName!.includes(q)));
    el.querySelectorAll<HTMLElement>('.attr-section').forEach((sec) => sec.classList.toggle('hidden', !sec.querySelector('[data-attr-name]:not(.hidden)')));
  });
  el.querySelector('[data-copy-plan]')?.addEventListener('click', () => copyText(skillPlanText(plan.missing), tx('Plan copiat (lipește-l în Skill Plans din joc)')));
}
