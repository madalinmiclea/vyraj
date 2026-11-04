import { panel, loader, alertBox, esc, formatInt, formatNum, badge, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { tx, locale } from '../i18n';
import { fold } from '../ui/fold';
import { StarMap, type MapPainter } from '../ui/starMap';
import { loadMap, JOVE_REGIONS, type NavMap, type NavSystem } from '../services/navigation';
import { loadStandings, canReadStandings, type Standings } from '../services/standings';
import { permissionGate } from '../character/permissions';
import { loadJson, saveJson } from '../storage';
import { sovereignty, sovCampaigns, resolveNames, cachedName, displaySec, secClass, type SovClaim, type SovCampaign } from '../services/recon';

type SideTab = 'alliances' | 'campaigns';

interface Holder { id: number; kind: 'alliance' | 'faction'; n: number; color: string; capital?: number; systems: number[] }

const JOVE_EMPIRE = 500005;

const CAMPAIGN_TYPE: Record<string, string> = {
  ihub_defense: tx('Apărare IHub'),
  tcu_defense: tx('Apărare TCU'),
  station_defense: tx('Apărare stație'),
  station_freeport: tx('Stație freeport'),
};

const secSpan = (sec: number) => `<span class="num ${secClass(sec)}">${formatNum(displaySec(sec), 1)}</span>`;

const whenText = (start: number) => {
  const m = Math.round((start - Date.now()) / 60000);
  if (m <= 0) return tx('în desfășurare');
  return m < 60 ? tx('începe în {n} min', { n: m }) : tx('începe în {n} h', { n: Math.round(m / 60) });
};

export interface SovMapView { show(): void }

const STANDINGS_KEY = 'eve-nav:sov-standings';

const standingTone = (v: number | undefined, own: boolean) => (own ? 'own' : v == null || v === 0 ? 'neutral' : v >= 5 ? 'excellent' : v > 0 ? 'good' : v <= -5 ? 'terrible' : 'bad');
const STANDING_COLOR: Record<string, string> = { own: 'hsl(280, 70%, 62%)', excellent: 'hsl(215, 90%, 52%)', good: 'hsl(200, 80%, 66%)', neutral: 'hsl(220, 8%, 46%)', bad: 'hsl(28, 92%, 56%)', terrible: 'hsl(0, 84%, 54%)' };
const STANDING_LABEL = (): Record<string, string> => ({ own: tx('Alianța ta'), excellent: tx('Excelent (+5 și peste)'), good: tx('Bun (peste 0)'), neutral: tx('Neutru'), bad: tx('Rău (sub 0)'), terrible: tx('Groaznic (−5 și sub)') });

export function createSovMap(el: HTMLElement, activeCharacter: () => { id?: number; name: string } = () => ({ name: '' })): SovMapView {
  let map: NavMap | null = null;
  let star: StarMap | null = null;
  let started = false;
  let claims = new Map<number, SovClaim>();
  let holders: Holder[] = [];
  let factions: Holder[] = [];
  let territory = new Map<number, string>();
  let campaigns: SovCampaign[] = [];
  let contested = new Map<number, SovCampaign[]>();
  let focus: number | null = null;
  let tab: SideTab = 'alliances';
  let loadedAt = 0;
  let labels: { name: string; x: number; y: number; n: number }[] = [];
  let standingsOn = loadJson<boolean>(STANDINGS_KEY, false);
  let standings: Standings | null = null;
  let standingsFor = 0;
  let standingsError = '';

  el.innerHTML = loader(tx('Încarc harta de suveranitate'));

  function claimOf(sys: number): SovClaim {
    const c = claims.get(sys);
    if (c) return c;
    const s = map?.systems.get(sys);
    return s && JOVE_REGIONS.has(s.regionId) ? { kind: 'faction', id: JOVE_EMPIRE } : null;
  }

  function build() {
    const by = new Map<number, Holder>();
    for (const sys of map ? map.systems.keys() : claims.keys()) {
      const c = claimOf(sys);
      if (!c) continue;
      if (c.kind === 'faction') {
        const s = map?.systems.get(sys);
        if (!s || displaySec(s.sec) > 0) continue;
      }
      const h = by.get(c.id) ?? { id: c.id, kind: c.kind, n: 0, color: '', systems: [] };
      h.n++;
      h.systems.push(sys);
      if (c.kind === 'alliance' && c.capital) h.capital = sys;
      by.set(c.id, h);
    }
    const all = [...by.values()].sort((a, b) => b.n - a.n);
    holders = all.filter((h) => h.kind === 'alliance');
    factions = all.filter((h) => h.kind === 'faction');
    holders.forEach((h, i) => { h.color = `hsl(${Math.round((i * 137.508) % 360)}, 70%, 55%)`; });
    factions.forEach((h, i) => { h.color = `hsl(${Math.round((i * 97 + 20) % 360)}, 14%, 52%)`; });
    if (standingsOn && standings) for (const h of holders) h.color = STANDING_COLOR[standingTone(standings.byId.get(h.id), h.id === standings.allianceId)];
    territory = new Map();
    for (const h of [...factions, ...holders]) if (!focus || focus === h.id) for (const s of h.systems) territory.set(s, h.color);
    contested = new Map();
    for (const c of campaigns) (contested.get(c.systemId) ?? contested.set(c.systemId, []).get(c.systemId)!).push(c);
    labels = [];
    if (!map) return;
    for (const h of [...holders.slice(0, 60), ...factions]) {
      const groups = new Map<number, NavSystem[]>();
      for (const id of h.systems) {
        const s = map.systems.get(id);
        if (s) (groups.get(s.regionId) ?? groups.set(s.regionId, []).get(s.regionId)!).push(s);
      }
      for (const list of groups.values()) {
        if (list.length < 8) continue;
        labels.push({ name: cachedName(h.id) || `#${h.id}`, x: list.reduce((n, s) => n + s.x2, 0) / list.length, y: list.reduce((n, s) => n + s.y2, 0) / list.length, n: list.length });
      }
    }
    labels.sort((a, b) => b.n - a.n);
  }

  function over(p: MapPainter) {
    const g = p.ctx;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (p.spacing >= 6) {
      g.font = `${p.spacing > 20 ? 13 : 10}px ${p.css('--font-body')}`;
      g.fillStyle = p.css('--gold');
      for (const h of holders) {
        if (!h.capital || (focus && focus !== h.id)) continue;
        const pt = p.at(h.capital);
        if (pt) g.fillText('★', pt[0], pt[1] - (p.spacing > 20 ? 12 : 7));
      }
    }
    g.strokeStyle = p.css('--gold');
    g.lineWidth = 1.6;
    g.setLineDash([3, 3]);
    for (const id of contested.keys()) {
      const pt = p.at(id);
      if (!pt) continue;
      g.beginPath();
      g.arc(pt[0], pt[1], p.spacing > 20 ? 11 : 6, 0, Math.PI * 2);
      g.stroke();
    }
    g.setLineDash([]);
    if (p.spacing < 30) {
      const placed: [number, number, number, number][] = [];
      g.font = `700 ${p.spacing < 8 ? 12 : 14}px ${p.css('--font-heading')}`;
      g.lineWidth = 3;
      g.strokeStyle = p.css('--bg-void');
      g.fillStyle = p.css('--text-bright');
      for (const l of labels) {
        const pt = p.world(l.x, l.y);
        if (pt[0] < -100 || pt[0] > p.width + 100 || pt[1] < -20 || pt[1] > p.height + 20) continue;
        const half = g.measureText(l.name).width / 2;
        const box: [number, number, number, number] = [pt[0] - half, pt[1] - 9, pt[0] + half, pt[1] + 9];
        if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        placed.push(box);
        g.strokeText(l.name, pt[0], pt[1]);
        g.fillText(l.name, pt[0], pt[1]);
      }
    }
  }

  function tooltip(s: NavSystem) {
    const c = claimOf(s.id);
    const camp = contested.get(s.id) ?? [];
    return `<b>${esc(s.name)}</b> ${secSpan(s.sec)}<small>${esc(map!.region(s))} · ${esc(map!.constellation(s))}</small>
      ${c ? `<span class="tip-row">${esc(cachedName(c.id) || `#${c.id}`)}${c.kind === 'alliance' && c.capital ? ` · ${tx('capitală')}` : ''}${c.kind === 'faction' ? ` <span class="dim">(${tx(displaySec(s.sec) <= 0 ? 'null-sec NPC, fără suveranitate de jucători' : 'facțiune NPC')})</span>` : ''}</span>` : `<span class="tip-row dim">${tx('Nerevendicat')}</span>`}
      ${camp.map((x) => `<span class="tip-row warn-text">${esc(CAMPAIGN_TYPE[x.type] ?? x.type)} · ${whenText(x.start)} · ${Math.round(x.defenderScore * 100)}% ${tx('apărare')}</span>`).join('')}`;
  }

  const row = (h: Holder) => `<button class="sov-row ${focus === h.id ? 'active' : ''}" data-sov="${h.id}"><i style="background:${h.color}"></i><span>${esc(cachedName(h.id) || `#${h.id}`)}</span><span class="num dim">${h.n}</span></button>`;

  function standingsHtml() {
    if (!standingsOn) return '';
    const who = activeCharacter();
    if (!who.id) return `<p class="dim small">${tx('Alege un caracter logat ca să vezi standings-urile.')}</p>`;
    if (!canReadStandings(who.id)) return permissionGate('contacts', who.id, who.name);
    if (standingsError) return alertBox(standingsError);
    if (!standings) return loader(tx('Citim standings-urile'));
    const counts = new Map<string, number>();
    for (const h of holders) { const t = standingTone(standings.byId.get(h.id), h.id === standings.allianceId); counts.set(t, (counts.get(t) ?? 0) + h.n); }
    return `<div class="sov-legend">${Object.entries(STANDING_LABEL()).filter(([k]) => counts.has(k)).map(([k, l]) => `<span><i style="background:${STANDING_COLOR[k]}"></i>${esc(l)} <span class="dim num">${formatInt(counts.get(k)!)}</span></span>`).join('')}</div>`;
  }

  async function refreshStandings() {
    const who = activeCharacter();
    if (!standingsOn || !who.id || !canReadStandings(who.id)) { renderSide(); return; }
    if (standings && standingsFor === who.id) { build(); star?.invalidateTerritory(); renderSide(); return; }
    standings = null;
    standingsError = '';
    renderSide();
    try {
      standings = await loadStandings(who.id);
      standingsFor = who.id;
    } catch (e) {
      standingsError = (e as Error).message;
    }
    build();
    star?.invalidateTerritory();
    renderSide();
  }

  function sideHtml() {
    if (tab === 'alliances') {
      if (standingsOn) return `${standingsHtml()}<div class="sov-list">${holders.map(row).join('')}</div>`;
      return `<div class="label">${tx('{n} alianțe dețin {s} sisteme', { n: holders.length, s: formatInt(holders.reduce((n, h) => n + h.n, 0)) })}</div>
        ${focus ? `<button class="btn ghost sm" data-sov-clear>${icon('close')}${tx('Arată toate alianțele')}</button>` : ''}
        <div class="sov-list">${holders.map(row).join('')}</div>
        ${factions.length ? `<div class="label sov-sub">${tx('Null-sec NPC: {n} sisteme ale facțiunilor NPC, fără suveranitate de jucători', { n: formatInt(factions.reduce((n, h) => n + h.n, 0)) })}</div>
        <div class="sov-list">${factions.map(row).join('')}</div>` : ''}`;
    }
    const list = [...campaigns].sort((a, b) => a.start - b.start);
    return `<div class="label">${tx('{n} campanii active sau programate', { n: list.length })}</div>
      <div class="live-events">${list.map((c) => {
        const s = map!.systems.get(c.systemId);
        const def = c.defenderId ? cachedName(c.defenderId) || `#${c.defenderId}` : '—';
        return `<div class="live-ev intel sov-camp" data-sys="${c.systemId}">
          <div class="live-ev-main">
            <div class="live-ev-top"><b>${s ? `${secSpan(s.sec)} ${esc(s.name)}` : c.systemId}</b>${badge(CAMPAIGN_TYPE[c.type] ?? c.type, c.start <= Date.now() ? 'danger' : 'warn')}</div>
            <div class="live-ev-sub dim">${s ? esc(map!.region(s)) : ''} · ${esc(def)}</div>
            <div class="live-ev-sub">${whenText(c.start)} <span class="dim">· ${new Date(c.start).toLocaleString(locale, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })} EVE</span></div>
            <div class="sov-score"><span style="width:${Math.round(c.defenderScore * 100)}%"></span></div>
            <div class="live-ev-sub dim small">${tx('Apărare {d}% · atac {a}%', { d: Math.round(c.defenderScore * 100), a: Math.round(c.attackersScore * 100) })}</div>
          </div>
        </div>`;
      }).join('') || `<p class="dim small">${tx('Nicio campanie de suveranitate acum.')}</p>`}</div>`;
  }

  function renderSide() {
    const box = el.querySelector<HTMLElement>('#sovSide');
    if (!box) return;
    const scroll = box.scrollTop;
    box.innerHTML = sideHtml();
    box.scrollTop = scroll;
    el.querySelectorAll<HTMLElement>('[data-sov-tab]').forEach((b) => b.classList.toggle('active', b.dataset.sovTab === tab));
    const stamp = el.querySelector<HTMLElement>('#sovStamp');
    if (stamp) stamp.textContent = loadedAt ? tx('Date ESI din {time}', { time: new Date(loadedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }) : '';
  }

  function setFocus(id: number | null) {
    focus = id;
    build();
    star?.invalidateTerritory();
    renderSide();
    const h = [...holders, ...factions].find((x) => x.id === id);
    if (h) star?.fitSystems(h.systems);
  }

  async function load() {
    const [c, camp] = await Promise.all([sovereignty(), sovCampaigns().catch(() => [] as SovCampaign[])]);
    claims = c;
    campaigns = camp;
    const ids = new Set<number>();
    for (const x of c.values()) if (x) ids.add(x.id);
    ids.add(JOVE_EMPIRE);
    for (const x of camp) if (x.defenderId) ids.add(x.defenderId);
    await resolveNames([...ids]).catch(() => null);
    loadedAt = Date.now();
    build();
    star?.invalidateTerritory();
    renderSide();
  }

  async function init() {
    try {
      map = await loadMap();
    } catch (err) {
      el.innerHTML = panel({ body: alertBox((err as Error).message) });
      return;
    }
    if (!map.schematic) {
      el.innerHTML = panel({ body: alertBox(tx('Datele hărții sunt vechi și nu au poziții 2D. Rulează "npm run data" ca să le regenerezi.'), 'warn') });
      return;
    }
    el.innerHTML = `<div class="live-map sov-map">
      <div class="live-toolbar">
        <input class="input live-jump" id="sovFind" data-list="sovNames" placeholder="${esc(tx('Caută alianță, sistem sau regiune'))}" autocomplete="off" spellcheck="false" />
        <span class="small dim">${tx('★ capitală · cerc punctat = campanie de suveranitate · gri = null-sec NPC')}</span>
        <span class="live-status small dim" id="sovStamp"></span>
        <button class="btn ghost sm sov-standings-btn ${standingsOn ? 'active' : ''}" data-sov-standings aria-pressed="${standingsOn}">${icon('character')}Standings</button>
        <button class="btn ghost sm" data-sov-reload>${icon('refresh')}${tx('Reîncarcă')}</button>
      </div>
      <div class="live-body">
        <div class="live-canvas">
          <div class="live-stage" id="sovStage"></div>
          <div class="live-zoom">
            <button class="icon-btn" data-zoom="in" aria-label="${esc(tx('Mărește'))}">+</button>
            <button class="icon-btn" data-zoom="out" aria-label="${esc(tx('Micșorează'))}">−</button>
            <button class="icon-btn" data-zoom="fit" aria-label="${esc(tx('Toată harta'))}">${icon('refresh')}</button>
          </div>
        </div>
        <aside class="live-side">
          <div class="live-tabs"><button class="chip-btn active" data-sov-tab="alliances">${tx('Alianțe')}</button><button class="chip-btn" data-sov-tab="campaigns">${tx('Campanii')}</button></div>
          <div class="live-side-body" id="sovSide">${loader(tx('Încarc suveranitatea din ESI'))}</div>
        </aside>
      </div>
      <datalist id="sovNames"></datalist>
    </div>`;
    star = new StarMap(el.querySelector<HTMLElement>('#sovStage')!, map, {
      territory: () => territory,
      regionLabels: false,
      over,
      tooltip,
      labelFirst: (id) => contested.has(id),
      onSelect: (id) => {
        const c = id ? claimOf(id) : null;
        if (c && [...holders, ...factions].some((h) => h.id === c.id)) { tab = 'alliances'; setFocus(c.id); }
        if (id && contested.has(id)) { tab = 'campaigns'; renderSide(); }
      },
    });
    const find = el.querySelector<HTMLInputElement>('#sovFind')!;
    const list = el.querySelector<HTMLDataListElement>('#sovNames')!;
    find.addEventListener('input', () => {
      const q = fold(find.value.trim());
      if (!q || !map) { list.innerHTML = ''; return; }
      const alliances = [...holders, ...factions].filter((h) => fold(cachedName(h.id)).includes(q)).slice(0, 8);
      const regions = [...map.regions.values()].filter((n) => fold(n).startsWith(q)).slice(0, 4);
      list.innerHTML = [
        ...alliances.map((h) => `<option value="${esc(cachedName(h.id))}">${h.kind === 'faction' ? tx('facțiune NPC') : tx('alianță')} · ${h.n}</option>`),
        ...regions.map((n) => `<option value="${esc(n)}">${tx('regiune')}</option>`),
        ...map.suggest(find.value, 6).map((s) => `<option value="${esc(s.name)}">${esc(map!.region(s))}</option>`),
      ].join('');
    });
    const go = () => {
      const q = fold(find.value.trim());
      if (!q || !map) return;
      const h = [...holders, ...factions].find((x) => fold(cachedName(x.id)) === q);
      if (h) { tab = 'alliances'; setFocus(h.id); return; }
      const region = [...map.regions.entries()].find(([, n]) => fold(n) === q);
      if (region) { star?.fitRegion(region[0]); return; }
      const s = map.find(find.value);
      if (s) { star?.select(s.id); star?.focus(s.id); return; }
      toast(tx('Nu găsesc {name}', { name: find.value }));
    };
    find.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    find.addEventListener('change', go);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const z = t.closest<HTMLElement>('[data-zoom]');
      if (z && star) { if (z.dataset.zoom === 'in') star.zoomBy(1.6); else if (z.dataset.zoom === 'out') star.zoomBy(1 / 1.6); else star.fitAll(); return; }
      const tb = t.closest<HTMLElement>('[data-sov-tab]');
      if (tb) { tab = tb.dataset.sovTab as SideTab; renderSide(); return; }
      const row = t.closest<HTMLElement>('[data-sov]');
      if (row) { const id = Number(row.dataset.sov); setFocus(focus === id ? null : id); return; }
      if (t.closest('[data-sov-clear]')) { setFocus(null); star?.fitAll(); return; }
      const sb = t.closest<HTMLElement>('[data-sov-standings]');
      if (sb) {
        standingsOn = !standingsOn;
        saveJson(STANDINGS_KEY, standingsOn);
        sb.classList.toggle('active', standingsOn);
        sb.setAttribute('aria-pressed', String(standingsOn));
        tab = 'alliances';
        build();
        star?.invalidateTerritory();
        refreshStandings();
        return;
      }
      if (t.closest('[data-sov-reload]')) { load().catch((err) => toast((err as Error).message)); return; }
      const sys = t.closest<HTMLElement>('[data-sys]');
      if (sys) { const id = Number(sys.dataset.sys); star?.select(id); star?.focus(id); }
    });
    try {
      await load();
      if (standingsOn) refreshStandings();
    } catch (err) {
      const box = el.querySelector<HTMLElement>('#sovSide');
      if (box) box.innerHTML = alertBox((err as Error).message);
    }
  }

  return {
    show() {
      if (started) { if (standingsOn && standingsFor !== activeCharacter().id) refreshStandings(); return; }
      started = true;
      init();
    },
  };
}
