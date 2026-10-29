import { panel, loader, alertBox, esc, formatNum, emptyState, button, badge } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { typeIconUrl } from '../services/market';
import { rosterCharacters } from '../character/roster';
import { getActiveCharacterId } from '../character/characters';
import { hasScope } from '../character/sso';
import { characterLocation } from '../character/esi';
import { formatDuration } from '../character/training';
import { displaySec, secClass } from '../services/navigation';
import { loadAtlas, type PlanetAtlas, type SpaceSystem } from '../services/planets';
import { TIER_NAMES, type PiData } from '../services/pi';
import { tx } from '../i18n';

const FINDER_KEY = 'eve-pi:finder';
const SCHEM_KEY = 'eve-pi:schematics';
const LOCATION_SCOPE = 'esi-location.read_location.v1';

type SecFilter = 'all' | 'low' | 'high';

const TIER_LABELS = [tx('Brut'), tx('De bază'), tx('Rafinat'), tx('Specializat'), tx('Avansat')];

const icon = (id: number, size = 32) => `<img class="row-icon" src="${typeIconUrl(id, size)}" alt="" loading="lazy" />`;
const tierBadge = (t: number) => `<span class="pi-tier t${t}">${TIER_NAMES[t]}</span>`;

const PLANET_RO: Record<string, string> = {
  Temperate: 'Temperată', Ice: 'Gheață', Gas: 'Gaz', Oceanic: 'Oceanică', Lava: 'Lavă', Barren: 'Stearpă', Storm: 'Furtună', Plasma: 'Plasmă', Shattered: 'Sfărâmată', 'Scorched Barren': 'Stearpă pârjolită',
};
export const planetLabel = (name: string) => tx(PLANET_RO[name] ?? name);

const whLabel = (cls: number) => (cls === 12 ? 'Thera' : cls === 13 ? 'C13' : cls >= 14 ? 'Drifter' : `C${cls}`);

function secHtml(s: SpaceSystem) {
  if (s.wh) return badge(whLabel(s.wh), 'warn');
  return `<span class="num ${secClass(s.sec)}">${formatNum(displaySec(s.sec), 1)}</span>`;
}

export function createPlanetFinder(pane: HTMLElement, ready: Promise<PiData>, onProduct: (id: number) => void) {
  const saved = { system: '', types: [] as number[], sec: 'all' as SecFilter, jumps: 15, ...loadJson<Partial<{ system: string; types: number[]; sec: SecFilter; jumps: number }>>(FINDER_KEY, {}) };
  const save = () => saveJson(FINDER_KEY, saved);
  let atlas: PlanetAtlas | null = null;
  let pi: PiData | null = null;
  let locating = false;
  let locError = '';

  pane.innerHTML = loader(tx('Încărcăm planetele din New Eden'));
  Promise.all([loadAtlas(), ready]).then(([a, d]) => {
    atlas = a;
    pi = d;
    draw();
  }).catch((e) => { pane.innerHTML = panel({ body: alertBox((e as Error).message) }); });

  const locators = () => rosterCharacters().filter((c) => hasScope(c.characterId!, LOCATION_SCOPE));

  function draw() {
    if (!atlas || !pi) return;
    const a = atlas;
    const d = pi;
    const sys = saved.system ? a.find(saved.system) : undefined;
    const canLocate = locators().length > 0;
    const form = panel({
      title: tx('Găsește planete'),
      body: `<p class="small dim pi-lead">${tx('Alege un sistem ca să vezi planetele lui și ce resurse P0 are fiecare, apoi caută cele mai apropiate planete de un anumit tip.')}</p>
        <form class="form-grid recon-form pi-form" id="piFinderForm">
          <label>${tx('Sistem')}<input class="input pi-product" name="system" data-list="piSystems" value="${esc(saved.system)}" placeholder="${esc(tx('ex: Jita, J123456'))}" autocomplete="off" spellcheck="false" /></label>
          ${canLocate ? button(locating ? tx('Caut locația…') : tx('Sistemul meu'), { iconName: 'target', cls: 'ghost', attrs: `type="button" data-pi-locate ${locating ? 'disabled' : ''}` }) : ''}
        </form>
        ${locError ? alertBox(locError) : ''}
        <datalist id="piSystems"></datalist>`,
    });
    if (!sys) {
      pane.innerHTML = `${form}${panel({ body: emptyState({ title: saved.system ? tx('Nu găsesc sistemul {name}', { name: saved.system }) : tx('Pornește de la un sistem'), text: tx('Sistemul în care stai sau în care vrei colonii. Merg și sistemele wormhole.') }) })}`;
      return;
    }
    const spots = a.planets(sys.id);
    const piTypes = new Set(d.planets.keys());
    const raws = new Map<number, number>();
    for (const p of spots) for (const r of d.planets.get(p.typeId)?.raws ?? []) raws.set(r, (raws.get(r) ?? 0) + 1);
    const makeable = [...d.byOutput.keys()].filter((id) => [...d.rawSet(id)].every((r) => raws.has(r)));
    const byTier = [4, 3, 2, 1].map((t) => makeable.filter((id) => d.tier(id) === t).sort((x, y) => d.name(x).localeCompare(d.name(y))));

    const cards = spots.map((p) => {
      const pt = d.planets.get(p.typeId);
      const typeName = a.names.get(p.typeId) ?? '';
      return `<div class="pi-planet-card ${pt ? '' : 'none'}">
        <div class="pi-planet-head">${icon(p.typeId, 64)}<div><b>${esc(p.name)}</b><span class="small dim">${esc(planetLabel(typeName))}</span></div></div>
        ${pt ? `<div class="pi-raws">${pt.raws.map((r) => `<button class="pi-raw" data-pi-product="${r}" title="${esc(d.name(r))}">${icon(r)}<span>${esc(d.name(r))}</span></button>`).join('')}</div>` : `<p class="small dim">${tx('Fără resurse pentru PI')}</p>`}
      </div>`;
    }).join('');

    const head = `<div class="pi-sys-head"><b>${esc(sys.name)}</b>${secHtml(sys)}<span class="small dim">${esc(sys.region)}</span><span class="small dim">· ${tx('{n} planete', { n: spots.length })}</span></div>`;

    const typeChips = [...piTypes].map((t) => `<button class="chip-btn pi-type-chip ${saved.types.includes(t) ? 'active' : ''}" data-pi-near-type="${t}">${icon(t)}${esc(planetLabel(a.names.get(t) ?? ''))}</button>`).join('');
    let nearHtml = '';
    if (sys.wh) {
      nearHtml = `<p class="small dim">${tx('Sistemele wormhole nu au porți, așa că distanța în salturi nu are sens aici. Caută din sistemul k-space prin care ieși.')}</p>`;
    } else if (!saved.types.length) {
      nearHtml = `<p class="small dim">${tx('Alege unul sau mai multe tipuri de planete.')}</p>`;
    } else {
      const minSec = saved.sec === 'high' ? 0.45 : saved.sec === 'low' ? 1e-9 : -1;
      const rows = a.nearest(sys.id, saved.types, { maxJumps: saved.jumps, minSec });
      nearHtml = rows.length ? `<div class="table-scroll"><table class="table compact pi-near">
        <thead><tr><th>${tx('Sistem')}</th><th class="r">${tx('Sec')}</th><th>${tx('Regiune')}</th><th class="r">${tx('Salturi')}</th><th>${tx('Planete')}</th></tr></thead>
        <tbody>${rows.map((r) => {
          const counts = a.typeCounts(r.system.id);
          return `<tr class="pi-row" data-pi-goto="${esc(r.system.name)}">
            <td><b>${esc(r.system.name)}</b></td>
            <td class="r">${secHtml(r.system)}</td>
            <td class="small dim">${esc(r.system.region)}</td>
            <td class="r num">${r.jumps}</td>
            <td><div class="pi-counts">${saved.types.filter((t) => counts.get(t)).map((t) => `<span class="pi-count" title="${esc(planetLabel(a.names.get(t) ?? ''))}">${icon(t)}<span class="num">×${counts.get(t)}</span></span>`).join('')}</div></td>
          </tr>`;
        }).join('')}</tbody></table></div>` : `<p class="small dim">${tx('Nicio planetă de acest tip în {n} salturi cu filtrul ales.', { n: saved.jumps })}</p>`;
    }

    pane.innerHTML = `${form}
      <div class="pi-finder-grid">
        ${panel({ title: tx('Planete în sistem'), count: spots.length, body: `${head}<div class="pi-planet-cards">${cards || `<p class="small dim">${tx('Sistemul nu are planete.')}</p>`}</div>` })}
        <div class="stack">
          ${panel({
            title: tx('Resurse P0 în sistem'),
            count: raws.size,
            body: raws.size ? `<div class="pi-raws">${[...raws].sort((x, y) => y[1] - x[1] || d.name(x[0]).localeCompare(d.name(y[0]))).map(([r, n]) => `<button class="pi-raw" data-pi-product="${r}">${icon(r)}<span>${esc(d.name(r))}</span><span class="dim num small">${tx('{n} pl.', { n })}</span></button>`).join('')}</div>` : `<p class="small dim">${tx('Niciuna.')}</p>`,
          })}
          ${panel({
            title: tx('Ce poți fabrica doar de aici'),
            count: makeable.length,
            body: makeable.length ? `${byTier.map((ids, i) => ids.length ? `<div class="pi-make-row">${tierBadge(4 - i)}<div class="pi-raws">${ids.map((id) => `<button class="pi-raw" data-pi-product="${id}">${icon(id)}<span>${esc(d.name(id))}</span></button>`).join('')}</div></div>` : '').join('')}
              <p class="small dim">${tx('Produse ale căror resurse P0 se găsesc toate pe planetele din acest sistem. Click pe unul ca să-l vezi în Scheme.')}</p>` : `<p class="small dim">${tx('Niciun produs nu poate fi făcut complet din acest sistem.')}</p>`,
          })}
        </div>
      </div>
      ${panel({
        title: tx('Cele mai apropiate planete'),
        body: `<div class="pi-type-chips">${typeChips}</div>
          <div class="form-grid recon-form pi-form">
            <label>${tx('Securitate')}<select class="input sm" data-pi-sec>${([['all', tx('Oricare')], ['low', tx('High și low sec')], ['high', tx('Doar high sec')]] as [SecFilter, string][]).map(([v, l]) => `<option value="${v}" ${v === saved.sec ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
            <label>${tx('Maxim salturi')}<select class="input sm" data-pi-jumps>${[5, 10, 15, 20, 30].map((n) => `<option value="${n}" ${n === saved.jumps ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          </div>
          ${nearHtml}`,
      })}`;
  }

  function setSystem(name: string) {
    saved.system = name.trim();
    save();
    draw();
  }

  pane.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.list !== 'piSystems' || !atlas) return;
    const list = pane.querySelector<HTMLDataListElement>('#piSystems');
    if (list) list.innerHTML = atlas.suggest(input.value).map((s) => `<option value="${esc(s.name)}">${esc(s.region)} · ${s.wh ? whLabel(s.wh) : formatNum(displaySec(s.sec), 1)}</option>`).join('');
  });
  pane.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.name === 'system') { setSystem(t.value); return; }
    if (t.matches('[data-pi-sec]')) { saved.sec = (t as HTMLSelectElement).value as SecFilter; save(); draw(); return; }
    if (t.matches('[data-pi-jumps]')) { saved.jumps = Number((t as HTMLSelectElement).value) || 15; save(); draw(); }
  });
  pane.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = (e.target as HTMLElement).querySelector<HTMLInputElement>('[name="system"]');
    if (input) setSystem(input.value);
  });
  pane.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const prod = t.closest<HTMLElement>('[data-pi-product]');
    if (prod) { onProduct(Number(prod.dataset.piProduct)); return; }
    const chip = t.closest<HTMLElement>('[data-pi-near-type]');
    if (chip) {
      const id = Number(chip.dataset.piNearType);
      saved.types = saved.types.includes(id) ? saved.types.filter((x) => x !== id) : [...saved.types, id];
      save();
      draw();
      return;
    }
    const go = t.closest<HTMLElement>('[data-pi-goto]');
    if (go) { setSystem(go.dataset.piGoto!); pane.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (t.closest('[data-pi-locate]') && atlas) {
      locating = true;
      locError = '';
      draw();
      try {
        const list = locators();
        const who = list.find((c) => c.id === getActiveCharacterId()) ?? list[0];
        const loc = await characterLocation(who.characterId!);
        const s = atlas.system(loc.solar_system_id);
        if (s) saved.system = s.name;
        save();
      } catch (err) {
        locError = (err as Error).message;
      } finally {
        locating = false;
        draw();
      }
    }
  });
}

export function createSchematics(pane: HTMLElement, ready: Promise<PiData>, onPlan: (id: number) => void) {
  const state = { types: [] as number[], selected: 0, ...loadJson<Partial<{ types: number[]; selected: number }>>(SCHEM_KEY, {}) };
  const save = () => saveJson(SCHEM_KEY, state);
  let pi: PiData | null = null;

  pane.innerHTML = loader(tx('Încărcăm schemele PI'));
  ready.then((d) => { pi = d; draw(); }).catch((e) => { pane.innerHTML = panel({ body: alertBox((e as Error).message) }); });

  function upstream(d: PiData, id: number, out = new Set<number>()) {
    const s = d.byOutput.get(id);
    for (const [inp] of s?.ins ?? []) if (!out.has(inp)) { out.add(inp); upstream(d, inp, out); }
    return out;
  }

  function downstream(d: PiData, id: number, out = new Set<number>()) {
    for (const s of d.usedIn(id)) if (!out.has(s.out)) { out.add(s.out); downstream(d, s.out, out); }
    return out;
  }

  function select(id: number) {
    state.selected = state.selected === id ? 0 : id;
    save();
    draw();
    if (state.selected && matchMedia('(max-width: 1100px)').matches) pane.querySelector('.pi-schem-side')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function detail(d: PiData, id: number) {
    if (!id || !d.types.has(id)) {
      return panel({ title: tx('Nimic selectat'), body: `<p class="small dim">${tx('Alege orice produs din lanț ca să vezi din ce se face, unde e folosit și ce planete au resursele lui brute.')}</p>` });
    }
    const t = d.tier(id);
    const s = d.byOutput.get(id);
    const uses = d.usedIn(id).sort((a, b) => d.tier(a.out) - d.tier(b.out) || d.name(a.out).localeCompare(d.name(b.out)));
    const raws = s ? d.rawNeeds(id, s.outQty) : new Map([[id, 1]]);
    const sources = d.planetsFor(id);
    const cover = d.cover([...raws.keys()]);
    const item = (x: number, qty?: string) => `<button class="pi-chain-item" data-pi-pick="${x}">${icon(x)}<span>${esc(d.name(x))}</span>${tierBadge(d.tier(x))}${qty ? `<span class="num dim small">${qty}</span>` : ''}</button>`;
    const planetTag = (pid: number) => `<span class="pi-planet-tag">${icon(pid)}${esc(planetLabel(d.planets.get(pid)?.name ?? ''))}</span>`;
    return panel({
      title: d.name(id),
      actions: t ? button(tx('Planificator'), { cls: 'ghost sm', attrs: `data-pi-plan="${id}"` }) : '',
      body: `<div class="pi-detail-head">${icon(id, 64)}<div>${tierBadge(t)} <span class="small dim">${esc(TIER_LABELS[t])}</span>${s ? `<div class="small dim">${tx('{qty} unități la fiecare {cycle}', { qty: s.outQty, cycle: formatDuration(s.cycle) })}</div>` : ''}</div></div>
        ${s ? `<h4 class="pi-detail-h">${tx('Inputuri pe ciclu')}</h4><div class="pi-chain-list">${s.ins.map(([x, q]) => item(x, `×${q}`)).join('')}</div>` : `<h4 class="pi-detail-h">${tx('Se extrage de pe')}</h4><div class="pi-planet-tags">${sources.map((p) => planetTag(p.id)).join('')}</div>`}
        <h4 class="pi-detail-h">${tx('Folosit în')}</h4>
        ${uses.length ? `<div class="pi-chain-list">${uses.map((u) => item(u.out)).join('')}</div>` : `<p class="small dim">${t === 4 ? tx('Produs final: se vinde sau intră în fabricarea structurilor.') : tx('Nicăieri în PI.')}</p>`}
        ${s ? `<h4 class="pi-detail-h">${tx('Resurse P0 pe ciclu')}</h4>
          <div class="pi-chain-list">${[...raws].sort((a, b) => b[1] - a[1]).map(([x, q]) => item(x, `×${formatNum(q, q < 10 ? 1 : 0)}`)).join('')}</div>
          <h4 class="pi-detail-h">${tx('Planete sursă')}</h4>
          <div class="pi-planet-tags">${cover.map((c) => planetTag(c.id)).join('')}</div>
          <p class="small dim">${tx('Cea mai mică combinație de tipuri de planete care acoperă toate resursele P0. Poți folosi și alte tipuri care au aceleași resurse.')}</p>` : ''}`,
    });
  }

  function draw() {
    if (!pi) return;
    const d = pi;
    const chosen = state.types.filter((t) => d.planets.has(t));
    const have = new Set(chosen.flatMap((t) => d.planets.get(t)!.raws));
    const possible = (id: number) => !chosen.length || [...d.rawSet(id)].every((r) => have.has(r));
    const sel = d.types.has(state.selected) ? state.selected : 0;
    const up = sel ? upstream(d, sel) : new Set<number>();
    const down = sel ? downstream(d, sel) : new Set<number>();
    const cols = [0, 1, 2, 3, 4].map((t) => [...d.types.values()].filter((x) => x.tier === t).sort((a, b) => a.name.localeCompare(b.name)));
    const chips = [...d.planets.values()].map((p) => `<button class="chip-btn pi-type-chip ${chosen.includes(p.id) ? 'active' : ''}" data-pi-ptype="${p.id}">${icon(p.id)}${esc(planetLabel(p.name))}</button>`).join('');

    pane.innerHTML = `${panel({
      title: tx('Tipuri de planete'),
      actions: chosen.length ? button(tx('Golește'), { cls: 'ghost sm', attrs: 'data-pi-clear' }) : '',
      body: `<p class="small dim pi-lead">${tx('Alege planetele pe care le ai; produsele pe care nu le pot face împreună devin estompate.')}</p><div class="pi-type-chips">${chips}</div>`,
    })}
      <div class="pi-schem-grid">
        ${panel({
          title: tx('Lanț de producție'),
          body: `<p class="small dim pi-lead">${tx('Alege un produs ca să vezi din ce se face și în ce intră.')}</p>
            <div class="pi-columns ${sel ? 'has-sel' : ''}">${cols.map((list, t) => `<div class="pi-col"><div class="pi-col-head">${TIER_NAMES[t]} · ${esc(TIER_LABELS[t])}</div>${list.map((x) => {
              const cls = [x.id === sel ? 'sel' : '', up.has(x.id) ? 'up' : '', down.has(x.id) ? 'down' : '', possible(x.id) ? '' : 'off'].join(' ');
              return `<button class="pi-chain-item ${cls}" data-pi-pick="${x.id}">${icon(x.id)}<span>${esc(x.name)}</span></button>`;
            }).join('')}</div>`).join('')}</div>
            ${sel ? `<p class="small dim pi-legend"><span class="pi-key up"></span>${tx('se face din')} <span class="pi-key down"></span>${tx('intră în')}</p>` : ''}`,
        })}
        <div class="pi-schem-side">${detail(d, sel)}</div>
      </div>`;
  }

  pane.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const pick = t.closest<HTMLElement>('[data-pi-pick]');
    if (pick) { select(Number(pick.dataset.piPick)); return; }
    const pt = t.closest<HTMLElement>('[data-pi-ptype]');
    if (pt) {
      const id = Number(pt.dataset.piPtype);
      state.types = state.types.includes(id) ? state.types.filter((x) => x !== id) : [...state.types, id];
      save();
      draw();
      return;
    }
    if (t.closest('[data-pi-clear]')) { state.types = []; save(); draw(); return; }
    const plan = t.closest<HTMLElement>('[data-pi-plan]');
    if (plan) onPlan(Number(plan.dataset.piPlan));
  });

  return {
    show(id: number) {
      state.selected = id;
      save();
      draw();
    },
  };
}
