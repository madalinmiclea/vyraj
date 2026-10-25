import type { AppContext } from '../app/context';
import { Category, type TypeInfo } from '../data/sde';
import { loadStoredCharacters, upsertStoredCharacter } from '../character/characters';
import { loadJson, saveJson } from '../storage';
import { requirementTree, requirementsFor, alphaRaces } from '../character/requirements';
import { formatDuration, durationHtml, skillRank, spForLevel } from '../character/training';
import { typeIconUrl } from '../services/market';
import { badge, badgeHtml, copyText, emptyState, esc, formatInt, panel, searchField, toast, windowTitle } from '../ui/components';
import { icon } from '../ui/icons';
import { requirementTreeHtml, roman, showItemInfo, skillPlanText } from '../ui/itemInfo';
import { fold } from '../ui/fold';
import { tx, locale } from '../i18n';
import { addItemToPlan, addToPlan, loadPlan, movePlan, planRows, planText, removeFromPlan, savePlan, type PlanEntry } from '../character/skillPlan';

export function createSkillsView(el: HTMLElement, ctx: AppContext, side: HTMLElement) {
  const sde = ctx.sde;
  const skills = sde.typesInCategory(Category.Skill).sort((a, b) => a.name.localeCompare(b.name));
  const groups = new Map<string, TypeInfo[]>();
  for (const s of skills) {
    if (!groups.has(s.groupName)) groups.set(s.groupName, []);
    groups.get(s.groupName)!.push(s);
  }
  const groupNames = [...groups.keys()].sort();
  const searchable = [...sde.types.values()].filter((t) => t.marketGroupId).map((t) => ({ t, l: fold(t.name) }));
  const OPEN_KEY = 'eve-fit:ui:skill-groups';
  const openGroups = new Set(loadJson<string[]>(OPEN_KEY, []));
  let selectedItem: number | null = null;

  el.innerHTML = `<div class="stack">
      <div class="char-plan-grid">
        <div id="skillPlan"></div>
        <div class="stack">
          ${panel({ title: tx('Requirements pentru orice item'), body: `${searchField({ id: 'reqSearch', placeholder: tx('Navă, modul, dronă, implant...') })}<div id="reqResults" class="req-results"></div>` })}
          <div id="reqDetail"></div>
        </div>
      </div>
    </div>`;
  const search = el.querySelector<HTMLInputElement>('#reqSearch')!;
  const results = el.querySelector<HTMLElement>('#reqResults')!;
  const detail = el.querySelector<HTMLElement>('#reqDetail')!;
  const planEl = el.querySelector<HTMLElement>('#skillPlan')!;

  function currentPlan(): PlanEntry[] {
    const c = ctx.character;
    return loadPlan(c.id).filter((e) => e.level > (c.skills.get(e.skillId) ?? 0));
  }

  function setPlan(plan: PlanEntry[]) {
    savePlan(ctx.character.id, plan);
    renderPlan();
  }

  function renderPlan() {
    const rows = planRows(sde, currentPlan(), ctx.character);
    const total = rows.reduce((a, r) => a + r.seconds, 0);
    const sp = rows.reduce((a, r) => a + r.sp, 0);
    const when = (ms: number) => new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    planEl.innerHTML = panel({
      title: 'Skill plan',
      count: rows.length ? `${tx('{n} niveluri', { n: rows.length })} · ${formatDuration(total)} · ${formatInt(sp)} SP` : '',
      body: rows.length
        ? `<table class="table compact plan-table"><thead><tr><th>Skill</th><th class="r">${tx('Timp')}</th><th class="r">${tx('Gata pe')}</th><th></th></tr></thead><tbody>
            ${rows.map((r, i) => `<tr><td><button class="link" data-info="${r.skillId}">${esc(r.name)}</button> <b>${roman(r.level)}</b></td>
              <td class="r num">${formatDuration(r.seconds)}</td><td class="r num dim">${when(r.finishes)}</td>
              <td class="r plan-actions"><button class="icon-btn" data-plan-move="${i}:-1" title="${tx('Sus')}">↑</button><button class="icon-btn" data-plan-move="${i}:1" title="${tx('Jos')}">↓</button><button class="icon-btn" data-plan-remove="${i}" title="${tx('Scoate')}">${icon('close')}</button></td></tr>`).join('')}
          </tbody></table>
          <div class="row-actions"><button class="btn ghost sm" data-plan-copy>${tx('Copiază pentru EVE')}</button><button class="btn ghost sm" data-plan-clear>${tx('Golește')}</button></div>`
        : `<p class="dim small">${tx('Planul e gol. Adaugă skill-uri din lista de requirements, din grupurile de skill-uri sau din „Ce skill-uri să antrenez” din Fitting.')}</p>`,
    });
  }

  function skillRows(group: string) {
    const c = ctx.character;
    const editable = c.kind === 'custom';
    return (groups.get(group) ?? []).map((s) => {
      const lvl = c.skills.get(s.id) ?? 0;
      const pips = Array.from({ length: 5 }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="skill-row">
          <button class="link" data-info="${s.id}" title="${esc(s.name)}">${esc(s.name)}</button>
          <span class="dim small">r${skillRank(sde, s.id)}</span>
          ${lvl < 5 ? `<button class="icon-btn plan-add" data-plan-skill="${s.id}" title="${tx('Adaugă nivelul următor în skill plan')}">+</button>` : '<span class="plan-add"></span>'}
          ${editable
            ? `<select class="input plain sm" data-level="${s.id}">${[0, 1, 2, 3, 4, 5].map((l) => `<option value="${l}" ${l === lvl ? 'selected' : ''}>${roman(l)}</option>`).join('')}</select>`
            : `<span class="skill-pips">${pips}</span>`}
        </div>`;
    }).join('');
  }

  function renderGroups() {
    const c = ctx.character;
    const editable = c.kind === 'custom';
    const trained = skills.filter((s) => (c.skills.get(s.id) ?? 0) > 0).length;
    const sp = c.totalSp ?? skills.reduce((a, s) => a + (c.sp.get(s.id) ?? spForLevel(skillRank(sde, s.id), c.skills.get(s.id) ?? 0)), 0);
    const scroll = side.querySelector('.side-nav')?.scrollTop ?? 0;
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Skill-uri'), `${trained}/${skills.length}`)}
        <p class="side-note">${formatInt(sp)} SP${editable ? ` · ${tx('caracter personalizat: poți schimba nivelurile')}` : c.kind === 'esi' ? (c.clone === 'alpha' ? ` · ${tx('Alpha: antrenează la jumătate de viteză')}` : '') : ` · ${tx('caracter teoretic')}`}</p></div>
      <div class="side-nav skill-tree">${groupNames.map((g) => {
        const list = groups.get(g)!;
        const any = list.filter((s) => (c.skills.get(s.id) ?? 0) > 0).length;
        const open = openGroups.has(g);
        return `<div class="tree-group sub skill-group ${open ? 'open' : ''}" style="--depth:0">
            <button class="tree-head" data-group="${esc(g)}">${icon('chevron', 'chev')}<span>${esc(g)}</span><span class="count">${any}/${list.length}</span></button>
            <div class="tree-items"><div class="skill-list">${open ? skillRows(g) : ''}</div></div>
          </div>`;
      }).join('')}</div>`;
    side.querySelector('.side-nav')!.scrollTop = scroll;
  }

  function toggleGroup(head: HTMLElement) {
    const g = head.dataset.group!;
    const box = head.parentElement!;
    const open = !openGroups.has(g);
    if (open) openGroups.add(g); else openGroups.delete(g);
    saveJson(OPEN_KEY, [...openGroups]);
    box.classList.toggle('open', open);
    const list = box.querySelector<HTMLElement>('.skill-list')!;
    list.innerHTML = open ? skillRows(g) : '';
  }

  function renderResults() {
    const q = fold(search.value.trim());
    if (q.length < 2) { results.innerHTML = ''; return; }
    const hits = searchable.filter((x) => x.l.includes(q)).slice(0, 30);
    results.innerHTML = hits.length
      ? hits.map(({ t }) => `<button class="req-hit ${t.id === selectedItem ? 'selected' : ''}" data-item="${t.id}"><img src="${typeIconUrl(t.id, 32)}" alt="" loading="lazy" /><span>${esc(t.name)}</span><span class="dim small">${esc(t.groupName)}</span></button>`).join('')
      : `<p class="dim small">${tx('Nimic găsit (aici sunt doar itemele de fitting și skill-urile).')}</p>`;
  }

  function renderDetail() {
    if (!selectedItem) {
      detail.innerHTML = panel({ body: emptyState({ title: tx('Alege un item'), text: tx('Caută mai sus un item ca să vezi ce skill-uri îți trebuie și cât durează.') }) });
      return;
    }
    const t = sde.type(selectedItem);
    const plan = requirementsFor(sde, [t.id], ctx.character);
    const alpha = alphaRaces(sde, [t.id]);
    const tree = requirementTree(sde, t.id);
    detail.innerHTML = panel({
      title: t.name,
      actions: `<button class="btn ghost sm" data-info="${t.id}">${icon('info')}Show Info</button>`,
      body: `<div class="req-summary">
          ${plan.canFly ? badge(tx('Ai tot ce trebuie'), 'ok', true) : badgeHtml(tx('Lipsesc <span class="unit">{n}</span> · {time}', { n: plan.missing.length, time: durationHtml(plan.totalSeconds) }), 'accent', true)}
          ${alpha.length ? badge('Alpha: ' + alpha.join(', '), 'accent') : badge('Omega', 'gold')}
        </div>
        ${tree.length ? requirementTreeHtml(ctx, tree) : `<p class="dim">${tx('Nu cere niciun skill.')}</p>`}
        ${plan.missing.length ? `<table class="table compact"><thead><tr><th>${tx('Ordine de antrenament')}</th><th></th><th class="r">${tx('Timp')}</th></tr></thead><tbody>
          ${plan.missing.map((s) => `<tr class="${s.status}"><td>${esc(s.name)}</td><td>${roman(s.current)} → ${roman(s.required)}</td><td class="r num">${formatDuration(s.seconds)}</td></tr>`).join('')}
          </tbody></table>
          <div class="row-actions"><button class="btn ghost sm" data-copy-plan>${tx('Copiază planul')}</button><button class="btn ghost sm" data-plan-item="${t.id}">${tx('Adaugă în skill plan')}</button></div>` : ''}`,
    });
  }

  function selectItem(typeId: number) {
    selectedItem = typeId;
    renderResults();
    renderDetail();
  }

  const onClick = (e: Event) => {
    const t = e.target as HTMLElement;
    const at = (sel: string) => t.closest<HTMLElement>(sel);
    const group = at('[data-group]');
    if (group) { toggleGroup(group); return; }
    const info = at('[data-info]');
    if (info) { showItemInfo(ctx, Number(info.dataset.info)); return; }
    const item = at('[data-item]');
    if (item) { selectItem(Number(item.dataset.item)); return; }
    const planItem = at('[data-plan-item]');
    if (planItem) { setPlan(addItemToPlan(sde, currentPlan(), ctx.character, Number(planItem.dataset.planItem))); toast(tx('Adăugat în skill plan')); return; }
    const planSkill = at('[data-plan-skill]');
    if (planSkill) {
      const id = Number(planSkill.dataset.planSkill);
      const plan = currentPlan();
      const next = Math.min(5, Math.max(ctx.character.skills.get(id) ?? 0, ...plan.filter((e) => e.skillId === id).map((e) => e.level)) + 1);
      setPlan(addToPlan(sde, plan, ctx.character, id, next));
      toast(tx('{name} {lvl} în skill plan', { name: sde.type(id).name, lvl: roman(next) }));
      return;
    }
    const move = at('[data-plan-move]');
    if (move) {
      const [i, d] = move.dataset.planMove!.split(':').map(Number);
      const before = currentPlan();
      const next = movePlan(sde, before, ctx.character, i, d);
      if (next === before) toast(tx('Nu poți muta skill-ul înaintea precondițiilor lui'));
      else setPlan(next);
      return;
    }
    const remove = at('[data-plan-remove]');
    if (remove) {
      const before = currentPlan();
      const next = removeFromPlan(sde, before, ctx.character, Number(remove.dataset.planRemove));
      const dropped = before.length - next.length - 1;
      setPlan(next);
      if (dropped > 0) toast(tx('Am scos și {n} skill-uri care depindeau de el', { n: dropped }));
      return;
    }
    if (at('[data-plan-copy]')) { copyText(planText(planRows(sde, currentPlan(), ctx.character)), tx('Plan copiat (lipește-l în Skill Plans din joc)')); return; }
    if (at('[data-plan-clear]')) { setPlan([]); return; }
    if (at('[data-copy-plan]') && selectedItem) {
      copyText(skillPlanText(requirementsFor(sde, [selectedItem], ctx.character).missing), tx('Plan copiat (lipește-l în Skill Plans din joc)'));
    }
  };

  el.addEventListener('click', onClick);
  side.addEventListener('click', onClick);

  const onLevel = (e: Event) => {
    const target = e.target as HTMLSelectElement;
    if (!target.dataset.level) return;
    const stored = loadStoredCharacters().find((c) => c.id === ctx.character.id);
    if (!stored) return;
    const skillId = Number(target.dataset.level);
    const level = Number(target.value);
    const before = stored.skills[skillId]?.sp ?? 0;
    const after = level > 0 ? spForLevel(skillRank(sde, skillId), level) : 0;
    if (level > 0) stored.skills[skillId] = { level, sp: after };
    else delete stored.skills[skillId];
    if (stored.totalSp != null) stored.totalSp = Math.max(0, stored.totalSp + after - before);
    upsertStoredCharacter(stored);
    ctx.reloadCharacters();
    toast(`${sde.types.get(skillId)?.name} → ${roman(level)}`);
  };
  el.addEventListener('change', onLevel);
  side.addEventListener('change', onLevel);

  search.addEventListener('input', renderResults);
  ctx.onCharacterChange(() => { renderGroups(); renderDetail(); renderPlan(); });
  window.addEventListener('eve-plan-changed', renderPlan);
  renderPlan();
  renderGroups();
  renderDetail();

  return {
    selectItem(name: string, typeId: number | null) {
      const t = typeId ? sde.types.get(typeId) : sde.findType(name);
      if (!t) { toast(tx('„{name}” nu e în datele de fitting', { name })); return; }
      selectItem(t.id);
    },
  };
}
