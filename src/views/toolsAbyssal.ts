import { panel, esc, formatNum, compactISK, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { parseItems } from '../services/appraisal';
import { fetchPrices } from '../services/market';
import { TIERS, WEATHERS, loadRuns, saveRuns, filamentTypeId, profitOf, summarize, iskPerHour, type AbyssalRun } from '../services/abyssal';
import { tx } from '../i18n';
import { priceOf, isk, dateTime, type At, type ToolEnv } from './toolsShared';

const LAST_RUN_KEY = 'eve-tools:abyssal-last';

export function createAbyssalTool(env: ToolEnv) {
  const { body } = env;

  function abyssal() {
    const runs = loadRuns().sort((a, b) => b.date - a.date);
    const last = loadJson<Partial<AbyssalRun>>(LAST_RUN_KEY, { tier: 3, weather: 'Electrical', ship: '' });
    const totalProfit = runs.reduce((a, r) => a + profitOf(r), 0);
    const totalMin = runs.reduce((a, r) => a + r.minutes, 0);
    const summaryTable = (title: string, list: ReturnType<typeof summarize>) => `<h4 class="sub-head">${title}</h4>
      <table class="table compact"><thead><tr><th></th><th class="r">${tx('Run-uri')}</th><th class="r">${tx('Profit mediu')}</th><th class="r">${tx('ISK/oră')}</th><th class="r">${tx('Pierderi')}</th></tr></thead><tbody>
      ${list.map((s) => `<tr><td>${esc(s.key)}</td><td class="r num">${s.runs}</td><td class="r">${isk(s.profit / s.runs)}</td><td class="r">${isk(iskPerHour(s.profit, s.minutes))}</td><td class="r num">${s.losses}</td></tr>`).join('')}
      </tbody></table>`;
    body.innerHTML = `<div class="tool-grid">
      ${panel({
        title: tx('Run nou'),
        body: `<div class="form-grid">
            <label>Tier <select class="input sm" id="abTier">${TIERS.map((t, i) => `<option value="${i}" ${i === last.tier ? 'selected' : ''}>T${i} ${t}</option>`).join('')}</select></label>
            <label>${tx('Vreme')} <select class="input sm" id="abWeather">${WEATHERS.map((w) => `<option ${w === last.weather ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
            <label>${tx('Navă')} <input class="input sm" id="abShip" value="${esc(last.ship ?? '')}" /></label>
            <label>${tx('Durată (min)')} <input class="input sm num" id="abMinutes" type="number" min="1" value="${last.minutes ?? 20}" /></label>
            <label>${tx('Navă pierdută (ISK)')} <input class="input sm num" id="abLoss" type="number" min="0" value="0" /></label>
          </div>
          <label class="block-label">${tx('Loot (lipește din inventar)')}</label>
          <textarea class="input area" id="abLoot" rows="8" spellcheck="false"></textarea>
          <div class="row-actions"><button class="btn sm" data-ab-save>${icon('save')}${tx('Salvează run-ul')}</button></div>`,
      })}
      ${panel({
        title: tx('Rezultate'),
        count: runs.length ? (runs.length === 1 ? tx('1 run') : tx('{n} run-uri', { n: runs.length })) : '',
        body: runs.length ? `<div class="history-kpis">
            <div><span class="label">${tx('Profit total')}</span><span class="value">${compactISK(totalProfit)}</span></div>
            <div><span class="label">${tx('ISK/oră')}</span><span class="value">${compactISK(iskPerHour(totalProfit, totalMin))}</span></div>
            <div><span class="label">${tx('Profit mediu')}</span><span class="value">${compactISK(totalProfit / runs.length)}</span></div>
            <div><span class="label">${tx('Timp')}</span><span class="value">${formatNum(totalMin / 60, 1)} h</span></div>
          </div>
          ${summaryTable(tx('Pe tier și vreme'), summarize(runs, (r) => `T${r.tier} ${TIERS[r.tier]} ${r.weather}`))}
          ${summaryTable(tx('Pe navă'), summarize(runs, (r) => r.ship || '—'))}
          <h4 class="sub-head">${tx('Run-uri')}</h4>
          <table class="table compact"><thead><tr><th>${tx('Data')}</th><th>Run</th><th class="r">Min</th><th class="r">Filament</th><th class="r">Loot</th><th class="r">Profit</th><th></th></tr></thead><tbody>
          ${runs.map((r) => `<tr><td class="num dim">${dateTime(r.date)}</td><td>T${r.tier} ${TIERS[r.tier]} ${esc(r.weather)} · ${esc(r.ship || '—')}</td><td class="r num">${r.minutes}</td><td class="r">${isk(r.filamentCost)}</td><td class="r">${isk(r.lootValue)}</td><td class="r ${profitOf(r) >= 0 ? 'up' : 'down'}">${isk(profitOf(r))}</td><td><button class="icon-btn" data-ab-del="${r.id}" title="${tx('Șterge')}">✕</button></td></tr>`).join('')}
          </tbody></table>` : `<p class="dim">${tx('Niciun run salvat.')}</p>`,
      })}
    </div>`;
  }

  async function saveRun() {
    const v = (id: string) => body.querySelector<HTMLInputElement>('#' + id)!.value;
    const tier = Number(v('abTier')), weather = v('abWeather'), ship = v('abShip').trim();
    const minutes = Number(v('abMinutes')), shipLoss = Math.max(0, Number(v('abLoss')) || 0);
    if (!(minutes >= 1)) { toast(tx('Pune durata run-ului în minute (minim 1).')); return; }
    const { lines, unknown } = parseItems(v('abLoot'));
    const fil = filamentTypeId(tier, weather);
    toast(tx('Calculez valorile…'));
    try {
      const prices = await fetchPrices([...lines.map((l) => l.typeId), ...(fil ? [fil] : [])], { fresh: true });
      const lootValue = lines.reduce((a, l) => a + priceOf(prices.get(l.typeId), 'sell') * l.quantity, 0);
      const filamentCost = fil ? priceOf(prices.get(fil), 'sell') : 0;
      saveRuns([...loadRuns(), { id: `${Date.now()}`, date: Date.now(), tier, weather, ship, minutes, filamentCost, lootValue, shipLoss }]);
      saveJson(LAST_RUN_KEY, { tier, weather, ship, minutes });
      const saved = tx('Run salvat · profit {isk} ISK', { isk: compactISK(lootValue - filamentCost - shipLoss) });
      toast(unknown.length ? `${saved} · ${tx('{n} linii de loot nerecunoscute: {list}', { n: unknown.length, list: unknown.slice(0, 5).join(', ') + (unknown.length > 5 ? '…' : '') })}` : saved);
      abyssal();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  function click(at: At) {
    if (at('[data-ab-save]')) { saveRun(); return true; }
    const del = at('[data-ab-del]');
    if (del) { saveRuns(loadRuns().filter((r) => r.id !== del.dataset.abDel)); abyssal(); return true; }
    return false;
  }

  return { render: abyssal, click };
}
