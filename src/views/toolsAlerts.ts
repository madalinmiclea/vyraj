import { panel, esc, toast, emptyState } from '../ui/components';
import { icon } from '../ui/icons';
import { parseItems } from '../services/appraisal';
import { typeIconUrl } from '../services/market';
import { loadAlerts, saveAlerts, addAlert, checkAlerts, hit } from '../services/alerts';
import { tx } from '../i18n';
import { isk, dateTime, type At, type ToolEnv } from './toolsShared';

export function createAlertsTool(env: ToolEnv) {
  const { body } = env;

  function alerts() {
    const list = loadAlerts();
    body.innerHTML = panel({
      title: tx('Alerte preț'),
      count: list.length ? tx('{n} active', { n: list.length }) : '',
      actions: list.length ? `<button class="btn ghost sm" data-al-check>${icon('refresh')}${tx('Verifică acum')}</button>` : '',
      body: `<div class="form-grid">
          <label>${tx('Item')} <input class="input sm" id="alName" placeholder="PLEX" /></label>
          <label><select class="input sm" id="alSide2"><option value="sell">${tx('vânzare min')}</option><option value="buy">${tx('cumpărare max')}</option></select></label>
          <label><select class="input sm" id="alOp2"><option value="below">≤</option><option value="above">≥</option></select></label>
          <label><input class="input sm num" id="alPrice2" type="number" min="0" step="any" placeholder="ISK" /></label>
          <button class="btn sm" data-al-add>${icon('plus')}${tx('Adaugă')}</button>
        </div>
        ${list.length ? `<table class="table compact"><thead><tr><th>Item</th><th>${tx('Condiție')}</th><th class="r">${tx('Acum')}</th><th>${tx('Verificat')}</th><th></th></tr></thead><tbody>
          ${list.map((a) => `<tr class="${a.current != null && hit(a, a.current) ? 'alert-hit' : ''}"><td><img class="row-icon" src="${typeIconUrl(a.typeId, 32)}" alt="" />${esc(a.name)}</td>
            <td>${a.side} ${a.op === 'below' ? '≤' : '≥'} ${isk(a.price)}</td>
            <td class="r">${a.current != null ? isk(a.current) : '—'}</td>
            <td class="num dim">${a.checkedAt ? dateTime(a.checkedAt) : '—'}</td>
            <td><button class="icon-btn" data-al-del="${a.id}" title="${tx('Șterge')}">✕</button></td></tr>`).join('')}
          </tbody></table>` : emptyState({ title: tx('Nicio alertă'), vy: 'No Alerts Woven' })}`,
    });
  }

  function addAlertFromForm() {
    const v = (id: string) => body.querySelector<HTMLInputElement>('#' + id)!.value;
    const { lines } = parseItems(v('alName'));
    const price = Number(v('alPrice2'));
    if (!lines.length) { toast(tx('Item necunoscut')); return; }
    if (!(price > 0)) { toast(tx('Pune un preț')); return; }
    addAlert({ typeId: lines[0].typeId, name: lines[0].name, side: v('alSide2') as 'sell' | 'buy', op: v('alOp2') as 'below' | 'above', price });
    checkAlerts().catch(() => {});
  }

  function click(at: At) {
    if (at('[data-al-add]')) { addAlertFromForm(); return true; }
    if (at('[data-al-check]')) { checkAlerts().then(() => toast(tx('Verificat'))).catch((err) => toast((err as Error).message)); return true; }
    const ad = at('[data-al-del]');
    if (ad) saveAlerts(loadAlerts().filter((a) => a.id !== ad.dataset.alDel));
    return !!ad;
  }

  return { render: alerts, click };
}
