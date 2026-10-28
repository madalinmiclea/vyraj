import { panel, loader, alertBox, esc, formatInt, formatNum, badge, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { tx, locale } from '../i18n';
import { fold } from '../ui/fold';
import { StarMap, type MapPainter } from '../ui/starMap';
import { loadMap, type NavMap, type NavSystem } from '../services/navigation';
import { sovereignty, sovCampaigns, resolveNames, cachedName, displaySec, secClass, type SovClaim, type SovCampaign } from '../services/recon';

type SideTab = 'alliances' | 'campaigns';

interface Holder { id: number; n: number; color: string; capital?: number; systems: number[] }

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

export function createSovMap(el: HTMLElement): SovMapView {
  let map: NavMap | null = null;
  let star: StarMap | null = null;
  let started = false;
  let claims = new Map<number, SovClaim>();
  let holders: Holder[] = [];
  let territory = new Map<number, string>();
  let campaigns: SovCampaign[] = [];
  let contested = new Map<number, SovCampaign[]>();
  let focus: number | null = null;
  let tab: SideTab = 'alliances';
  let loadedAt = 0;
  let labels: { name: string; x: number; y: number; n: number }[] = [];

  el.innerHTML = loader(tx('Încarc harta de suveranitate'));

  function build() {
    const by = new Map<number, Holder>();
    for (const [sys, c] of claims) {
      if (c?.kind !== 'alliance') continue;
      const h = by.get(c.id) ?? { id: c.id, n: 0, color: '', systems: [] };
      h.n++;
      h.systems.push(sys);
      if (c.capital) h.capital = sys;
      by.set(c.id, h);
    }
    holders = [...by.values()].sort((a, b) => b.n - a.n);
    holders.forEach((h, i) => { h.color = `hsl(${Math.round((i * 137.508) % 360)}, 70%, 55%)`; });
    territory = new Map();
    for (const h of holders) if (!focus || focus === h.id) for (const s of h.systems) territory.set(s, h.color);
    contested = new Map();
    for (const c of campaigns) (contested.get(c.systemId) ?? contested.set(c.systemId, []).get(c.systemId)!).push(c);
    labels = [];
    if (!map) return;
    for (const h of holders.slice(0, 60)) {
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
    const c = claims.get(s.id);
    const camp = contested.get(s.id) ?? [];
    return `<b>${esc(s.name)}</b> ${secSpan(s.sec)}<small>${esc(map!.region(s))} · ${esc(map!.constellation(s))}</small>
      ${c ? `<span class="tip-row">${esc(cachedName(c.id) || `#${c.id}`)}${c.kind === 'alliance' && c.capital ? ` · ${tx('capitală')}` : ''}${c.kind === 'faction' ? ` <span class="dim">(${tx('facțiune NPC')})</span>` : ''}</span>` : `<span class="tip-row dim">${tx('Nerevendicat')}</span>`}
      ${camp.map((x) => `<span class="tip-row warn-text">${esc(CAMPAIGN_TYPE[x.type] ?? x.type)} · ${whenText(x.start)} · ${Math.round(x.defenderScore * 100)}% ${tx('apărare')}</span>`).join('')}`;
  }

  function sideHtml() {
    if (tab === 'alliances') {
      return `<div class="label">${tx('{n} alianțe dețin {s} sisteme', { n: holders.length, s: formatInt(holders.reduce((n, h) => n + h.n, 0)) })}</div>
        ${focus ? `<button class="btn ghost sm" data-sov-clear>${icon('close')}${tx('Arată toate alianțele')}</button>` : ''}
        <div class="sov-list">${holders.map((h) => `<button class="sov-row ${focus === h.id ? 'active' : ''}" data-sov="${h.id}"><i style="background:${h.color}"></i><span>${esc(cachedName(h.id) || `#${h.id}`)}</span><span class="num dim">${h.n}</span></button>`).join('')}</div>`;
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
    const h = holders.find((x) => x.id === id);
    if (h) star?.fitSystems(h.systems);
  }

  async function load() {
    const [c, camp] = await Promise.all([sovereignty(), sovCampaigns().catch(() => [] as SovCampaign[])]);
    claims = c;
    campaigns = camp;
    const ids = new Set<number>();
    for (const x of c.values()) if (x) ids.add(x.id);
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
        <span class="small dim">${tx('★ capitală · cerc punctat = campanie de suveranitate')}</span>
        <span class="live-status small dim" id="sovStamp"></span>
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
        const c = id ? claims.get(id) : null;
        if (c?.kind === 'alliance') { tab = 'alliances'; setFocus(c.id); }
        if (id && contested.has(id)) { tab = 'campaigns'; renderSide(); }
      },
    });
    const find = el.querySelector<HTMLInputElement>('#sovFind')!;
    const list = el.querySelector<HTMLDataListElement>('#sovNames')!;
    find.addEventListener('input', () => {
      const q = fold(find.value.trim());
      if (!q || !map) { list.innerHTML = ''; return; }
      const alliances = holders.filter((h) => fold(cachedName(h.id)).includes(q)).slice(0, 8);
      const regions = [...map.regions.values()].filter((n) => fold(n).startsWith(q)).slice(0, 4);
      list.innerHTML = [
        ...alliances.map((h) => `<option value="${esc(cachedName(h.id))}">${tx('alianță')} · ${h.n}</option>`),
        ...regions.map((n) => `<option value="${esc(n)}">${tx('regiune')}</option>`),
        ...map.suggest(find.value, 6).map((s) => `<option value="${esc(s.name)}">${esc(map!.region(s))}</option>`),
      ].join('');
    });
    const go = () => {
      const q = fold(find.value.trim());
      if (!q || !map) return;
      const h = holders.find((x) => fold(cachedName(x.id)) === q);
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
      if (t.closest('[data-sov-reload]')) { load().catch((err) => toast((err as Error).message)); return; }
      const sys = t.closest<HTMLElement>('[data-sys]');
      if (sys) { const id = Number(sys.dataset.sys); star?.select(id); star?.focus(id); }
    });
    try {
      await load();
    } catch (err) {
      const box = el.querySelector<HTMLElement>('#sovSide');
      if (box) box.innerHTML = alertBox((err as Error).message);
    }
  }

  return {
    show() {
      if (started) return;
      started = true;
      init();
    },
  };
}
