import { mergeImplants, type Fit } from '../engine/fit';
import type { Dogma } from '../engine/dogma';
import { typeIconUrl } from '../services/market';
import { attributeSections } from '../ui/attributes';
import { button, closeModal, confirmDialog, esc, formatNum, openModal, panel, toast } from '../ui/components';
import { Category } from '../data/sde';
import { icon } from '../ui/icons';
import { tx } from '../i18n';
import type { FitEnv } from './shared';
import { activeSet, deleteSet, DRAFT, fitCharacter, hasDraft, implantSets, saveSet, setImplants, useSet } from './implantSets';

const PERCENT_UNITS = [105, 109, 111, 121, 124, 127];

export function createImplantPanel(env: FitEnv) {
  const { sde } = env;
  const isBooster = (id: number) => sde.baseAttr(id, sde.attrId('boosterness')) > 0;
  const slotOf = (id: number) => sde.baseAttr(id, sde.attrId('implantness'));
  const signed = (v: string) => (v.startsWith('-') || v.startsWith('+') ? v : '+' + v);

  function bonusLine(id: number) {
    const rows = attributeSections(sde, id).flatMap((sec) => sec.rows).filter((r) => {
      const a = sde.attributes.get(r.id);
      return a && (/bonus/i.test(a.name) || PERCENT_UNITS.includes(a.unitId ?? 0)) && a.name !== 'implantness';
    });
    if (!rows.length) return attributeSections(sde, id).flatMap((sec) => sec.rows).filter((r) => /^implantSet/.test(sde.attributes.get(r.id)?.name ?? '')).map((r) => `${r.name} ${r.value}`).join(' · ');
    return rows.slice(0, 2).map((r) => `${r.name} ${signed(r.base ?? r.value)}`).join(' · ');
  }

  function setLine(d: Dogma, id: number): string {
    const setAttr = [...sde.type(id).attrs.keys()].find((a) => /^implantSet/.test(sde.attributes.get(a)?.name ?? ''));
    const item = d.implants.find((i) => i.typeId === id);
    if (!setAttr || !item) return '';
    const pieces = d.implants.filter((i) => sde.type(i.typeId).attrs.has(setAttr)).length;
    const all = attributeSections(sde, id, item).flatMap((sec) => sec.rows);
    let changed = all.filter((r) => {
      const a = sde.attributes.get(r.id);
      return r.base && a && (/bonus/i.test(a.name) || PERCENT_UNITS.includes(a.unitId ?? 0));
    });
    if (!changed.length) {
      const total = d.implants.reduce((m, i) => m * (sde.baseAttr(i.typeId, setAttr) || 1), 1);
      changed = all.filter((r) => r.id === setAttr).map((r) => ({ ...r, value: `${formatNum(total, 2)} x` }));
    }
    if (!changed.length) return '';
    const setName = env.name(id).replace(/\s+\S+$/, '');
    return `${tx('Set {name}', { name: setName })} · ${pieces === 1 ? tx('{n} piesă', { n: pieces }) : tx('{n} piese', { n: pieces })}: ${changed.map((r) => `${r.name} ${r.id === setAttr ? r.value : signed(r.value)}`).join(' · ')}`;
  }

  const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  function row(d: Dogma, slot: number, id: number | undefined) {
    const sub = id ? bonusLine(id) : '';
    const set = id ? setLine(d, id) : '';
    const label = `[${slot}] ${id ? env.name(id) : tx('Gol')}`;
    return `<div class="slot ${id ? 'fitted' : ''}">
      ${id ? `<img class="slot-img" src="${typeIconUrl(id, 32)}" alt="" loading="lazy" />` : ''}
      <div class="slot-main">${id ? `<button class="slot-name link" data-info="${id}">${esc(label)}</button>` : `<span class="dim">${esc(label)}</span>`}${sub ? `<span class="dim small">${esc(sub)}</span>` : ''}${set ? `<span class="small set-bonus">${esc(set)}</span>` : ''}</div>
      <button class="slot-info" data-implant-change="${slot}" title="${tx('Schimbă')}" aria-label="${tx('Schimbă')}">${icon('swap')}</button>
      <button class="slot-remove" data-implant-clear="${slot}" title="${tx('Golește')}" aria-label="${tx('Golește')}" ${id ? '' : 'disabled'}>${icon('close')}</button>
    </div>`;
  }

  function render(f: Fit, d: Dogma): string {
    const base = fitCharacter(env.ctx.character).implants.filter((id) => sde.types.has(id) && !isBooster(id));
    const set = activeSet();
    const fitted = f.implants.filter((id) => !isBooster(id));
    let count = 0;
    const rows = SLOTS.map((slot) => {
      const own = fitted.find((id) => slotOf(id) === slot);
      const id = own ?? base.find((x) => slotOf(x) === slot);
      if (id) count++;
      return row(d, slot, id);
    }).join('');
    const body = `<div class="slot-group implants">${rows}</div>`
      + `<div class="implant-set-save"><input class="input sm" id="fitImplantSetName" placeholder="${tx('Nume set')}" value="${esc(set?.name ?? '')}" />${button(tx('Salvează set'), { cls: 'sm', attrs: 'data-implant-set-save' })}${set ? button(tx('Șterge set'), { cls: 'ghost sm', attrs: 'data-implant-set-delete' }) : ''}</div>`;
    const actions = `<select class="input plain sm" id="fitImplantSet" title="${tx('Implanturi folosite la calcul')}">
        <option value="">${tx('Din joc')}</option>${hasDraft() ? `<option value="${DRAFT}" ${set && !set.name ? 'selected' : ''}>${tx('Nesalvat')}</option>` : ''}${implantSets().map((x) => `<option value="${esc(x.name)}" ${x.name === set?.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
      </select>`;
    return panel({ title: tx('Implanturi'), count: count || undefined, id: 'fitImplants', cls: 'fit-implants', body, actions });
  }

  function putInSlot(slot: number, id: number | null, done: () => void) {
    const base = fitCharacter(env.ctx.character).implants.filter((x) => slotOf(x) !== slot);
    setImplants(id ? [...base, id] : base);
    const f = env.getFit();
    if (f && f.implants.some((x) => !isBooster(x) && slotOf(x) === slot)) env.change((draft) => { draft.implants = draft.implants.filter((x) => isBooster(x) || slotOf(x) !== slot); });
    else done();
  }

  function openPicker(slot: number, done: () => void) {
    const list = sde.typesInCategory(Category.Implant).filter((t) => slotOf(t.id) === slot && !isBooster(t.id)).sort((a, b) => env.name(a.id).localeCompare(env.name(b.id)));
    const rows = list.map((t) => `<button class="slot fitted implant-pick" data-implant-pick="${t.id}" data-search="${esc(env.name(t.id).toLowerCase())}">
        <img class="slot-img" src="${typeIconUrl(t.id, 32)}" alt="" loading="lazy" />
        <span class="slot-main"><span class="slot-name">${esc(env.name(t.id))}</span><span class="dim small">${esc(bonusLine(t.id))}</span></span>
      </button>`).join('');
    const modal = openModal(tx('Implant slot {n}', { n: slot }), `<input class="input" id="implantPickSearch" placeholder="${tx('Caută')}" /><div class="slot-group implants implant-pick-list">${rows}</div>`);
    modal.querySelector<HTMLInputElement>('#implantPickSearch')?.addEventListener('input', (e) => {
      const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
      modal.querySelectorAll<HTMLElement>('[data-implant-pick]').forEach((b) => { b.hidden = !!q && !b.dataset.search!.includes(q); });
    });
    modal.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-implant-pick]');
      if (!b) return;
      closeModal();
      putInSlot(slot, Number(b.dataset.implantPick), done);
    });
  }

  function handleChange(target: HTMLElement): boolean {
    if (target.id !== 'fitImplantSet') return false;
    useSet((target as HTMLSelectElement).value);
    return true;
  }

  function handleClick(target: HTMLElement, done: () => void): boolean {
    const change = target.closest<HTMLElement>('[data-implant-change]');
    if (change) { openPicker(Number(change.dataset.implantChange), done); return true; }
    const clear = target.closest<HTMLElement>('[data-implant-clear]');
    if (clear) { putInSlot(Number(clear.dataset.implantClear), null, done); return true; }
    const f = env.getFit();
    if (target.closest('[data-implant-set-save]') && f) {
      const name = document.querySelector<HTMLInputElement>('#fitImplantSetName')?.value.trim() ?? '';
      if (!name) { toast(tx('Scrie un nume pentru set')); return true; }
      const implants = mergeImplants(sde, fitCharacter(env.ctx.character).implants, f.implants).filter((id) => sde.types.has(id) && !isBooster(id));
      const exists = implantSets().some((x) => x.name === name);
      void (exists ? confirmDialog(tx('Setul „{name}” există. Îl înlocuiești?', { name }), { ok: tx('Înlocuiește') }) : Promise.resolve(true)).then((ok) => {
        if (!ok) return;
        saveSet(name, implants);
        toast(tx('Set salvat'));
        done();
      });
      return true;
    }
    const set = activeSet();
    if (target.closest('[data-implant-set-delete]') && set) {
      void confirmDialog(tx('Ștergi setul „{name}”?', { name: set.name || tx('nesalvat') }), { ok: tx('Șterge set'), danger: true }).then((ok) => {
        if (!ok) return;
        deleteSet(set.name);
        done();
      });
      return true;
    }
    return false;
  }

  return { bonusLine, render, handleChange, handleClick };
}
