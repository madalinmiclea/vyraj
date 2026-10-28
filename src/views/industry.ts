import '../styles/industry.css';
import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, formatInt, formatNum, formatISK, compactISK, emptyState, windowTitle, badge, dataStamp, button, copyText, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { fetchPrices, forgetPrices, pricesAt, typeIconUrl, type Aggregates } from '../services/market';
import { feesFromSkills } from '../services/intel';
import { loadMap, displaySec, secClass, type NavMap } from '../services/navigation';
import { hasScope, loginProblem } from '../character/sso';
import { permissionGate } from '../character/permissions';
import { bindBreakdownTips, breakdownHtml, type Breakdown } from '../ui/breakdown';
import {
  loadIndustry, adjustedPrices, costIndices, ownedBlueprints, industryJobs, computeBuild, facilityBonus,
  FACILITIES, ACTIVITY, SCC_SURCHARGE, INVENTION_EIV_SHARE,
  type IndustryData, type Blueprint, type Facility, type BuildResult, type Basis, type Decryptor, type OwnedBlueprint, type IndustryJob, type CostIndices,
} from '../services/industry';
import { tx } from '../i18n';

type Tab = 'calc' | 'mine' | 'jobs';

const TABS: { id: Tab; label: string }[] = [
  { id: 'calc', label: tx('Calculator') },
  { id: 'mine', label: tx('Blueprint-urile mele') },
  { id: 'jobs', label: tx('Joburi active') },
];

const TAB_KEY = 'eve-industry:tab';
const SETTINGS_KEY = 'eve-industry:settings';
const CALC_KEY = 'eve-industry:calc';
const BP_SCOPE = 'esi-characters.read_blueprints.v1';
const JOB_SCOPE = 'esi-industry.read_character_jobs.v1';

interface Settings { facility: string; rig: string; system: string; tax: number; basis: Basis }
interface CalcForm { product: string; me: number; te: number; runs: number; source: 'invention' | 'own'; decryptor: number }

const duration = (s: number) => {
  const t = Math.max(0, Math.round(s));
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60);
  if (d) return `${d}d ${h}h ${String(m).padStart(2, '0')}m`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(t % 60).padStart(2, '0')}s`;
};

const isk = (n: number) => `${compactISK(n)} <span class="unit">ISK</span>`;
const signed = (n: number) => `<span class="${n >= 0 ? 'pos' : 'neg'}">${n >= 0 ? '+' : '−'}${compactISK(Math.abs(n))}</span>`;
const pct = (n: number) => `<span class="${n >= 0 ? 'pos' : 'neg'}">${formatNum(n, 1)}%</span>`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

const SHARE_PREFIX = '#build=';

const encodeShare = (o: unknown) => {
  let bin = '';
  new TextEncoder().encode(JSON.stringify(o)).forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function decodeShare(code: string): Record<string, unknown> | null {
  try {
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return o && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function createIndustryView(el: HTMLElement, ctx: AppContext, side: HTMLElement) {
  let tab = loadJson<Tab>(TAB_KEY, 'calc');
  if (!TABS.some((t) => t.id === tab)) tab = 'calc';
  const settings: Settings = { facility: 'npc', rig: 'none', system: 'Jita', tax: 0.25, basis: 'sell', ...loadJson<Partial<Settings>>(SETTINGS_KEY, {}) };
  const calc: CalcForm = { product: '', me: 10, te: 20, runs: 1, source: 'invention', decryptor: 0, ...loadJson<Partial<CalcForm>>(CALC_KEY, {}) };

  el.innerHTML = `${pageHead(tx('Industrie'), tx('Cost de fabricație și invenție comparat cu prețul de vânzare din Jita'), 'Matterweave', { hub: true })}
    <div id="indSettings"></div>
    <div id="indCalc"></div>
    <div id="indMine"></div>
    <div id="indJobs"></div>
    <datalist id="indProducts"></datalist>
    <datalist id="indSystems"></datalist>`;
  const settingsEl = el.querySelector<HTMLElement>('#indSettings')!;
  const panes: Record<Tab, HTMLElement> = {
    calc: el.querySelector<HTMLElement>('#indCalc')!,
    mine: el.querySelector<HTMLElement>('#indMine')!,
    jobs: el.querySelector<HTMLElement>('#indJobs')!,
  };
  const productList = el.querySelector<HTMLDataListElement>('#indProducts')!;
  const systemList = el.querySelector<HTMLDataListElement>('#indSystems')!;
  const tips = new Map<string, string>();
  bindBreakdownTips(el, (k) => tips.get(k));

  let data: IndustryData | null = null;
  let map: NavMap | null = null;
  let lastBuild: { d: IndustryData; r: BuildResult } | null = null;
  let priceIds: number[] = [];

  async function jitaPrices(ids: number[]) {
    const p = await fetchPrices(ids);
    priceIds = ids;
    renderStamp();
    return p;
  }

  function renderStamp() {
    const box = side.querySelector<HTMLElement>('.side-stamp');
    if (box) box.innerHTML = tab === 'jobs' ? '' : dataStamp(pricesAt(priceIds), 'data-ind-prices');
  }
  const ready = Promise.all([loadIndustry(), loadMap().catch(() => null)]).then(([d, m]) => { data = d; map = m; return d; });

  const skillName = (id: number) => ctx.sde.types.get(id)?.name ?? data?.name(id) ?? `#${id}`;
  const nameOf = (id: number) => data?.name(id) ?? ctx.sde.types.get(id)?.name ?? `#${id}`;
  const fees = () => feesFromSkills(ctx.character.skills);

  async function facility(reaction: boolean): Promise<{ f: Facility; note: string; systemOk: boolean }> {
    const preset = FACILITIES.find((p) => p.id === settings.facility) ?? FACILITIES[0];
    const sys = map?.find(settings.system) ?? null;
    const b = facilityBonus(preset, settings.rig, sys?.sec ?? null);
    const all = await costIndices().catch(() => new Map<number, CostIndices>());
    const index = (sys && all.get(sys.id)) || { manufacturing: 0, invention: 0, reaction: 0 };
    const mismatch = preset.reaction !== reaction && preset.id !== 'npc';
    const note = mismatch ? tx('{name} nu face acest tip de job; bonusurile structurii pot să nu se aplice.', { name: preset.name }) : '';
    return { f: { me: b.me, te: b.te, costBonus: preset.costBonus, tax: settings.tax, index }, note, systemOk: Boolean(sys) };
  }

  function saveSettings() {
    saveJson(SETTINGS_KEY, settings);
  }

  function renderSettings() {
    const sys = map?.find(settings.system);
    settingsEl.innerHTML = panel({
      title: tx('Locul de producție'),
      body: `<form class="form-grid ind-settings" id="indSettingsForm">
        <label>${tx('Structură')}<select class="input" name="facility">${FACILITIES.map((p) => `<option value="${p.id}" ${p.id === settings.facility ? 'selected' : ''}>${esc(p.id === 'npc' ? tx('Stație NPC') : p.name)}</option>`).join('')}</select></label>
        <label>${tx('Rig')}<select class="input" name="rig">
          <option value="none" ${settings.rig === 'none' ? 'selected' : ''}>${tx('Fără rig')}</option>
          <option value="t1" ${settings.rig === 't1' ? 'selected' : ''}>T1</option>
          <option value="t2" ${settings.rig === 't2' ? 'selected' : ''}>T2</option>
        </select></label>
        <label>${tx('Sistem')}<input class="input" name="system" data-list="indSystems" value="${esc(settings.system)}" autocomplete="off" spellcheck="false" /></label>
        <label>${tx('Taxă facilitate %')}<input class="input ind-num" name="tax" type="number" min="0" max="50" step="0.01" value="${settings.tax}" /></label>
        <div class="advice-sort ind-basis">
          <span class="dim small">${tx('Materiale la')}</span>
          <button type="button" class="chip-btn ${settings.basis === 'sell' ? 'active' : ''}" data-basis="sell">${tx('Jita vânzare')}</button>
          <button type="button" class="chip-btn ${settings.basis === 'buy' ? 'active' : ''}" data-basis="buy">${tx('Jita cumpărare')}</button>
        </div>
      </form>
      <p class="dim small" id="indFacilityNote">${sys ? `${esc(sys.name)} <span class="num ${secClass(sys.sec)}">${formatNum(displaySec(sys.sec), 1)}</span> · ` : ''}${tx('Taxele de vânzare vin din skill-urile caracterului activ: taxă de vânzare {t}%, comision broker {b}%.', { t: formatNum(fees().salesTax, 2), b: formatNum(fees().brokerFee, 2) })}</p>`,
    });
  }

  settingsEl.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'facility') settings.facility = t.value;
    else if (t.name === 'rig') settings.rig = t.value;
    else if (t.name === 'system') settings.system = t.value.trim();
    else if (t.name === 'tax') settings.tax = clamp(Number(t.value), 0, 50);
    else return;
    saveSettings();
    renderSettings();
    refresh();
  });
  settingsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-basis]');
    if (!b) return;
    settings.basis = b.dataset.basis as Basis;
    saveSettings();
    renderSettings();
    refresh();
  });

  el.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const list = input.dataset.list;
    if (list === 'indSystems' && map) systemList.innerHTML = map.suggest(input.value).map((s) => `<option value="${esc(s.name)}">${esc(map!.region(s))} · ${formatNum(displaySec(s.sec), 1)}</option>`).join('');
    if (list === 'indProducts' && data) productList.innerHTML = data.suggest(input.value).map((b) => `<option value="${esc(data!.name(b.productId))}">${esc(data!.group(b.productId))}</option>`).join('');
  });

  function renderTabs() {
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Industrie'))}</div>
      <div class="side-nav">${TABS.map((t) => `<button class="side-link ${t.id === tab ? 'active' : ''}" data-ind-tab="${t.id}">${t.label}</button>`).join('')}</div>
      <div class="side-stamp"></div>`;
    renderStamp();
    for (const [id, pane] of Object.entries(panes)) pane.hidden = id !== tab;
    settingsEl.hidden = tab === 'jobs';
  }

  side.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-ind-prices]')) {
      forgetPrices(priceIds);
      refresh();
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ind-tab]');
    if (!b) return;
    tab = b.dataset.indTab as Tab;
    saveJson(TAB_KEY, tab);
    renderTabs();
    refresh();
  });

  function failed(pane: HTMLElement, err: unknown) {
    pane.innerHTML = panel({ body: alertBox((err as Error).message) });
  }

  function esiCharacter(scope: string): number | string {
    const c = ctx.character;
    const problem = loginProblem(c);
    if (problem || !c.characterId) return problem ?? '';
    if (!hasScope(c.characterId, scope)) return 'scope';
    return c.characterId;
  }

  function allIds(bps: Blueprint[], d: IndustryData, withInvention: boolean): number[] {
    const ids = new Set<number>();
    for (const bp of bps) {
      ids.add(bp.productId);
      bp.mats.forEach(([id]) => ids.add(id));
      const inv = withInvention ? d.inventions.get(bp.id) : undefined;
      inv?.mats.forEach(([id]) => ids.add(id));
    }
    if (withInvention) d.decryptors.forEach((x) => ids.add(x.id));
    return [...ids];
  }

  const labels = () => ({ te: tx('TE blueprint'), facility: tx('Structură + rig'), skill: skillName });

  function costBreakdown(r: BuildResult): Breakdown {
    const parts = [{ label: tx('cost job / unitate'), delta: r.jobCost / r.units }];
    if (r.invention) parts.push({ label: tx('invenție / unitate'), delta: r.invention.perUnit });
    return { base: r.matCost / r.units, parts, value: r.costUnit };
  }

  function timeBreakdown(r: BuildResult): Breakdown {
    let prev = r.baseTime;
    const parts = r.timeParts.map((p) => {
      const next = prev * p.factor;
      const delta = next - prev;
      prev = next;
      return { label: p.label, delta };
    });
    return { base: r.baseTime, parts, value: r.time };
  }

  function jobTip(r: BuildResult, f: Facility) {
    const idx = r.bp.reaction ? f.index.reaction : f.index.manufacturing;
    return `<div class="bd-row"><span class="num">${formatISK(r.eiv, 0)}</span><span class="dim">(${tx('valoare estimată EIV')})</span></div>
      <div class="bd-row"><span class="num up">+${formatISK(r.jobGross, 0)}</span><span class="dim">(${tx('cost index {n}%', { n: formatNum(idx * 100, 2) })})</span></div>
      ${r.jobBonus ? `<div class="bd-row"><span class="num down">−${formatISK(r.jobBonus, 0)}</span><span class="dim">(${tx('bonus structură {n}%', { n: formatNum(f.costBonus, 0) })})</span></div>` : ''}
      <div class="bd-row"><span class="num up">+${formatISK(r.jobTax, 0)}</span><span class="dim">(${tx('taxă facilitate {t}% + SCC {s}%', { t: formatNum(f.tax, 2), s: formatNum(SCC_SURCHARGE * 100, 0) })})</span></div>
      <div class="bd-row bd-total"><span class="num">${formatISK(r.jobCost, 0)}</span><span class="dim">(${tx('total')})</span></div>`;
  }

  async function renderCalc() {
    const pane = panes.calc;
    const d = data ?? (await ready);
    const bp = calc.product ? d.find(calc.product) : undefined;
    const inv = bp ? d.inventions.get(bp.id) : undefined;
    pane.innerHTML = `${panel({
      body: `<form class="form-grid ind-form" id="indCalcForm">
          <label class="ind-product">${tx('Produs sau blueprint')}<input class="input" name="product" data-list="indProducts" value="${esc(calc.product)}" placeholder="${esc(tx('ex: Hammerhead II'))}" autocomplete="off" spellcheck="false" /></label>
          <label>Runs<input class="input ind-num" name="runs" type="number" min="1" max="10000" step="1" value="${calc.runs}" /></label>
          ${inv ? `<label>${tx('Sursă blueprint')}<select class="input" name="source">
            <option value="invention" ${calc.source === 'invention' ? 'selected' : ''}>Invention</option>
            <option value="own" ${calc.source === 'own' ? 'selected' : ''}>${tx('BPC propriu')}</option>
          </select></label>` : ''}
          ${inv && calc.source === 'invention' ? `<label>${tx('Decryptor')}<select class="input" name="decryptor"><option value="0">${tx('Fără decryptor')}</option>${d.decryptors.map((x) => `<option value="${x.id}" ${x.id === calc.decryptor ? 'selected' : ''}>${esc(d.name(x.id))}</option>`).join('')}</select></label>`
          : `<label>ME<input class="input ind-num" name="me" type="number" min="0" max="10" step="1" value="${calc.me}" /></label>
          <label>TE<input class="input ind-num" name="te" type="number" min="0" max="20" step="2" value="${calc.te}" /></label>`}
          <button class="btn" type="submit">${icon('search')}${tx('Calculează')}</button>
        </form>`,
    })}<div id="indCalcResult"></div>`;
    const result = pane.querySelector<HTMLElement>('#indCalcResult')!;
    if (!calc.product) {
      result.innerHTML = panel({ body: emptyState({ title: tx('Alege un produs'), text: tx('Scrie numele unui item care se fabrică (navă, modul, muniție, componentă) sau deschide unul din Blueprint-urile mele.') }) });
      return;
    }
    if (!bp) {
      result.innerHTML = panel({ body: alertBox(tx('Nu găsesc un blueprint care produce „{name}”.', { name: calc.product })) });
      return;
    }
    result.innerHTML = loader(tx('Calculez costul de producție'));
    try {
      const useInv = inv && calc.source === 'invention' ? inv : null;
      const [prices, adjusted, fac] = await Promise.all([jitaPrices(allIds([bp], d, Boolean(useInv))), adjustedPrices(), facility(bp.reaction)]);
      const base = { bp, runs: calc.runs, me: calc.me, te: calc.te, facility: fac.f, basis: settings.basis, fees: fees(), skills: ctx.character.skills, prices, adjusted, labels: labels() };
      const dec = d.decryptors.find((x) => x.id === calc.decryptor) ?? null;
      const r = computeBuild({ ...base, invention: useInv ? { inv: useInv, decryptor: dec } : null });
      lastBuild = { d, r };
      result.innerHTML = buildHtml(d, r, fac.f, prices, fac.note, fac.systemOk);
      if (useInv) result.insertAdjacentHTML('beforeend', inventionHtml(d, r, (decryptor) => computeBuild({ ...base, invention: { inv: useInv, decryptor } })));
    } catch (err) {
      failed(result, err);
    }
  }

  function buildHtml(d: IndustryData, r: BuildResult, f: Facility, prices: Map<number, Aggregates>, note: string, systemOk: boolean) {
    const money = (n: number) => `${formatISK(n, 2)} ISK`;
    tips.set('cost', breakdownHtml(costBreakdown(r), money, tx('materiale / unitate')));
    tips.set('time', breakdownHtml(timeBreakdown(r), duration, tx('timp de bază')));
    tips.set('job', jobTip(r, f));
    tips.set('profit', breakdownHtml({ base: r.netSellUnit, parts: [{ label: tx('cost / unitate'), delta: -r.costUnit }], value: r.profitUnit }, money, tx('Vânzare Jita după taxe')));
    const p = prices.get(r.bp.productId);
    const warn = [
      note,
      systemOk ? '' : tx('Nu găsesc sistemul „{name}”; cost index-ul e 0.', { name: settings.system }),
      p?.sellMin ? '' : tx('Produsul nu are ordine de vânzare în Jita.'),
      r.mats.some((m) => !m.unit) ? tx('Unele materiale nu au preț în Jita și sunt socotite 0.') : '',
    ].filter(Boolean);
    const total = r.matCost + r.jobCost + (r.invention ? r.invention.perUnit * r.units : 0);
    return `${panel({
      title: d.name(r.bp.productId),
      count: `${formatInt(r.units)} ${tx('buc')}`,
      actions: `${button(tx('Copiază Multibuy'), { iconName: 'copy', cls: 'ghost sm', attrs: `data-ind-multibuy title="${esc(tx('Lista de materiale, gata de lipit în fereastra Multibuy din joc'))}"` })}${button(tx('Copiază link'), { iconName: 'link', cls: 'ghost sm', attrs: `data-ind-share title="${esc(tx('Link care deschide același calcul: produs, runs, ME, TE și locul de producție'))}"` })}`,
      body: `<div class="ind-head"><img class="ind-icon" src="${typeIconUrl(r.bp.productId, 64)}" alt="" />
          <div><div class="dim small">${esc(d.category(r.bp.productId))} · ${esc(d.group(r.bp.productId))}${r.bp.reaction ? ` · ${badge('Reaction')}` : ''}</div>
          <div class="dim small">${esc(d.name(r.bp.id))} · ${r.invention ? `ME ${r.invention.me} · TE ${r.invention.te} (invention)` : r.bp.reaction ? '' : `ME ${calc.me} · TE ${calc.te}`}</div></div></div>
        <div class="history-kpis ind-kpis">
          <div data-bd="cost"><span class="label">${tx('Cost / unitate')}</span><span class="value">${isk(r.costUnit)}</span></div>
          <div><span class="label">${tx('Jita vânzare')}</span><span class="value">${r.sellUnit ? isk(r.sellUnit) : '—'}</span></div>
          <div data-bd="profit"><span class="label">${tx('Profit / unitate')}</span><span class="value">${r.sellUnit ? signed(r.profitUnit) : '—'}</span></div>
          <div><span class="label">${tx('Marjă')}</span><span class="value">${r.sellUnit ? pct(r.margin) : '—'}</span></div>
          <div><span class="label">${tx('ISK / oră')}</span><span class="value">${r.sellUnit ? signed(r.iskHour) : '—'}</span></div>
          <div data-bd="time"><span class="label">${tx('Timp job')}</span><span class="value">${duration(r.time)}</span></div>
        </div>
        ${warn.map((w) => alertBox(w, 'warn')).join('')}
        <div class="table-scroll"><table class="table compact ind-table"><thead><tr><th>${tx('Material')}</th><th class="r">${tx('Bază / run')}</th><th class="r">${tx('Cantitate')}</th><th class="r">${tx('Preț unitar')}</th><th class="r">Total</th><th></th></tr></thead><tbody>
          ${r.mats.map((m) => `<tr><td><img class="row-icon" src="${typeIconUrl(m.id, 32)}" alt="" />${esc(d.name(m.id))}</td><td class="r num">${formatInt(m.base)}</td><td class="r num">${formatInt(m.qty)}</td><td class="r num">${m.unit ? formatISK(m.unit) : '—'}</td><td class="r num">${compactISK(m.total)}</td><td class="r">${d.byProduct.has(m.id) ? `<button class="btn ghost sm" data-open="${esc(d.name(m.id))}" title="${esc(tx('Deschide în calculator'))}">${icon('blueprint')}</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <table class="table compact ind-sum"><tbody>
          <tr><td>${tx('Materiale')}</td><td class="r num">${formatISK(r.matCost, 0)}</td></tr>
          <tr data-bd="job"><td>${tx('Cost job')}</td><td class="r num">${formatISK(r.jobCost, 0)}</td></tr>
          ${r.invention ? `<tr><td>${tx('Invenție ({n} unități)', { n: formatInt(r.units) })}</td><td class="r num">${formatISK(r.invention.perUnit * r.units, 0)}</td></tr>` : ''}
          <tr class="ind-total"><td>${tx('Cost total')}</td><td class="r num">${formatISK(total, 0)}</td></tr>
          <tr><td>${tx('Vânzare cu ordin de vânzare (după broker și taxă)')}</td><td class="r num">${formatISK(r.netSellUnit * r.units, 0)}</td></tr>
          <tr><td>${tx('Vânzare instant în ordinele de cumpărare (după taxă)')}</td><td class="r num">${formatISK(r.netBuyUnit * r.units, 0)} · ${r.buyUnit ? signed(r.profitInstantUnit * r.units) : '—'}</td></tr>
        </tbody></table>
        <p class="dim small">${tx('Treci cu mouse-ul peste cost, profit, timp și cost job pentru detalii. Timpul folosește skill-urile caracterului activ ({name}).', { name: esc(ctx.character.name) })}</p>`,
    })}`;
  }

  function inventionHtml(d: IndustryData, r: BuildResult, variant: (dec: Decryptor | null) => BuildResult) {
    const iv = r.invention!;
    const rows = [null, ...d.decryptors].map((dec) => ({ dec, r: dec?.id === iv.decryptor?.id || (!dec && !iv.decryptor) ? r : variant(dec) }));
    const best = rows.reduce((a, b) => (b.r.iskHour > a.r.iskHour ? b : a), rows[0]);
    return panel({
      title: tx('Invenție'),
      body: `<div class="history-kpis ind-kpis">
          <div><span class="label">${tx('Șansă')}</span><span class="value accent">${formatNum(iv.chance * 100, 1)}%</span></div>
          <div><span class="label">${tx('Runs / BPC')}</span><span class="value">${formatInt(iv.runs)}</span></div>
          <div><span class="label">ME / TE</span><span class="value">${iv.me} / ${iv.te}</span></div>
          <div><span class="label">${tx('Cost / încercare')}</span><span class="value">${isk(iv.attempt)}</span></div>
          <div><span class="label">${tx('Invenție / unitate')}</span><span class="value">${isk(iv.perUnit)}</span></div>
        </div>
        <p class="dim small">${tx('Din {name}. Skill-uri: {skills}. Cost job = {p}% din EIV-ul produsului × indicele de cost pentru invenție.', { name: esc(d.name(iv.inv.sourceId)), skills: iv.skillLevels.map((s) => `${esc(skillName(s.id))} ${s.level}`).join(', '), p: formatNum(INVENTION_EIV_SHARE * 100, 0) })}</p>
        <div class="table-scroll"><table class="table compact ind-table"><thead><tr><th>${tx('Material')}</th><th class="r">${tx('Cantitate')}</th><th class="r">${tx('Preț unitar')}</th><th class="r">Total</th></tr></thead><tbody>
          ${iv.mats.map((m) => `<tr><td><img class="row-icon" src="${typeIconUrl(m.id, 32)}" alt="" />${esc(d.name(m.id))}</td><td class="r num">${formatInt(m.qty)}</td><td class="r num">${m.unit ? formatISK(m.unit) : '—'}</td><td class="r num">${compactISK(m.total)}</td></tr>`).join('')}
          <tr><td>${tx('Cost job invenție')}</td><td></td><td></td><td class="r num">${compactISK(iv.jobCost)}</td></tr>
        </tbody></table></div>
        <div class="section-title">${tx('Comparație decryptori')}</div>
        <div class="table-scroll"><table class="table compact ind-table ind-dec"><thead><tr><th>${tx('Decryptor')}</th><th class="r">${tx('Șansă')}</th><th class="r">Runs</th><th class="r">ME / TE</th><th class="r">${tx('Cost / unitate')}</th><th class="r">${tx('Profit / unitate')}</th><th class="r">${tx('ISK / oră')}</th></tr></thead><tbody>
          ${rows.map(({ dec, r: x }) => `<tr class="clickable ${x === r ? 'active' : ''} ${x === best.r ? 'best' : ''}" data-dec="${dec?.id ?? 0}"><td>${dec ? `<img class="row-icon" src="${typeIconUrl(dec.id, 32)}" alt="" />${esc(d.name(dec.id))}` : tx('Fără decryptor')}</td><td class="r num">${formatNum(x.invention!.chance * 100, 1)}%</td><td class="r num">${x.invention!.runs}</td><td class="r num">${x.invention!.me} / ${x.invention!.te}</td><td class="r num">${compactISK(x.costUnit)}</td><td class="r">${x.sellUnit ? signed(x.profitUnit) : '—'}</td><td class="r">${x.sellUnit ? signed(x.iskHour) : '—'}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="dim small">${tx('ISK / oră ține cont doar de timpul de fabricație. Click pe un rând ca să folosești acel decryptor.')}</p>`,
    });
  }

  panes.calc.addEventListener('submit', (e) => {
    e.preventDefault();
    readCalc();
    renderCalc();
  });
  panes.calc.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches('select')) { readCalc(); renderCalc(); }
  });
  function multibuy() {
    if (!lastBuild) return;
    const { d, r } = lastBuild;
    const lines = r.mats.filter((m) => m.qty > 0).map((m) => `${d.name(m.id)} ${m.qty}`);
    copyText(lines.join('\n'), tx('Lista Multibuy e în clipboard. În joc: Piață, Multibuy, Import din clipboard.'));
  }

  function shareLink() {
    const code = encodeShare({ v: 1, c: { product: calc.product, me: calc.me, te: calc.te, runs: calc.runs, source: calc.source, decryptor: calc.decryptor }, s: settings });
    copyText(`${location.origin}${location.pathname}${SHARE_PREFIX}${code}`, tx('Linkul calculului e în clipboard'));
  }

  function applyShared(): boolean {
    if (!location.hash.startsWith(SHARE_PREFIX)) return false;
    const o = decodeShare(location.hash.slice(SHARE_PREFIX.length));
    history.replaceState(null, '', `${location.pathname}${location.search}#/industry`);
    const c = o?.c as Record<string, unknown> | undefined;
    const st = o?.s as Record<string, unknown> | undefined;
    const product = str(c?.product, 120);
    if (!c || !product) { toast(tx('Linkul de industrie nu e valid sau e incomplet.')); return false; }
    calc.product = product;
    calc.runs = clamp(Math.floor(num(c.runs) ?? 1), 1, 10000);
    calc.me = clamp(Math.floor(num(c.me) ?? 10), 0, 10);
    calc.te = clamp(Math.floor(num(c.te) ?? 20), 0, 20);
    calc.source = c.source === 'own' ? 'own' : 'invention';
    calc.decryptor = Math.max(0, Math.floor(num(c.decryptor) ?? 0));
    if (st) {
      const facility = str(st.facility, 40);
      if (facility && FACILITIES.some((f) => f.id === facility)) settings.facility = facility;
      if (st.rig === 'none' || st.rig === 't1' || st.rig === 't2') settings.rig = st.rig;
      const system = str(st.system, 60);
      if (system) settings.system = system;
      settings.tax = clamp(num(st.tax) ?? settings.tax, 0, 50);
      if (st.basis === 'sell' || st.basis === 'buy') settings.basis = st.basis;
      saveSettings();
    }
    saveJson(CALC_KEY, calc);
    tab = 'calc';
    saveJson(TAB_KEY, tab);
    toast(tx('Calcul deschis din link: {name}', { name: product }));
    return true;
  }

  panes.calc.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-ind-multibuy]')) { multibuy(); return; }
    if (t.closest('[data-ind-share]')) { shareLink(); return; }
    const open = t.closest<HTMLElement>('[data-open]');
    if (open) { openProduct(open.dataset.open!, { source: 'invention' }); return; }
    const dec = t.closest<HTMLElement>('[data-dec]');
    if (dec) { calc.decryptor = Number(dec.dataset.dec); saveJson(CALC_KEY, calc); renderCalc(); }
  });

  function readCalc() {
    const form = panes.calc.querySelector<HTMLFormElement>('#indCalcForm');
    if (!form) return;
    const fd = new FormData(form);
    calc.product = String(fd.get('product') ?? '').trim();
    calc.runs = clamp(Math.floor(Number(fd.get('runs'))), 1, 10000);
    if (fd.has('me')) calc.me = clamp(Math.floor(Number(fd.get('me'))), 0, 10);
    if (fd.has('te')) calc.te = clamp(Math.floor(Number(fd.get('te'))), 0, 20);
    if (fd.has('source')) calc.source = fd.get('source') === 'own' ? 'own' : 'invention';
    if (fd.has('decryptor')) calc.decryptor = Number(fd.get('decryptor')) || 0;
    saveJson(CALC_KEY, calc);
  }

  function openProduct(name: string, extra: Partial<CalcForm>) {
    Object.assign(calc, { product: name }, extra);
    saveJson(CALC_KEY, calc);
    tab = 'calc';
    saveJson(TAB_KEY, tab);
    renderTabs();
    renderCalc();
    el.scrollIntoView({ block: 'start' });
  }

  let mineSeq = 0;
  async function renderMine() {
    const pane = panes.mine;
    const seq = ++mineSeq;
    const who = esiCharacter(BP_SCOPE);
    if (typeof who === 'string') { pane.innerHTML = panel({ body: who === 'scope' ? permissionGate('industry', ctx.character.characterId!, ctx.character.name) : alertBox(who || tx('Selectează un caracter importat din EVE (ecranul Caracter).')) }); return; }
    pane.innerHTML = loader(tx('Citesc blueprint-urile din EVE'));
    try {
      const [d, owned] = await Promise.all([ready, ownedBlueprints(who)]);
      if (seq !== mineSeq) return;
      const groups = new Map<string, { o: OwnedBlueprint; n: number; runs: number }>();
      for (const o of owned) {
        const key = `${o.type_id}:${o.material_efficiency}:${o.time_efficiency}:${o.runs < 0 ? 'o' : 'c'}`;
        const g = groups.get(key);
        if (g) { g.n += 1; g.runs += Math.max(0, o.runs); } else groups.set(key, { o, n: 1, runs: Math.max(0, o.runs) });
      }
      const list = [...groups.values()].filter((g) => d.blueprints.has(g.o.type_id));
      const inventTargets = [...new Set(list.flatMap((g) => d.inventable.get(g.o.type_id) ?? []))].filter((id) => d.blueprints.has(id));
      if (!list.length && !inventTargets.length) {
        pane.innerHTML = panel({ body: emptyState({ title: tx('Niciun blueprint'), text: tx('Caracterul nu are blueprint-uri de fabricație sau de reacții (sau ESI încă nu le-a actualizat).') }) });
        return;
      }
      const bps = [...list.map((g) => d.blueprints.get(g.o.type_id)!), ...inventTargets.map((id) => d.blueprints.get(id)!)];
      const [prices, adjusted, facM, facR] = await Promise.all([jitaPrices(allIds(bps, d, true)), adjustedPrices(), facility(false), facility(true)]);
      if (seq !== mineSeq) return;
      const common = { basis: settings.basis, fees: fees(), skills: ctx.character.skills, prices, adjusted, labels: labels() };
      const rows = list.map((g) => {
        const bp = d.blueprints.get(g.o.type_id)!;
        const bpc = g.o.runs >= 0;
        const runs = bpc ? Math.max(1, g.o.runs) : Math.max(1, Math.min(10, bp.limit || 10));
        return { g, bpc, r: computeBuild({ ...common, bp, runs, me: g.o.material_efficiency, te: g.o.time_efficiency, facility: bp.reaction ? facR.f : facM.f }) };
      }).sort((a, b) => b.r.iskHour - a.r.iskHour);
      const invRows = inventTargets.map((id) => {
        const bp = d.blueprints.get(id)!;
        const inv = d.inventions.get(id)!;
        return computeBuild({ ...common, bp, runs: Math.max(1, inv.runs), me: 0, te: 0, facility: facM.f, invention: { inv, decryptor: null } });
      }).sort((a, b) => b.iskHour - a.iskHour);
      const bpos = list.filter((g) => g.o.runs < 0).reduce((a, g) => a + g.n, 0);
      pane.innerHTML = `${panel({
        title: tx('Fabricație din blueprint-urile tale'),
        count: `${formatInt(bpos)} BPO · ${formatInt(owned.length - bpos)} BPC`,
        body: rows.length ? `<div class="table-scroll"><table class="table compact ind-table"><thead><tr><th>Blueprint</th><th>${tx('Tip')}</th><th class="r">ME / TE</th><th class="r">${tx('Cost / unitate')}</th><th class="r">${tx('Jita vânzare')}</th><th class="r">${tx('Profit / unitate')}</th><th class="r">${tx('Marjă')}</th><th class="r">${tx('ISK / oră')}</th></tr></thead><tbody>
            ${rows.map(({ g, bpc, r }) => `<tr class="clickable" data-own="${g.o.type_id}" data-me="${g.o.material_efficiency}" data-te="${g.o.time_efficiency}" data-runs="${r.runs}"><td><img class="row-icon" src="${typeIconUrl(r.bp.productId, 32)}" alt="" />${esc(d.name(r.bp.productId))}${g.n > 1 ? ` <span class="dim">×${g.n}</span>` : ''}</td><td>${bpc ? `BPC · ${tx('{n} run-uri', { n: formatInt(g.runs) })}` : 'BPO'}</td><td class="r num">${r.bp.reaction ? '—' : `${g.o.material_efficiency} / ${g.o.time_efficiency}`}</td><td class="r num">${compactISK(r.costUnit)}</td><td class="r num">${r.sellUnit ? compactISK(r.sellUnit) : '—'}</td><td class="r">${r.sellUnit ? signed(r.profitUnit) : '—'}</td><td class="r">${r.sellUnit ? pct(r.margin) : '—'}</td><td class="r">${r.sellUnit ? signed(r.iskHour) : '—'}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="dim small">${tx('BPO calculat pe {n} run-uri, BPC pe toate run-urile rămase. Click pe un rând ca să-l deschizi în calculator.', { n: 10 })}</p>` : emptyState({ title: tx('Niciun blueprint de fabricație') }),
      })}
      ${invRows.length ? panel({
        title: tx('Invenție din blueprint-urile tale'),
        count: invRows.length,
        body: `<div class="table-scroll"><table class="table compact ind-table"><thead><tr><th>${tx('Produs T2 / T3')}</th><th>${tx('Din')}</th><th class="r">${tx('Șansă')}</th><th class="r">${tx('Cost / unitate')}</th><th class="r">${tx('Jita vânzare')}</th><th class="r">${tx('Profit / unitate')}</th><th class="r">${tx('Marjă')}</th><th class="r">${tx('ISK / oră')}</th></tr></thead><tbody>
            ${invRows.map((r) => `<tr class="clickable" data-inv="${esc(d.name(r.bp.productId))}"><td><img class="row-icon" src="${typeIconUrl(r.bp.productId, 32)}" alt="" />${esc(d.name(r.bp.productId))}</td><td class="dim">${esc(d.name(r.invention!.inv.sourceId))}</td><td class="r num">${formatNum(r.invention!.chance * 100, 1)}%</td><td class="r num">${compactISK(r.costUnit)}</td><td class="r num">${r.sellUnit ? compactISK(r.sellUnit) : '—'}</td><td class="r">${r.sellUnit ? signed(r.profitUnit) : '—'}</td><td class="r">${r.sellUnit ? pct(r.margin) : '—'}</td><td class="r">${r.sellUnit ? signed(r.iskHour) : '—'}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="dim small">${tx('Fără decryptor, cu skill-urile caracterului activ. Costul include datacores, job-ul de invenție împărțit la șansă și fabricația cu ME 2 / TE 4.')}</p>`,
      }) : ''}`;
    } catch (err) {
      if (seq === mineSeq) failed(pane, err);
    }
  }

  panes.mine.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const own = t.closest<HTMLElement>('[data-own]');
    if (own && data) {
      const bp = data.blueprints.get(Number(own.dataset.own));
      if (bp) openProduct(data.name(bp.productId), { me: Number(own.dataset.me), te: Number(own.dataset.te), runs: Number(own.dataset.runs), source: 'own' });
      return;
    }
    const inv = t.closest<HTMLElement>('[data-inv]');
    if (inv) openProduct(inv.dataset.inv!, { source: 'invention', decryptor: 0, runs: 1 });
  });

  let jobsSeq = 0;
  async function renderJobs() {
    const pane = panes.jobs;
    const seq = ++jobsSeq;
    const who = esiCharacter(JOB_SCOPE);
    if (typeof who === 'string') { pane.innerHTML = panel({ body: who === 'scope' ? permissionGate('industry', ctx.character.characterId!, ctx.character.name) : alertBox(who || tx('Selectează un caracter importat din EVE (ecranul Caracter).')) }); return; }
    pane.innerHTML = loader(tx('Citesc joburile de industrie'));
    try {
      const [, jobs] = await Promise.all([ready, industryJobs(who)]);
      if (seq !== jobsSeq) return;
      const list = jobs.filter((j) => j.status === 'active' || j.status === 'ready' || j.status === 'paused').sort((a, b) => a.end_date.localeCompare(b.end_date));
      pane.innerHTML = panel({
        title: tx('Joburi active'),
        count: list.length,
        body: list.length ? `<div class="table-scroll"><table class="table compact ind-table"><thead><tr><th>${tx('Activitate')}</th><th>Blueprint</th><th>${tx('Produs')}</th><th class="r">${tx('Run-uri')}</th><th>${tx('Stare')}</th><th class="r">${tx('Gata în')}</th><th class="r">${tx('Cost')}</th></tr></thead><tbody>
            ${list.map((j) => jobRow(j)).join('')}
          </tbody></table></div>` : emptyState({ title: tx('Niciun job activ'), text: tx('Joburile pornite în joc apar aici după câteva minute (ESI le actualizează periodic).') }),
      });
    } catch (err) {
      if (seq === jobsSeq) failed(pane, err);
    }
  }

  function jobRow(j: IndustryJob) {
    const left = (new Date(j.end_date).getTime() - Date.now()) / 1000;
    const done = left <= 0 || j.status === 'ready';
    return `<tr><td>${esc(ACTIVITY[j.activity_id] ?? `#${j.activity_id}`)}</td><td><img class="row-icon" src="${typeIconUrl(j.blueprint_type_id, 32)}" alt="" />${esc(nameOf(j.blueprint_type_id))}</td><td>${j.product_type_id ? esc(nameOf(j.product_type_id)) : '—'}</td><td class="r num">${formatInt(j.runs)}</td><td>${done ? badge(tx('Gata'), 'ok') : j.status === 'paused' ? badge(tx('Pe pauză'), 'warn') : esc(tx('În lucru'))}</td><td class="r num">${done ? '—' : duration(left)}</td><td class="r num">${j.cost ? compactISK(j.cost) : '—'}</td></tr>`;
  }

  function refresh() {
    if (tab === 'calc') renderCalc();
    else if (tab === 'mine') renderMine();
    else renderJobs();
  }

  ctx.onCharacterChange(() => { renderSettings(); refresh(); });

  addEventListener('hashchange', () => {
    if (!applyShared()) return;
    renderTabs();
    renderSettings();
    refresh();
  });

  applyShared();
  renderTabs();
  renderSettings();
  panes[tab].innerHTML = loader(tx('Încarc datele de industrie'));
  ready.then(() => { renderSettings(); refresh(); }).catch((err) => failed(panes[tab], err));
}
