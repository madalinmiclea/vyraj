import type { Fit } from '../engine/fit';
import type { Dogma } from '../engine/dogma';
import { burstCharges, SHIP_BONUSES, type FleetBoost } from '../engine/fleet';
import { isProjectable, projectedFlow } from '../engine/projected';
import type { HeatStat } from '../engine/stats';
import type { TypeInfo } from '../data/sde';
import { Category } from '../data/sde';
import { typeIconUrl } from '../services/market';
import { icon } from '../ui/icons';
import { button, esc, formatNum, panel, toast } from '../ui/components';
import { tx } from '../i18n';
import { capTime, type FitEnv } from './shared';

const emptyBoost = (): FleetBoost => ({ charges: [], t2: true, shipBonus: 0, mindlink: false });

export function createSupportPanels(env: FitEnv) {
  const { sde } = env;
  let projectable: TypeInfo[] | null = null;
  const projectableList = () => projectable ??= sde.typesInCategory(Category.Module).filter((t) => t.marketGroupId && isProjectable(sde, t.id)).sort((a, b) => a.name.localeCompare(b.name));
  const bursts = burstCharges(sde);

  function modeSelect(f: Fit) {
    const modes = sde.modesFor(f.shipId);
    if (!modes.length) return '';
    const label = (t: TypeInfo) => t.name.replace(`${sde.type(f.shipId).name} `, '').replace(/ Mode$/, '');
    return `<label class="select-field mode-field"><span>${tx('Mod')}</span><select class="input plain sm" id="fitMode">
      ${modes.map((m) => `<option value="${m.id}" ${m.id === f.mode ? 'selected' : ''}>${esc(label(m))}</option>`).join('')}
    </select></label>`;
  }

  function ensureMode(f: Fit) {
    const modes = sde.modesFor(f.shipId);
    if (!modes.length) { delete f.mode; return; }
    if (!modes.some((m) => m.id === f.mode)) f.mode = modes[0].id;
  }

  function fleetBody(f: Fit) {
    const b = f.fleet ?? emptyBoost();
    const label = (id: number) => env.name(id).replace(/ Charge$/, '');
    const chosen = b.charges.map((id) => `<button class="chip-btn sm active" data-burst="${id}" title="${tx('Scoate')}">${esc(label(id))} ×</button>`).join('');
    const picker = `<select class="input plain sm" id="fleetAddBurst"><option value="">+ ${tx('Burst')}</option>
      ${bursts.map((g) => `<optgroup label="${esc(g.group)}">${g.charges.filter((c) => !b.charges.includes(c.id)).map((c) => `<option value="${c.id}">${esc(label(c.id))}</option>`).join('')}</optgroup>`).join('')}
    </select>`;
    return `<div class="fleet-opts">
        <button class="chip-btn sm ${b.t2 ? 'active' : ''}" data-fleet="t2">T2 burst</button>
        <button class="chip-btn sm ${b.mindlink ? 'active' : ''}" data-fleet="mindlink">Mindlink</button>
        <label class="select-field"><span>${tx('Bonus navă')}</span><select class="input plain sm" id="fleetShipBonus">
          ${SHIP_BONUSES.map((n) => `<option value="${n}" ${n === b.shipBonus ? 'selected' : ''}>${n ? `${n}% × 5` : '—'}</option>`).join('')}
        </select></label>
      </div>
      <div class="burst-group">${picker}${chosen}</div>`;
  }

  function projectedBody(f: Fit, d: Dogma) {
    const list = f.projected ?? [];
    const flow = projectedFlow(d);
    const rows = list.map((p, i) => `<div class="slot fitted">
      <img class="slot-img" src="${typeIconUrl(p.typeId, 32)}" alt="" loading="lazy" />
      <div class="slot-main"><button class="slot-name link" data-info="${p.typeId}">${esc(env.name(p.typeId))}</button></div>
      <div class="stepper"><button data-proj="${i}:-1">−</button><span class="num">${p.count}</span><button data-proj="${i}:1">+</button></div>
      <button class="slot-remove" data-proj="${i}:x" title="${tx('Scoate')}">${icon('close')}</button>
    </div>`).join('');
    const flows = [
      flow.shield ? `<span>Shield <b class="num pos">+${formatNum(flow.shield, 1)}</b> HP/s</span>` : '',
      flow.armor ? `<span>Armor <b class="num pos">+${formatNum(flow.armor, 1)}</b> HP/s</span>` : '',
      flow.hull ? `<span>Hull <b class="num pos">+${formatNum(flow.hull, 1)}</b> HP/s</span>` : '',
      flow.capIn ? `<span>Cap <b class="num pos">+${formatNum(flow.capIn, 1)}</b> GJ/s</span>` : '',
      flow.capOut ? `<span>Cap <b class="num neg">−${formatNum(flow.capOut, 1)}</b> GJ/s</span>` : '',
    ].join('');
    return `<div class="proj-add">
        <input class="input plain sm" id="projName" list="projList" placeholder="${tx('Modul proiectat pe navă')}" />
        <datalist id="projList">${projectableList().map((t) => `<option value="${esc(t.name)}"></option>`).join('')}</datalist>
        ${button(tx('Adaugă'), { iconName: 'plus', cls: 'ghost sm', attrs: 'data-proj-add="1"' })}
      </div>
      <div class="slot-group">${rows}</div>
      ${flows ? `<div class="mini-kv">${flows}</div>` : ''}`;
  }

  function supportPanel(f: Fit, d: Dogma) {
    const active = (f.fleet?.charges.length ?? 0) + (f.projected?.length ?? 0);
    return panel({
      title: tx('Flotă și efecte proiectate'),
      count: active ? String(active) : undefined,
      body: `<div class="window-title sub">${tx('Boost-uri flotă')}</div>${fleetBody(f)}
        <div class="window-title sub">${tx('Efecte proiectate')}</div>${projectedBody(f, d)}`,
    });
  }

  function heatPanel(list: HeatStat[]) {
    if (!list.length) return '';
    return panel({
      title: 'Overheat',
      body: `<table class="table compact"><thead><tr><th>${tx('Modul')}</th><th class="r">HP</th><th class="r">${tx('Daună/ciclu')}</th><th class="r">${tx('Cicluri')}</th><th class="r">${tx('Timp')}</th></tr></thead><tbody>
        ${list.map((h) => `<tr><td>${esc(h.name)}</td><td class="r num">${formatNum(h.hp, 0)}</td><td class="r num">${formatNum(h.damage, 2)}</td>
          <td class="r num">${Number.isFinite(h.cycles) ? h.cycles : '∞'}</td><td class="r num dim">${Number.isFinite(h.cycles) && h.cycle > 0 ? capTime(h.cycles * h.cycle) : '—'}</td></tr>`).join('')}
      </tbody></table>`,
    });
  }

  function handleClick(target: HTMLElement): boolean {
    const at = (sel: string) => target.closest<HTMLElement>(sel);
    const burst = at('[data-burst]');
    if (burst) {
      const id = Number(burst.dataset.burst);
      env.change((draft) => {
        const b = draft.fleet ?? (draft.fleet = emptyBoost());
        b.charges = b.charges.includes(id) ? b.charges.filter((x) => x !== id) : [...b.charges, id];
      });
      return true;
    }
    const opt = at('[data-fleet]');
    if (opt) {
      const key = opt.dataset.fleet as 't2' | 'mindlink';
      env.change((draft) => { const b = draft.fleet ?? (draft.fleet = emptyBoost()); b[key] = !b[key]; });
      return true;
    }
    const proj = at('[data-proj]');
    if (proj) {
      const [i, op] = proj.dataset.proj!.split(':');
      env.change((draft) => {
        const list = draft.projected ?? (draft.projected = []);
        const p = list[Number(i)];
        if (!p) return;
        if (op === 'x') list.splice(Number(i), 1);
        else p.count = Math.max(1, Math.min(20, p.count + Number(op)));
      });
      return true;
    }
    if (at('[data-proj-add]')) {
      const input = document.querySelector<HTMLInputElement>('#projName');
      const t = input?.value.trim() ? sde.findType(input.value.trim()) : undefined;
      if (!t || !isProjectable(sde, t.id)) { toast(tx('Alege un modul din listă')); return true; }
      env.change((draft) => {
        const list = draft.projected ?? (draft.projected = []);
        const same = list.find((p) => p.typeId === t.id);
        if (same) same.count++; else list.push({ typeId: t.id, count: 1 });
      });
      return true;
    }
    return false;
  }

  function handleChange(target: HTMLSelectElement): boolean {
    if (target.id === 'fitMode') { env.change((draft) => { draft.mode = Number(target.value); }); return true; }
    if (target.id === 'fleetAddBurst') {
      const id = Number(target.value);
      if (id) env.change((draft) => { const b = draft.fleet ?? (draft.fleet = emptyBoost()); if (!b.charges.includes(id)) b.charges.push(id); });
      return true;
    }
    if (target.id === 'fleetShipBonus') { env.change((draft) => { (draft.fleet ?? (draft.fleet = emptyBoost())).shipBonus = Number(target.value); }); return true; }
    return false;
  }

  return { modeSelect, ensureMode, supportPanel, heatPanel, handleClick, handleChange };
}
