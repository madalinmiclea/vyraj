import { panel, loader, alertBox, esc, formatInt, formatNum, compactISK, badge, loginEmpty } from '../ui/components';
import { icon } from '../ui/icons';
import { seriesChart, bindSeriesChart } from '../ui/charts';
import { loadJson, saveJson } from '../storage';
import { typeIconUrl } from '../services/market';
import { universeNames } from '../character/esi';
import { rosterCharacters } from '../character/roster';
import { hasTokens } from '../character/sso';
import { permissionButtons } from '../character/permissions';
import { loadMap, type NavMap } from '../services/navigation';
import { loadLedger, loadExtractions, ledgerCharacters, moonCharacters, corpName, moonName, type OwnedLedgerRow, type OwnedExtraction } from '../services/miningLedger';
import type { MiningData, Ore } from '../services/mining';
import { tx, locale } from '../i18n';

export interface LedgerDeps {
  data: MiningData;
  price: (basis: 'sell' | 'buy') => (id: number) => number;
  refinedPerUnit: (ore: Ore, price: (id: number) => number) => number;
}

interface LedgerUi { who: string; days: 7 | 30; basis: 'sell' | 'buy'; value: 'raw' | 'refined' }

const UI_KEY = 'eve-mining:ledger';

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
const dateTime = (ms: number) => new Date(ms).toLocaleString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function untilText(ms: number) {
  const m = Math.round(ms / 60000);
  if (m <= 0) return tx('a sosit');
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  return tx('{n} zile', { n: Math.floor(h / 24) });
}

function loggedChars() {
  return rosterCharacters().filter((c) => hasTokens(c.characterId!)).map((c) => ({ characterId: c.characterId!, name: c.name }));
}

export function createLedgerPanel(pane: HTMLElement, deps: () => LedgerDeps) {
  const ui = loadJson<LedgerUi>(UI_KEY, { who: 'all', days: 30, basis: 'buy', value: 'raw' });
  let map: NavMap | null = null;
  let busy = false;

  async function render(force = false) {
    const logged = loggedChars();
    if (!logged.length) {
      pane.innerHTML = loginEmpty(tx('Fă login cu EVE ca să vezi ce ai minat.'));
      return;
    }
    if (!ledgerCharacters().length) {
      pane.innerHTML = panel({ body: permissionButtons('mining', logged) });
      return;
    }
    if (busy) return;
    busy = true;
    pane.innerHTML = panel({ body: loader(tx('Citim registrul de minerit')) });
    try {
      const [scan, m] = await Promise.all([loadLedger(force), map ? Promise.resolve(map) : loadMap()]);
      map = m;
      draw(scan.rows, scan.errors, scan.at);
    } catch (e) {
      pane.innerHTML = panel({ body: alertBox((e as Error).message) });
    } finally {
      busy = false;
    }
  }

  function draw(all: OwnedLedgerRow[], errors: string[], at: number) {
    const { data, price, refinedPerUnit } = deps();
    const p = price(ui.basis);
    const owners = [...new Map(all.map((r) => [r.ownerId, r.ownerName])).entries()];
    if (ui.who !== 'all' && !owners.some(([id]) => String(id) === ui.who)) ui.who = 'all';
    const since = new Date(Date.now() - ui.days * 86_400_000).toISOString().slice(0, 10);
    const rows = all.filter((r) => r.date >= since && (ui.who === 'all' || String(r.ownerId) === ui.who));
    const unit = (typeId: number) => {
      const ore = data.byId.get(typeId);
      if (ui.value === 'refined' && ore?.materials.length) return refinedPerUnit(ore, p);
      return p(typeId);
    };
    const volume = (typeId: number) => data.byId.get(typeId)?.volume ?? 0;
    const byType = new Map<number, { qty: number; isk: number }>();
    const byDay = new Map<string, { isk: number; m3: number }>();
    const bySystem = new Map<number, { isk: number; m3: number }>();
    const byOwner = new Map<number, { isk: number; m3: number }>();
    for (const r of rows) {
      const isk = unit(r.type_id) * r.quantity;
      const m3 = volume(r.type_id) * r.quantity;
      const t = byType.get(r.type_id) ?? { qty: 0, isk: 0 };
      t.qty += r.quantity; t.isk += isk; byType.set(r.type_id, t);
      for (const [mapRef, key] of [[byDay, r.date], [bySystem, r.solar_system_id], [byOwner, r.ownerId]] as [Map<unknown, { isk: number; m3: number }>, unknown][]) {
        const x = mapRef.get(key) ?? { isk: 0, m3: 0 };
        x.isk += isk; x.m3 += m3; mapRef.set(key, x);
      }
    }
    const days: { label: string; value: number; bar: number }[] = [];
    for (let i = ui.days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const v = byDay.get(d);
      days.push({ label: dayLabel(d), value: v?.isk ?? 0, bar: Math.round(v?.m3 ?? 0) });
    }
    const totalIsk = [...byType.values()].reduce((a, t) => a + t.isk, 0);
    const totalM3 = [...byDay.values()].reduce((a, d) => a + d.m3, 0);
    const best = [...byDay.entries()].sort((a, b) => b[1].isk - a[1].isk)[0];
    const active = byDay.size;
    const chips = (items: [string, string][], key: keyof LedgerUi) => `<div class="advice-sort">${items.map(([id, l]) => `<button class="chip-btn ${String(ui[key]) === id ? 'active' : ''}" data-ml-${key}="${id}">${esc(l)}</button>`).join('')}</div>`;
    const typeRows = [...byType.entries()].sort((a, b) => b[1].isk - a[1].isk).map(([id, t]) => {
      const ore = data.byId.get(id);
      return `<tr>
        <td><span class="nav-ship-name"><img class="row-icon" src="${typeIconUrl(id, 32)}" alt="" />${esc(ore?.name ?? String(id))}</span>${ore && ore.group !== ore.name ? `<div class="dim small">${esc(ore.group)}</div>` : ''}</td>
        <td class="r num">${formatInt(t.qty)}</td>
        <td class="r num">${formatNum(volume(id) * t.qty, 0)} m³</td>
        <td class="r num">${t.isk > 0 ? compactISK(t.isk) : '<span class="dim">—</span>'}</td>
        <td class="r num">${totalIsk > 0 ? `${formatNum((t.isk / totalIsk) * 100, 1)}%` : '—'}</td>
      </tr>`;
    }).join('');
    const sysRows = [...bySystem.entries()].sort((a, b) => b[1].isk - a[1].isk).map(([id, s]) => {
      const sys = map?.systems.get(id);
      return `<tr><td>${esc(sys?.name ?? String(id))}${sys ? `<span class="dim small"> · ${esc(map!.region(sys))}</span>` : ''}</td><td class="r num">${formatNum(s.m3, 0)} m³</td><td class="r num">${compactISK(s.isk)}</td></tr>`;
    }).join('');
    const ownerRows = owners.length > 1 && ui.who === 'all' ? [...byOwner.entries()].sort((a, b) => b[1].isk - a[1].isk).map(([id, s]) => `<tr><td>${esc(owners.find(([o]) => o === id)?.[1] ?? '')}</td><td class="r num">${formatNum(s.m3, 0)} m³</td><td class="r num">${compactISK(s.isk)}</td></tr>`).join('') : '';
    pane.innerHTML = `${errors.map((e) => alertBox(e)).join('')}${panel({
      title: tx('Registru de minerit'),
      actions: `<button class="btn ghost sm" data-ml-refresh>${icon('refresh')}${tx('Verifică acum')}</button>`,
      body: `<div class="ct-filters">
          ${owners.length > 1 ? chips([['all', tx('Toate caracterele')], ...owners.map(([id, n]) => [String(id), n] as [string, string])], 'who') : ''}
          ${chips([['7', tx('7 zile')], ['30', tx('30 zile')]], 'days')}
          ${chips([['raw', tx('Ca minereu')], ['refined', tx('Ca minerale')]], 'value')}
          ${chips([['buy', tx('Jita cumpărare')], ['sell', tx('Jita vânzare')]], 'basis')}
        </div>
        <div class="history-kpis">
          <div><span class="label">${tx('Valoare')}</span><span class="value accent">${compactISK(totalIsk)}</span></div>
          <div><span class="label">${tx('Volum minat')}</span><span class="value">${formatNum(totalM3, 0)} m³</span></div>
          <div><span class="label">${tx('Zile cu minerit')}</span><span class="value">${formatInt(active)}</span></div>
          <div><span class="label">${tx('Medie pe zi activă')}</span><span class="value">${compactISK(active ? totalIsk / active : 0)}</span></div>
          <div><span class="label">${tx('Cea mai bună zi')}</span><span class="value">${best ? `${compactISK(best[1].isk)} <span class="dim small">${dayLabel(best[0])}</span>` : '—'}</span></div>
        </div>
        ${rows.length ? `<div id="mlChart">${seriesChart(days, { bars: true })}</div>` : `<p class="dim">${tx('Niciun minereu în registru pentru perioada aleasă.')}</p>`}
        <p class="dim small">${tx('Citit la {time}. EVE actualizează registrul de câteva ori pe zi.', { time: dateTime(at) })}</p>`,
    })}
    ${rows.length ? `<div class="grid-2">${panel({ title: tx('Pe tip de minereu'), count: byType.size, body: `<div class="table-scroll"><table class="table compact"><thead><tr><th>${tx('Minereu')}</th><th class="r">${tx('Cantitate')}</th><th class="r">${tx('Volum')}</th><th class="r">${tx('Valoare')}</th><th class="r">%</th></tr></thead><tbody>${typeRows}</tbody></table></div>` })}
      <div>${panel({ title: tx('Pe sistem'), count: bySystem.size, body: `<div class="table-scroll"><table class="table compact"><thead><tr><th>${tx('Sistem')}</th><th class="r">${tx('Volum')}</th><th class="r">${tx('Valoare')}</th></tr></thead><tbody>${sysRows}</tbody></table></div>` })}
      ${ownerRows ? panel({ title: tx('Pe caracter'), body: `<div class="table-scroll"><table class="table compact"><thead><tr><th>${tx('Caracter')}</th><th class="r">${tx('Volum')}</th><th class="r">${tx('Valoare')}</th></tr></thead><tbody>${ownerRows}</tbody></table></div>` }) : ''}</div></div>` : ''}`;
    const chart = pane.querySelector<HTMLElement>('#mlChart');
    if (chart) bindSeriesChart(chart, days, { barLabel: 'm³', valueLabel: tx('Valoare') });
  }

  pane.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-ml-refresh]')) { render(true); return; }
    const b = t.closest<HTMLElement>('[data-ml-who],[data-ml-days],[data-ml-basis],[data-ml-value]');
    if (!b) return;
    if (b.dataset.mlWho) ui.who = b.dataset.mlWho;
    if (b.dataset.mlDays) ui.days = b.dataset.mlDays === '7' ? 7 : 30;
    if (b.dataset.mlBasis) ui.basis = b.dataset.mlBasis === 'sell' ? 'sell' : 'buy';
    if (b.dataset.mlValue) ui.value = b.dataset.mlValue === 'refined' ? 'refined' : 'raw';
    saveJson(UI_KEY, ui);
    render();
  });

  return { render };
}

export function createMoonPanel(pane: HTMLElement) {
  const names = new Map<number, string>();
  let busy = false;
  let timer = 0;

  async function render(force = false) {
    const logged = loggedChars();
    if (!logged.length) {
      pane.innerHTML = loginEmpty(tx('Fă login cu EVE ca să vezi extracțiile corporației.'));
      return;
    }
    if (!moonCharacters().length) {
      pane.innerHTML = panel({ body: permissionButtons('moons', logged) });
      return;
    }
    if (busy) return;
    busy = true;
    pane.innerHTML = panel({ body: loader(tx('Citim extracțiile lunare')) });
    try {
      const scan = await loadExtractions(force);
      const byReader = new Map<number, number[]>();
      for (const r of scan.rows) byReader.set(r.readerId, [...(byReader.get(r.readerId) ?? []), r.structure_id]);
      await Promise.all([...new Set(scan.rows.map((r) => r.moon_id))].filter((id) => !names.has(id)).map(async (id) => names.set(id, await moonName(id))));
      for (const [reader, ids] of byReader) {
        const todo = ids.filter((id) => !names.has(id));
        if (todo.length) for (const [id, n] of await universeNames(todo, reader).catch(() => new Map<number, string>())) names.set(id, n);
      }
      const corps = new Map<number, string>();
      for (const r of scan.rows) if (!corps.has(r.corporationId)) corps.set(r.corporationId, await corpName(r.corporationId, r.readerId));
      draw(scan.rows, scan.errors, scan.noRole, corps);
    } catch (e) {
      pane.innerHTML = panel({ body: alertBox((e as Error).message) });
    } finally {
      busy = false;
    }
  }

  function draw(rows: OwnedExtraction[], errors: string[], noRole: string[], corps: Map<number, string>) {
    const now = Date.now();
    const list = [...rows].sort((a, b) => Date.parse(a.chunk_arrival_time) - Date.parse(b.chunk_arrival_time));
    const ready = list.filter((r) => Date.parse(r.chunk_arrival_time) <= now);
    const next = list.find((r) => Date.parse(r.chunk_arrival_time) > now);
    const day = list.filter((r) => { const t = Date.parse(r.chunk_arrival_time) - now; return t > 0 && t < 86_400_000; });
    const multiCorp = corps.size > 1;
    const row = (r: OwnedExtraction) => {
      const arrive = Date.parse(r.chunk_arrival_time);
      const decay = Date.parse(r.natural_decay_time);
      const start = Date.parse(r.extraction_start_time);
      const progress = Math.max(0, Math.min(1, (now - start) / Math.max(1, arrive - start)));
      const state = now >= decay ? badge(tx('Spart singur'), 'danger', true) : now >= arrive ? badge(tx('Gata de spart'), 'ok', true) : badge(tx('În extracție'), 'accent', true);
      return `<tr>
        <td>${esc(names.get(r.moon_id) ?? String(r.moon_id))}<div class="dim small">${esc(names.get(r.structure_id) ?? tx('Structură {id}', { id: r.structure_id }))}${multiCorp ? ` · ${esc(corps.get(r.corporationId) ?? '')}` : ''}</div></td>
        <td>${state}</td>
        <td class="r num">${dateTime(arrive)}<div class="dim small">${now < arrive ? untilText(arrive - now) : ''}</div></td>
        <td class="r num">${dateTime(decay)}<div class="dim small">${now < decay ? untilText(decay - now) : ''}</div></td>
        <td class="r num"><div class="moon-bar"><i style="width:${(progress * 100).toFixed(1)}%"></i></div><span class="dim small">${formatNum(progress * 100, 0)}%</span></td>
      </tr>`;
    };
    pane.innerHTML = `${errors.map((e) => alertBox(e)).join('')}${noRole.length ? alertBox(tx('Fără rol de Station Manager sau Director: {names}', { names: noRole.join(', ') }), 'warn') : ''}${panel({
      title: tx('Extracții lunare'),
      count: list.length,
      actions: `<button class="btn ghost sm" data-moon-refresh>${icon('refresh')}${tx('Verifică acum')}</button>`,
      body: `<div class="history-kpis">
          <div><span class="label">${tx('Gata de spart')}</span><span class="value ${ready.length ? 'accent' : ''}">${formatInt(ready.length)}</span></div>
          <div><span class="label">${tx('Sosesc în 24 h')}</span><span class="value">${formatInt(day.length)}</span></div>
          <div><span class="label">${tx('Următorul chunk')}</span><span class="value">${next ? untilText(Date.parse(next.chunk_arrival_time) - now) : '—'}</span></div>
        </div>
        ${list.length ? `<div class="table-scroll"><table class="table compact"><thead><tr><th>${tx('Lună')}</th><th>${tx('Stare')}</th><th class="r">${tx('Sosește chunk-ul')}</th><th class="r">${tx('Se sparge singur')}</th><th class="r">${tx('Progres')}</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`
          : `<p class="dim">${tx('Nicio extracție programată în corporație.')}</p>`}`,
    })}`;
    clearTimeout(timer);
    if (pane.isConnected) timer = window.setTimeout(() => { if (!pane.hidden) draw(rows, errors, noRole, corps); }, 60_000);
  }

  pane.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-moon-refresh]')) render(true);
  });

  return { render };
}
