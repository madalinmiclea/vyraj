import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, formatInt, formatNum, formatISK, badge, emptyState } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { fetchPrices, typeIconUrl } from '../services/market';
import { allEveItems } from '../data/items';
import { buildDogma, emptyFit, type Fit } from '../engine/fit';
import { loadFits } from '../fitting/savedFits';
import { bindBreakdownTips, breakdownHtml, single } from '../ui/breakdown';
import {
  loadMap, planJumps, inRange, cynoAllowed, isHighsec, displaySec, secClass, systemStats, wormholeLinks,
  ISOTOPES, POCHVEN_REGION, POCHVEN_FILAMENTS, KRAI_HOMES, KRAI_BORDERS,
  type NavMap, type NavSystem, type JumpShip, type JumpPlan, type PlanMode, type SystemStat, type WormholeLink,
} from '../services/navigation';
import { tx } from '../i18n';

type Tab = 'jump' | 'pochven' | 'wormholes';

const TABS: { id: Tab; label: string }[] = [
  { id: 'jump', label: 'Jump Planner' },
  { id: 'pochven', label: 'Pochven' },
  { id: 'wormholes', label: 'Thera / Turnur' },
];

const TAB_KEY = 'eve-nav:tab';
const PLAN_KEY = 'eve-nav:plan';
const HOME_KEY = 'eve-nav:home';
const JUMP_CATEGORY = 6;

interface PlanForm { ship: string; from: string; to: string; mode: PlanMode; avoid: string; fatigue: number }

const minutes = (m: number) => {
  const total = Math.round(m);
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
};

const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 60 ? tx('acum {n} min', { n: m }) : tx('acum {n} h', { n: Math.round(m / 60) });
};

const secCell = (s: NavSystem) => `<span class="num ${secClass(s.sec)}">${formatNum(displaySec(s.sec), 1)}</span>`;
const dotlan = (name: string, text = name) => `<a class="ext-link" href="https://evemaps.dotlan.net/system/${encodeURIComponent(name.replace(/ /g, '_'))}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

export function createNavigationView(el: HTMLElement, ctx: AppContext) {
  let tab = loadJson<Tab>(TAB_KEY, 'jump');
  if (!TABS.some((t) => t.id === tab)) tab = 'jump';
  const saved = loadJson<PlanForm>(PLAN_KEY, { ship: 'type:28844', from: '', to: '', mode: 'jumps', avoid: '', fatigue: 0 });

  el.innerHTML = `${pageHead(tx('Navigație'), tx('Jump planner pentru capitale, tracker Pochven și conexiuni Thera / Turnur'), 'Krai Passage')}
    <div class="tabs" id="navTabs"></div>
    <div id="navJump"></div>
    <div id="navPochven"></div>
    <div id="navWormholes"></div>
    <datalist id="navSystems"></datalist>`;
  const tabsEl = el.querySelector<HTMLElement>('#navTabs')!;
  const panes: Record<Tab, HTMLElement> = {
    jump: el.querySelector<HTMLElement>('#navJump')!,
    pochven: el.querySelector<HTMLElement>('#navPochven')!,
    wormholes: el.querySelector<HTMLElement>('#navWormholes')!,
  };
  const datalist = el.querySelector<HTMLDataListElement>('#navSystems')!;
  const loaded = new Set<Tab>();
  let map: NavMap | null = null;

  const mapReady = loadMap().then((m) => (map = m));

  function renderTabs() {
    tabsEl.innerHTML = TABS.map((t) => `<button class="tab ${t.id === tab ? 'active' : ''}" data-nav-tab="${t.id}">${t.label}</button>`).join('');
    for (const [id, pane] of Object.entries(panes)) pane.hidden = id !== tab;
    if (!loaded.has(tab)) {
      loaded.add(tab);
      if (tab === 'jump') initJump();
      if (tab === 'pochven') initPochven();
      if (tab === 'wormholes') initWormholes();
    }
  }

  tabsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-nav-tab]');
    if (!b) return;
    tab = b.dataset.navTab as Tab;
    saveJson(TAB_KEY, tab);
    renderTabs();
  });

  el.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.getAttribute('list') !== 'navSystems' || !map) return;
    datalist.innerHTML = map.suggest(input.value).map((s) => `<option value="${esc(s.name)}">${esc(map!.region(s))} · ${formatNum(displaySec(s.sec), 1)}</option>`).join('');
  });

  function failed(pane: HTMLElement, err: unknown) {
    pane.innerHTML = panel({ body: alertBox((err as Error).message) });
  }

  function jumpShips(): { id: number; name: string; group: string }[] {
    const rangeAttr = ctx.sde.attrId('jumpDriveRange');
    return [...ctx.sde.types.values()]
      .filter((t) => t.categoryId === JUMP_CATEGORY && (t.attrs.get(rangeAttr) ?? 0) > 0 && t.marketGroupId != null)
      .map((t) => ({ id: t.id, name: t.name, group: t.groupName }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  }

  function initJump() {
    const pane = panes.jump;
    const ships = jumpShips();
    const shipIds = new Set(ships.map((s) => s.id));
    const fits = () => loadFits().filter((f) => shipIds.has(f.shipId));
    const groups = [...new Set(ships.map((s) => s.group))];
    const fitOptions = () => {
      const list = fits();
      return list.length ? `<optgroup label="${esc(tx('Fit-uri salvate'))}">${list.map((f) => `<option value="fit:${esc(f.id)}" ${saved.ship === `fit:${f.id}` ? 'selected' : ''}>${esc(f.name)} · ${esc(ctx.sde.types.get(f.shipId)?.name ?? '')}</option>`).join('')}</optgroup>` : '';
    };

    pane.innerHTML = `${panel({
      body: `<form class="form-grid recon-form nav-form" id="jumpForm">
          <label>${tx('Navă')}<select class="input" name="ship">${fitOptions()}${groups.map((g) => `<optgroup label="${esc(g)}">${ships.filter((s) => s.group === g).map((s) => `<option value="type:${s.id}" ${saved.ship === `type:${s.id}` ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
          <label>${tx('Pornire')}<input class="input" name="from" list="navSystems" value="${esc(saved.from)}" autocomplete="off" spellcheck="false" required /></label>
          <label>${tx('Destinație')}<input class="input" name="to" list="navSystems" value="${esc(saved.to)}" autocomplete="off" spellcheck="false" required /></label>
          <label>${tx('Preferință')}<select class="input" name="mode">
            <option value="jumps" ${saved.mode === 'jumps' ? 'selected' : ''}>${tx('Cele mai puține salturi')}</option>
            <option value="fuel" ${saved.mode === 'fuel' ? 'selected' : ''}>${tx('Cel mai puțin combustibil')}</option>
          </select></label>
          <label>${tx('Evită sisteme')}<input class="input" name="avoid" value="${esc(saved.avoid)}" placeholder="${esc(tx('ex: Tama, Amamake'))}" autocomplete="off" spellcheck="false" /></label>
          <label>${tx('Oboseală acum (min)')}<input class="input nav-num" name="fatigue" type="number" min="0" max="300" step="1" value="${saved.fatigue || 0}" /></label>
          <button class="btn" type="submit">${icon('search')}${tx('Calculează')}</button>
        </form>
        <div id="jumpShip"></div>`,
    })}<div id="jumpResult"></div>`;
    const form = pane.querySelector<HTMLFormElement>('#jumpForm')!;
    const shipEl = pane.querySelector<HTMLElement>('#jumpShip')!;
    const result = pane.querySelector<HTMLElement>('#jumpResult')!;
    const tips = new Map<string, string>();
    bindBreakdownTips(pane, (k) => tips.get(k));
    let plan: { plan: JumpPlan | null; from: NavSystem; to: NavSystem; ship: JumpShip; reach: number; fuelPrice: number | null } | null = null;

    const selectedFit = (): Fit | null => {
      const v = String(new FormData(form).get('ship') ?? saved.ship);
      if (v.startsWith('fit:')) return fits().find((f) => `fit:${f.id}` === v) ?? null;
      const id = Number(v.slice(5));
      return shipIds.has(id) ? emptyFit(id) : emptyFit(ships[0].id);
    };

    function shipStats(): { ship: JumpShip; fit: Fit } {
      const fit = selectedFit() ?? emptyFit(ships[0].id);
      const d = buildDogma(ctx.sde, fit, ctx.character);
      const id = (n: string) => ctx.sde.attrId(n);
      const range = d.ship.attr(id('jumpDriveRange'));
      const fuelPerLy = d.ship.attr(id('jumpDriveConsumptionAmount'));
      const fuelType = Math.round(d.ship.attr(id('jumpDriveConsumptionType')));
      const fat = d.ship.attr(id('jumpFatigueMultiplier'));
      tips.set('range', breakdownHtml(single(d.ship.trace(id('jumpDriveRange'))), (n) => `${formatNum(n, 2)} LY`));
      tips.set('fuel', breakdownHtml(single(d.ship.trace(id('jumpDriveConsumptionAmount'))), (n) => formatNum(n, 1)));
      return { ship: { range, fuelPerLy, fuelType, fatigueFactor: fat > 0 ? fat : 1 }, fit };
    }

    function renderShip() {
      if (!ships.length) { shipEl.innerHTML = alertBox(tx('Nu găsesc nave cu jump drive în datele SDE.')); return; }
      const { ship, fit } = shipStats();
      const fuelName = allEveItems.find((i) => i.t === ship.fuelType)?.n ?? ISOTOPES[ship.fuelType] ?? `#${ship.fuelType}`;
      shipEl.innerHTML = `<div class="history-kpis nav-ship">
          <div><span class="label">${tx('Navă')}</span><span class="value nav-ship-name"><img class="row-icon" src="${typeIconUrl(fit.shipId, 32)}" alt="" />${esc(ctx.sde.types.get(fit.shipId)?.name ?? '')}</span></div>
          <div data-bd="range"><span class="label">${tx('Rază jump')}</span><span class="value accent">${formatNum(ship.range, 2)} LY</span></div>
          <div data-bd="fuel"><span class="label">${tx('Consum / LY')}</span><span class="value">${formatNum(ship.fuelPerLy, 1)}</span></div>
          <div><span class="label">${tx('Combustibil')}</span><span class="value nav-ship-name"><img class="row-icon" src="${typeIconUrl(ship.fuelType, 32)}" alt="" />${esc(fuelName)}</span></div>
          <div><span class="label">${tx('Reducere oboseală')}</span><span class="value">${formatInt(Math.round((1 - ship.fatigueFactor) * 100))}%</span></div>
        </div>
        <p class="dim small">${tx('Calculat pentru {name} cu skill-urile caracterului activ și modulele fit-ului (ex: Jump Drive Economizer). Treci cu mouse-ul peste rază și consum pentru detalii.', { name: esc(ctx.character.name) })}</p>`;
    }

    async function run(e?: Event) {
      e?.preventDefault();
      const fd = new FormData(form);
      const q: PlanForm = {
        ship: String(fd.get('ship') ?? ''),
        from: String(fd.get('from') ?? '').trim(),
        to: String(fd.get('to') ?? '').trim(),
        mode: fd.get('mode') === 'fuel' ? 'fuel' : 'jumps',
        avoid: String(fd.get('avoid') ?? '').trim(),
        fatigue: Math.max(0, Math.min(300, Number(fd.get('fatigue')) || 0)),
      };
      Object.assign(saved, q);
      saveJson(PLAN_KEY, q);
      renderShip();
      if (!q.from || !q.to) return;
      result.innerHTML = loader(tx('Calculez ruta de jump'));
      try {
        const m = map ?? (await mapReady);
        const from = m.find(q.from);
        const to = m.find(q.to);
        if (!from) throw new Error(tx('Nu găsesc sistemul „{name}”.', { name: q.from }));
        if (!to) throw new Error(tx('Nu găsesc sistemul „{name}”.', { name: q.to }));
        const avoid = new Set(q.avoid.split(/[,;\n]/).map((s) => m.find(s)?.id).filter((x): x is number => x != null && x !== to.id));
        const { ship } = shipStats();
        const p = planJumps(m, ship, from, to, q.mode, avoid, q.fatigue);
        const reach = inRange(m, from, ship.range).length;
        plan = { plan: p, from, to, ship, reach, fuelPrice: null };
        renderPlan();
        if (p) {
          const prices = await fetchPrices([ship.fuelType]).catch(() => null);
          const price = prices?.get(ship.fuelType)?.sellMin ?? null;
          if (plan?.plan === p) { plan.fuelPrice = price || null; renderPlan(); }
        }
      } catch (err) {
        result.innerHTML = panel({ body: alertBox((err as Error).message) });
      }
    }

    function renderPlan() {
      if (!plan) return;
      const { plan: p, from, to, ship, reach, fuelPrice } = plan;
      const m = map!;
      if (!p) {
        const why = !cynoAllowed(to)
          ? isHighsec(to)
            ? tx('{name} e highsec: acolo nu se poate aprinde cyno, deci nu poți sări direct. Alege un sistem lowsec din apropiere și continuă pe porți.', { name: to.name })
            : tx('În {name} nu se poate sări cu jump drive (Pochven, Zarzakh sau spațiu Jove).', { name: to.name })
          : tx('Nu există rută cu raza de {ly} LY. Antrenează Jump Drive Calibration sau alege alt punct de plecare.', { ly: formatNum(ship.range, 2) });
        result.innerHTML = panel({ title: `${from.name} → ${to.name}`, body: alertBox(why, 'warn') + `<p class="dim small">${tx('Din {name} ai {n} sisteme cyno în rază.', { name: esc(from.name), n: formatInt(reach) })}</p>` });
        return;
      }
      const cost = fuelPrice ? p.fuel * fuelPrice : null;
      result.innerHTML = panel({
        title: `${from.name} → ${to.name}`,
        count: tx('{n} salturi', { n: p.legs.length }),
        body: `<div class="history-kpis">
            <div><span class="label">${tx('Salturi')}</span><span class="value">${p.legs.length}</span></div>
            <div><span class="label">${tx('Distanță totală')}</span><span class="value">${formatNum(p.ly, 2)} LY</span></div>
            <div><span class="label">${tx('Izotopi')}</span><span class="value accent">${formatInt(p.fuel)}</span></div>
            <div><span class="label">${tx('Cost combustibil (Jita)')}</span><span class="value">${cost != null ? formatISK(cost, 0) : '—'}</span></div>
            <div><span class="label">${tx('Timp de așteptare')}</span><span class="value">${minutes(p.travelMinutes)}</span></div>
            <div><span class="label">${tx('Oboseală la final')}</span><span class="value">${minutes(p.fatigueEnd)}</span></div>
          </div>
          ${isHighsec(from) ? `<p class="dim small">${tx('Pornești din highsec: e permis, doar destinațiile trebuie să fie low/null.')}</p>` : ''}
          <div class="table-scroll"><table class="table compact nav-legs"><thead><tr>
            <th class="r">#</th><th>${tx('Din')}</th><th>${tx('În')}</th><th class="r">Sec</th><th>${tx('Regiune')}</th><th class="r">LY</th><th class="r">${tx('Izotopi')}</th><th class="r">${tx('Aștepți înainte')}</th><th class="r">${tx('Activare')}</th><th class="r">${tx('Oboseală după')}</th>
          </tr></thead><tbody>
          ${p.legs.map((l, i) => `<tr>
            <td class="r num dim">${i + 1}</td>
            <td>${dotlan(l.from.name)}</td>
            <td>${dotlan(l.to.name)}</td>
            <td class="r">${secCell(l.to)}</td>
            <td class="dim">${esc(m.region(l.to))}</td>
            <td class="r num">${formatNum(l.ly, 2)}</td>
            <td class="r num">${formatInt(l.fuel)}</td>
            <td class="r num">${i ? minutes(l.waitBefore) : '—'}</td>
            <td class="r num">${minutes(l.cooldown)}</td>
            <td class="r num">${minutes(l.fatigueAfter)}</td>
          </tr>`).join('')}
          </tbody></table></div>
          <p class="dim small">${tx('Distanța e în linie dreaptă între sisteme. Combustibilul e rotunjit în sus la fiecare salt. Oboseala și timpul de activare urmează regulile actuale (max 5 h oboseală, max 30 min activare); „Aștepți înainte” presupune că sari imediat ce se termină activarea.')} ${tx('Din {name} ai {n} sisteme cyno în rază.', { name: esc(from.name), n: formatInt(reach) })}</p>`,
      });
    }

    form.addEventListener('submit', run);
    form.querySelector('select[name="ship"]')!.addEventListener('change', () => { saved.ship = String(new FormData(form).get('ship')); saveJson(PLAN_KEY, saved); renderShip(); if (plan) run(); });
    ctx.onCharacterChange(() => { renderShip(); if (plan) run(); });
    renderShip();
    if (saved.from && saved.to) mapReady.then(() => run()).catch((err) => failed(result, err));
  }

  function initPochven() {
    const pane = panes.pochven;
    pane.innerHTML = loader(tx('Încărcăm harta Pochven'));
    mapReady.then(async (m) => {
      const systems = m.inRegion(POCHVEN_REGION);
      const krais = ['Perun', 'Svarog', 'Veles'];
      const kraiOf = (s: NavSystem) => m.constellation(s).replace(/^Krai\s+/i, '');
      const role = (s: NavSystem) => (Object.values(KRAI_HOMES).includes(s.name) ? 'home' : KRAI_BORDERS.includes(s.name) ? 'border' : 'internal');
      const roleLabel: Record<string, string> = { home: 'Home', border: tx('Graniță'), internal: tx('Intern') };
      let stats: { at: number; map: Map<number, SystemStat> } | null = null;
      let statsErr = '';
      let prices: Map<number, { sellMin: number; buyMax: number }> | null = null;

      const render = () => {
        const st = (s: NavSystem) => stats?.map.get(s.id);
        const totals = systems.reduce((a, s) => {
          const x = st(s);
          return { ship: a.ship + (x?.ship ?? 0), pod: a.pod + (x?.pod ?? 0), npc: a.npc + (x?.npc ?? 0), jumps: a.jumps + (x?.jumps ?? 0) };
        }, { ship: 0, pod: 0, npc: 0, jumps: 0 });
        const busiest = stats ? [...systems].sort((a, b) => (st(b)?.npc ?? 0) - (st(a)?.npc ?? 0))[0] : null;
        const hottest = stats ? [...systems].sort((a, b) => ((st(b)?.ship ?? 0) + (st(b)?.pod ?? 0)) - ((st(a)?.ship ?? 0) + (st(a)?.pod ?? 0)))[0] : null;
        const kraiPanel = (k: string) => {
          const list = systems.filter((s) => kraiOf(s) === k).sort((a, b) => ['home', 'border', 'internal'].indexOf(role(a)) - ['home', 'border', 'internal'].indexOf(role(b)) || a.name.localeCompare(b.name));
          return panel({
            title: `Krai ${k}`,
            count: list.length,
            body: `<div class="table-scroll"><table class="table compact nav-krai"><thead><tr>
                <th>${tx('Sistem')}</th><th>${tx('Rol')}</th><th class="r">${tx('Nave / h')}</th><th class="r">${tx('Capsule / h')}</th><th class="r">NPC / h</th><th class="r">${tx('Sărituri / h')}</th><th>${tx('Porți către')}</th>
              </tr></thead><tbody>
              ${list.map((s) => {
                const x = st(s);
                const r = role(s);
                const pvp = (x?.ship ?? 0) + (x?.pod ?? 0);
                return `<tr class="${pvp >= 3 ? 'risk-hi' : ''}">
                  <td>${dotlan(s.name)}</td>
                  <td>${badge(roleLabel[r], r === 'home' ? 'gold' : r === 'border' ? 'warn' : '')}</td>
                  <td class="r num">${x ? formatInt(x.ship) : '—'}</td>
                  <td class="r num">${x ? formatInt(x.pod) : '—'}</td>
                  <td class="r num">${x ? formatInt(x.npc) : '—'}</td>
                  <td class="r num">${x ? formatInt(x.jumps) : '—'}</td>
                  <td class="dim small">${(m.gates.get(s.id) ?? []).map((g) => m.systems.get(g)?.name ?? '').filter(Boolean).sort().join(', ')}</td>
                </tr>`;
              }).join('')}
              </tbody></table></div>`,
          });
        };
        const item = (id: number) => allEveItems.find((i) => i.t === id)?.n ?? `#${id}`;
        const filamentNote = (name: string) => {
          if (/Home/.test(name)) return tx('Te duce într-un sistem Home (Kino, Niarja sau Archee).');
          if (/Border/.test(name)) return tx('Te duce într-un sistem de graniță dintre două Krai.');
          if (/Internal/.test(name)) return tx('Te duce într-un sistem intern din Pochven.');
          if (/Krai/.test(name)) return tx('Te duce într-un sistem din Krai-ul numit.');
          if (/Devana/.test(name)) return tx('Ieșire din Pochven spre un sistem cu victorie Triglavian minoră.');
          if (/Extraction/.test(name)) return tx('Ieșire din Pochven lângă locul vechi al sistemului pe hartă.');
          return '';
        };
        pane.innerHTML = `${panel({
            body: `<div class="history-kpis">
                <div><span class="label">${tx('Sisteme')}</span><span class="value">${systems.length}</span></div>
                <div><span class="label">NPC / h</span><span class="value accent">${stats ? formatInt(totals.npc) : '—'}</span></div>
                <div><span class="label">${tx('Nave distruse / h')}</span><span class="value">${stats ? formatInt(totals.ship) : '—'}</span></div>
                <div><span class="label">${tx('Capsule / h')}</span><span class="value">${stats ? formatInt(totals.pod) : '—'}</span></div>
                <div><span class="label">${tx('Cel mai mult PvE')}</span><span class="value">${busiest && (st(busiest)?.npc ?? 0) > 0 ? esc(busiest.name) : '—'}</span></div>
                <div><span class="label">${tx('Cel mai mult PvP')}</span><span class="value">${hottest && ((st(hottest)?.ship ?? 0) + (st(hottest)?.pod ?? 0)) > 0 ? esc(hottest.name) : '—'}</span></div>
              </div>
              ${statsErr ? alertBox(statsErr, 'warn') : ''}
              <p class="dim small">${stats ? tx('Activitate din ESI pe ultima oră, actualizată de CCP o dată pe oră ({ago}).', { ago: ago(stats.at) }) : tx('Se încarcă activitatea din ESI...')} ${tx('Împărțirea pe Krai e fixă în datele jocului: CCP nu publică un „control de cladă” care să se schimbe, iar timer-ele structurilor jucătorilor nu sunt publice în ESI.')}</p>`,
          })}
          <div class="nav-krais">${krais.map(kraiPanel).join('')}</div>
          ${panel({
            title: tx('Filamente Pochven'),
            count: POCHVEN_FILAMENTS.length,
            body: `<div class="table-scroll"><table class="table compact"><thead><tr>
                <th>${tx('Filament')}</th><th class="r">${tx('Piloți max')}</th><th class="r">Jita sell</th><th class="r">Jita buy</th><th>${tx('Unde te duce')}</th>
              </tr></thead><tbody>
              ${POCHVEN_FILAMENTS.map((id) => {
                const n = item(id);
                const p = prices?.get(id);
                const pilots = /-(\d+)\s/.exec(n)?.[1] ?? '—';
                return `<tr>
                  <td><span class="recon-ship"><img class="row-icon" src="${typeIconUrl(id, 32)}" alt="" /><span>${esc(n)}</span></span></td>
                  <td class="r num">${pilots}</td>
                  <td class="r num">${p?.sellMin ? formatISK(p.sellMin, 0) : '—'}</td>
                  <td class="r num">${p?.buyMax ? formatISK(p.buyMax, 0) : '—'}</td>
                  <td class="dim small">${filamentNote(n)}</td>
                </tr>`;
              }).join('')}
              </tbody></table></div>
              <p class="dim small">${tx('Intrarea se mai face prin găuri de vierme: fiecare sistem Pochven are un C729 care apare la cel mult 3 salturi de vechea lui poziție, plus găuri X450, R081, U372 și F216 care se mută. Nu există o sursă publică live pentru aceste semnături; conexiunile Thera și Turnur sunt în tab-ul lor.')}</p>`,
          })}`;
      };

      render();
      systemStats().then((s) => { stats = s; }).catch((err) => { statsErr = tx('ESI nu a răspuns: {msg}', { msg: (err as Error).message }); }).finally(render);
      fetchPrices(POCHVEN_FILAMENTS).then((p) => { prices = p; render(); }).catch(() => {  });
    }).catch((err) => failed(pane, err));
  }

  function initWormholes() {
    const pane = panes.wormholes;
    const home = loadJson<string>(HOME_KEY, '');
    pane.innerHTML = `${panel({
      body: `<form class="form-grid recon-form" id="whForm">
          <label>${tx('Sistemul tău')}<input class="input" name="home" list="navSystems" value="${esc(home)}" autocomplete="off" spellcheck="false" /></label>
          <button class="btn" type="submit">${icon('refresh')}${tx('Actualizează')}</button>
        </form>
        <p class="dim small">${tx('Conexiunile vin de la EVE-Scout (Signal Cartel), scanate de voluntari. Cu sistemul tău completat, tabelul arată câte salturi pe porți ai până la fiecare ieșire.')}</p>`,
    })}<div id="whResult"></div>`;
    const form = pane.querySelector<HTMLFormElement>('#whForm')!;
    const result = pane.querySelector<HTMLElement>('#whResult')!;
    let links: WormholeLink[] | null = null;
    let at = 0;

    async function load(force = false) {
      const homeName = String(new FormData(form).get('home') ?? '').trim();
      saveJson(HOME_KEY, homeName);
      if (!links || force) {
        result.innerHTML = loader(tx('Încărcăm conexiunile de la EVE-Scout'));
        try {
          links = await wormholeLinks();
          at = Date.now();
        } catch (err) {
          result.innerHTML = panel({ body: alertBox(tx('EVE-Scout nu a răspuns ({msg}). Încearcă din nou mai târziu.', { msg: (err as Error).message })) });
          return;
        }
      }
      const m = map ?? (await mapReady);
      const origin = homeName ? m.find(homeName) : undefined;
      const dist = origin ? m.gateDistances(origin.id) : null;
      const rows = links.map((l) => ({ l, s: m.systems.get(l.systemId), d: dist?.get(l.systemId) }))
        .sort((a, b) => (a.d ?? 999) - (b.d ?? 999) || b.l.hoursLeft - a.l.hoursLeft);
      if (!rows.length) { result.innerHTML = panel({ body: emptyState({ title: tx('Nicio conexiune raportată acum') }) }); return; }
      const hubs = [...new Set(rows.map((r) => r.l.hub))];
      result.innerHTML = panel({
        title: tx('Conexiuni active'),
        count: rows.length,
        actions: `<span class="dim small">EVE-Scout ${ago(at)}</span>`,
        body: `${homeName && !origin ? alertBox(tx('Nu găsesc sistemul „{name}”.', { name: homeName }), 'warn') : ''}
          <div class="history-kpis">${hubs.map((h) => `<div><span class="label">${esc(h)}</span><span class="value">${rows.filter((r) => r.l.hub === h).length}</span></div>`).join('')}
            ${origin ? `<div><span class="label">${tx('Cea mai apropiată')}</span><span class="value accent">${rows[0].d != null ? `${esc(rows[0].l.system)} · ${tx('{n} salturi', { n: rows[0].d })}` : '—'}</span></div>` : ''}
          </div>
          <div class="table-scroll"><table class="table compact"><thead><tr>
            <th>Hub</th><th>${tx('Semnătură hub')}</th><th>${tx('Ieșire')}</th><th class="r">Sec</th><th>${tx('Regiune')}</th><th>${tx('Semnătură')}</th>${origin ? `<th class="r">${tx('Salturi de la tine')}</th>` : ''}<th>${tx('Mărime max')}</th><th class="r">${tx('Ore rămase')}</th>
          </tr></thead><tbody>
          ${rows.map(({ l, s, d }) => `<tr>
            <td>${esc(l.hub)}</td>
            <td class="num">${esc(l.hubSig)}</td>
            <td>${s ? dotlan(s.name) : esc(l.system)}</td>
            <td class="r">${s ? secCell(s) : '<span class="dim">WH</span>'}</td>
            <td class="dim">${esc(l.region || (s ? m.region(s) : ''))}</td>
            <td class="num">${esc(l.sig)}${l.type ? ` <span class="dim">${esc(l.type)}</span>` : ''}</td>
            ${origin ? `<td class="r num">${d != null ? d : '—'}</td>` : ''}
            <td>${esc(l.size)}</td>
            <td class="r num">${l.hoursLeft < 1 ? '&lt; 1' : formatNum(l.hoursLeft, 0)}</td>
          </tr>`).join('')}
          </tbody></table></div>`,
      });
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); load(true); });
    load();
  }

  renderTabs();
}
