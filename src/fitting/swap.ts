import { buildDogma, slotOf, canActivate, canLoadCharge, canOverheat, defaultState, cloneFit, type FitModule, type SlotKind } from '../engine/fit';
import type { Dogma, DogmaItem } from '../engine/dogma';
import { applyChecked } from '../engine/rules';
import { toast } from '../ui/components';
import type { FitSwap } from '../ui/itemInfo';
import { moduleName } from '../engine/mutation';
import { tx } from '../i18n';
import { proving, type FitEnv } from './shared';
import { fitCharacter } from './implantSets';

export function createFitSwap(env: FitEnv, deps: { dogma(): Dogma | null; render(): void }) {
  const { sde, ctx, name } = env;

  function fittedItem(button: HTMLElement): DogmaItem | undefined {
    const d = deps.dogma();
    const fit = env.getFit();
    if (!d || !fit) return undefined;
    const typeId = Number(button.dataset.info);
    const chargeSlot = button.dataset.infoCharge;
    if (chargeSlot) return d.charges.find((c) => c.slotKey === chargeSlot);
    const row = button.closest<HTMLElement>('[data-slot]');
    if (row) return d.modules.find((m) => m.slotKey === row.dataset.slot!.replace(':', ''));
    if (typeId === fit.shipId && button.closest('.ship-head')) return d.ship;
    const droneRow = button.closest<HTMLElement>('[data-drone-row]');
    if (droneRow) {
      const idx = Number(droneRow.dataset.droneRow);
      const key = `drone${idx}`;
      const launched = d.drones.find((x) => x.item.slotKey === key)?.item;
      if (launched || !fit.drones[idx]?.mutation) return launched ?? d.drones.find((x) => x.item.typeId === typeId)?.item;
      const draft = cloneFit(fit);
      draft.drones[idx].active = 1;
      return buildDogma(sde, draft, fitCharacter(ctx.character)).drones.find((x) => x.item.slotKey === key)?.item;
    }
    return d.drones.find((x) => x.item.typeId === typeId)?.item ?? d.implants.find((x) => x.typeId === typeId);
  }

  function swappedModule(m: FitModule, typeId: number): FitModule {
    let state = m.state;
    if (state === 'overheated' && !canOverheat(sde, typeId)) state = 'active';
    if (state === 'active' && !canActivate(sde, typeId)) state = defaultState(sde, typeId);
    const chargeId = m.chargeId && canLoadCharge(sde, typeId, m.chargeId) ? m.chargeId : undefined;
    return { typeId, state, ...(chargeId ? { chargeId } : {}) };
  }

  function swapContext(kind: SlotKind, i: number): FitSwap | undefined {
    const fit = env.getFit();
    const m = fit?.slots[kind][i];
    const key = `${kind}${i}`;
    const fitted = deps.dogma()?.modules.find((x) => x.slotKey === key);
    if (!fit || !m || !fitted) return undefined;
    return {
      fittedId: m.typeId,
      fitted,
      preview: (typeId) => {
        const fit = env.getFit();
        if (!fit || slotOf(sde, typeId) !== kind) return undefined;
        const draft = cloneFit(fit);
        draft.slots[kind][i] = swappedModule(m, typeId);
        return buildDogma(sde, draft, fitCharacter(ctx.character)).modules.find((x) => x.slotKey === key);
      },
      replace: (typeId) => {
        const fit = env.getFit();
        if (!fit) return null;
        if (slotOf(sde, typeId) !== kind) { toast(proving(tx('{name} nu intră în același tip de slot', { name: name(typeId) }))); return null; }
        const result = applyChecked(sde, fit, ctx.character.skills, (draft) => {
          draft.slots[kind][i] = swappedModule(m, typeId);
          return { ok: true, message: tx('{name} montat în locul lui {old}', { name: name(typeId), old: moduleName(sde, m) }) };
        }, fitCharacter(ctx.character).implants);
        toast(result.ok ? result.message : proving(result.message));
        if (!result.ok) return null;
        deps.render();
        return swapContext(kind, i) ?? null;
      },
    };
  }

  return { fittedItem, swapContext };
}
