import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, formatInt, formatNum, compactISK, formatISK, badge, emptyState, windowTitle, button } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { fetchPrices, typeIconUrl, type Aggregates } from '../services/market';
import { buildDogma, type Fit } from '../engine/fit';
import { loadFits } from '../fitting/savedFits';
import { OPEN_KEY } from '../fitting/shared';
import { parseItems } from '../services/appraisal';
import { bindBreakdownTips, breakdownHtml, single, type Breakdown } from '../ui/breakdown';
import { roman } from '../ui/itemInfo';
import {
  loadMining, miners, fitRate, canMine, holdCapacity, refineYield, baseLabel, refine, oreValuePerM3, priceOf, implantFor,
  ORE_KINDS, SECURITY_LABEL, DEFAULT_SETUP,
  type MiningData, type Ore, type OreKind, type Miner, type MinerKind, type RefineSetup, type Security, type OreValue,
} from '../services/mining';
import { tx } from '../i18n';

type Tab = 'yield' | 'refine' | 'ores';
type Basis = 'sell' | 'buy';

const TABS = (): { id: Tab; label: string }[] => [
  { id: 'yield', label: tx('Randament și ISK/oră') },
  { id: 'refine', label: tx('Reprocesare') },
  { id: 'ores', label: tx('Valoare ore') },
];

const TAB_KEY = 'eve-mining:tab';
const YIELD_KEY = 'eve-mining:yield';
const ORES_KEY = 'eve-mining:ores';
const SETUP_KEY = 'eve-mining:refine';
const PASTE_KEY = 'eve-mining:paste';

const KIND_LABEL = (): Record<OreKind, string> => ({ ore: tx('Asteroizi'), moon: tx('Ore de lună'), ice: tx('Gheață'), gas: tx('Gaz') });
const MINER_LABEL = (): Record<MinerKind, string> => ({ ore: tx('Ore'), ice: tx('Gheață'), gas: tx('Gaz') });
const VALUE_LABEL = (): Record<OreValue['best'], string> => ({ raw: tx('Vinde brut'), compressed: tx('Comprimă și vinde'), refined: tx('Reprocesează') });

const pct = (n: number) => `${formatNum(n * 100, 2)}%`;
const m3 = (n: number) => `${formatNum(n, n < 10 ? 2 : 0)} m³`;
const iskCell = (n: number, best: boolean) => `<td class="r num ${best ? 'up' : ''}">${n > 0 ? compactISK(n) : '<span class="dim">—</span>'}</td>`;
const duration = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')} min` : `${Math.max(1, Math.round(s / 60))} min`);

interface FitChoice { key: string; label: string; fit: Fit }

export function createMiningView(el: HTMLElement, ctx: AppContext, side: HTMLElement) {
  let tab = loadJson<Tab>(TAB_KEY, 'yield');
  if (!TABS().some((t) => t.id === tab)) tab = 'yield';
  const yieldForm = loadJson<{ fit: string; basis: Basis; kind: OreKind | 'all'; q: string; variants: boolean }>(YIELD_KEY, { fit: '', basis: 'buy', kind: 'all', q: '', variants: true });
  const oresForm = loadJson<{ basis: Basis; kind: OreKind | 'all'; q: string }>(ORES_KEY, { basis: 'buy', kind: 'ore', q: '' });
  const setup: RefineSetup = { ...DEFAULT_SETUP, ...loadJson<Partial<RefineSetup>>(SETUP_KEY, {}) };
  setup.rigs = { ...DEFAULT_SETUP.rigs, ...setup.rigs };

  el.innerHTML = `${pageHead(tx('Mining și reprocesare'), tx('ISK pe oră pe tip de ore din fit-ul și skill-urile tale, plus valoarea reprocesată față de vânzarea brută, la prețuri Jita'), 'Rudnik')}
    <div id="mineYield"></div>
    <div id="mineRefine"></div>
    <div id="mineOres"></div>`;
  const panes: Record<Tab, HTMLElement> = {
    yield: el.querySelector<HTMLElement>('#mineYield')!,
    refine: el.querySelector<HTMLElement>('#mineRefine')!,
    ores: el.querySelector<HTMLElement>('#mineOres')!,
  };
  const tips = new Map<string, string>();
  bindBreakdownTips(el, (k) => tips.get(k));

  let data: MiningData | null = null;
  let prices = new Map<number, Aggregates>();
  let pricesAt = 0;
  const ready = loadMining().then(async (d) => {
    data = d;
    await loadPrices();
    return d;
  });

  async function loadPrices() {
    if (!data || Date.now() - pricesAt < 5 * 60 * 1000) return;
    const ids = new Set<number>();
    for (const o of data.ores) {
      ids.add(o.id);
      if (o.compressedId) ids.add(o.compressedId);
    }
    for (const id of data.minerals.keys()) ids.add(id);
    prices = await fetchPrices([...ids]);
    pricesAt = Date.now();
  }

  const price = (basis: Basis) => (id: number) => priceOf(prices.get(id), basis);

  function renderTabs() {
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Mining'))}</div>
      <div class="side-nav">${TABS().map((t) => `<button class="side-link ${t.id === tab ? 'active' : ''}" data-mine-tab="${t.id}">${t.label}</button>`).join('')}</div>`;
    for (const [id, pane] of Object.entries(panes)) pane.hidden = id !== tab;
    render();
  }

  side.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mine-tab]');
    if (!b) return;
    tab = b.dataset.mineTab as Tab;
    saveJson(TAB_KEY, tab);
    renderTabs();
  });

  ctx.onCharacterChange(() => render());

  async function render() {
    const pane = panes[tab];
    if (!data) {
      pane.innerHTML = loader(tx('Încărcăm datele de mining și prețurile Jita'));
      try { await ready; } catch (err) { pane.innerHTML = panel({ body: alertBox((err as Error).message) }); return; }
    }
    if (tab === 'yield') renderYield();
    if (tab === 'refine') renderRefine();
    if (tab === 'ores') renderOres();
  }

  function fitChoices(): FitChoice[] {
    const open = loadJson<{ fits: (Fit | null)[]; active: number } | null>(OPEN_KEY, null);
    const out: FitChoice[] = [];
    const seen = new Set<string>();
    (open?.fits ?? []).forEach((f, i) => {
      if (!f?.shipId || !hasMiners(f)) return;
      seen.add(f.id);
      out.push({ key: `open:${i}`, label: `${f.name} · ${ctx.sde.types.get(f.shipId)?.name ?? ''} (${tx('deschis în Fitting')})`, fit: f });
    });
    for (const f of loadFits()) {
      if (seen.has(f.id) || !hasMiners(f)) continue;
      out.push({ key: `fit:${f.id}`, label: `${f.name} · ${ctx.sde.types.get(f.shipId)?.name ?? ''}`, fit: f });
    }
    return out;
  }

  function hasMiners(f: Fit): boolean {
    try {
      return miners(ctx.sde, buildDogma(ctx.sde, f, ctx.character)).length > 0;
    } catch {
      return false;
    }
  }

  function yieldOf(ore: Ore): Breakdown {
    return refineYield(data!, setup, ctx.character, ore);
  }

  function minerRows(list: Miner[]): string {
    return list.map((m, i) => {
      const key = `mi${i}`;
      tips.set(`${key}a`, breakdownHtml(single(m.amountTrace), m3));
      tips.set(`${key}d`, breakdownHtml(single(m.durationTrace), (n) => `${formatNum(n / 1000, 2)} s`));
      const perHour = (3600 / m.duration) * m.amount * m.count;
      return `<tr>
        <td><span class="nav-ship-name"><img class="row-icon" src="${typeIconUrl(m.item.typeId, 32)}" alt="" />${esc(m.item.type.name)}${m.count > 1 ? ` <span class="dim">×${m.count}</span>` : ''}</span></td>
        <td>${badge(MINER_LABEL()[m.kind])}</td>
        <td class="small">${m.crystal ? esc(m.crystal.name) : '<span class="dim">—</span>'}</td>
        <td class="r num" data-bd="${key}a">${m3(m.amount)}</td>
        <td class="r num" data-bd="${key}d">${formatNum(m.duration, 1)} s</td>
        <td class="r num">${m.critChance ? `${formatNum(m.critChance * 100, 1)}% · +${formatInt(Math.round(m.critBonus * 100))}%` : '<span class="dim">—</span>'}</td>
        <td class="r num">${m.wasteChance ? `${formatNum(m.wasteChance * 100, 1)}% · ×${formatNum(m.wasteMult, 2)}` : '<span class="dim">—</span>'}</td>
        <td class="r num">${m3(perHour)}</td>
      </tr>`;
    }).join('');
  }

  function renderYield() {
    const pane = panes.yield;
    tips.clear();
    const choices = fitChoices();
    if (!choices.length) {
      pane.innerHTML = panel({ body: emptyState({ title: tx('Niciun fit de mining'), text: tx('Fă în Fitting un fit cu module de mining (lasere, strip minere, ice harvestere, gas scoop-uri sau drone de mining) și salvează-l sau lasă-l deschis. Aici apare apoi randamentul pe oră pentru fiecare tip de ore.') }) });
      return;
    }
    const choice = choices.find((c) => c.key === yieldForm.fit) ?? choices[0];
    const d = buildDogma(ctx.sde, choice.fit, ctx.character);
    const list = miners(ctx.sde, d);
    const kinds = [...new Set(list.map((m) => m.kind))];
    const p = price(yieldForm.basis);
    const q = yieldForm.q.trim().toLowerCase();
    const ores = data!.ores
      .filter((o) => list.some((m) => canMine(m, o)))
      .filter((o) => yieldForm.kind === 'all' || o.kind === yieldForm.kind)
      .filter((o) => yieldForm.variants || !o.baseId)
      .filter((o) => !q || o.name.toLowerCase().includes(q) || o.group.toLowerCase().includes(q));
    const rows = ores.map((o) => {
      const rate = fitRate(list, o);
      const y = yieldOf(o);
      const v = oreValuePerM3(o, y.value, p, setup.tax);
      const best = Math.max(v.raw, v.compressed, v.refined);
      return { o, rate, v, y, best: best * rate.m3, crit: best * rate.crit };
    }).sort((a, b) => b.best - a.best);

    const kpis = kinds.map((k) => {
      const own = list.filter((m) => m.kind === k);
      const sample = data!.ores
        .filter((o) => o.family !== 'Mercoxit' && own.some((m) => canMine(m, o)))
        .reduce<Ore | null>((best, o) => (!best || fitRate(own, o).m3 > fitRate(own, best).m3 ? o : best), null);
      if (!sample) return '';
      const r = fitRate(own, sample);
      const hold = holdCapacity(ctx.sde, d, k);
      return `<div><span class="label">${MINER_LABEL()[k]} m³/h</span><span class="value accent">${formatInt(Math.round(r.m3))}</span></div>
        ${r.crit ? `<div><span class="label">${tx('Crit-uri, medie')}</span><span class="value">+${formatInt(Math.round(r.crit))} m³/h</span></div>` : ''}
        ${r.waste ? `<div><span class="label">${tx('Reziduu pierdut')}</span><span class="value">${formatInt(Math.round(r.waste))} m³/h</span></div>` : ''}
        ${hold > 0 && r.m3 > 0 ? `<div><span class="label">${tx('Hold plin în')}</span><span class="value">${duration((hold / (r.m3 + r.crit)) * 3600)}</span></div>` : ''}`;
    }).join('');

    const top = rows[0];
    pane.innerHTML = `${panel({
      body: `<form class="form-grid recon-form nav-form" id="mineYieldForm">
          <label>Fit<select class="input" name="fit">${choices.map((c) => `<option value="${esc(c.key)}" ${c.key === choice.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
          <label>${tx('Preț Jita')}<select class="input" name="basis">
            <option value="buy" ${yieldForm.basis === 'buy' ? 'selected' : ''}>${tx('Buy max (vânzare instant)')}</option>
            <option value="sell" ${yieldForm.basis === 'sell' ? 'selected' : ''}>${tx('Sell min (ordin de vânzare)')}</option>
          </select></label>
          <label>${tx('Tip')}<select class="input" name="kind"><option value="all">${tx('Toate')}</option>${ORE_KINDS.map((k) => `<option value="${k}" ${yieldForm.kind === k ? 'selected' : ''}>${KIND_LABEL()[k]}</option>`).join('')}</select></label>
          <label>${tx('Caută')}<input class="input" name="q" value="${esc(yieldForm.q)}" placeholder="${esc(tx('ex: Spodumain'))}" autocomplete="off" spellcheck="false" /></label>
          <label class="check"><input type="checkbox" name="variants" ${yieldForm.variants ? 'checked' : ''} /> ${tx('Variante +5% / +10% / +15%')}</label>
        </form>
        <div class="history-kpis nav-ship">
          <div><span class="label">${tx('Navă')}</span><span class="value nav-ship-name"><img class="row-icon" src="${typeIconUrl(choice.fit.shipId, 32)}" alt="" />${esc(ctx.sde.types.get(choice.fit.shipId)?.name ?? '')}</span></div>
          ${kpis}
          ${top ? `<div><span class="label">${tx('Cel mai bun ore')}</span><span class="value">${esc(top.o.name)} · ${compactISK(top.best)}/h</span></div>` : ''}
        </div>
        <p class="dim small">${tx('Calculat cu skill-urile caracterului activ ({name}), modulele, crystalele, dronele active și boost-urile de flotă din fit (tab-ul Command din Fitting). Treci cu mouse-ul peste m³ / ciclu și durată pentru detalii.', { name: esc(ctx.character.name) })}</p>
        <div class="table-scroll"><table class="table compact mine-miners"><thead><tr>
          <th>${tx('Modul / dronă')}</th><th>${tx('Tip')}</th><th>Crystal</th><th class="r">${tx('m³ / ciclu')}</th><th class="r">${tx('Ciclu')}</th><th class="r">${tx('Crit · bonus')}</th><th class="r">${tx('Reziduu · volum')}</th><th class="r">m³/h</th>
        </tr></thead><tbody>${minerRows(list)}</tbody></table></div>`,
    })}
    ${panel({
      title: tx('ISK pe oră pe tip de ore'),
      count: rows.length,
      body: rows.length ? `<div class="table-scroll"><table class="table compact mine-table"><thead><tr>
          <th>Ore</th><th class="r">m³/h</th><th class="r">${tx('Unități/h')}</th><th class="r">${tx('Brut')}</th><th class="r">${tx('Comprimat')}</th><th class="r">${tx('Reprocesat')}</th><th class="r">${tx('Randament')}</th><th class="r">${tx('Cel mai bun /h')}</th><th>${tx('Recomandare')}</th>
        </tr></thead><tbody>${rows.map((r, i) => {
          tips.set(`yr${i}`, breakdownHtml(r.y, pct, baseLabel(data!, setup, r.o)));
          return `<tr>
            <td><span class="nav-ship-name"><img class="row-icon" src="${typeIconUrl(r.o.id, 32)}" alt="" />${esc(r.o.name)}</span><div class="dim small">${esc(r.o.group)}</div></td>
            <td class="r num">${formatInt(Math.round(r.rate.m3))}</td>
            <td class="r num">${formatInt(Math.round(r.rate.m3 / r.o.volume))}</td>
            ${iskCell(r.v.raw * r.rate.m3, r.v.best === 'raw')}
            ${iskCell(r.v.compressed * r.rate.m3, r.v.best === 'compressed')}
            ${iskCell(r.v.refined * r.rate.m3, r.v.best === 'refined')}
            <td class="r num" ${r.o.materials.length ? `data-bd="yr${i}"` : ''}>${r.o.materials.length ? pct(r.y.value) : '<span class="dim">—</span>'}</td>
            <td class="r num accent">${compactISK(r.best)}${r.crit ? `<div class="dim small">+${compactISK(r.crit)} crit</div>` : ''}</td>
            <td>${badge(VALUE_LABEL()[r.v.best], r.v.best === 'refined' ? 'accent' : '')}</td>
          </tr>`;
        }).join('')}</tbody></table></div>
        <p class="dim small">${tx('Reprocesat folosește setările din tab-ul Reprocesare ({place}). Taxa de reprocesare e scăzută din valoare. Crystalele dau bonusul doar pe ore-ul lor; pentru restul randamentul e recalculat fără crystal.', { place: esc(placeName()) })}</p>`
        : emptyState({ title: tx('Niciun ore pentru filtrele alese') }),
    })}`;

    const form = pane.querySelector<HTMLFormElement>('#mineYieldForm')!;
    const update = () => {
      const fd = new FormData(form);
      yieldForm.fit = String(fd.get('fit') ?? '');
      yieldForm.basis = fd.get('basis') === 'sell' ? 'sell' : 'buy';
      yieldForm.kind = (String(fd.get('kind') ?? 'all') as OreKind | 'all');
      yieldForm.q = String(fd.get('q') ?? '');
      yieldForm.variants = fd.get('variants') === 'on';
      saveJson(YIELD_KEY, yieldForm);
    };
    form.addEventListener('change', (e) => { if ((e.target as HTMLElement).getAttribute('name') !== 'q') { update(); renderYield(); } });
    form.addEventListener('submit', (e) => { e.preventDefault(); update(); renderYield(); });
    const qInput = form.querySelector<HTMLInputElement>('input[name="q"]')!;
    let timer = 0;
    qInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        update();
        renderYield();
        const again = panes.yield.querySelector<HTMLInputElement>('input[name="q"]');
        again?.focus();
        again?.setSelectionRange(again.value.length, again.value.length);
      }, 250);
    });
  }

  function placeName(): string {
    return data!.structures.find((s) => s.id === setup.place)?.name ?? tx('stație NPC');
  }

  function renderRefine() {
    const pane = panes.refine;
    tips.clear();
    const d = data!;
    const structure = d.structures.find((s) => s.id === setup.place);
    const rigSelect = (k: 'ore' | 'moon' | 'ice') => `<label>${tx('Rig {kind}', { kind: KIND_LABEL()[k].toLowerCase() })}<select class="input" name="rig-${k}" ${structure ? '' : 'disabled'}>
        <option value="0">${tx('Fără rig')}</option>
        ${d.rigs.filter((r) => r.kind === k).map((r) => `<option value="${r.id}" ${setup.rigs[k] === r.id ? 'selected' : ''}>${esc(r.name.replace('Standup M-Set ', ''))}</option>`).join('')}
      </select></label>`;
    const autoImplant = implantFor(d, { ...setup, implant: -1 }, ctx.character);
    const families = new Map<string, Ore>();
    for (const o of d.ores) if (o.materials.length && o.skillId && !families.has(String(o.skillId))) families.set(String(o.skillId), o);
    const famRows = [...families.values()].sort((a, b) => ORE_KINDS.indexOf(a.kind) - ORE_KINDS.indexOf(b.kind) || (d.skills.get(a.skillId!)?.name ?? '').localeCompare(d.skills.get(b.skillId!)?.name ?? ''));
    const lvl = (id: number) => ctx.character.skills.get(id) ?? 0;
    const paste = loadJson<string>(PASTE_KEY, '');

    pane.innerHTML = `${panel({
      title: tx('Unde reprocesezi'),
      body: `<form class="form-grid recon-form nav-form" id="mineSetup">
          <label>${tx('Loc')}<select class="input" name="place">
            <option value="0">${tx('Stație NPC (50%)')}</option>
            ${d.structures.map((s) => `<option value="${s.id}" ${setup.place === s.id ? 'selected' : ''}>${esc(s.name)} (+${formatNum(s.bonus, 1)}%)</option>`).join('')}
          </select></label>
          ${rigSelect('ore')}${rigSelect('moon')}${rigSelect('ice')}
          <label>${tx('Securitate')}<select class="input" name="sec" ${structure ? '' : 'disabled'}>${([0, 1, 2] as Security[]).map((s) => `<option value="${s}" ${setup.sec === s ? 'selected' : ''}>${SECURITY_LABEL()[s]}</option>`).join('')}</select></label>
          <label>Implant<select class="input" name="implant">
            <option value="-1" ${setup.implant === -1 ? 'selected' : ''}>${autoImplant ? tx('Din clone: {name}', { name: esc(autoImplant.name) }) : tx('Din clone: niciunul')}</option>
            <option value="0" ${setup.implant === 0 ? 'selected' : ''}>${tx('Fără implant')}</option>
            ${d.implants.map((i) => `<option value="${i.id}" ${setup.implant === i.id ? 'selected' : ''}>${esc(i.name)} (+${i.pct}%)</option>`).join('')}
          </select></label>
          <label>${tx('Taxă (%)')}<input class="input nav-num" name="tax" type="number" min="0" max="100" step="0.1" value="${setup.tax}" /></label>
        </form>
        <p class="dim small">${tx('Rig-urile și securitatea contează doar în structuri. Taxa o vezi în fereastra de reprocesare din joc (în stațiile NPC depinde de standing).')}</p>`,
    })}
    ${panel({
      title: tx('Randament pe familie de ore'),
      body: `<div class="table-scroll"><table class="table compact"><thead><tr><th>Skill</th><th>${tx('Tip')}</th><th class="r">${tx('Nivel')}</th><th class="r">${tx('Randament')}</th></tr></thead><tbody>
        ${famRows.map((o, i) => {
          const y = yieldOf(o);
          tips.set(`fy${i}`, breakdownHtml(y, pct, baseLabel(d, setup, o)));
          const s = d.skills.get(o.skillId!);
          return `<tr><td>${esc(s?.name ?? '')}</td><td>${badge(KIND_LABEL()[o.kind])}</td><td class="r num">${roman(lvl(o.skillId!)) || '0'}</td><td class="r num accent" data-bd="fy${i}">${pct(y.value)}</td></tr>`;
        }).join('')}
        </tbody></table></div>
        <p class="dim small">${tx('Reprocessing {a} și Reprocessing Efficiency {b} pentru {name}. Treci cu mouse-ul peste randament pentru detalii.', { a: roman(lvl(3385)) || '0', b: roman(lvl(3389)) || '0', name: esc(ctx.character.name) })}</p>`,
    })}
    ${panel({
      title: tx('Calculator reprocesare'),
      body: `<label class="block-label">${tx('Lipește ore, gheață sau ore comprimat din inventar')}</label>
        <textarea class="input area" id="minePaste" rows="8" spellcheck="false" placeholder="${esc(tx('ex: Compressed Veldspar 120000'))}">${esc(paste)}</textarea>
        <div class="row-actions">${button(tx('Calculează'), { iconName: 'search', cls: 'sm', attrs: 'data-mine-calc' })}</div>
        <div id="mineCalc"></div>`,
    })}`;

    const form = pane.querySelector<HTMLFormElement>('#mineSetup')!;
    form.addEventListener('change', () => {
      const fd = new FormData(form);
      setup.place = Number(fd.get('place')) || 0;
      for (const k of ['ore', 'moon', 'ice'] as const) if (fd.has(`rig-${k}`)) setup.rigs[k] = Number(fd.get(`rig-${k}`)) || 0;
      if (fd.has('sec')) setup.sec = Number(fd.get('sec')) as Security;
      setup.implant = Number(fd.get('implant'));
      setup.tax = Math.max(0, Math.min(100, Number(fd.get('tax')) || 0));
      saveJson(SETUP_KEY, setup);
      renderRefine();
    });
    pane.querySelector('[data-mine-calc]')!.addEventListener('click', () => calculate());
    if (paste.trim()) calculate();
  }

  async function calculate() {
    const pane = panes.refine;
    const area = pane.querySelector<HTMLTextAreaElement>('#minePaste')!;
    const out = pane.querySelector<HTMLElement>('#mineCalc')!;
    saveJson(PASTE_KEY, area.value);
    const { lines, unknown } = parseItems(area.value);
    if (!lines.length) { out.innerHTML = unknown.length ? alertBox(tx('Nu recunosc: {list}', { list: esc(unknown.slice(0, 8).join(', ')) })) : ''; return; }
    out.innerHTML = loader(tx('Prețuri Jita'));
    try { await loadPrices(); } catch (err) { out.innerHTML = alertBox((err as Error).message); return; }
    const d = data!;
    const sell = price('sell');
    const buy = price('buy');
    const minerals = new Map<number, number>();
    const skipped: string[] = [...unknown];
    const leftovers: string[] = [];
    let rawBuy = 0, rawSell = 0;
    const rows = lines.flatMap((l) => {
      const ore = d.byId.get(l.typeId);
      if (!ore || !ore.materials.length) { skipped.push(l.name); return []; }
      const y = yieldOf(ore).value;
      const r = refine(ore, l.typeId, l.quantity, y);
      for (const o of r.outputs) minerals.set(o.id, (minerals.get(o.id) ?? 0) + o.qty);
      if (r.leftover) leftovers.push(`${formatInt(r.leftover)} ${l.name}`);
      const value = r.outputs.reduce((a, o) => a + o.qty * buy(o.id), 0) * (1 - setup.tax / 100);
      const b = buy(l.typeId) * l.quantity;
      const s = sell(l.typeId) * l.quantity;
      rawBuy += b;
      rawSell += s;
      return [{ l, y, value, b, s }];
    });
    const minRows = [...minerals].sort((a, b) => b[1] * buy(b[0]) - a[1] * buy(a[0]));
    const refBuy = minRows.reduce((a, [id, q]) => a + q * buy(id), 0) * (1 - setup.tax / 100);
    const refSell = minRows.reduce((a, [id, q]) => a + q * sell(id), 0) * (1 - setup.tax / 100);
    const verdict = refBuy > rawBuy ? tx('Reprocesarea câștigă cu {isk} față de vânzarea brută la buy.', { isk: compactISK(refBuy - rawBuy) }) : tx('Vânzarea brută câștigă cu {isk} față de reprocesare (la buy).', { isk: compactISK(rawBuy - refBuy) });
    out.innerHTML = `${rows.length ? `<div class="history-kpis">
        <div><span class="label">${tx('Brut · buy')}</span><span class="value">${compactISK(rawBuy)}</span></div>
        <div><span class="label">${tx('Brut · sell')}</span><span class="value">${compactISK(rawSell)}</span></div>
        <div><span class="label">${tx('Reprocesat · buy')}</span><span class="value ${refBuy > rawBuy ? 'accent' : ''}">${compactISK(refBuy)}</span></div>
        <div><span class="label">${tx('Reprocesat · sell')}</span><span class="value">${compactISK(refSell)}</span></div>
      </div>
      <p>${verdict}</p>
      <div class="mine-calc-grid">
        <div class="table-scroll"><table class="table compact"><thead><tr><th>${tx('Intrare')}</th><th class="r">${tx('Cantitate')}</th><th class="r">${tx('Randament')}</th><th class="r">${tx('Brut · buy')}</th><th class="r">${tx('Reprocesat · buy')}</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td><span class="nav-ship-name"><img class="row-icon" src="${typeIconUrl(r.l.typeId, 32)}" alt="" />${esc(r.l.name)}</span></td><td class="r num">${formatInt(r.l.quantity)}</td><td class="r num">${pct(r.y)}</td>${iskCell(r.b, r.b >= r.value)}${iskCell(r.value, r.value > r.b)}</tr>`).join('')}
        </tbody></table></div>
        <div class="table-scroll"><table class="table compact"><thead><tr><th>${tx('Mineral')}</th><th class="r">${tx('Cantitate')}</th><th class="r">${tx('Buy max')}</th><th class="r">${tx('Valoare')}</th></tr></thead><tbody>
          ${minRows.map(([id, q]) => `<tr><td><span class="nav-ship-name"><img class="row-icon" src="${typeIconUrl(id, 32)}" alt="" />${esc(d.minerals.get(id) ?? `#${id}`)}</span></td><td class="r num">${formatInt(q)}</td><td class="r num">${formatISK(buy(id))}</td><td class="r num">${compactISK(q * buy(id))}</td></tr>`).join('')}
        </tbody></table></div>
      </div>` : ''}
      ${leftovers.length ? `<p class="dim small">${tx('Rămân nereprocesate (sub o porție): {list}', { list: esc(leftovers.join(', ')) })}</p>` : ''}
      ${skipped.length ? alertBox(tx('Ignorat (nu e ore, gheață sau ore comprimat): {list}', { list: esc([...new Set(skipped)].slice(0, 12).join(', ')) })) : ''}`;
  }

  function renderOres() {
    const pane = panes.ores;
    tips.clear();
    const d = data!;
    const p = price(oresForm.basis);
    const q = oresForm.q.trim().toLowerCase();
    const rows = d.ores
      .filter((o) => oresForm.kind === 'all' || o.kind === oresForm.kind)
      .filter((o) => !q || o.name.toLowerCase().includes(q) || o.group.toLowerCase().includes(q))
      .map((o) => {
        const y = yieldOf(o);
        const v = oreValuePerM3(o, y.value, p, setup.tax);
        return { o, y, v, best: Math.max(v.raw, v.compressed, v.refined) };
      })
      .sort((a, b) => b.best - a.best);
    pane.innerHTML = panel({
      body: `<form class="form-grid recon-form nav-form" id="mineOresForm">
          <label>${tx('Preț Jita')}<select class="input" name="basis">
            <option value="buy" ${oresForm.basis === 'buy' ? 'selected' : ''}>${tx('Buy max (vânzare instant)')}</option>
            <option value="sell" ${oresForm.basis === 'sell' ? 'selected' : ''}>${tx('Sell min (ordin de vânzare)')}</option>
          </select></label>
          <label>${tx('Tip')}<select class="input" name="kind"><option value="all">${tx('Toate')}</option>${ORE_KINDS.map((k) => `<option value="${k}" ${oresForm.kind === k ? 'selected' : ''}>${KIND_LABEL()[k]}</option>`).join('')}</select></label>
          <label>${tx('Caută')}<input class="input" name="q" value="${esc(oresForm.q)}" autocomplete="off" spellcheck="false" /></label>
          <button class="btn" type="submit">${tx('Filtrează')}</button>
        </form>
        <div class="table-scroll"><table class="table compact mine-table"><thead><tr>
          <th>Ore</th><th class="r">m³ / ${tx('unitate')}</th><th class="r">${tx('Brut ISK/m³')}</th><th class="r">${tx('Comprimat ISK/m³')}</th><th class="r">${tx('Reprocesat ISK/m³')}</th><th class="r">${tx('Randament')}</th><th class="r">${tx('Reprocesat vs brut')}</th><th>${tx('Recomandare')}</th>
        </tr></thead><tbody>${rows.map((r, i) => {
          tips.set(`or${i}`, breakdownHtml(r.y, pct, baseLabel(d, setup, r.o)));
          const diff = r.v.raw > 0 && r.v.refined > 0 ? r.v.refined / r.v.raw - 1 : null;
          return `<tr>
            <td><span class="nav-ship-name"><img class="row-icon" src="${typeIconUrl(r.o.id, 32)}" alt="" />${esc(r.o.name)}</span><div class="dim small">${esc(r.o.group)}</div></td>
            <td class="r num">${formatNum(r.o.volume, r.o.volume < 1 ? 2 : 0)}</td>
            ${iskCell(r.v.raw, r.v.best === 'raw')}
            ${iskCell(r.v.compressed, r.v.best === 'compressed')}
            ${iskCell(r.v.refined, r.v.best === 'refined')}
            <td class="r num" ${r.o.materials.length ? `data-bd="or${i}"` : ''}>${r.o.materials.length ? pct(r.y.value) : '<span class="dim">—</span>'}</td>
            <td class="r num ${diff == null ? '' : diff > 0 ? 'up' : 'down'}">${diff == null ? '<span class="dim">—</span>' : `${diff > 0 ? '+' : ''}${formatNum(diff * 100, 1)}%`}</td>
            <td>${r.best > 0 ? badge(VALUE_LABEL()[r.v.best], r.v.best === 'refined' ? 'accent' : '') : '<span class="dim">' + tx('fără ordine în Jita') + '</span>'}</td>
          </tr>`;
        }).join('')}</tbody></table></div>
        <p class="dim small">${tx('Valori pe m³ de ore necomprimat, deci comparabile direct cu m³/h din tab-ul Randament. Reprocesat folosește setările de la Reprocesare ({place}) și skill-urile caracterului activ.', { place: esc(placeName()) })}</p>`,
    });
    const form = pane.querySelector<HTMLFormElement>('#mineOresForm')!;
    const update = (e?: Event) => {
      e?.preventDefault();
      const fd = new FormData(form);
      oresForm.basis = fd.get('basis') === 'sell' ? 'sell' : 'buy';
      oresForm.kind = String(fd.get('kind') ?? 'all') as OreKind | 'all';
      oresForm.q = String(fd.get('q') ?? '');
      saveJson(ORES_KEY, oresForm);
      renderOres();
    };
    form.addEventListener('submit', update);
    form.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => update()));
  }

  renderTabs();
}
