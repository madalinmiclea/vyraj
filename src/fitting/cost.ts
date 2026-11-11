import { fitContents, SLOT_KINDS, type Fit } from '../engine/fit';
import { requirementsFor, fitTypeIds } from '../character/requirements';
import { fetchPrices, forgetPrices, pricesAt } from '../services/market';
import { alertBox, button, compactISK, dataStamp, esc, formatInt, formatISK, lore, panel } from '../ui/components';
import { tx } from '../i18n';
import type { FitEnv } from './shared';

export function createCostPanel(env: FitEnv, el: HTMLElement) {
  const { sde, ctx, name } = env;
  let priceRequest = 0;
  let costIds: number[] = [];

  function costPanel() {
    return panel({ title: tx('Cost Jita (vânzare minimă)'), id: 'fitCost', body: `<div class="dim small">${lore(tx('Se încarcă prețurile…'), 'Weaving the Flow…')}</div>` });
  }

  async function loadCost(f: Fit) {
    const id = ++priceRequest;
    const contents = fitContents(sde, f, true);
    const abyssal = new Map<number, number>();
    for (const k of SLOT_KINDS) for (const m of f.slots[k]) if (m?.mutation) abyssal.set(m.typeId, (abyssal.get(m.typeId) ?? 0) + 1);
    for (const d of f.drones) if (d.mutation) abyssal.set(d.typeId, (abyssal.get(d.typeId) ?? 0) + d.count);
    const req = requirementsFor(sde, fitTypeIds(f), ctx.character);
    const books = req.missing.filter((s) => s.current === 0).map((s) => s.skillId);
    try {
      const ids = [...contents.keys(), ...abyssal.keys(), ...books];
      const prices = await fetchPrices(ids);
      if (id !== priceRequest) return;
      costIds = ids;
      const lines = [...[...contents].map(([typeId, n]) => ({ typeId, n, abyssal: false })), ...[...abyssal].map(([typeId, n]) => ({ typeId, n, abyssal: true }))]
        .map((x) => ({ ...x, price: prices.get(x.typeId)?.sellMin ?? 0 }))
        .map((x) => ({ ...x, total: x.price * x.n }))
        .sort((a, b) => b.total - a.total);
      const total = lines.reduce((a, x) => a + x.total, 0);
      const noPrice = lines.filter((x) => x.price === 0).length;
      const target = el.querySelector('#fitCost .panel-body');
      if (!target) return;
      target.innerHTML = `
        <div class="cost-total">${abyssal.size ? '<span class="dim">min.</span> ' : ''}<span class="num">${formatISK(total, 0)}</span> ISK <span class="dim">(${compactISK(total)})</span></div>
        <table class="table compact"><tbody>${lines.map((x) => `<tr><td>${x.abyssal ? `<span class="abyssal-tag">${tx('Abisal')}</span> ` : ''}${esc(name(x.typeId))}${x.n > 1 ? ` <span class="dim">×${formatInt(x.n)}</span>` : ''}</td><td class="r num">${x.price ? `${x.abyssal ? '<span class="dim">min.</span> ' : ''}${compactISK(x.total)}` : `<span class="dim">${tx('fără ordine')}</span>`}</td></tr>`).join('')}</tbody></table>
        ${noPrice ? `<p class="dim small">${tx('{n} iteme nu au ordine de vânzare în Jita.', { n: noPrice })}</p>` : ''}
        <div class="row-actions">${button(tx('Copiază Multibuy'), { iconName: 'copy', cls: 'ghost sm', attrs: 'data-action="multibuy"' })}${dataStamp(pricesAt(ids), 'data-action="cost-refresh"')}</div>`;
      const booksEl = el.querySelector('#skillbookCost');
      if (booksEl && books.length) {
        const cost = books.reduce((a, b) => a + (prices.get(b)?.sellMin ?? 0), 0);
        booksEl.innerHTML = `${tx('Skillbook-uri de cumpărat')}: ${books.length} · <span class="num">${compactISK(cost)}</span> ISK`;
      }
    } catch {
      if (id !== priceRequest) return;
      const target = el.querySelector('#fitCost .panel-body');
      if (target) target.innerHTML = alertBox(tx('Nu am putut încărca prețurile din Jita (Fuzzwork).'));
    }
  }

  function refresh() {
    forgetPrices(costIds);
    const fit = env.getFit();
    if (fit) loadCost(fit);
  }

  return { render: costPanel, load: loadCost, refresh };
}
