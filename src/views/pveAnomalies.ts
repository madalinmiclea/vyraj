import { panel, esc, button } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { FACTIONS, EWAR_LABEL, type Dmg } from '../services/missions';
import { ANOM_FACTIONS, ANOM_TIERS, VARIANTS, siteName, escalation, type AnomFaction, type Band } from '../services/anomalies';
import { tx } from '../i18n';

const STATE_KEY = 'eve-pve:anomalies';

const DMG_NAME: Record<Dmg, string> = { em: 'EM', th: tx('Termic'), kin: tx('Cinetic'), exp: tx('Exploziv') };
const DMG_CLS: Record<Dmg, string> = { em: 'em', th: 'thermal', kin: 'kinetic', exp: 'explosive' };
const BAND_NAME: Record<Band, string> = { high: 'Highsec', low: 'Lowsec', null: 'Nullsec' };
const BAND_CLS: Record<Band, string> = { high: 'sec-hi', low: 'sec-lo', null: 'sec-null' };

interface State { faction: AnomFaction; band: Band | 'all'; variants: boolean }

export function createAnomaliesPanel(el: HTMLElement, opts: { onTank: (site: string, faction: string) => void; openTool: (id: string) => void }) {
  const state: State = { faction: 'guristas', band: 'all', variants: true, ...loadJson<Partial<State>>(STATE_KEY, {}) };
  const save = () => saveJson(STATE_KEY, state);
  const dmg = (list: Dmg[]) => list.map((d) => `<span class="dmg-tag ${DMG_CLS[d]}">${DMG_NAME[d]}</span>`).join('');

  function render() {
    const f = FACTIONS.find((x) => x.id === state.faction)!;
    const tiers = ANOM_TIERS.filter((t) => (state.variants || !t.variant) && (state.band === 'all' || t.bands.includes(state.band)) && siteName(t, state.faction)).sort((a, b) => a.tier - b.tier || Number(!!a.variant) - Number(!!b.variant));
    el.innerHTML = `<div class="stack">
      ${panel({
        title: tx('Ghid de anomalii de luptă'),
        body: `<div class="pve-filters">
            <div class="chip-row">${ANOM_FACTIONS.map((x) => `<button class="chip-btn ${x.id === state.faction ? 'active' : ''}" data-an-faction="${x.id}">${esc(FACTIONS.find((y) => y.id === x.id)?.name ?? x.prefix)}</button>`).join('')}</div>
            <div class="chip-row">${(['all', 'high', 'low', 'null'] as const).map((b) => `<button class="chip-btn ${b === state.band ? 'active' : ''}" data-an-band="${b}">${b === 'all' ? tx('Toate') : BAND_NAME[b]}</button>`).join('')}</div>
            <label class="check"><input type="checkbox" id="anVariants" ${state.variants ? 'checked' : ''} /> ${tx('Și variantele Forsaken')}</label>
          </div>
          <div class="tick-factions"><div class="tick-faction">
            <div class="tick-faction-head"><b>${esc(f.name)}</b></div>
            <div class="small"><span class="dim">${tx('Trag cu')}</span> ${dmg(f.shoot)}</div>
            <div class="small"><span class="dim">${tx('Slabi la')}</span> ${dmg(f.weak)}</div>
            <div class="small"><span class="dim">EWAR</span> ${f.ewar.length ? f.ewar.map((e) => esc(EWAR_LABEL[e] ?? e)).join(', ') : tx('fără')}</div>
          </div></div>
          <div class="wallet-scroll tall"><table class="table compact"><thead><tr><th class="r">${tx('Nivel')}</th><th>${tx('Anomalie')}</th><th>${tx('Unde apare')}</th><th>${tx('Navă potrivită')}</th><th>${tx('Escaladare')}</th><th></th></tr></thead><tbody>
            ${tiers.map((t) => {
              const e = escalation(t, state.faction);
              return `<tr><td class="r num dim">${t.tier}</td><td><b>${esc(siteName(t, state.faction))}</b>${t.variant ? ` <span class="badge gold">${tx('Variantă')}</span>` : ''}</td>
                <td>${t.bands.map((b) => `<span class="badge ${BAND_CLS[b]}">${BAND_NAME[b]}</span>`).join(' ')}</td>
                <td>${esc(t.ship)}</td>
                <td>${e ? `<span class="badge accent">DED ${e}/10</span>` : '<span class="dim">—</span>'}</td>
                <td class="r">${t.tank ? button(tx('Verifică tank-ul'), { cls: 'sm ghost', attrs: `data-an-tank="${t.tank}"` }) : ''}</td></tr>`;
            }).join('')}
          </tbody></table></div>
          <p class="dim small wallet-note">${tx('Anomaliile de luptă apar direct în Probe Scanner, fără probe. Cu cât securitatea reală a sistemului e mai mică, cu atât apar anomalii mai grele și mai bine plătite. Nava potrivită e o recomandare de start: cu skill-uri și fit bun poți face mai mult.')}</p>`,
      })}
      ${panel({
        title: tx('Variante și escaladări'),
        body: `<ul class="pve-list">${VARIANTS.map((v) => `<li><b>${esc(v.name)}</b> · ${esc(v.text)}</li>`).join('')}</ul>
          <p class="small">${tx('La ultimul val, o anomalie poate da o escaladare: o expediție către un complex DED din alt sistem, cu securitate mai mică. Nivelul DED din tabel e complexul în care duce escaladarea pentru facțiunea aleasă.')}</p>
          <p>${button(tx('Ține evidența escaladărilor'), { cls: 'sm', attrs: 'data-an-open="escalations"' })} ${button(tx('Unde faci ratting'), { cls: 'sm ghost', attrs: 'data-an-open="ratting"' })}</p>`,
      })}
    </div>`;
  }

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const fa = t.closest<HTMLElement>('[data-an-faction]');
    if (fa) { state.faction = fa.dataset.anFaction as AnomFaction; save(); render(); return; }
    const b = t.closest<HTMLElement>('[data-an-band]');
    if (b) { state.band = b.dataset.anBand as State['band']; save(); render(); return; }
    const tank = t.closest<HTMLElement>('[data-an-tank]');
    if (tank) { opts.onTank(tank.dataset.anTank!, state.faction); return; }
    const open = t.closest<HTMLElement>('[data-an-open]');
    if (open) opts.openTool(open.dataset.anOpen!);
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'anVariants') return;
    state.variants = t.checked;
    save();
    render();
  });

  return {
    show() { render(); },
    hide() {},
  };
}
