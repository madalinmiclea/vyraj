import { panel, loader, alertBox, esc, formatNum, formatInt } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { loadMap, distanceLy, displaySec, secClass, type NavMap, type NavSystem } from '../services/navigation';
import { sovereignty, resolveNames, type SovClaim } from '../services/recon';
import { tx } from '../i18n';

const CAPACITY = 1250;
const RECHARGE = 200;
const ZONES = [
  { zone: 1, max: 5, mult: 0 },
  { zone: 2, max: 10, mult: 2 },
  { zone: 3, max: 15, mult: 6 },
  { zone: 4, max: 20, mult: 9 },
  { zone: 5, max: Infinity, mult: 15 },
];

const BASE: Record<string, number> = {
  Capsule: 1, Exhumer: 1, 'Expedition Frigate': 1, Freighter: 1, Hauler: 1, 'Jump Freighter': 1, 'Mining Barge': 1, 'Prototype Exploration Ship': 1, Shuttle: 1, 'Special Edition Yachts': 1, Corvette: 1,
  Frigate: 4, 'Covert Ops': 5, Destroyer: 6, 'Assault Frigate': 7, 'Blockade Runner': 7, 'Deep Space Transport': 7, Interceptor: 8, Interdictor: 8.5,
  'Command Destroyer': 9, 'Electronic Attack Ship': 9, 'Logistics Frigate': 9, 'Tactical Destroyer': 9, 'Industrial Command Ship': 10, Cruiser: 10,
  'Heavy Interdiction Cruiser': 10.5, 'Stealth Bomber': 11, 'Force Recon Ship': 11.5, 'Heavy Assault Cruiser': 11.5, 'Combat Recon Ship': 11.5, 'Flag Cruiser': 12,
  Logistics: 12.5, 'Strategic Cruiser': 13, 'Attack Battlecruiser': 14, 'Combat Battlecruiser': 14.5, 'Expedition Command Ship': 15, 'Command Ship': 16.5,
  Battleship: 16.5, 'Black Ops': 18, Marauder: 19, 'Capital Industrial Ship': 19,
};

const zoneOf = (ly: number) => ZONES.find((z) => ly <= z.max)!;

interface Form { from: string; to: string; group: string }

const FORM_KEY = 'eve-nav:ansiblex';

export function createAnsiblexPanel(pane: HTMLElement) {
  const form = loadJson<Form>(FORM_KEY, { from: '', to: '', group: 'Battleship' });
  let map: NavMap | null = null;
  let sov: Map<number, SovClaim> | null = null;
  const names = new Map<number, string>();

  async function init() {
    pane.innerHTML = panel({ body: loader(tx('Citim suveranitatea din ESI')) });
    try {
      [map, sov] = await Promise.all([loadMap(), sovereignty()]);
      render();
    } catch (e) {
      pane.innerHTML = panel({ body: alertBox((e as Error).message) });
    }
  }

  function capitals(): Map<number, NavSystem> {
    const out = new Map<number, NavSystem>();
    for (const [sys, c] of sov!) {
      const s = map!.systems.get(sys);
      if (c?.kind === 'alliance' && c.capital && s) out.set(c.id, s);
    }
    return out;
  }

  async function nameAll(ids: number[]) {
    const todo = ids.filter((id) => !names.has(id));
    if (todo.length) { const got = await resolveNames(todo).catch(() => new Map<number, string>()); for (const id of todo) if (got.has(id)) names.set(id, got.get(id)!); }
  }

  function render() {
    const groups = Object.keys(BASE).sort((a, b) => BASE[a] - BASE[b] || a.localeCompare(b));
    pane.innerHTML = `<div class="tool-grid">
      ${panel({
        title: tx('Taxa Ansiblex'),
        body: `<form class="form-grid recon-form nav-form" id="axForm">
            <label>${tx('De la')}<input class="input" name="from" list="navSystems" data-list="navSystems" value="${esc(form.from)}" autocomplete="off" spellcheck="false" /></label>
            <label>${tx('Până la')}<input class="input" name="to" list="navSystems" data-list="navSystems" value="${esc(form.to)}" autocomplete="off" spellcheck="false" /></label>
            <label>${tx('Clasa navei')}<select class="input" name="group">${groups.map((g) => `<option value="${esc(g)}" ${g === form.group ? 'selected' : ''}>${esc(g)} · ${formatNum(BASE[g], BASE[g] % 1 ? 1 : 0)} TJ</option>`).join('')}</select></label>
            <button class="btn" type="submit">${tx('Calculează')}</button>
          </form>
          <div id="axResult"></div>`,
      })}
      ${panel({
        title: tx('Zone față de capitală'),
        body: `<table class="table compact"><thead><tr><th>${tx('Zonă')}</th><th class="r">LY</th><th class="r">${tx('Multiplicator')}</th><th class="r">${esc(form.group)}</th></tr></thead><tbody>
          ${ZONES.map((z, i) => `<tr><td>${tx('Zona {n}', { n: z.zone })}</td><td class="r num">${i ? `${ZONES[i - 1].max}–` : '0–'}${Number.isFinite(z.max) ? z.max : '∞'}</td><td class="r num">×${z.mult}</td><td class="r num">${z.mult ? `${formatNum(BASE[form.group] * z.mult, 1)} TJ` : tx('gratuit')}</td></tr>`).join('')}
        </tbody></table>
        <p class="dim small">${tx('Capacitor {cap} TJ, se reîncarcă ~{rate} TJ pe oră. Costul îl dă distanța sistemului de destinație față de capitala alianței.', { cap: formatInt(CAPACITY), rate: RECHARGE })}</p>`,
      })}
    </div>`;
    const f = pane.querySelector<HTMLFormElement>('#axForm')!;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      form.from = String(fd.get('from') ?? '');
      form.to = String(fd.get('to') ?? '');
      form.group = String(fd.get('group') ?? form.group);
      saveJson(FORM_KEY, form);
      render();
    });
    f.querySelector('select')!.addEventListener('change', () => f.requestSubmit());
    result();
  }

  async function result() {
    const out = pane.querySelector<HTMLElement>('#axResult')!;
    if (!form.from.trim() || !form.to.trim()) return;
    const a = map!.find(form.from), b = map!.find(form.to);
    if (!a || !b) { out.innerHTML = alertBox(tx('Sistem necunoscut: {name}', { name: !a ? form.from : form.to })); return; }
    const owner = sov!.get(a.id);
    if (owner?.kind !== 'alliance') { out.innerHTML = alertBox(tx('{name} nu e în suveranitatea unei alianțe, deci nu poate avea Ansiblex.', { name: a.name }), 'warn'); return; }
    const cap = capitals().get(owner.id);
    await nameAll([owner.id]);
    if (!cap) { out.innerHTML = alertBox(tx('Alianța {name} nu are capitală de suveranitate, așa că zona nu se poate calcula.', { name: names.get(owner.id) ?? String(owner.id) }), 'warn'); return; }
    const base = BASE[form.group] ?? 0;
    const ly = distanceLy(b, cap);
    const z = zoneOf(ly);
    const fare = base * z.mult;
    const through = fare ? Math.floor(CAPACITY / fare) : Infinity;
    const sys = (s: NavSystem) => `<span class="num ${secClass(s.sec)}">${formatNum(displaySec(s.sec), 1)}</span> ${esc(s.name)}`;
    out.innerHTML = `<div class="history-kpis">
        <div><span class="label">${tx('Cost pe salt')}</span><span class="value accent">${fare ? `${formatNum(fare, 1)} TJ` : tx('gratuit')}</span></div>
        <div><span class="label">${tx('Zonă')}</span><span class="value">${z.zone} · ×${z.mult}</span></div>
        <div><span class="label">${tx('Nave pe capacitor plin')}</span><span class="value">${Number.isFinite(through) ? formatInt(through) : '∞'}</span></div>
        <div><span class="label">${tx('Reîncărcare după un salt')}</span><span class="value">${fare ? `${formatInt(Math.round((fare / RECHARGE) * 60))} min` : '—'}</span></div>
      </div>
      <p class="small">${tx('Alianța {name}', { name: esc(names.get(owner.id) ?? String(owner.id)) })} · ${tx('capitala')} ${sys(cap)} · ${sys(b)} ${tx('la {ly} LY', { ly: formatNum(ly, 2) })}</p>`;
  }

  return { show: () => (map && sov ? render() : init()) };
}
