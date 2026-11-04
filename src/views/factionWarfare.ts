import { panel, loader, alertBox, esc, formatInt, formatNum, badge } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { loadMap, type NavMap, displaySec, secClass } from '../services/navigation';
import { loadFw, WARZONES, type FwData, type FwState, type Leaderboard, type FwSystem } from '../services/fw';
import { tx, locale } from '../i18n';

interface FwUi { zone: string; state: 'all' | 'contested' | 'vulnerable'; board: 'kills' | 'victory_points'; period: 'last_week' | 'yesterday' | 'active_total'; q: string }

const UI_KEY = 'eve-ops:fw';

const STATE: Record<FwState, [string, string]> = {
  captured: [tx('Capturat'), 'danger'],
  contested: [tx('Contestat'), 'warn'],
  uncontested: [tx('Liniștit'), ''],
  vulnerable: [tx('Vulnerabil'), 'danger'],
};

const MILITIA: Record<number, number> = { 500001: 1000180, 500002: 1000182, 500003: 1000179, 500004: 1000181, 500010: 1000437, 500011: 1000436 };
const factionLogo = (id: number) => (MILITIA[id] ? `<img class="row-icon" src="https://images.evetech.net/corporations/${MILITIA[id]}/logo?size=32" alt="" />` : '');

export function createFwPanel(body: HTMLElement) {
  const ui = loadJson<FwUi>(UI_KEY, { zone: 'cg', state: 'all', board: 'kills', period: 'last_week', q: '' });
  let map: NavMap | null = null;
  let data: FwData | null = null;
  let run = 0;

  async function render(force = false) {
    const mine = ++run;
    if (!data || force) body.innerHTML = loader(tx('Citim Faction Warfare din ESI'));
    try {
      const [d, m] = await Promise.all([loadFw(force), map ? Promise.resolve(map) : loadMap()]);
      if (mine !== run) return;
      data = d;
      map = m;
      draw();
    } catch (e) {
      if (mine === run) body.innerHTML = panel({ body: alertBox((e as Error).message) });
    }
  }

  const name = (id: number) => data?.names.get(id) ?? String(id);

  function zoneBar(sides: [number, number], systems: FwSystem[]) {
    const [a, b] = sides;
    const held = (f: number) => systems.filter((s) => s.occupier_faction_id === f).length;
    const ha = held(a), hb = held(b), total = Math.max(1, systems.length);
    const pctA = (ha / total) * 100;
    return `<div class="fw-zone">
      <div class="fw-zone-head"><span>${factionLogo(a)}<b>${esc(name(a))}</b> ${formatInt(ha)}</span><span>${formatInt(hb)} <b>${esc(name(b))}</b>${factionLogo(b)}</span></div>
      <div class="fw-tug"><i style="width:${pctA.toFixed(1)}%"></i></div>
    </div>`;
  }

  function factionCards(sides: number[]) {
    const stats = data!.stats.filter((s) => sides.includes(s.faction_id) || !WARZONES.some((z) => z.sides.includes(s.faction_id)));
    return `<div class="fw-factions">${stats.map((s) => {
      const enemies = data!.wars.filter((w) => w.faction_id === s.faction_id).map((w) => name(w.against_id));
      return `<div class="fw-faction">
        <div class="fw-faction-head">${factionLogo(s.faction_id)}<b>${esc(name(s.faction_id))}</b></div>
        <div class="fw-faction-grid">
          <span class="dim small">${tx('Piloți')}</span><span class="num">${formatInt(s.pilots)}</span>
          <span class="dim small">${tx('Sisteme')}</span><span class="num">${formatInt(s.systems_controlled)}</span>
          <span class="dim small">${tx('Kill-uri ieri / 7 zile')}</span><span class="num">${formatInt(s.kills.yesterday)} / ${formatInt(s.kills.last_week)}</span>
          <span class="dim small">${tx('VP ieri / 7 zile')}</span><span class="num">${formatInt(s.victory_points.yesterday)} / ${formatInt(s.victory_points.last_week)}</span>
        </div>
        ${enemies.length ? `<div class="dim small">${tx('În război cu {list}', { list: enemies.map(esc).join(', ') })}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function systemsTable(systems: FwSystem[]) {
    const q = ui.q.trim().toLowerCase();
    const list = systems
      .filter((s) => ui.state === 'all' || (ui.state === 'vulnerable' ? s.contested === 'vulnerable' || s.contested === 'captured' : s.contested !== 'uncontested'))
      .map((s) => ({ s, sys: map!.systems.get(s.solar_system_id) }))
      .filter((r) => !q || (r.sys?.name ?? '').toLowerCase().includes(q) || (r.sys ? map!.region(r.sys).toLowerCase().includes(q) : false))
      .sort((x, y) => y.s.victory_points / Math.max(1, y.s.victory_points_threshold) - x.s.victory_points / Math.max(1, x.s.victory_points_threshold));
    return `<div class="table-scroll"><table class="table compact"><thead><tr>
      <th>${tx('Sistem')}</th><th>${tx('Ocupat de')}</th><th>${tx('Stare')}</th><th class="r">${tx('Contestat')}</th><th class="r">VP</th>
    </tr></thead><tbody>${list.map(({ s, sys }) => {
      const pct = (s.victory_points / Math.max(1, s.victory_points_threshold)) * 100;
      const [label, tone] = STATE[s.contested] ?? [s.contested, ''];
      return `<tr>
        <td>${sys ? `<span class="${secClass(sys.sec)} num">${formatNum(displaySec(sys.sec), 1)}</span> ${esc(sys.name)}<div class="dim small">${esc(map!.region(sys))} · ${esc(map!.constellation(sys))}</div>` : s.solar_system_id}</td>
        <td><span class="nav-ship-name">${factionLogo(s.occupier_faction_id)}${esc(name(s.occupier_faction_id))}</span>${s.owner_faction_id !== s.occupier_faction_id ? `<div class="dim small">${tx('Proprietar {f}', { f: esc(name(s.owner_faction_id)) })}</div>` : ''}</td>
        <td>${badge(label, tone, true)}</td>
        <td class="r num"><div class="ops-bar"><span style="width:${Math.min(100, pct).toFixed(1)}%"></span></div>${formatNum(pct, 1)}%</td>
        <td class="r num">${formatInt(s.victory_points)} / ${formatInt(s.victory_points_threshold)}</td>
      </tr>`;
    }).join('')}</tbody></table></div>${list.length ? '' : `<p class="dim">${tx('Niciun sistem pentru filtrele alese.')}</p>`}`;
  }

  function leaderboard() {
    const d = data!;
    const pick = <K extends string>(b: Leaderboard<K>, key: K) =>
      (b[ui.board][ui.period] ?? []).slice(0, 10).map((r, i) => `<tr><td class="num dim">${i + 1}</td><td>${esc(name(r[key]))}</td><td class="r num">${formatInt(r.amount)}</td></tr>`).join('');
    const table = (title: string, rows: string) => `<div><h4 class="ct-sub">${title}</h4><table class="table compact"><tbody>${rows || `<tr><td class="dim">—</td></tr>`}</tbody></table></div>`;
    return `<div class="fw-boards">${table(tx('Piloți'), pick(d.characters, 'character_id'))}${table(tx('Corporații'), pick(d.corporations, 'corporation_id'))}</div>`;
  }

  function draw() {
    const d = data!;
    const zone = WARZONES.find((z) => z.id === ui.zone) ?? WARZONES[0];
    const systems = d.systems.filter((s) => zone.sides.includes(s.owner_faction_id));
    const chips = (items: [string, string][], key: keyof FwUi) => `<div class="advice-sort">${items.map(([id, l]) => `<button class="chip-btn ${ui[key] === id ? 'active' : ''}" data-fw-${key}="${id}">${esc(l)}</button>`).join('')}</div>`;
    body.innerHTML = `${panel({
      title: 'Faction Warfare',
      actions: `<button class="btn ghost sm" data-fw-refresh>${icon('refresh')}${tx('Verifică acum')}</button>`,
      body: `${chips(WARZONES.map((z) => [z.id, `${name(z.sides[0])} · ${name(z.sides[1])}`]), 'zone')}
        ${zoneBar(zone.sides, systems)}
        ${factionCards(zone.sides)}
        <p class="dim small">${tx('Citit la {time}', { time: new Date(d.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</p>`,
    })}
    <div class="grid-2 wide-right">
      ${panel({
        title: tx('Sisteme'),
        count: systems.length,
        body: `<div class="ct-filters">${chips([['all', tx('Toate')], ['contested', tx('Contestate')], ['vulnerable', tx('Vulnerabile')]], 'state')}
          <input class="input fw-q" data-fw-q value="${esc(ui.q)}" placeholder="${tx('Sistem sau regiune')}" autocomplete="off" spellcheck="false" /></div>
          ${systemsTable(systems)}`,
      })}
      ${panel({
        title: tx('Clasament'),
        body: `<div class="ct-filters">${chips([['kills', tx('Kill-uri')], ['victory_points', 'VP']], 'board')}
          ${chips([['yesterday', tx('Ieri')], ['last_week', tx('7 zile')], ['active_total', tx('Total')]], 'period')}</div>
          ${leaderboard()}`,
      })}
    </div>`;
  }

  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!body.querySelector('[data-fw-refresh]')) return;
    if (t.closest('[data-fw-refresh]')) { render(true); return; }
    const b = t.closest<HTMLElement>('[data-fw-zone],[data-fw-state],[data-fw-board],[data-fw-period]');
    if (!b) return;
    if (b.dataset.fwZone) ui.zone = b.dataset.fwZone;
    if (b.dataset.fwState) ui.state = b.dataset.fwState as FwUi['state'];
    if (b.dataset.fwBoard) ui.board = b.dataset.fwBoard as FwUi['board'];
    if (b.dataset.fwPeriod) ui.period = b.dataset.fwPeriod as FwUi['period'];
    saveJson(UI_KEY, ui);
    draw();
  });

  body.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.matches('[data-fw-q]')) return;
    ui.q = t.value;
    saveJson(UI_KEY, ui);
    const pos = t.selectionStart;
    draw();
    const next = body.querySelector<HTMLInputElement>('[data-fw-q]');
    if (next) { next.focus(); next.setSelectionRange(pos, pos); }
  });

  return { render, stop: () => { run++; } };
}
