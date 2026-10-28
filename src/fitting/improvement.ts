import type { Fit } from '../engine/fit';
import { findProfile } from '../engine/profiles';
import { skillsPlan, type FitRequirements } from '../character/requirements';
import { formatDuration, durationHtml } from '../character/training';
import { adviseSkills, rankAdvice, type AdviceKind, type SkillAdvice } from '../character/skillAdvisor';
import { addToPlan, loadPlan, savePlan } from '../character/skillPlan';
import { shipMastery, masterySkills } from '../services/masteries';
import { roman, skillPlanText, withHullSkills } from '../ui/itemInfo';
import { icon } from '../ui/icons';
import { badge, badgeHtml, copyText, esc, formatInt, loader, panel, toast } from '../ui/components';
import { tx } from '../i18n';
import type { FitEnv } from './shared';

const KINDS: { key: AdviceKind; label: string }[] = [
  { key: 'dps', label: 'DPS' },
  { key: 'tank', label: 'Tank' },
  { key: 'general', label: 'General' },
];

export function createImprovementPanel(env: FitEnv) {
  const { sde, ctx, name } = env;
  let tab: AdviceKind | number = 'dps';
  let perDay = false;
  let adviceKey = '';
  let advice: SkillAdvice[] | null = null;
  let masteryKey = '';
  let mastery: FitRequirements[] | null = null;
  let timer = 0;

  const keyOf = (f: Fit) => `${ctx.character.id}|${env.profileId()}|${JSON.stringify(f)}`;
  const masteryKeyOf = (f: Fit) => `${ctx.character.id}|${f.shipId}`;
  const host = () => document.querySelector<HTMLElement>('#fitImprove .panel-body');

  function adviceHtml(kind: AdviceKind): string {
    if (!advice) return loader(tx('Calculez fiecare skill pe fit…'));
    const rows = rankAdvice(advice, kind, perDay).slice(0, 20).map((a) => `<tr>
        <td><button class="link" data-info="${a.skillId}">${esc(a.name)}</button>
          <span class="dim small">${a.from ? roman(a.from) : '0'} → ${roman(a.to)}</span>
          ${a.missing.length ? `<div class="small warn-text">${tx('cere')} ${a.missing.map((r) => `<button class="link" data-info="${r.skillId}">${esc(name(r.skillId))}</button> ${roman(r.level)}`).join(', ')}</div>` : ''}</td>
        <td class="advice-gain">${a.changes[kind].map((c) => `<span><b class="num">${esc(c.text)}</b> ${esc(c.label)}</span>`).join('')}</td>
        <td class="r num">${formatInt(a.sp)} SP</td>
        <td class="r num">${formatDuration(a.seconds)}</td>
        <td><button class="icon-btn" data-improve-plan="${a.skillId}:${a.to}" title="${tx('Adaugă în skill plan')}">+</button></td>
      </tr>`).join('');
    return `<div class="advice-sort">
        <button class="chip-btn ${perDay ? '' : 'active'}" data-improve-sort="gain">${tx('Câștig cel mai mare')}</button>
        <button class="chip-btn ${perDay ? 'active' : ''}" data-improve-sort="day">${tx('Câștig pe zi de antrenament')}</button>
      </div>
      ${rows ? `<table class="table compact advice"><thead><tr><th>Skill</th><th>${tx('Câștig la nivelul următor')}</th><th class="r">SP</th><th class="r">${tx('Timp')}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="dim">${kind === 'dps' ? tx('Niciun skill nu mai îmbunătățește DPS-ul pe fit-ul ăsta.') : kind === 'tank' ? tx('Niciun skill nu mai îmbunătățește tank-ul pe fit-ul ăsta.') : tx('Niciun skill nu mai îmbunătățește nimic aici pe fit-ul ăsta.')}</p>`}`;
  }

  function masteryHtml(level: number): string {
    const plan = mastery?.[level - 1];
    if (!plan) return '';
    if (plan.canFly) return `<div class="req-summary">${badge(tx('Mastery {lvl} completă', { lvl: roman(level) }), 'ok', true)}</div>`;
    const rows = plan.missing.map((s) => `<tr class="${s.status}">
        <td><button class="link" data-info="${s.skillId}">${esc(s.name)}</button> <span class="dim small">${s.current ? roman(s.current) : '0'} → ${roman(s.required)}</span></td>
        <td class="r num">${formatInt(s.sp)} SP</td>
        <td class="r num">${formatDuration(s.seconds)}</td>
        <td><button class="icon-btn" data-improve-plan="${s.skillId}:${s.required}" title="${tx('Adaugă în skill plan')}">+</button></td>
      </tr>`).join('');
    return `<div class="req-summary">${badgeHtml(tx('Mastery {lvl}: lipsesc <span class="unit">{n}</span> skill-uri · {time}', { lvl: roman(level), n: plan.missing.length, time: durationHtml(plan.totalSeconds) }), 'accent', true)}</div>
      <table class="table compact advice"><thead><tr><th>Skill</th><th class="r">SP</th><th class="r">${tx('Timp')}</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <div class="row-actions"><button class="btn ghost sm" data-improve-copy>${icon('copy')}${tx('Copiază planul')}</button><button class="btn ghost sm" data-improve-mastery>${icon('skills')}${tx('Adaugă în skill plan')}</button></div>`;
  }

  function bodyHtml(): string {
    if (typeof tab === 'number' && !mastery) tab = 'dps';
    const kindTabs = KINDS.map((k) => `<button class="tab ${k.key === tab ? 'active' : ''}" data-improve-tab="${k.key}">${k.label}${advice ? `<span class="tab-count">${rankAdvice(advice, k.key, false).length}</span>` : ''}</button>`).join('');
    const masteryTabs = mastery ? `<div class="improve-mastery"><span class="improve-mastery-label">Mastery</span><div class="improve-seg">${mastery.map((p, i) => `<button class="${tab === i + 1 ? 'active' : ''}" data-improve-tab="${i + 1}" aria-label="Mastery ${roman(i + 1)}">${roman(i + 1)}<small class="${p.canFly ? 'ok' : ''}">${p.canFly ? '✓' : p.missing.length}</small></button>`).join('')}</div></div>` : '';
    return `<div class="tabs improve-tabs">${kindTabs}${masteryTabs}</div>${typeof tab === 'number' ? masteryHtml(tab) : adviceHtml(tab)}`;
  }

  function redraw() {
    const el = host();
    if (el) el.innerHTML = bodyHtml();
  }

  function render(f: Fit): string {
    if (keyOf(f) !== adviceKey) advice = null;
    if (masteryKeyOf(f) !== masteryKey) mastery = null;
    return panel({ title: tx('Improvement skills'), count: ctx.character.name, id: 'fitImprove', cls: 'fit-improve', body: bodyHtml() });
  }

  function refresh(f: Fit) {
    const key = keyOf(f);
    if (key !== adviceKey || !advice) {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const current = env.getFit();
        if (!current || keyOf(current) !== key) return;
        advice = adviseSkills(sde, current, ctx.character, findProfile(env.profileId()));
        adviceKey = key;
        redraw();
      }, 250);
    }
    const mKey = masteryKeyOf(f);
    if (mKey !== masteryKey || !mastery) {
      const shipId = f.shipId;
      shipMastery(shipId).then((raw) => {
        const current = env.getFit();
        if (!raw || !current || masteryKeyOf(current) !== mKey) return;
        const m = withHullSkills(ctx, shipId, raw);
        mastery = [1, 2, 3, 4, 5].map((l) => skillsPlan(sde, masterySkills(m, l), ctx.character));
        masteryKey = mKey;
        redraw();
      });
    }
  }

  function handleClick(target: HTMLElement): boolean {
    if (!target.closest('#fitImprove')) return false;
    const at = (sel: string) => target.closest<HTMLElement>(sel);
    const t = at('[data-improve-tab]');
    if (t) {
      const v = t.dataset.improveTab!;
      tab = /^\d$/.test(v) ? Number(v) : (v as AdviceKind);
      redraw();
      return true;
    }
    const s = at('[data-improve-sort]');
    if (s) { perDay = s.dataset.improveSort === 'day'; redraw(); return true; }
    const c = ctx.character;
    const pl = at('[data-improve-plan]');
    if (pl) {
      const [id, lvl] = pl.dataset.improvePlan!.split(':').map(Number);
      savePlan(c.id, addToPlan(sde, loadPlan(c.id), c, id, lvl));
      toast(tx('{name} {lvl} în skill plan', { name: name(id), lvl: roman(lvl) }));
      return true;
    }
    const steps = typeof tab === 'number' ? mastery?.[tab - 1]?.missing ?? [] : [];
    if (at('[data-improve-mastery]') && typeof tab === 'number') {
      savePlan(c.id, steps.reduce((p, st) => addToPlan(sde, p, c, st.skillId, st.required), loadPlan(c.id)));
      toast(tx('Mastery {lvl} pentru {ship} adăugat în skill plan', { lvl: roman(tab), ship: name(env.getFit()?.shipId ?? 0) }));
      return true;
    }
    if (at('[data-improve-copy]')) {
      copyText(skillPlanText(steps), tx('Plan copiat (lipește-l în Skill Plans din joc)'));
      return true;
    }
    return false;
  }

  return { render, refresh, handleClick };
}
