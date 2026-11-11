import { Category, type TypeInfo } from '../data/sde';
import { addToFit, canActivate, canOverheat, type Fit, type FitModule, type SlotKind } from '../engine/fit';
import { isProjectable } from '../engine/projected';
import type { ModuleState } from '../engine/dogma';
import { applyChecked } from '../engine/rules';
import { toast } from '../ui/components';
import { tx } from '../i18n';
import { parseSlot, proving, type ExtrasTab, type FitEnv } from './shared';
import { fitCharacter } from './implantSets';
import type { createSupportPanels } from './support';
import type { createFitModals } from './modals';

interface EditDeps {
  el: HTMLElement;
  left: HTMLElement;
  support: ReturnType<typeof createSupportPanels>;
  openMutation: ReturnType<typeof createFitModals>['openMutation'];
  render(): void;
  newFit(shipId: number): Promise<boolean>;
  extrasTab(): ExtrasTab;
  showExtras(key: ExtrasTab): void;
  pickedSlot(): SlotKind | null;
  pickSlot(kind: SlotKind | null): void;
}

export function createFitEdit(env: FitEnv, deps: EditDeps) {
  const { sde, ctx } = env;
  const { el, left, support, render, newFit, showExtras } = deps;

  function routeToExtras(fit: Fit, t: TypeInfo): boolean {
    const extrasTab = deps.extrasTab();
    if (extrasTab === 'cargo') {
      const result = applyChecked(sde, fit, ctx.character.skills, (draft) => {
        const same = draft.cargo.find((c) => c.typeId === t.id);
        if (same) same.count++; else draft.cargo.push({ typeId: t.id, count: 1 });
        return { ok: true, message: tx('{name} adăugat în cargo', { name: t.name }) };
      }, fitCharacter(ctx.character).implants);
      toast(proving(result.message));
      if (result.ok) render();
      return true;
    }
    if (extrasTab === 'projected' && isProjectable(sde, t.id)) { support.addProjected(t.id); toast(tx('{name} proiectat pe navă', { name: t.name })); return true; }
    if (extrasTab === 'command' && support.isBurst(t.id)) { support.addBurst(t.id); toast(tx('{name} adăugat la boost-uri', { name: t.name })); return true; }
    return false;
  }

  function selectItem(itemName: string, typeId: number | null) {
    const t = typeId ? sde.types.get(typeId) : sde.findType(itemName);
    if (!t) { toast(tx('„{name}” nu se poate folosi în fitting', { name: itemName })); return; }
    if (t.categoryId === Category.Ship) {
      void newFit(t.id).then((ok) => { if (ok) toast(`${tx('Fit nou')}: ${t.name}`); });
      return;
    }
    const fit = env.getFit();
    if (!fit) { toast(tx('Alege întâi o navă')); return; }
    if (routeToExtras(fit, t)) return;
    let result = applyChecked(sde, fit, ctx.character.skills, (draft) => addToFit(sde, draft, t.id), fitCharacter(ctx.character).implants);
    if (!result.ok && (t.categoryId === Category.Drone || t.categoryId === Category.Fighter)) {
      const bay = applyChecked(sde, fit, ctx.character.skills, (draft) => {
        const r = addToFit(sde, draft, t.id);
        const dr = draft.drones.find((x) => x.typeId === t.id);
        if (r.ok && dr && dr.active > 0) dr.active--;
        const why = result.message.charAt(0).toLowerCase() + result.message.slice(1);
        if (!r.ok) return r;
        return { ok: true, message: t.categoryId === Category.Fighter ? tx('{name} adăugat în hangarul de fighteri (nelansat: {why})', { name: t.name, why }) : tx('{name} adăugată în hangarul de drone (nelansată: {why})', { name: t.name, why }) };
      }, fitCharacter(ctx.character).implants);
      if (bay.ok) result = bay;
    }
    toast(proving(result.message));
    if (!result.ok) return;
    if (t.categoryId === Category.Drone) showExtras('drones');
    else if (t.categoryId === Category.Fighter) showExtras('fighters');
    else if (t.categoryId === Category.Implant && sde.baseAttr(t.id, sde.attrId('boosterness')) > 0) showExtras('boosters');
    render();
  }

  function cycleState(m: FitModule) {
    const order: ModuleState[] = ['offline', 'online'];
    if (canActivate(sde, m.typeId)) order.push('active');
    if (canOverheat(sde, m.typeId)) order.push('overheated');
    m.state = order[(order.indexOf(m.state) + 1) % order.length];
  }

  function click(at: (sel: string) => HTMLElement | null) {
    const fit = env.getFit();
    if (!fit) return;
    const state = at('[data-state]');
    if (state) {
      const [k, i] = parseSlot(state.dataset.state!);
      const m = fit.slots[k][i];
      if (m) env.change((draft) => cycleState(draft.slots[k][i]!));
      return;
    }
    const mut = at('[data-mutate]');
    if (mut) { const [kind, i] = parseSlot(mut.dataset.mutate!); deps.openMutation({ kind, i }); return; }
    const mutDrone = at('[data-mutate-drone]');
    if (mutDrone) { deps.openMutation({ drone: Number(mutDrone.dataset.mutateDrone) }); return; }
    const remove = at('[data-remove]');
    if (remove) {
      const [k, i] = parseSlot(remove.dataset.remove!);
      env.change((draft) => {
        draft.slots[k][i] = null;
        if (k === 'subsystem') draft.slots[k] = draft.slots[k].filter(Boolean);
      });
      return;
    }
    const drone = at('[data-drone]');
    if (drone) {
      const [i, field, delta] = drone.dataset.drone!.split(':');
      env.change((draft) => {
        const dr = draft.drones[Number(i)];
        if (field === 'remove') draft.drones.splice(Number(i), 1);
        else if (field === 'bay') {
          if (Number(delta) > 0) dr.count++;
          else if (dr.count > dr.active) dr.count--;
          if (dr.count === 0) draft.drones.splice(Number(i), 1);
          else if (dr.wanted != null) dr.wanted = Math.min(dr.wanted, dr.count);
        } else {
          if (Number(delta) > 0) { if (dr.active === dr.count) dr.count++; dr.active++; } else dr.active = Math.max(0, dr.active - 1);
          delete dr.wanted;
        }
      });
      return;
    }
    const pick = at('[data-pick]');
    if (pick && !at('select, button')) { deps.pickSlot(pick.dataset.pick === deps.pickedSlot() ? null : (pick.dataset.pick as SlotKind)); return; }
    const side = at('[data-side]');
    if (side) {
      const [tid, effect] = side.dataset.side!.split(':');
      env.change((draft) => {
        const map = draft.boosterSides ?? (draft.boosterSides = {});
        const list = map[tid] ?? [];
        map[tid] = list.includes(effect) ? list.filter((x) => x !== effect) : [...list, effect];
      });
      return;
    }
    const implant = at('[data-implant]');
    if (implant) { env.change((draft) => { draft.implants.splice(Number(implant.dataset.implant), 1); }); return; }
    const cargo = at('[data-cargo]');
    if (cargo) env.change((draft) => { draft.cargo.splice(Number(cargo.dataset.cargo), 1); });
  }

  function change(target: HTMLSelectElement) {
    const fit = env.getFit();
    if (!fit) return;
    if (target.dataset.cargoCount) {
      const i = Number(target.dataset.cargoCount);
      const n = Math.max(1, Math.floor(Number(target.value) || 1));
      env.change((draft) => { if (draft.cargo[i]) draft.cargo[i].count = n; });
      return;
    }
    if (target.dataset.charge) {
      const [k, i] = parseSlot(target.dataset.charge);
      const m = fit.slots[k][i];
      if (!m) return;
      const chargeId = Number(target.value) || undefined;
      const weapon = sde.hasEffect(m.typeId, 'turretFitted') || sde.hasEffect(m.typeId, 'launcherFitted');
      env.change((draft) => {
        if (!weapon) { const own = draft.slots[k][i]; if (own) own.chargeId = chargeId; return; }
        for (const other of draft.slots[k]) if (other && other.typeId === m.typeId) other.chargeId = chargeId;
      });
    }
  }

  let dragSlot = '';
  const clearDrag = () => left.querySelectorAll('.dragging, .drop-on').forEach((x) => x.classList.remove('dragging', 'drop-on'));
  left.addEventListener('dragstart', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.slot.fitted[data-drop]');
    if (!row) return;
    dragSlot = row.dataset.drop!;
    e.dataTransfer?.setData('text/plain', dragSlot);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  left.addEventListener('dragover', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-drop]');
    if (!row || !dragSlot || parseSlot(row.dataset.drop!)[0] !== parseSlot(dragSlot)[0]) return;
    e.preventDefault();
    if (row.classList.contains('drop-on')) return;
    left.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on'));
    row.classList.add('drop-on');
  });
  left.addEventListener('drop', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-drop]');
    const from = dragSlot;
    dragSlot = '';
    clearDrag();
    if (!row || !from) return;
    e.preventDefault();
    const [k, a] = parseSlot(from);
    const [k2, b] = parseSlot(row.dataset.drop!);
    if (k !== k2 || a === b) return;
    env.change((draft) => {
      const list = draft.slots[k];
      while (list.length <= Math.max(a, b)) list.push(null);
      [list[a], list[b]] = [list[b], list[a]];
    });
  });
  left.addEventListener('dragend', () => { dragSlot = ''; clearDrag(); });

  el.addEventListener('contextmenu', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
    const fit = env.getFit();
    if (!row || !fit) return;
    e.preventDefault();
    const [k, i] = parseSlot(row.dataset.slot!);
    const m = fit.slots[k][i];
    if (!m) return;
    env.change((draft) => {
      const dm = draft.slots[k][i]!;
      dm.state = dm.state === 'offline' ? (canActivate(sde, dm.typeId) ? 'active' : 'online') : 'offline';
    });
  });

  return { selectItem, click, change };
}
