import { pageHead, panel, loader, alertBox, esc, formatInt, formatNum, compactISK, badge, button, windowTitle, emptyState, lore } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { fetchPrices, typeIconUrl, type Aggregates } from '../services/market';
import { rosterCharacters } from '../character/roster';
import { hasTokens, hasScope } from '../character/sso';
import { formatDuration } from '../character/training';
import { systemInfo, displaySec, secClass, type SystemInfo } from '../services/recon';
import {
  loadPi, chainRows, fetchColonies, loadColonies, saveColonies, planetNames, priceOf, perDay, exportTax,
  PI_SCOPE, TIER_NAMES, EXPORT_BASE,
  type PiData, type ChainRow, type ChainOptions, type ColonyEntry, type Colony, type PriceSide,
} from '../services/pi';
import { tx, locale } from '../i18n';

type Tab = 'colonies' | 'chains' | 'planner';
type ChainSort = 'name' | 'tier' | 'outValue' | 'inCost' | 'tax' | 'profitCycle' | 'profitHour' | 'margin';
type ColonySort = 'expiry' | 'character' | 'system';

const TABS: { id: Tab; label: string }[] = [
  { id: 'colonies', label: tx('Colonii și timere') },
  { id: 'chains', label: tx('Profit pe lanțuri') },
  { id: 'planner', label: tx('Planificator lanț') },
];

const TAB_KEY = 'eve-pi:tab';
const OPTS_KEY = 'eve-pi:opts';
const PLAN_KEY = 'eve-pi:plan';
const COLONY_SORT_KEY = 'eve-pi:colony-sort';
const DAY = 86_400_000;
const STALE = 10 * 60_000;

interface Opts extends ChainOptions { tier: number; sort: ChainSort; desc: boolean; q: string }

const icon32 = (id: number) => `<img class="row-icon" src="${typeIconUrl(id, 32)}" alt="" />`;
const isk = (n: number) => `<span class="${n < 0 ? 'neg' : ''}">${compactISK(n)}</span>`;
const pct = (n: number) => `<span class="${n < 0 ? 'neg' : n > 0 ? 'pos' : ''}">${formatNum(n * 100, 1)}%</span>`;
const tierBadge = (t: number) => `<span class="pi-tier t${t}">${TIER_NAMES[t]}</span>`;

const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 60) return tx('acum {n} min', { n: m });
  if (m < 2880) return tx('acum {n} h', { n: Math.round(m / 60) });
  return tx('acum {n} zile', { n: Math.round(m / 1440) });
};

export function createPiView(el: HTMLElement, side: HTMLElement) {
  let tab = loadJson<Tab>(TAB_KEY, 'colonies');
  if (!TABS.some((t) => t.id === tab)) tab = 'colonies';
  const opts = { input: 'buy', output: 'sell', taxRate: 0.1, tier: 0, sort: 'profitHour', desc: true, q: '', ...loadJson<Partial<Opts>>(OPTS_KEY, {}) } as Opts;
  const plan = { product: 0, qty: 1000, ...loadJson<{ product?: number; qty?: number }>(PLAN_KEY, {}) };
  let colonySort = loadJson<ColonySort>(COLONY_SORT_KEY, 'expiry');

  el.innerHTML = `${pageHead('Planetary Interaction', tx('Profit pe lanțuri P0-P4 la prețuri Jita și timer-ele de extracție pe toate caracterele'), 'Rootweave')}
    <div id="piColonies"></div>
    <div id="piChains"></div>
    <div id="piPlanner"></div>
    <datalist id="piProducts"></datalist>`;
  const panes: Record<Tab, HTMLElement> = {
    colonies: el.querySelector<HTMLElement>('#piColonies')!,
    chains: el.querySelector<HTMLElement>('#piChains')!,
    planner: el.querySelector<HTMLElement>('#piPlanner')!,
  };
  const datalist = el.querySelector<HTMLDataListElement>('#piProducts')!;

  let pi: PiData | null = null;
  let prices: Map<number, Aggregates> | null = null;
  let pricesAt = 0;
  const ready = loadPi().then((d) => {
    pi = d;
    datalist.innerHTML = [...d.byOutput.keys()].map((id) => d.types.get(id)!).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)).map((t) => `<option value="${esc(t.name)}">${TIER_NAMES[t.tier]}</option>`).join('');
    return d;
  });
  const priced = async () => {
    const d = await ready;
    if (!prices || Date.now() - pricesAt > 30 * 60_000) {
      prices = await fetchPrices([...d.types.keys()]);
      pricesAt = Date.now();
    }
    return { d, p: prices };
  };

  const loaded = new Set<Tab>();
  const renderers: Record<Tab, () => void> = { colonies: renderColonies, chains: renderChains, planner: renderPlanner };

  function renderTabs() {
    side.innerHTML = `<div class="sidebar-head">${windowTitle('Planetary Interaction')}</div>
      <div class="side-nav">${TABS.map((t) => `<button class="side-link ${t.id === tab ? 'active' : ''}" data-pi-tab="${t.id}">${t.label}</button>`).join('')}</div>`;
    for (const [id, pane] of Object.entries(panes)) pane.hidden = id !== tab;
    if (!loaded.has(tab)) {
      loaded.add(tab);
      renderers[tab]();
    }
  }

  side.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pi-tab]');
    if (!b) return;
    tab = b.dataset.piTab as Tab;
    saveJson(TAB_KEY, tab);
    renderTabs();
  });

  const failed = (pane: HTMLElement, err: unknown) => { pane.innerHTML = panel({ body: alertBox((err as Error).message) }); };

  let colonies = loadColonies();
  let busy = false;
  let systems = new Map<number, SystemInfo>();
  let names = new Map<number, string>();

  async function refreshColonies(force = false) {
    if (busy) return;
    const chars = rosterCharacters().filter((c) => hasTokens(c.characterId!));
    const due = chars.filter((c) => {
      const e = colonies[c.characterId!];
      return force || !e || Date.now() - e.fetched > STALE || (e.missingScope && hasScope(c.characterId!, PI_SCOPE));
    });
    if (!due.length) return;
    busy = true;
    drawColonies();
    try {
      const d = await ready;
      const got = await Promise.all(due.map((c) => fetchColonies(d, c.characterId!)));
      colonies = { ...loadColonies() };
      for (const e of got) colonies[e.characterId] = e;
      saveColonies(colonies);
      await resolvePlaces();
    } finally {
      busy = false;
      drawColonies();
    }
  }

  async function resolvePlaces() {
    const all = Object.values(colonies).flatMap((e) => e.colonies);
    const [s, n] = await Promise.all([
      systemInfo([...new Set(all.map((c) => c.systemId))]).catch(() => systems),
      planetNames(all.map((c) => c.planetId)).catch(() => names),
    ]);
    systems = s;
    names = n;
  }

  function renderColonies() {
    panes.colonies.innerHTML = loader(tx('Încărcăm coloniile'));
    ready.then(async () => {
      await resolvePlaces().catch(() => {});
      priced().then(drawColonies).catch(() => {});
      drawColonies();
      refreshColonies().catch((e) => failed(panes.colonies, e));
    }).catch((e) => failed(panes.colonies, e));
  }

  function extractorCell(c: Colony, now: number) {
    if (!c.extractors.length) return '<span class="dim">—</span>';
    return c.extractors.map((e) => {
      const left = e.expiry - now;
      const tone = !e.expiry || left <= 0 ? 'danger' : left < DAY ? 'warn' : 'ok';
      const label = !e.expiry ? tx('Oprit') : left <= 0 ? tx('Expirat') : formatDuration(left / 1000);
      return `<div class="pi-ext" title="${esc(tx('{qty} / ciclu · ciclu {cycle} · {heads} capete', { qty: formatInt(e.qtyPerCycle), cycle: formatDuration(e.cycle), heads: e.heads }))}">${icon32(e.product)}<span>${esc(pi!.name(e.product))}</span>${badge(label, tone, true)}</div>`;
    }).join('');
  }

  function factoryCell(c: Colony) {
    if (!c.factories.length) return '<span class="dim">—</span>';
    return c.factories.map((f) => {
      const s = pi!.schematics.get(f.schematic);
      return s ? `<div class="pi-fac">${icon32(s.out)}<span>${esc(pi!.name(s.out))}</span><span class="dim num">×${f.count}</span></div>` : '';
    }).join('');
  }

  function storageCell(c: Colony) {
    const fill = c.storage.filter((s) => s.capacity > 0 && s.kind !== 'cc');
    if (!fill.length) return '<span class="dim">—</span>';
    return fill.map((s) => {
      const p = Math.min(100, (s.used / s.capacity) * 100);
      const tone = p >= 95 ? 'danger' : p >= 75 ? 'warn' : '';
      const what = s.contents.map(([id, n]) => `${pi!.name(id)}: ${formatInt(n)}`).join('\n');
      return `<div class="pi-store ${tone}" title="${esc(`${s.name}\n${what || tx('Gol')}`)}"><span class="pi-store-bar"><i style="width:${p.toFixed(1)}%"></i></span><span class="num small">${formatInt(p)}%</span></div>`;
    }).join('');
  }

  function drawColonies() {
    if (!pi) return;
    const pane = panes.colonies;
    const now = Date.now();
    const chars = rosterCharacters();
    if (!chars.length) {
      pane.innerHTML = panel({ body: emptyState({ title: tx('Niciun caracter logat'), text: tx('Fă login cu EVE din meniul de caractere (dreapta sus) ca să vezi coloniile.') }) });
      return;
    }
    const rows: { charName: string; charId: number; c: Colony }[] = [];
    const noScope: string[] = [];
    const errors: string[] = [];
    for (const ch of chars) {
      const e: ColonyEntry | undefined = colonies[ch.characterId!];
      if (!hasTokens(ch.characterId!)) continue;
      if (e?.missingScope) noScope.push(ch.name);
      if (e?.error) errors.push(`${ch.name}: ${e.error}`);
      for (const c of e?.colonies ?? []) rows.push({ charName: ch.name, charId: ch.characterId!, c });
    }
    const nextExpiry = (c: Colony) => (c.extractors.length ? Math.min(...c.extractors.map((x) => x.expiry || 0)) : Infinity);
    const sorters: Record<ColonySort, (a: typeof rows[number], b: typeof rows[number]) => number> = {
      expiry: (a, b) => nextExpiry(a.c) - nextExpiry(b.c),
      character: (a, b) => a.charName.localeCompare(b.charName),
      system: (a, b) => (systems.get(a.c.systemId)?.name ?? '').localeCompare(systems.get(b.c.systemId)?.name ?? ''),
    };
    rows.sort((a, b) => sorters[colonySort](a, b) || a.charName.localeCompare(b.charName) || a.c.planetId - b.c.planetId);

    const extractors = rows.flatMap((r) => r.c.extractors);
    const expired = extractors.filter((e) => !e.expiry || e.expiry <= now).length;
    const soon = extractors.filter((e) => e.expiry > now && e.expiry - now < DAY).length;
    const upcoming = extractors.filter((e) => e.expiry > now).map((e) => e.expiry);
    const next = upcoming.length ? Math.min(...upcoming) : 0;
    const daily = extractors.filter((e) => e.expiry > now).reduce((s, e) => s + perDay(e) * (prices ? priceOf(prices, e.product, 'buy') : 0), 0);
    const charsWith = new Set(rows.map((r) => r.charId)).size;
    const chip = (label: string, value: string | number, tone = '') => `<div class="roster-chip ${tone}"><span class="label">${label}</span><span class="value num">${value}</span></div>`;
    const updated = Object.values(colonies).reduce((m, e) => Math.max(m, e.fetched), 0);
    const sortSel = `<select class="input plain sm" data-pi-colony-sort>${([['expiry', tx('Următoarea expirare')], ['character', tx('Caracter')], ['system', tx('Sistem')]] as [ColonySort, string][]).map(([id, label]) => `<option value="${id}" ${id === colonySort ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;

    pane.innerHTML = `<section class="panel">
      <div class="panel-head">
        <div class="window-title">${lore(esc(tx('Colonii')), 'Tended Worlds')}<span class="count">${rows.length}</span></div>
        <div class="panel-actions">${sortSel}${button(busy ? tx('Se actualizează…') : tx('Actualizează toate'), { iconName: 'refresh', cls: 'ghost sm', attrs: `data-pi-refresh ${busy ? 'disabled' : ''}` })}</div>
      </div>
      <div class="panel-body">
        <div class="roster-chips">
          ${chip(tx('Caractere cu colonii'), `${charsWith}/${chars.length}`)}
          ${chip(tx('Extractoare'), extractors.length)}
          ${chip(tx('Expirate'), expired, expired ? 'danger' : '')}
          ${chip(tx('Expiră în 24h'), soon, soon ? 'warn' : '')}
          ${chip(tx('Următoarea expirare'), next ? formatDuration((next - now) / 1000) : '—')}
          ${chip(tx('P0 extras / zi'), daily ? compactISK(daily) : '—')}
        </div>
        ${noScope.length ? alertBox(tx('Fără permisiunea pentru planete: {names}. Fă din nou login cu ele din „Adaugă caracter”, dreapta sus.', { names: noScope.join(', ') }), 'warn') : ''}
        ${errors.map((x) => alertBox(x)).join('')}
        ${rows.length ? `<div class="table-scroll"><table class="table compact pi-colonies">
          <thead><tr><th>${tx('Caracter')}</th><th>${tx('Planetă')}</th><th>${tx('Extractoare')}</th><th>${tx('Fabrici')}</th><th>${tx('Depozit')}</th><th class="r">${tx('Actualizat în joc')}</th></tr></thead>
          <tbody>${rows.map(({ charName, c }) => {
            const sys = systems.get(c.systemId);
            const type = c.planetType.charAt(0).toUpperCase() + c.planetType.slice(1);
            return `<tr>
              <td>${esc(charName)}</td>
              <td data-label="${tx('Planetă')}"><div class="pi-planet"><b>${esc(names.get(c.planetId) ?? `#${c.planetId}`)}</b><span class="small dim">${sys ? `${esc(sys.name)} <span class="num ${secClass(sys.sec)}">${formatNum(displaySec(sys.sec), 1)}</span> · ` : ''}${esc(type)} · CC ${c.level}</span></div></td>
              <td data-label="${tx('Extractoare')}">${extractorCell(c, now)}</td>
              <td data-label="${tx('Fabrici')}">${factoryCell(c)}</td>
              <td data-label="${tx('Depozit')}">${storageCell(c)}</td>
              <td class="r small dim" data-label="${tx('Actualizat în joc')}">${c.lastUpdate ? ago(c.lastUpdate) : '—'}</td>
            </tr>`;
          }).join('')}</tbody></table></div>` : busy ? loader(tx('Citim coloniile din ESI')) : emptyState({ title: tx('Nicio colonie găsită'), text: tx('Caracterele logate nu au colonii PI sau nu au încă permisiunea pentru planete.') })}
        <p class="small dim roster-note">${tx('Timer-ele extractoarelor vin din ESI și sunt exacte. Fabricile și depozitele sunt instantanee de la ultima deschidere a coloniei în joc. Producția pe zi e estimată din cantitatea pe ciclu la Jita buy.')}${updated ? ` ${tx('Actualizat la {time}.', { time: new Date(updated).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}` : ''}</p>
      </div>
    </section>`;
  }

  panes.colonies.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-pi-refresh]')) refreshColonies(true).catch((err) => failed(panes.colonies, err));
  });
  panes.colonies.addEventListener('change', (e) => {
    const s = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-pi-colony-sort]');
    if (!s) return;
    colonySort = s.value as ColonySort;
    saveJson(COLONY_SORT_KEY, colonySort);
    drawColonies();
  });
  setInterval(() => {
    if (tab !== 'colonies' || !loaded.has('colonies') || !el.classList.contains('active')) return;
    drawColonies();
    refreshColonies().catch(() => {});
  }, 60_000);

  function renderChains() {
    panes.chains.innerHTML = loader(tx('Încărcăm prețurile Jita pentru PI'));
    priced().then(drawChains).catch((e) => failed(panes.chains, e));
  }

  function drawChains() {
    if (!pi || !prices) return;
    const d = pi;
    const q = opts.q.trim().toLowerCase();
    const rows = chainRows(d, prices, opts).filter((r) => (!opts.tier || r.tier === opts.tier) && (!q || d.name(r.schematic.out).toLowerCase().includes(q) || r.schematic.ins.some(([id]) => d.name(id).toLowerCase().includes(q))));
    const key = (r: ChainRow): number | string => (opts.sort === 'name' ? d.name(r.schematic.out) : r[opts.sort]);
    rows.sort((a, b) => {
      const x = key(a), y = key(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return (opts.desc ? -c : c) || d.name(a.schematic.out).localeCompare(d.name(b.schematic.out));
    });
    const th = (id: ChainSort, label: string, right = true) => `<th class="${right ? 'r ' : ''}sortable" data-pi-sort="${id}">${label}${opts.sort === id ? (opts.desc ? ' ▼' : ' ▲') : ''}</th>`;
    const side = (name: string, v: PriceSide) => `<select class="input sm" name="${name}"><option value="buy" ${v === 'buy' ? 'selected' : ''}>Jita buy</option><option value="sell" ${v === 'sell' ? 'selected' : ''}>Jita sell</option></select>`;
    const best = rows.filter((r) => !r.missing).slice().sort((a, b) => b.profitHour - a.profitHour)[0];

    panes.chains.innerHTML = panel({
      body: `<form class="form-grid recon-form pi-form" id="piChainForm">
          <label>${tx('Cumpăr inputurile la')}${side('input', opts.input)}</label>
          <label>${tx('Vând produsul la')}${side('output', opts.output)}</label>
          <label>${tx('Taxă POCO (%)')}<input class="input pi-num" name="tax" type="number" min="0" max="100" step="0.5" value="${formatNum(opts.taxRate * 100, 1)}" /></label>
          <label>${tx('Caută')}<input class="input" name="q" value="${esc(opts.q)}" placeholder="${esc(tx('produs sau input'))}" autocomplete="off" spellcheck="false" /></label>
        </form>
        <div class="advice-sort">${[0, 1, 2, 3, 4].map((t) => `<button class="chip-btn ${t === opts.tier ? 'active' : ''}" data-pi-tier="${t}">${t ? TIER_NAMES[t] : tx('Toate')}</button>`).join('')}</div>
        ${best ? `<p class="small dim">${tx('Cel mai bun acum: {name}, {isk} ISK/oră pe fabrică.', { name: `<b>${esc(d.name(best.schematic.out))}</b>`, isk: `<span class="num">${compactISK(best.profitHour)}</span>` })}</p>` : ''}
        <div class="table-scroll"><table class="table compact pi-chains">
          <thead><tr>${th('name', tx('Produs'), false)}<th>${tx('Inputuri / ciclu')}</th>${th('outValue', tx('Valoare'))}${th('inCost', tx('Cost inputuri'))}${th('tax', tx('Taxe'))}${th('profitCycle', tx('Profit / ciclu'))}${th('profitHour', tx('Profit / oră'))}${th('margin', tx('Marjă'))}</tr></thead>
          <tbody>${rows.map((r) => `<tr class="pi-row ${r.missing ? 'dim' : ''}" data-pi-open="${r.schematic.out}">
            <td><div class="pi-prod">${icon32(r.schematic.out)}<span>${esc(d.name(r.schematic.out))}</span>${tierBadge(r.tier)}<span class="dim small num">×${r.schematic.outQty} · ${formatDuration(r.schematic.cycle)}</span></div></td>
            <td class="small" data-label="${tx('Inputuri / ciclu')}">${r.schematic.ins.map(([id, n]) => `<span class="pi-in">${esc(d.name(id))} <span class="dim num">×${formatInt(n)}</span></span>`).join('')}</td>
            <td class="r num" data-label="${tx('Valoare')}">${isk(r.outValue)}</td>
            <td class="r num" data-label="${tx('Cost inputuri')}">${isk(r.inCost)}</td>
            <td class="r num" data-label="${tx('Taxe')}">${isk(r.tax)}</td>
            <td class="r num" data-label="${tx('Profit / ciclu')}">${isk(r.profitCycle)}</td>
            <td class="r num" data-label="${tx('Profit / oră')}"><b>${isk(r.profitHour)}</b></td>
            <td class="r num" data-label="${tx('Marjă')}">${r.missing ? `<span class="dim">${tx('fără preț')}</span>` : pct(r.margin)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="small dim">${tx('Profitul e pentru o fabrică ce cumpără inputurile și vinde produsul. Taxa de export se aplică produsului, iar inputurile plătesc jumătate (import). Valori de bază pe nivel: {list} ISK. Click pe un rând pentru lanțul complet până la P0.', { list: EXPORT_BASE.map((v, i) => `${TIER_NAMES[i]} ${formatInt(v)}`).join(', ') })}</p>`,
    });
  }

  const onChainForm = (e: Event) => {
    const f = (e.target as HTMLElement).closest('form');
    if (!f) return;
    const fd = new FormData(f as HTMLFormElement);
    opts.input = fd.get('input') === 'sell' ? 'sell' : 'buy';
    opts.output = fd.get('output') === 'buy' ? 'buy' : 'sell';
    opts.taxRate = Math.max(0, Math.min(100, Number(fd.get('tax')) || 0)) / 100;
    opts.q = String(fd.get('q') ?? '');
    saveJson(OPTS_KEY, opts);
    const t = e.target as HTMLInputElement;
    const focus = t.name;
    const pos = t.selectionStart;
    drawChains();
    const again = panes.chains.querySelector<HTMLInputElement>(`[name="${focus}"]`);
    if (again && focus === 'q') { again.focus(); again.setSelectionRange(pos, pos); }
  };
  panes.chains.addEventListener('input', (e) => { if ((e.target as HTMLElement).tagName === 'INPUT') onChainForm(e); });
  panes.chains.addEventListener('change', (e) => { if ((e.target as HTMLElement).tagName === 'SELECT') onChainForm(e); });
  panes.chains.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tierBtn = t.closest<HTMLElement>('[data-pi-tier]');
    if (tierBtn) { opts.tier = Number(tierBtn.dataset.piTier); saveJson(OPTS_KEY, opts); drawChains(); return; }
    const s = t.closest<HTMLElement>('[data-pi-sort]');
    if (s) {
      const id = s.dataset.piSort as ChainSort;
      opts.desc = opts.sort === id ? !opts.desc : id !== 'name';
      opts.sort = id;
      saveJson(OPTS_KEY, opts);
      drawChains();
      return;
    }
    const row = t.closest<HTMLElement>('[data-pi-open]');
    if (row) openPlanner(Number(row.dataset.piOpen));
  });

  function openPlanner(product: number) {
    plan.product = product;
    saveJson(PLAN_KEY, plan);
    tab = 'planner';
    saveJson(TAB_KEY, tab);
    if (loaded.has('planner')) drawPlanner();
    renderTabs();
  }

  function renderPlanner() {
    panes.planner.innerHTML = loader(tx('Încărcăm prețurile Jita pentru PI'));
    priced().then(drawPlanner).catch((e) => failed(panes.planner, e));
  }

  function coverPlanets(d: PiData, raws: number[]) {
    const left = new Set(raws);
    const chosen: { name: string; raws: number[] }[] = [];
    while (left.size) {
      let pick: { name: string; raws: number[] } | null = null;
      for (const p of d.planets.values()) {
        const hit = p.raws.filter((r) => left.has(r));
        if (hit.length && (!pick || hit.length > pick.raws.length)) pick = { name: p.name, raws: hit };
      }
      if (!pick) break;
      chosen.push(pick);
      pick.raws.forEach((r) => left.delete(r));
    }
    return chosen;
  }

  function treeHtml(d: PiData, id: number, qty: number, depth = 0): string {
    const s = d.byOutput.get(id);
    const price = priceOf(prices!, id, 'sell');
    const kids = s ? s.ins.map(([inp, q]) => treeHtml(d, inp, (q * qty) / s.outQty, depth + 1)).join('') : '';
    const planets = s ? '' : `<span class="small dim">${d.planetsFor(id).map((p) => p.name).join(', ')}</span>`;
    return `<li><div class="pi-node">${icon32(id)}<span>${esc(d.name(id))}</span>${tierBadge(d.tier(id))}<span class="num">×${formatInt(Math.ceil(qty))}</span><span class="num dim small">${price ? compactISK(price * qty) + ' ISK' : ''}</span>${planets}</div>${kids ? `<ul>${kids}</ul>` : ''}</li>`;
  }

  function drawPlanner() {
    if (!pi || !prices) return;
    const d = pi;
    const products = [...d.byOutput.keys()];
    if (!d.byOutput.has(plan.product)) plan.product = products.find((id) => d.tier(id) === 2) ?? products[0];
    const id = plan.product;
    const qty = Math.max(1, plan.qty || 1);
    const raws = d.rawNeeds(id, qty);
    const levels = d.levelNeeds(id, qty);
    const cover = coverPlanets(d, [...raws.keys()]);
    const tier = d.tier(id);
    const valueAt = (t: number, side: PriceSide) => [...levels].filter(([x]) => d.tier(x) === t).reduce((s, [x, n]) => s + priceOf(prices!, x, side) * n, 0);
    const taxAt = (t: number) => [...levels].filter(([x]) => d.tier(x) === t).reduce((s, [x, n]) => s + exportTax(d, x, n, opts.taxRate), 0);
    const steps = Array.from({ length: tier + 1 }, (_, t) => ({ t, sell: valueAt(t, 'sell'), buy: valueAt(t, 'buy'), tax: taxAt(t) }));
    const volume = (d.types.get(id)?.volume ?? 0) * qty;
    const rawVolume = [...raws].reduce((s, [x, n]) => s + (d.types.get(x)?.volume ?? 0) * n, 0);

    panes.planner.innerHTML = `${panel({
      body: `<form class="form-grid recon-form pi-form" id="piPlanForm">
          <label>${tx('Produs')}<input class="input pi-product" name="product" list="piProducts" value="${esc(d.name(id))}" autocomplete="off" spellcheck="false" /></label>
          <label>${tx('Cantitate')}<input class="input pi-num" name="qty" type="number" min="1" step="1" value="${qty}" /></label>
        </form>
        <div class="history-kpis">
          <div><span class="label">${tx('Valoare Jita sell')}</span><span class="value accent">${compactISK(priceOf(prices, id, 'sell') * qty)}</span></div>
          <div><span class="label">${tx('Volum produs')}</span><span class="value">${formatNum(volume, 1)} m³</span></div>
          <div><span class="label">${tx('Volum P0 necesar')}</span><span class="value">${formatNum(rawVolume, 1)} m³</span></div>
          <div><span class="label">${tx('Tipuri de P0')}</span><span class="value">${raws.size}</span></div>
          <div><span class="label">${tx('Planete minime')}</span><span class="value">${cover.length}</span></div>
        </div>`,
    })}
    <div class="pi-plan-grid">
      ${panel({ title: tx('Lanțul complet'), body: `<ul class="pi-tree">${treeHtml(d, id, qty)}</ul>` })}
      <div class="stack">
        ${panel({
          title: tx('P0 necesar și planete'),
          body: `<div class="table-scroll"><table class="table compact"><thead><tr><th>P0</th><th class="r">${tx('Cantitate')}</th><th>${tx('Planete')}</th></tr></thead>
            <tbody>${[...raws].sort((a, b) => b[1] - a[1]).map(([x, n]) => `<tr><td><div class="pi-prod">${icon32(x)}<span>${esc(d.name(x))}</span></div></td><td class="r num">${formatInt(Math.ceil(n))}</td><td class="small">${d.planetsFor(x).map((p) => esc(p.name)).join(', ')}</td></tr>`).join('')}</tbody></table></div>
            <p class="small"><b>${tx('Combinație minimă de planete')}:</b> ${cover.map((c) => `${esc(c.name)} <span class="dim">(${c.raws.map((r) => esc(d.name(r))).join(', ')})</span>`).join(' + ')}</p>`,
        })}
        ${panel({
          title: tx('Unde merită să te oprești'),
          body: `<div class="table-scroll"><table class="table compact"><thead><tr><th>${tx('Nivel')}</th><th class="r">Jita buy</th><th class="r">Jita sell</th><th class="r">${tx('Taxă export')}</th><th class="r">${tx('Câștig față de nivelul anterior')}</th></tr></thead>
            <tbody>${steps.map((s, i) => `<tr><td>${tierBadge(s.t)}</td><td class="r num">${compactISK(s.buy)}</td><td class="r num">${compactISK(s.sell)}</td><td class="r num">${compactISK(s.tax)}</td><td class="r num">${i ? isk(s.sell - steps[i - 1].sell) : '<span class="dim">—</span>'}</td></tr>`).join('')}</tbody></table></div>
            <p class="small dim">${tx('Valoarea întregului lanț vândut la fiecare nivel: dacă un nivel adaugă puțin față de cel anterior, poți vinde mai jos și economisești fabrici și transport. Taxa folosește {rate}% din tab-ul Profit pe lanțuri.', { rate: formatNum(opts.taxRate * 100, 1) })}</p>`,
        })}
      </div>
    </div>`;
  }

  panes.planner.addEventListener('change', (e) => {
    const f = (e.target as HTMLElement).closest<HTMLFormElement>('#piPlanForm');
    if (!f || !pi) return;
    const fd = new FormData(f);
    const name = String(fd.get('product') ?? '').trim().toLowerCase();
    const hit = [...pi.byOutput.keys()].find((x) => pi!.name(x).toLowerCase() === name);
    if (hit) plan.product = hit;
    plan.qty = Math.max(1, Math.round(Number(fd.get('qty')) || 1));
    saveJson(PLAN_KEY, plan);
    drawPlanner();
  });

  renderTabs();
}
