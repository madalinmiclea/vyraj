import type { AppContext } from '../app/context';
import { panel } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { ALERTS_EVENT } from '../services/alerts';
import { hasScope, loginProblem } from '../character/sso';
import { permissionGate, type PermId } from '../character/permissions';
import { showItemInfo } from '../ui/itemInfo';
import { tx } from '../i18n';
import type { Basis, ToolEnv, ToolTab } from './toolsShared';
import { createAppraisalTool } from './toolsAppraisal';
import { createAbyssalTool } from './toolsAbyssal';
import { createAssetsTool } from './toolsAssets';
import { createLpTool } from './toolsLp';
import { createAlertsTool } from './toolsAlerts';

export type { ToolTab };

const BASIS_KEY = 'eve-tools:price-basis';

export interface ToolPanel { show(next: ToolTab): void; hide(): void }

export function createToolPanel(body: HTMLElement, ctx: AppContext): ToolPanel {
  let tab: ToolTab | null = null;
  let basis = loadJson<Basis>(BASIS_KEY, 'sell');

  const basisChips = () => `<div class="advice-sort">
    <button class="chip-btn ${basis === 'sell' ? 'active' : ''}" data-basis="sell">${tx('Jita vânzare')}</button>
    <button class="chip-btn ${basis === 'buy' ? 'active' : ''}" data-basis="buy">${tx('Jita cumpărare')}</button>
  </div>`;

  function esiCharacter(scope?: string): { id: number } | string {
    const c = ctx.character;
    const problem = loginProblem(c);
    if (problem || !c.characterId) return problem ?? '';
    if (scope && !hasScope(c.characterId, scope)) return 'scope';
    return { id: c.characterId };
  }

  function scopePrompt(perm: PermId) {
    return panel({ body: permissionGate(perm, ctx.character.characterId!, ctx.character.name) });
  }

  const env: ToolEnv = { body, ctx, get tab() { return tab; }, get basis() { return basis; }, basisChips, esiCharacter, scopePrompt };
  const tools = { appraisal: createAppraisalTool(env), abyssal: createAbyssalTool(env), assets: createAssetsTool(env), lp: createLpTool(env), alerts: createAlertsTool(env) };

  function render() {
    if (tab) tools[tab].render();
  }

  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const at = (s: string) => t.closest<HTMLElement>(s);
    const b = at('[data-basis]');
    if (b) {
      basis = b.dataset.basis as Basis;
      saveJson(BASIS_KEY, basis);
      if (tab === 'appraisal') tools.appraisal.run(); else if (tab === 'lp') tools.lp.load(); else render();
      return;
    }
    const info = at('[data-asset-info]');
    if (info) { showItemInfo(ctx, Number(info.dataset.assetInfo)); return; }
    if (tools.appraisal.click(at) || tools.assets.click(at) || tools.lp.click(at) || tools.abyssal.click(at)) return;
    tools.alerts.click(at);
  });

  body.addEventListener('input', (e) => tools.lp.input(e.target as HTMLInputElement));
  body.addEventListener('change', (e) => tools.lp.change(e.target as HTMLElement));

  window.addEventListener(ALERTS_EVENT, () => { if (tab === 'alerts') tools.alerts.render(); });
  ctx.onCharacterChange(() => { if (tab === 'assets' || tab === 'lp') render(); });

  return {
    show(next) { tab = next; render(); },
    hide() { tab = null; },
  };
}
