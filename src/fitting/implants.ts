import { mergeImplants, type Fit } from '../engine/fit';
import type { Dogma } from '../engine/dogma';
import { typeIconUrl } from '../services/market';
import { attributeSections } from '../ui/attributes';
import { icon } from '../ui/icons';
import { badge, button, confirmDialog, esc, panel, toast } from '../ui/components';
import { tx } from '../i18n';
import type { FitEnv } from './shared';
import { activeSet, deleteSet, fitCharacter, implantSets, saveSet, useSet } from './implantSets';

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
    return rows.slice(0, 2).map((r) => `${r.name} ${signed(r.base ?? r.value)}`).join(' · ');
  }

  function setLine(d: Dogma, id: number): string {
    const setAttr = [...sde.type(id).attrs.keys()].find((a) => /^implantSet/.test(sde.attributes.get(a)?.name ?? ''));
    const item = d.implants.find((i) => i.typeId === id);
    if (!setAttr || !item) return '';
    const pieces = d.implants.filter((i) => sde.type(i.typeId).attrs.has(setAttr)).length;
    const changed = attributeSections(sde, id, item).flatMap((sec) => sec.rows).filter((r) => {
      const a = sde.attributes.get(r.id);
      return r.base && a && (/bonus/i.test(a.name) || PERCENT_UNITS.includes(a.unitId ?? 0));
    });
    if (!changed.length) return '';
    const setName = env.name(id).replace(/\s+\S+$/, '');
    return `${tx('Set {name}', { name: setName })} · ${pieces === 1 ? tx('{n} piesă', { n: pieces }) : tx('{n} piese', { n: pieces })}: ${changed.map((r) => `${r.name} ${signed(r.value)}`).join(' · ')}`;
  }

  function row(d: Dogma, id: number, extra: { attr?: string; tag?: string }) {
    const slot = slotOf(id);
    const sub = bonusLine(id);
    const set = setLine(d, id);
    return `<div class="slot fitted">
      <img class="slot-img" src="${typeIconUrl(id, 32)}" alt="" loading="lazy" />
      <div class="slot-main"><button class="slot-name link" data-info="${id}">${esc(`${slot ? `[${slot}] ` : ''}${env.name(id)}`)}</button>${sub ? `<span class="dim small">${esc(sub)}</span>` : ''}${set ? `<span class="small set-bonus">${esc(set)}</span>` : ''}</div>
      ${extra.tag ? badge(extra.tag, 'accent') : ''}
      <button class="slot-info" data-info="${id}" title="${tx('Informații')}">${icon('info')}</button>
      ${extra.attr ? `<button class="slot-remove" ${extra.attr} title="${tx('Scoate')}">${icon('close')}</button>` : ''}
    </div>`;
  }

  function render(f: Fit, d: Dogma): string {
    const base = fitCharacter(env.ctx.character).implants;
    const set = activeSet();
    const active = new Set(mergeImplants(sde, base, f.implants));
    const own = base.filter((id) => sde.types.has(id) && active.has(id) && !f.implants.includes(id) && !isBooster(id));
    const fitted = f.implants.map((id, i) => ({ id, i })).filter((x) => !isBooster(x.id));
    const rows = [...own].sort((a, b) => slotOf(a) - slotOf(b)).map((id) => row(d, id, { tag: set?.name ?? tx('caracter') })).join('')
      + fitted.sort((a, b) => slotOf(a.id) - slotOf(b.id)).map((x) => row(d, x.id, { attr: `data-implant="${x.i}"` })).join('');
    const body = `<div class="slot-group implants">${rows}</div>`
      + (rows ? '' : `<p class="dim small extras-hint">${tx('Apasă pe un implant din browser ca să-l adaugi.')}</p>`)
      + `<div class="implant-set-save"><input class="input sm" id="fitImplantSetName" placeholder="${tx('Nume set')}" value="${esc(set?.name ?? '')}" />${button(tx('Salvează set'), { cls: 'sm', attrs: 'data-implant-set-save' })}${set ? button(tx('Șterge set'), { cls: 'ghost sm', attrs: 'data-implant-set-delete' }) : ''}</div>`;
    const actions = `<select class="input plain sm" id="fitImplantSet" title="${tx('Implanturi folosite la calcul')}">
        <option value="">${tx('Din joc')}</option>${implantSets().map((x) => `<option value="${esc(x.name)}" ${x.name === set?.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
      </select>`;
    return panel({ title: tx('Implanturi'), count: own.length + fitted.length || undefined, id: 'fitImplants', cls: 'fit-implants', body, actions });
  }

  function handleChange(target: HTMLElement): boolean {
    if (target.id !== 'fitImplantSet') return false;
    useSet((target as HTMLSelectElement).value);
    return true;
  }

  function handleClick(target: HTMLElement, done: () => void): boolean {
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
      void confirmDialog(tx('Ștergi setul „{name}”?', { name: set.name }), { ok: tx('Șterge set'), danger: true }).then((ok) => {
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
