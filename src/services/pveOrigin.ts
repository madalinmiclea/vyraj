import type { AppContext } from '../app/context';
import { characterLocation } from '../character/esi';
import { hasScope, loginProblem } from '../character/sso';
import { loadJson, saveJson } from '../storage';
import { esc, formatNum } from '../ui/components';
import { displaySec, type NavMap, type NavSystem } from './navigation';
import { tx } from '../i18n';

const KEY = 'eve-pve:origin';
const LOCATION_SCOPE = 'esi-location.read_location.v1';

export interface Origin { system: NavSystem | null; esi: boolean; needScope: boolean }

export async function pveOrigin(ctx: AppContext, map: NavMap): Promise<Origin> {
  const typed = loadJson<string>(KEY, '');
  const c = ctx.character;
  const logged = !loginProblem(c) && !!c.characterId;
  if (!typed && logged && hasScope(c.characterId!, LOCATION_SCOPE)) {
    try {
      const loc = await characterLocation(c.characterId!);
      const s = map.systems.get(loc.solar_system_id);
      if (s) return { system: s, esi: true, needScope: false };
    } catch {
      return { system: null, esi: false, needScope: false };
    }
  }
  const s = typed ? map.find(typed) : undefined;
  return { system: s ?? null, esi: false, needScope: logged && !typed && !hasScope(c.characterId!, LOCATION_SCOPE) };
}

export const saveOrigin = (name: string) => saveJson(KEY, name.trim());

export function originBar(map: NavMap, o: Origin, id: string) {
  const value = o.esi ? '' : o.system?.name ?? '';
  const where = o.system ? `${esc(o.system.name)} · ${esc(map.region(o.system))} · ${formatNum(displaySec(o.system.sec), 1)}` : tx('niciun sistem ales');
  return `<div class="pve-origin">
      <label>${tx('Pornești din')} <input class="input sm" id="${id}" list="${id}List" value="${esc(value)}" placeholder="${esc(o.esi ? tx('locația ta din EVE') : tx('Scrie un sistem'))}" autocomplete="off" /></label>
      <datalist id="${id}List"></datalist>
      <span class="dim small">${o.esi ? tx('Locația ta din EVE: {s}', { s: where }) : where}</span>
    </div>`;
}

export function bindOrigin(root: HTMLElement, map: NavMap, id: string, onChange: () => void) {
  const input = root.querySelector<HTMLInputElement>(`#${id}`);
  const list = root.querySelector<HTMLDataListElement>(`#${id}List`);
  if (!input || !list) return;
  input.addEventListener('input', () => {
    list.innerHTML = map.suggest(input.value, 10).map((s) => `<option value="${esc(s.name)}">${esc(map.region(s))}</option>`).join('');
  });
  input.addEventListener('change', () => {
    const v = input.value.trim();
    if (v && !map.find(v)) return;
    saveOrigin(v ? map.find(v)!.name : '');
    onChange();
  });
}
