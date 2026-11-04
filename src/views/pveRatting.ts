import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, dataStamp } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { permissionGate } from '../character/permissions';
import { loadMap, systemStats, displaySec, secClass, type NavMap, type SystemStat } from '../services/navigation';
import { pveOrigin, originBar, bindOrigin, type Origin } from '../services/pveOrigin';
import { tx } from '../i18n';

const STATE_KEY = 'eve-pve:ratting';
const LIMIT = 60;

type Space = 'all' | 'high' | 'low' | 'null';
interface State { range: number; space: Space; quiet: boolean }

const RANGES = [5, 10, 15, 25];
const SPACES: { id: Space; label: string }[] = [
  { id: 'all', label: tx('Toate') },
  { id: 'high', label: 'Highsec' },
  { id: 'low', label: 'Lowsec' },
  { id: 'null', label: 'Nullsec' },
];

const spaceOf = (sec: number): Space => (sec >= 0.45 ? 'high' : sec > 0 ? 'low' : 'null');

function risk(s: SystemStat) {
  const pvp = s.ship + s.pod;
  if (pvp >= 5) return `<span class="badge danger" title="${esc(tx('Multe nave distruse de jucători în ultima oră'))}">${tx('Periculos')}</span>`;
  if (pvp > 0) return `<span class="badge warn" title="${esc(tx('Au fost nave distruse de jucători în ultima oră'))}">${tx('Atenție')}</span>`;
  return `<span class="badge ok">${tx('Liniștit')}</span>`;
}

export function createRattingPanel(el: HTMLElement, ctx: AppContext) {
  const state: State = { range: 10, space: 'all', quiet: false, ...loadJson<Partial<State>>(STATE_KEY, {}) };
  let visible = false;
  let seq = 0;
  let map: NavMap | null = null;
  let origin: Origin = { system: null, esi: false, needScope: false };

  async function load() {
    if (!visible) return;
    const mine = ++seq;
    el.innerHTML = panel({ body: loader(tx('Citesc kill-urile NPC din ultima oră')) });
    try {
      const [m, stats] = await Promise.all([loadMap(), systemStats()]);
      map = m;
      origin = await pveOrigin(ctx, m);
      if (mine !== seq || !visible) return;
      render(stats.at, stats.map);
    } catch (err) {
      if (mine === seq) el.innerHTML = panel({ body: alertBox((err as Error).message, 'danger') });
    }
  }

  function render(at: number, stats: Map<number, SystemStat>) {
    if (!map) return;
    const dist = origin.system ? map.gateDistances(origin.system.id, state.range) : null;
    const rows = [...stats].filter(([id, s]) => {
      const sys = map!.systems.get(id);
      if (!sys || s.npc < 1) return false;
      if (dist && !dist.has(id)) return false;
      if (state.space !== 'all' && spaceOf(sys.sec) !== state.space) return false;
      if (state.quiet && s.ship + s.pod > 0) return false;
      return true;
    }).map(([id, s]) => ({ sys: map!.systems.get(id)!, s, jumps: dist?.get(id) }))
      .sort((a, b) => b.s.npc - a.s.npc || (a.jumps ?? 0) - (b.jumps ?? 0));
    const total = rows.reduce((a, r) => a + r.s.npc, 0);
    const dotlan = (name: string) => `https://evemaps.dotlan.net/system/${encodeURIComponent(name.replace(/ /g, '_'))}`;
    el.innerHTML = `<div class="stack">
      ${panel({
        title: tx('Unde faci ratting'),
        actions: dataStamp(at, 'data-rat-refresh', { label: tx('Date din {time}'), title: tx('ESI actualizează kill-urile o dată pe oră. Click pentru a le citi din nou.') }),
        body: `${originBar(map, origin, 'ratOrigin')}
          ${origin.needScope && ctx.character.characterId ? permissionGate('location', ctx.character.characterId, ctx.character.name) : ''}
          <div class="pve-filters">
            <label>${tx('Distanță')} <select class="input sm" id="ratRange" ${origin.system ? '' : 'disabled'}>${RANGES.map((r) => `<option value="${r}" ${r === state.range ? 'selected' : ''}>${tx('{n} salturi', { n: r })}</option>`).join('')}</select></label>
            <div class="chip-row">${SPACES.map((s) => `<button class="chip-btn ${s.id === state.space ? 'active' : ''}" data-rat-space="${s.id}">${s.label}</button>`).join('')}</div>
            <label class="check"><input type="checkbox" id="ratQuiet" ${state.quiet ? 'checked' : ''} /> ${tx('Doar fără kill-uri PvP')}</label>
          </div>
          ${rows.length ? `<p class="dim small">${tx('{n} sisteme · {k} NPC-uri distruse în ultima oră', { n: formatInt(rows.length), k: formatInt(total) })}</p>
          <div class="wallet-scroll tall"><table class="table compact"><thead><tr><th>${tx('Sistem')}</th><th>${tx('Regiune')}</th>${dist ? `<th class="r">${tx('Salturi')}</th>` : ''}<th class="r">${tx('NPC-uri ucise')}</th><th class="r">${tx('Nave ucise')}</th><th class="r">${tx('Pod-uri ucise')}</th><th class="r">${tx('Trafic/oră')}</th><th>${tx('Risc')}</th></tr></thead><tbody>
            ${rows.slice(0, LIMIT).map((r) => `<tr><td><a class="ext-link" href="${dotlan(r.sys.name)}" target="_blank" rel="noopener noreferrer">${esc(r.sys.name)}</a> <span class="sec ${secClass(r.sys.sec)}">${displaySec(r.sys.sec).toFixed(1)}</span></td><td class="dim">${esc(map!.region(r.sys))}</td>${dist ? `<td class="r num">${r.jumps}</td>` : ''}<td class="r num">${formatInt(r.s.npc)}</td><td class="r num ${r.s.ship ? 'down' : 'dim'}">${formatInt(r.s.ship)}</td><td class="r num ${r.s.pod ? 'down' : 'dim'}">${formatInt(r.s.pod)}</td><td class="r num dim">${formatInt(r.s.jumps)}</td><td>${risk(r.s)}</td></tr>`).join('')}
          </tbody></table></div>` : `<p class="dim">${tx('Niciun sistem nu se potrivește cu filtrele alese.')}</p>`}`,
      })}
    </div>`;
    bindOrigin(el, map, 'ratOrigin', load);
  }

  const save = () => saveJson(STATE_KEY, state);

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const sp = t.closest<HTMLElement>('[data-rat-space]');
    if (sp) { state.space = sp.dataset.ratSpace as Space; save(); load(); return; }
    if (t.closest('[data-rat-refresh]')) load();
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'ratRange') state.range = Number(t.value);
    else if (t.id === 'ratQuiet') state.quiet = t.checked;
    else return;
    save();
    load();
  });

  ctx.onCharacterChange(() => { if (visible) load(); });

  return {
    show() { visible = true; load(); },
    hide() { visible = false; seq++; },
  };
}
