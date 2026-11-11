import { panel, loader, alertBox, esc, formatInt, compactISK, copyText, dataStamp } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { parseItems, type AppraisalLine } from '../services/appraisal';
import { fetchPrices, forgetPrices, pricesAt, typeIconUrl } from '../services/market';
import { tx } from '../i18n';
import { priceOf, isk, type At, type ToolEnv } from './toolsShared';

const APPRAISAL_KEY = 'eve-tools:appraisal-text';

export function createAppraisalTool(env: ToolEnv) {
  const { body, basisChips } = env;
  let apIds: number[] = [];

  async function priceTable(lines: AppraisalLine[]) {
    const prices = await fetchPrices(lines.map((l) => l.typeId));
    const rows = lines.map((l) => {
      const p = prices.get(l.typeId);
      return { ...l, sell: (p?.sellMin ?? 0) * l.quantity, buy: (p?.buyMax ?? 0) * l.quantity, unit: priceOf(p, env.basis) };
    }).sort((a, b) => (env.basis === 'sell' ? b.sell - a.sell : b.buy - a.buy));
    apIds = lines.map((l) => l.typeId);
    return { rows, sell: rows.reduce((a, r) => a + r.sell, 0), buy: rows.reduce((a, r) => a + r.buy, 0) };
  }

  function appraisal() {
    const text = loadJson<string>(APPRAISAL_KEY, '');
    body.innerHTML = `<div class="tool-grid">
      ${panel({
        title: tx('Lipește iteme'),
        body: `<textarea class="input area" id="apText" rows="16" spellcheck="false" placeholder="${tx('Copiază din inventar, contract, EFT sau listă')}">${esc(text)}</textarea>
          <div class="row-actions"><button class="btn sm" data-appraise>${icon('market')}${tx('Evaluează')}</button><button class="btn ghost sm" data-ap-clear>${tx('Golește')}</button></div>`,
      })}
      <div id="apResult"></div>
    </div>`;
    if (text.trim()) runAppraisal();
  }

  async function runAppraisal() {
    const out = body.querySelector<HTMLElement>('#apResult');
    const text = body.querySelector<HTMLTextAreaElement>('#apText')?.value ?? '';
    saveJson(APPRAISAL_KEY, text);
    if (!out) return;
    const { lines, unknown } = parseItems(text);
    if (!lines.length) { out.innerHTML = panel({ body: `<p class="dim">${tx('Niciun item recunoscut.')}</p>` }); return; }
    out.innerHTML = panel({ body: loader(tx('Prețuri {name}', { name: 'Jita' })) });
    try {
      const t = await priceTable(lines);
      out.innerHTML = panel({
        title: tx('Evaluare'),
        count: tx('{n} tipuri · {q} bucăți', { n: lines.length, q: formatInt(lines.reduce((a, l) => a + l.quantity, 0)) }),
        actions: dataStamp(pricesAt(apIds), 'data-ap-refresh') + basisChips(),
        body: `<div class="history-kpis">
            <div><span class="label">${tx('Jita vânzare')}</span><span class="value">${compactISK(t.sell)}</span></div>
            <div><span class="label">${tx('Jita cumpărare')}</span><span class="value">${compactISK(t.buy)}</span></div>
            <div><span class="label">${tx('90% din cumpărare')}</span><span class="value">${compactISK(t.buy * 0.9)}</span></div>
          </div>
          <div class="row-actions"><button class="btn ghost sm" data-copy-total="${Math.round(env.basis === 'sell' ? t.sell : t.buy)}">${icon('copy')}${tx('Copiază total')}</button></div>
          <table class="table compact"><thead><tr><th>Item</th><th class="r">${tx('Cant.')}</th><th class="r">${tx('Unitar')}</th><th class="r">Sell</th><th class="r">Buy</th></tr></thead><tbody>
          ${t.rows.map((r) => `<tr><td><img class="row-icon" src="${typeIconUrl(r.typeId, 32, r.name)}" alt="" />${esc(r.name)}</td><td class="r num">${formatInt(r.quantity)}</td><td class="r">${isk(r.unit)}</td><td class="r">${isk(r.sell)}</td><td class="r">${isk(r.buy)}</td></tr>`).join('')}
          </tbody></table>
          ${unknown.length ? `<p class="small warn-text">${tx('Nerecunoscute')}: ${unknown.slice(0, 20).map(esc).join(', ')}${unknown.length > 20 ? '…' : ''}</p>` : ''}`,
      });
    } catch (err) {
      out.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  function click(at: At) {
    if (at('[data-appraise]')) { runAppraisal(); return true; }
    if (at('[data-ap-refresh]')) { forgetPrices(apIds); runAppraisal(); return true; }
    if (at('[data-ap-clear]')) { saveJson(APPRAISAL_KEY, ''); appraisal(); return true; }
    const ct = at('[data-copy-total]');
    if (ct) { copyText(ct.dataset.copyTotal!, tx('Total copiat')); return true; }
    return false;
  }

  return { render: appraisal, run: runAppraisal, click };
}
