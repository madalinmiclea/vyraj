import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, formatInt, formatNum, compactISK, emptyState, badge, button, windowTitle } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { typeIconUrl } from '../services/market';
import { portraitUrl } from '../character/esi';
import {
  findSystem, route, systemInfo, systemActivity, recentKills, resolveIds, resolveNames, cachedName, affiliations, pilotStats, cachedPilot,
  parsePaste, estimateDps, threat, displaySec, secClass,
  type RouteFlag, type SystemInfo, type SystemActivity, type SystemIntel, type Pilot, type DscanRow, type DpsEstimate,
} from '../services/recon';
import { tx } from '../i18n';
import { allEveItems } from '../data/items';

type Tab = 'route' | 'local';

const TABS: { id: Tab; label: string }[] = [
  { id: 'route', label: tx('Rută') },
  { id: 'local', label: tx('Local și D-Scan') },
];

const TAB_KEY = 'eve-recon:tab';
const ROUTE_KEY = 'eve-recon:route';
const RECENT_ROUTES_KEY = 'eve-recon:recent-routes';
const MAX_PILOTS = 300;
const AUTO_DETAILS = 5;

const FLAGS: { id: RouteFlag; label: string }[] = [
  { id: 'shortest', label: tx('Cea mai scurtă') },
  { id: 'secure', label: tx('Cea mai sigură') },
  { id: 'insecure', label: tx('Prin low/null') },
];

const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 60 ? tx('acum {n} min', { n: m }) : tx('acum {n} h', { n: Math.round(m / 60) });
};

const secCell = (s: SystemInfo) => `<span class="num ${secClass(s.sec)}">${formatNum(displaySec(s.sec), 1)}</span>`;

const zkbLink = (kind: 'system' | 'character' | 'kill', id: number, text: string) =>
  `<a class="ext-link" href="https://zkillboard.com/${kind}/${id}/" target="_blank" rel="noopener noreferrer">${text}</a>`;

function riskOf(a: SystemActivity | undefined, intel?: SystemIntel): { level: 0 | 1 | 2 | 3; label: string } {
  if (intel?.camp) return { level: 3, label: intel.smartbomb ? tx('Smartbomb camp') : tx('Posibil gatecamp') };
  const ship = a?.ship ?? 0, pod = a?.pod ?? 0;
  const score = ship + pod * 1.5;
  if (score >= 8 || pod >= 3) return { level: 3, label: tx('Periculos') };
  if (score >= 3) return { level: 2, label: tx('Activitate') };
  if (score > 0) return { level: 1, label: tx('Câteva kill-uri') };
  return { level: 0, label: tx('Liniștit') };
}

const RISK_TONE = ['ok', 'gold', 'warn', 'danger'];
const THREAT_LABEL = () => [tx('Necunoscut'), tx('Ocazional'), tx('Activ'), tx('Periculos')];

function dpsTip(e: DpsEstimate) {
  const parts = [`${tx('Estimare')}: ${formatInt(e.dps)} DPS`];
  if (e.weapons) parts.push(`${tx('Arme')}: ${e.weapons} × ${e.perWeapon}${e.bonus > 1 ? ` × ${e.bonus} ${tx('bonus navă')}` : ''}`);
  if (e.drones) parts.push(`${tx('Drone')}: ${formatInt(e.bandwidth)} Mbit/s → ${formatInt(e.drones)}`);
  return parts.join('\n');
}

export function createReconView(el: HTMLElement, ctx: AppContext, side: HTMLElement) {
  let tab = loadJson<Tab>(TAB_KEY, 'route');
  if (!TABS.some((t) => t.id === tab)) tab = 'route';
  const saved = loadJson<{ from: string; to: string; flag: RouteFlag }>(ROUTE_KEY, { from: 'Jita', to: 'Amarr', flag: 'shortest' });

  el.innerHTML = `${pageHead(tx('Intel PvP'), tx('Pericol pe rută și analiza Local / D-Scan'), 'Cladistic Recon')}
    <div id="reconRoute"></div>
    <div id="reconLocal"></div>`;
  const routeEl = el.querySelector<HTMLElement>('#reconRoute')!;
  const localEl = el.querySelector<HTMLElement>('#reconLocal')!;

  let itemNames: Map<number, string> | null = null;
  const localName = (id: number) => {
    itemNames ??= new Map(allEveItems.map((i) => [i.t, i.n.trim()]));
    return ctx.sde.types.get(id)?.name ?? itemNames.get(id);
  };
  const remoteName = (id: number) => {
    const n = cachedName(id);
    return n && n !== String(id) ? n : '';
  };
  const isSmartbomb = (id: number) => {
    const t = ctx.sde.types.get(id);
    return t ? t.groupName === 'Smart Bomb' : /smartbomb/i.test(localName(id) ?? '');
  };
  const shipName = (id?: number) => (id ? localName(id) ?? (remoteName(id) || `#${id}`) : '—');
  const shipCell = (id?: number) => (id ? `<span class="recon-ship"><img class="row-icon" src="${typeIconUrl(id, 32)}" alt="" /><span>${esc(shipName(id))}</span></span>` : '<span class="dim">—</span>');

  function renderTabs() {
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Intel PvP'))}</div>
      <div class="side-nav">${TABS.map((t) => `<button class="side-link ${t.id === tab ? 'active' : ''}" data-recon-tab="${t.id}">${t.label}</button>`).join('')}</div>`;
    routeEl.hidden = tab !== 'route';
    localEl.hidden = tab !== 'local';
  }

  side.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-recon-tab]');
    if (!b) return;
    tab = b.dataset.reconTab as Tab;
    saveJson(TAB_KEY, tab);
    renderTabs();
  });

  routeEl.innerHTML = `${panel({
    body: `<form class="form-grid recon-form" id="routeForm">
        <label>${tx('Pornire')}<input class="input" name="from" value="${esc(saved.from)}" autocomplete="off" spellcheck="false" required /></label>
        <label>${tx('Destinație')}<input class="input" name="to" value="${esc(saved.to)}" autocomplete="off" spellcheck="false" required /></label>
        <label>${tx('Preferință')}<select class="input" name="flag">${FLAGS.map((f) => `<option value="${f.id}" ${f.id === saved.flag ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label>
        <button class="btn" type="submit">${icon('search')}${tx('Verifică ruta')}</button>
      </form>
      <p class="dim small">${tx('Kill-urile pe sistem vin din ESI (ultima oră, actualizate de CCP o dată pe oră). Sistemele cu kill-uri primesc detalii din zKillboard: ce nave au murit, cine a atacat și dacă pare un gatecamp.')}</p>`,
  })}<div id="routeResult"></div>`;
  const routeForm = routeEl.querySelector<HTMLFormElement>('#routeForm')!;
  const routeResult = routeEl.querySelector<HTMLElement>('#routeResult')!;

  type SavedRoute = { from: string; to: string; flag: RouteFlag };
  const recentRoutes = () => loadJson<SavedRoute[]>(RECENT_ROUTES_KEY, []);
  function renderRecentRoutes() {
    const list = recentRoutes();
    if (!list.length) return;
    routeResult.innerHTML = panel({
      title: tx('Rute recente'),
      body: `<div class="item-tiles">${list.map((r, i) => `<button class="item-tile" data-recent-route="${i}"><span>${icon('jump')}</span><span class="tile-text"><span>${esc(r.from)} → ${esc(r.to)}</span><small>${FLAGS.find((f) => f.id === r.flag)?.label ?? ''}</small></span></button>`).join('')}</div>`,
    });
  }
  routeResult.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-recent-route]');
    if (!b) return;
    const r = recentRoutes()[Number(b.dataset.recentRoute)];
    if (!r) return;
    routeForm.querySelector<HTMLInputElement>('[name="from"]')!.value = r.from;
    routeForm.querySelector<HTMLInputElement>('[name="to"]')!.value = r.to;
    routeForm.querySelector<HTMLSelectElement>('[name="flag"]')!.value = r.flag;
    routeForm.requestSubmit();
  });
  renderRecentRoutes();

  let routeRun = 0;
  let path: SystemInfo[] = [];
  let act = new Map<number, SystemActivity>();
  let actAt = 0;
  const intel = new Map<number, SystemIntel | 'loading' | string>();
  const open = new Set<number>();

  routeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(routeForm);
    const q = { from: String(fd.get('from') ?? '').trim(), to: String(fd.get('to') ?? '').trim(), flag: fd.get('flag') as RouteFlag };
    saveJson(ROUTE_KEY, q);
    saveJson(RECENT_ROUTES_KEY, [q, ...recentRoutes().filter((r) => r.from.toLowerCase() !== q.from.toLowerCase() || r.to.toLowerCase() !== q.to.toLowerCase() || r.flag !== q.flag)].slice(0, 8));
    const run = ++routeRun;
    routeResult.innerHTML = loader(tx('Calculez ruta'));
    try {
      const [a, b] = await Promise.all([findSystem(q.from), findSystem(q.to)]);
      const ids = await route(a.id, b.id, q.flag);
      const [info, activity] = await Promise.all([systemInfo(ids), systemActivity()]);
      if (run !== routeRun) return;
      path = ids.map((id) => info.get(id)!);
      act = activity.map;
      actAt = activity.at;
      intel.clear();
      open.clear();
      renderRoute();
      const hot = path.filter((s) => (act.get(s.id)?.ship ?? 0) + (act.get(s.id)?.pod ?? 0) > 0)
        .sort((x, y) => (act.get(y.id)!.ship + act.get(y.id)!.pod) - (act.get(x.id)!.ship + act.get(x.id)!.pod))
        .slice(0, AUTO_DETAILS);
      for (const s of hot) await loadIntel(s.id, run);
    } catch (err) {
      if (run === routeRun) routeResult.innerHTML = alertBox((err as Error).message);
    }
  });

  async function loadIntel(id: number, run = routeRun) {
    const cur = intel.get(id);
    if (cur === 'loading' || (cur && typeof cur === 'object')) return;
    intel.set(id, 'loading');
    renderRoute();
    try {
      const r = await recentKills(id, isSmartbomb);
      const unknownShips = r.kills.flatMap((k) => [k.victimShip, ...k.shipList.map((x) => x.id)]).filter((t) => t && !localName(t));
      await resolveNames([...r.kills.flatMap((k) => k.attackerAlliances), ...unknownShips]);
      if (run !== routeRun) return;
      intel.set(id, r);
      if (r.camp || r.kills.length) open.add(id);
    } catch (err) {
      if (run !== routeRun) return;
      intel.set(id, tx('zKillboard nu a răspuns ({msg}). Încearcă din nou peste un minut.', { msg: (err as Error).message }));
    }
    renderRoute();
  }

  function attackersTitle(k: SystemIntel['kills'][number]) {
    if (k.npc) return tx('Omorât doar de NPC-uri (CONCORD, sentry gun-uri sau rați), fără jucători.');
    const parts = [tx('{n} jucători', { n: k.players })];
    if (k.npcAttackers) parts.push(tx('{n} NPC (sentry gun, CONCORD, rați)', { n: k.npcAttackers }));
    if (k.solo) parts.push(tx('Solo pe zKillboard: un singur jucător, NPC-urile nu se pun la socoteală.'));
    return parts.join(' · ');
  }

  function shipsCell(k: SystemIntel['kills'][number]) {
    if (!k.shipList.length) return shipCell(k.topShip);
    const names = k.shipList.map((x) => `${esc(shipName(x.id))}${x.n > 1 ? ` <span class="dim">×${x.n}</span>` : ''}`).join(', ');
    return `<span class="recon-ships"><img class="row-icon" src="${typeIconUrl(k.shipList[0].id, 32)}" alt="" /><span>${names}</span></span>`;
  }

  function killsTable(r: SystemIntel) {
    if (!r.kills.length) return `<p class="dim small">${tx('Niciun kill în ultimele 60 de minute pe zKillboard.')}</p>`;
    const shown = r.kills.length < r.total ? tx('Afișez {n} din {total} kill-uri pe zKillboard în ultima oră (cele mai recente).', { n: r.kills.length, total: r.total }) : tx('{n} kill-uri pe zKillboard în ultima oră.', { n: r.kills.length });
    return `<p class="dim small">${shown}</p><table class="table compact recon-kills"><thead><tr><th>${tx('Când')}</th><th>${tx('Victimă')}</th><th class="r">${tx('Valoare')}</th><th class="r" title="${esc(tx('Jucători care au participat la kill. NPC-urile (sentry gun-uri, CONCORD, rați) apar separat.'))}">${tx('Atacatori')}</th><th>${tx('Navă atacator')}</th><th>${tx('Alianță atacator')}</th><th></th></tr></thead><tbody>
      ${r.kills.map((k) => `<tr>
        <td class="num">${ago(k.time)}</td>
        <td>${shipCell(k.victimShip)}</td>
        <td class="r num">${compactISK(k.value)}</td>
        <td class="r num" title="${esc(attackersTitle(k))}">${k.npc ? badge(tx('Doar NPC')) : `${k.players}${k.npcAttackers ? ` <span class="dim">+ ${k.npcAttackers} NPC</span>` : ''}${k.solo ? ` ${badge('solo', 'gold')}` : ''}`}</td>
        <td>${shipsCell(k)}</td>
        <td class="dim recon-list">${k.attackerAlliances.map((a) => esc(cachedName(a))).join(', ') || '—'}</td>
        <td class="r">${zkbLink('kill', k.id, icon('external'))}</td>
      </tr>`).join('')}
    </tbody></table>`;
  }

  function renderRoute() {
    if (!path.length) { routeResult.innerHTML = ''; return; }
    const rows = path.map((s, i) => ({ s, i, a: act.get(s.id), r: intel.get(s.id) }));
    const ships = rows.reduce((n, x) => n + (x.a?.ship ?? 0), 0);
    const pods = rows.reduce((n, x) => n + (x.a?.pod ?? 0), 0);
    const risky = rows.filter((x) => riskOf(x.a, typeof x.r === 'object' ? x.r : undefined).level >= 2);
    const camps = rows.filter((x) => typeof x.r === 'object' && x.r.camp);
    const minSec = Math.min(...path.map((s) => s.sec));
    const verdict = camps.length ? alertBox(tx('Posibil gatecamp în: {list}', { list: camps.map((x) => x.s.name).join(', ') }), 'danger')
      : risky.length ? alertBox(tx('Atenție la: {list}', { list: risky.map((x) => x.s.name).join(', ') }), 'warn')
      : `<div class="alert ok">${icon('check')}<span>${tx('Nicio activitate PvP semnificativă pe rută în ultima oră.')}</span></div>`;
    routeResult.innerHTML = panel({
      title: `${path[0].name} → ${path[path.length - 1].name}`,
      count: tx('{n} sărituri', { n: path.length - 1 }),
      actions: `<span class="dim small">ESI ${ago(actAt)}</span>`,
      body: `<div class="history-kpis">
          <div><span class="label">${tx('Sărituri')}</span><span class="value">${path.length - 1}</span></div>
          <div><span class="label">${tx('Nave distruse / h')}</span><span class="value">${formatInt(ships)}</span></div>
          <div><span class="label">${tx('Capsule / h')}</span><span class="value">${formatInt(pods)}</span></div>
          <div><span class="label">${tx('Sisteme cu risc')}</span><span class="value">${risky.length}</span></div>
          <div><span class="label">${tx('Securitate minimă')}</span><span class="value ${secClass(minSec)}">${formatNum(displaySec(minSec), 1)}</span></div>
        </div>
        ${verdict}
        <div class="table-scroll"><table class="table compact recon-route"><thead><tr>
          <th class="r">#</th><th>${tx('Sistem')}</th><th class="r" title="${esc(tx('Nivelul de securitate al sistemului.'))}">Sec</th><th class="r" title="${esc(tx('Nave de jucători distruse în sistem în ultima oră, fără capsule. Sursa: ESI, actualizat de CCP o dată pe oră. Include și navele de gank omorâte de CONCORD.'))}">${tx('Nave distruse / h')}</th><th class="r" title="${esc(tx('Capsule distruse în sistem în ultima oră (ESI).'))}">${tx('Capsule / h')}</th><th class="r" title="${esc(tx('NPC-uri (rați) omorâte de jucători în ultima oră (ESI). Arată cât de mult se face PvE aici, nu pericol.'))}">${tx('NPC uciși / h')}</th><th class="r" title="${esc(tx('Nave care au intrat în sistem prin stargate în ultima oră (ESI). Arată traficul.'))}">${tx('Sărituri / h')}</th><th>${tx('Risc')}</th><th></th>
        </tr></thead><tbody>
        ${rows.map(({ s, i, a, r }) => {
          const det = typeof r === 'object' ? r : undefined;
          const risk = riskOf(a, det);
          const action = r === 'loading' ? `<span class="dim small">${tx('zKillboard...')}</span>`
            : det ? `<button class="btn ghost sm" data-toggle="${s.id}">${open.has(s.id) ? tx('Ascunde') : tx('Detalii')}</button>`
            : (a?.ship ?? 0) + (a?.pod ?? 0) > 0 ? `<button class="btn ghost sm" data-intel="${s.id}">${tx('Detalii')}</button>` : '';
          return `<tr class="${risk.level >= 3 ? 'risk-hi' : ''}">
            <td class="r num dim">${i}</td>
            <td>${zkbLink('system', s.id, esc(s.name))}</td>
            <td class="r">${secCell(s)}</td>
            <td class="r num ${(a?.ship ?? 0) > 0 ? 'neg-text' : 'dim'}">${a?.ship ?? 0}</td>
            <td class="r num ${(a?.pod ?? 0) > 0 ? 'neg-text' : 'dim'}">${a?.pod ?? 0}</td>
            <td class="r num dim">${a?.npc ?? 0}</td>
            <td class="r num dim">${formatInt(a?.jumps ?? 0)}</td>
            <td>${badge(risk.label, RISK_TONE[risk.level], true)}</td>
            <td class="r">${action}</td>
          </tr>${typeof r === 'string' && r !== 'loading' ? `<tr class="recon-detail"><td></td><td colspan="8">${alertBox(r, 'warn')}</td></tr>` : ''}
          ${det && open.has(s.id) ? `<tr class="recon-detail"><td></td><td colspan="8">${killsTable(det)}</td></tr>` : ''}`;
        }).join('')}
        </tbody></table></div>`,
    });
  }

  routeResult.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const load = t.closest<HTMLElement>('[data-intel]');
    if (load) { loadIntel(Number(load.dataset.intel)); return; }
    const tog = t.closest<HTMLElement>('[data-toggle]');
    if (tog) {
      const id = Number(tog.dataset.toggle);
      if (open.has(id)) open.delete(id); else open.add(id);
      renderRoute();
    }
  });

  localEl.innerHTML = `${panel({
    body: `<p class="dim small">${tx('În joc, dă click în lista din Local sau din fereastra D-Scan, apasă Ctrl+A apoi Ctrl+C și lipește aici. Vyraj recunoaște singur ce ai lipit.')}</p>
      <textarea class="input area" id="reconPaste" rows="8" spellcheck="false" placeholder="${esc(tx('Lipește lista din Local sau rezultatul D-Scan'))}"></textarea>
      <div class="row-actions">${button(tx('Analizează'), { iconName: 'search', attrs: 'data-analyze' })}${button(tx('Golește'), { cls: 'ghost', attrs: 'data-clear' })}</div>`,
  })}<div id="localResult"></div>`;
  const paste = localEl.querySelector<HTMLTextAreaElement>('#reconPaste')!;
  const localResult = localEl.querySelector<HTMLElement>('#localResult')!;

  let localRun = 0;
  let pilots: Pilot[] = [];
  let pending = 0;
  let unknown: string[] = [];

  async function analyze() {
    const parsed = parsePaste(paste.value);
    const run = ++localRun;
    pilots = [];
    if (parsed.kind === 'empty') {
      localResult.innerHTML = panel({ body: emptyState({ title: tx('Nimic de analizat'), text: tx('Lipește numele piloților din Local (unul pe rând) sau liniile copiate din D-Scan.'), vy: 'Nothing to Discern', vyText: 'Paste the pilot names from Local (one per line) or the lines copied from D-Scan, and the Clade shall discern them.' }) });
      return;
    }
    if (parsed.kind === 'dscan') { renderDscan(parsed.rows); return; }
    localResult.innerHTML = loader(tx('Caut {n} piloți', { n: parsed.names.length }));
    try {
      const { characters } = await resolveIds(parsed.names);
      const found = new Set(characters.map((c) => c.name.toLowerCase()));
      unknown = parsed.names.filter((n) => !found.has(n.toLowerCase()));
      const aff = await affiliations(characters.map((c) => c.id));
      await resolveNames([...aff.values()].flatMap((a) => [a.corpId, a.allianceId ?? 0]).filter(Boolean));
      if (run !== localRun) return;
      pilots = characters.map((c) => ({ id: c.id, name: c.name, corpId: aff.get(c.id)?.corpId, allianceId: aff.get(c.id)?.allianceId, stats: cachedPilot(c.id) }));
      const todo = pilots.slice(0, MAX_PILOTS).filter((p) => p.stats === undefined);
      pending = todo.length;
      renderLocal();
      let last = Date.now();
      for (const p of todo) {
        try { p.stats = await pilotStats(p.id); } catch { p.stats = null; p.failed = true; }
        if (run !== localRun) return;
        pending--;
        if (Date.now() - last > 1500 || !pending) { renderLocal(); last = Date.now(); }
      }
    } catch (err) {
      if (run === localRun) localResult.innerHTML = alertBox((err as Error).message);
    }
  }

  function renderLocal() {
    const rank = (p: Pilot) => (p.failed ? 1.5 : threat(p.stats));
    const list = [...pilots].sort((a, b) => rank(b) - rank(a) || (b.stats?.recent ?? 0) - (a.stats?.recent ?? 0) || (b.stats?.kills ?? 0) - (a.stats?.kills ?? 0));
    const groups = new Map<string, { id?: number; corp: boolean; n: number; danger: number }>();
    for (const p of list) {
      const key = p.allianceId ? `a${p.allianceId}` : `c${p.corpId}`;
      const g = groups.get(key) ?? { id: p.allianceId ?? p.corpId, corp: !p.allianceId, n: 0, danger: 0 };
      g.n++;
      if (threat(p.stats) >= 2) g.danger++;
      groups.set(key, g);
    }
    const mains = list.map((p) => ({ p, ship: p.stats?.topShips[0]?.id, est: p.stats?.topShips[0] ? estimateDps(ctx.sde, p.stats.topShips[0].id) : null }));
    const dps = mains.reduce((n, m) => n + (threat(m.p.stats) >= 1 ? m.est?.dps ?? 0 : 0), 0);
    const dangerous = list.filter((p) => threat(p.stats) >= 2).length;
    const failed = list.filter((p) => p.failed).length;
    const logo = (g: { id?: number; corp: boolean }) => (g.id ? `<img class="row-icon" src="https://images.evetech.net/${g.corp ? 'corporations' : 'alliances'}/${g.id}/logo?size=32" alt="" />` : '');
    localResult.innerHTML = `<div class="history-kpis intel-kpis">
        <div><span class="label">${tx('Piloți')}</span><span class="value">${formatInt(list.length)}</span></div>
        <div><span class="label">${tx('Grupări')}</span><span class="value">${formatInt(groups.size)}</span></div>
        <div><span class="label">${tx('Activi / periculoși')}</span><span class="value ${dangerous ? 'neg-text' : ''}">${formatInt(dangerous)}</span></div>
        <div title="${esc(tx('Suma DPS-ului estimat pentru nava cea mai folosită de fiecare pilot cu kill-uri. Estimare din hardpoint-uri și drone bandwidth, nu fit-ul real.'))}"><span class="label">${tx('DPS estimat')}</span><span class="value">~${formatInt(dps)}</span></div>
        ${pending ? `<div><span class="label">zKillboard</span><span class="value dim">${tx('încă {n}', { n: pending })}</span></div>` : ''}
      </div>
      ${failed ? alertBox(tx('zKillboard nu a răspuns pentru {n} piloți (site căzut sau prea multe cereri). Nu știm nimic despre ei, nu-i considera inofensivi. Apasă din nou Analizează peste un minut.', { n: failed }), 'danger') : ''}
      ${unknown.length ? alertBox(tx('Nume negăsite: {list}', { list: unknown.slice(0, 10).join(', ') + (unknown.length > 10 ? '…' : '') }), 'warn') : ''}
      ${list.length > MAX_PILOTS ? alertBox(tx('Istoricul zKillboard se încarcă doar pentru primii {n} piloți.', { n: MAX_PILOTS }), 'warn') : ''}
      <div class="recon-grid">
        ${panel({
          title: tx('Piloți'),
          count: formatInt(list.length),
          body: `<div class="table-scroll"><table class="table compact recon-pilots"><thead><tr>
              <th>${tx('Pilot')}</th><th>${tx('Corporație / alianță')}</th><th class="r">Kills</th><th class="r">Losses</th><th class="r">Solo</th><th class="r">Danger</th><th class="r">${tx('Kill-uri 7z')}</th><th>${tx('Navă preferată')}</th><th class="r">DPS ~</th><th>${tx('Amenințare')}</th>
            </tr></thead><tbody>
            ${mains.map(({ p, ship, est }) => {
              const s = p.stats;
              const lvl = threat(s);
              return `<tr>
                <td><span class="recon-ship"><img class="row-icon round" src="${portraitUrl(p.id, 32)}" alt="" />${zkbLink('character', p.id, esc(p.name))}</span></td>
                <td class="dim recon-aff">${esc(cachedName(p.corpId))}${p.allianceId ? `<small>${esc(cachedName(p.allianceId))}</small>` : ''}</td>
                ${s === undefined ? `<td colspan="5" class="dim small">${tx('se încarcă...')}</td>`
                  : p.failed ? `<td colspan="5" class="small warn-text">${tx('zKillboard indisponibil')}</td>`
                  : `<td class="r num">${formatInt(s?.kills ?? 0)}</td><td class="r num dim">${formatInt(s?.losses ?? 0)}</td><td class="r num">${formatInt(s?.solo ?? 0)}</td><td class="r num">${s?.kills ? s.danger + '%' : '—'}</td><td class="r num ${(s?.recent ?? 0) > 0 ? 'neg-text' : 'dim'}">${formatInt(s?.recent ?? 0)}</td>`}
                <td>${shipCell(ship)}</td>
                <td class="r num" ${est ? `title="${esc(dpsTip(est))}"` : ''}>${est ? formatInt(est.dps) : '—'}</td>
                <td>${s === undefined ? '' : p.failed ? badge(tx('Neverificat'), 'warn', true) : badge(THREAT_LABEL()[lvl], RISK_TONE[lvl], true)}</td>
              </tr>`;
            }).join('')}
            </tbody></table></div>`,
        })}
        ${panel({
          title: tx('Grupări'),
          body: `<ul class="idea-list recon-groups">${[...groups.values()].sort((a, b) => b.n - a.n).map((g) => `<li>${logo(g)}<span class="idea-name">${esc(cachedName(g.id) || '—')}<small class="dim">${g.corp ? tx('corporație') : tx('alianță')}</small></span><span class="idea-val num">${g.n}${g.danger ? ` <small class="neg-text">${tx('{n} activi', { n: g.danger })}</small>` : ''}</span></li>`).join('')}</ul>`,
        })}
      </div>
      <p class="dim small">${tx('Danger = procentul de nave de luptă din kill-urile pilotului (zKillboard). DPS-ul e o estimare din hardpoint-uri, mărimea navei și drone bandwidth, nu din fit-ul real.')}</p>`;
  }

  function renderDscan(rows: DscanRow[]) {
    const byType = new Map<number, { typeId: number; typeName: string; n: number; grid: number; ship: boolean; group: string; est: DpsEstimate | null }>();
    for (const r of rows) {
      const t = ctx.sde.types.get(r.typeId) ?? ctx.sde.findType(r.typeName);
      const id = t?.id ?? r.typeId;
      const x = byType.get(id) ?? { typeId: id, typeName: t?.name ?? r.typeName, n: 0, grid: 0, ship: t?.categoryId === 6 && t.groupName !== 'Capsule', group: t?.groupName ?? '', est: t ? estimateDps(ctx.sde, t.id) : null };
      x.n++;
      if (r.km != null && r.km <= 10_000) x.grid++;
      byType.set(id, x);
    }
    const all = [...byType.values()];
    const ships = all.filter((x) => x.ship).sort((a, b) => b.n - a.n || a.typeName.localeCompare(b.typeName));
    const other = all.filter((x) => !x.ship);
    const shipCount = ships.reduce((n, x) => n + x.n, 0);
    const dps = ships.reduce((n, x) => n + (x.est?.dps ?? 0) * x.n, 0);
    const byGroup = new Map<string, number>();
    for (const s of ships) byGroup.set(s.group, (byGroup.get(s.group) ?? 0) + s.n);
    const otherGroups = new Map<string, number>();
    for (const o of other) otherGroups.set(o.group || o.typeName, (otherGroups.get(o.group || o.typeName) ?? 0) + o.n);
    const isBubble = (group: string, name: string) => /Warp Disrupt|Interdiction/i.test(group) || /Warp Disrupt(or|ion)|Interdiction Sphere/i.test(name);
    const bubbleRows = rows.filter((r) => {
      const t = ctx.sde.types.get(r.typeId) ?? ctx.sde.findType(r.typeName);
      return !(t?.categoryId === 6) && isBubble(t?.groupName ?? '', t?.name ?? r.typeName);
    });
    const nearBubbles = bubbleRows.filter((r) => r.km != null && r.km <= 10_000).sort((a, b) => a.km! - b.km!);
    const farBubbles = bubbleRows.length - nearBubbles.length;
    const bubbleAlerts = [
      nearBubbles.length ? alertBox(nearBubbles.length === 1
        ? tx('Bulă de warp pe grid, la {dist}', { dist: nearBubbles[0].distance })
        : tx('{n} bule de warp pe grid, cea mai apropiată la {dist}', { n: nearBubbles.length, dist: nearBubbles[0].distance }), 'danger') : '',
      farBubbles ? alertBox(farBubbles === 1 ? tx('O bulă de warp în sistem, departe de tine (AU)') : tx('{n} bule de warp în sistem, departe de tine (AU)', { n: farBubbles }), 'warn') : '',
    ].join('');
    const caps = ships.filter((s) => /Carrier|Dreadnought|Titan|Supercarrier|Force Auxiliary/i.test(s.group));
    localResult.innerHTML = `<div class="history-kpis intel-kpis">
        <div><span class="label">${tx('Nave')}</span><span class="value">${formatInt(shipCount)}</span></div>
        <div><span class="label">${tx('Tipuri de nave')}</span><span class="value">${formatInt(ships.length)}</span></div>
        <div><span class="label">${tx('Pe grid')}</span><span class="value">${formatInt(ships.reduce((n, x) => n + x.grid, 0))}</span></div>
        <div title="${esc(tx('Suma DPS-ului estimat pentru navele văzute. Estimare din hardpoint-uri și drone bandwidth, nu fit-ul real.'))}"><span class="label">${tx('DPS estimat')}</span><span class="value">~${formatInt(dps)}</span></div>
        <div><span class="label">${tx('Alte obiecte')}</span><span class="value">${formatInt(other.reduce((n, x) => n + x.n, 0))}</span></div>
      </div>
      ${bubbleAlerts}
      ${caps.length ? alertBox(tx('Capitale pe scan: {list}', { list: caps.map((c) => `${c.n}× ${c.typeName}`).join(', ') }), 'danger') : ''}
      <div class="recon-grid">
        ${panel({
          title: tx('Nave'),
          count: formatInt(shipCount),
          body: ships.length ? `<div class="table-scroll"><table class="table compact"><thead><tr><th>${tx('Navă')}</th><th>${tx('Clasă')}</th><th class="r">${tx('Număr')}</th><th class="r">${tx('Pe grid')}</th><th class="r">DPS ~</th></tr></thead><tbody>
            ${ships.map((s) => `<tr><td>${shipCell(s.typeId)}</td><td class="dim">${esc(s.group)}</td><td class="r num">${s.n}</td><td class="r num dim">${s.grid}</td><td class="r num" ${s.est ? `title="${esc(dpsTip(s.est))}"` : ''}>${s.est ? formatInt(s.est.dps * s.n) : '—'}</td></tr>`).join('')}
            </tbody></table></div>` : `<p class="dim small">${tx('Nicio navă pe scan.')}</p>`,
        })}
        <div class="recon-side">
          ${panel({ title: tx('Clase de nave'), body: `<ul class="idea-list">${[...byGroup.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => `<li><span class="idea-name">${esc(g)}</span><span class="idea-val num">${n}</span></li>`).join('') || `<li class="dim">—</li>`}</ul>` })}
          ${panel({ title: tx('Alte obiecte'), body: `<ul class="idea-list">${[...otherGroups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([g, n]) => `<li><span class="idea-name">${esc(g)}</span><span class="idea-val num">${n}</span></li>`).join('') || `<li class="dim">—</li>`}</ul>` })}
        </div>
      </div>
      <p class="dim small">${tx('Pe grid = sub 10.000 km. DPS-ul e o estimare din hardpoint-uri, mărimea navei și drone bandwidth, nu din fit-ul real; carrierele și fighterii nu sunt incluși.')}</p>`;
  }

  localEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-analyze]')) analyze();
    if (t.closest('[data-clear]')) { paste.value = ''; localRun++; pilots = []; localResult.innerHTML = ''; paste.focus(); }
  });
  paste.addEventListener('paste', () => setTimeout(analyze, 0));

  renderTabs();
}
