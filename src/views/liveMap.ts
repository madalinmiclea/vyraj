import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, formatNum, compactISK, badge, button, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson, isDemo } from '../storage';
import { DEMO_ID } from '../demo/identity';
import { typeIconUrl } from '../services/market';
import { characterLocation, characterOnline } from '../character/esi';
import { hasScope, hasTokens } from '../character/sso';
import { loadStoredCharacters } from '../character/characters';
import { permissionButtons } from '../character/permissions';
import { allEveItems } from '../data/items';
import { tx } from '../i18n';
import { fold } from '../ui/fold';
import { StarMap, type MapPainter } from '../ui/starMap';
import { playSound, unlockAudio, type SoundKind } from '../ui/sound';
import { loadMap, wormholeLinks, type NavMap, type NavSystem, type WormholeLink } from '../services/navigation';
import { analyzeKills, systemActivity, sovereignty, resolveNames, cachedName, displaySec, secClass, type ActivitySnapshot, type SystemActivity, type SovClaim } from '../services/recon';
import { startKillStream, onKill, onStreamStatus, liveKills, setStreamPaused, streamPaused, WINDOW_MS, type LiveKill, type StreamStatus } from '../services/killstream';
import { ChatWatcher, SystemMatcher, parseIntel, chatFolderSupported, type IntelReport } from '../services/chatIntel';

type SideTab = 'events' | 'system' | 'chat';
type KillMode = 'pvp' | 'npc' | 'all';

interface LiveSettings {
  win: number;
  npc?: boolean;
  mode: KillMode;
  labels: boolean;
  battles: boolean;
  follow: string;
  range: number;
  sound: SoundKind;
  soundSet?: boolean;
  notify: boolean;
  wh: boolean;
  center: boolean;
  ref: number;
  tab: SideTab;
}

interface SysStat { n: number; pods: number; gate: number; value: number; last: number; kills: LiveKill[]; camp: boolean; smartbomb: boolean }

interface Battle { id: number; systems: number[]; main: number; kills: number; value: number; pilots: number; start: number; end: number }

interface Followed { id: number; name: string; systemId?: number; online?: boolean; at: number; error?: string }

const SETTINGS_KEY = 'eve-live:settings';
const DEFAULTS: LiveSettings = { win: 60, mode: 'pvp', labels: true, battles: true, follow: '', range: 5, sound: 'off', notify: false, wh: true, center: true, ref: 0, tab: 'events' };
const RANGES = [1, 2, 3, 5, 7, 10, 15];
const LOCATION_SCOPE = 'esi-location.read_location.v1';
const INTEL_KEEP = 30 * 60_000;
const MAX_EVENTS = 150;
const BATTLE_GAP = 20 * 60_000;
const BATTLE_MIN_KILLS = 5;
const BATTLE_MIN_PILOTS = 6;
const NPC_CORP_MAX = 2_000_000;
const MODES: [KillMode, string][] = [['pvp', 'PvP'], ['npc', 'NPC'], ['all', 'Toate']];

const groupOf = (alliance?: number, corp?: number) => alliance || (corp && corp > NPC_CORP_MAX ? corp : 0);

function findBattles(kills: LiveKill[], gates: Map<number, number[]>): Battle[] {
  const list = kills.filter((k) => !k.npc).sort((a, b) => a.time - b.time);
  const parent = list.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const bySys = new Map<number, number[]>();
  list.forEach((k, i) => (bySys.get(k.systemId) ?? bySys.set(k.systemId, []).get(k.systemId)!).push(i));
  list.forEach((k, i) => {
    for (const sys of [k.systemId, ...(gates.get(k.systemId) ?? [])]) {
      for (const j of bySys.get(sys) ?? []) {
        if (j >= i) break;
        if (k.time - list[j].time <= BATTLE_GAP) parent[root(j)] = root(i);
      }
    }
  });
  const groups = new Map<number, LiveKill[]>();
  list.forEach((k, i) => (groups.get(root(i)) ?? groups.set(root(i), []).get(root(i))!).push(k));
  const out: Battle[] = [];
  for (const g of groups.values()) {
    if (g.length < BATTLE_MIN_KILLS) continue;
    const pilots = new Set<number>();
    const hits = new Set<string>();
    for (const k of g) {
      k.attackerIds.forEach((id) => pilots.add(id));
      if (k.victimChar) pilots.add(k.victimChar);
      const victim = groupOf(k.victimAlliance, k.victimCorp);
      if (!victim) continue;
      for (const a of [...k.attackerAlliances, ...(k.attackerCorps ?? []).filter((c) => c > NPC_CORP_MAX)]) if (a !== victim) hits.add(`${a}>${victim}`);
    }
    const twoSided = [...hits].some((h) => { const [a, b] = h.split('>'); return hits.has(`${b}>${a}`); });
    if (!twoSided || pilots.size < BATTLE_MIN_PILOTS) continue;
    const counts = new Map<number, number>();
    for (const k of g) counts.set(k.systemId, (counts.get(k.systemId) ?? 0) + 1);
    const systems = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    out.push({ id: g[0].id, systems, main: systems[0], kills: g.length, value: g.reduce((t, k) => t + k.value, 0), pilots: pilots.size, start: g[0].time, end: g[g.length - 1].time });
  }
  return out.sort((a, b) => b.value - a.value);
}

const agoShort = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return tx('acum {n} s', { n: s });
  const m = Math.round(s / 60);
  return m < 60 ? tx('acum {n} min', { n: m }) : tx('acum {n} h', { n: Math.round(m / 60) });
};

const secSpan = (sec: number) => `<span class="num ${secClass(sec)}">${formatNum(displaySec(sec), 1)}</span>`;

export interface LiveMapView { show(): void; hide(): void }

export function createLiveMap(el: HTMLElement, ctx: AppContext): LiveMapView {
  const stored = loadJson<Partial<LiveSettings>>(SETTINGS_KEY, {});
  const settings: LiveSettings = { ...DEFAULTS, ...(isDemo() ? { follow: String(DEMO_ID) } : {}), ...(stored.mode ? {} : { mode: stored.npc ? 'all' : 'pvp' }), ...stored };
  delete settings.npc;
  if (!settings.soundSet) settings.sound = 'off';
  const save = () => saveJson(SETTINGS_KEY, settings);

  el.innerHTML = loader(tx('Încarc harta'));

  let map: NavMap | null = null;
  let star: StarMap | null = null;
  let matcher: SystemMatcher | null = null;
  let started = false;
  let visible = false;
  let stats = new Map<number, SysStat>();
  let statsTimer = 0;
  let listTimer = 0;
  let activity: ActivitySnapshot | null = null;
  let hourly = new Map<number, number>();
  let battles: Battle[] = [];
  let sov = new Map<number, SovClaim>();
  let links: WormholeLink[] = [];
  let whExtra = new Map<number, number[]>();
  let dist: Map<number, number> | null = null;
  let intel: IntelReport[] = [];
  const intelIds = new Set<string>();
  const followed = new Map<number, Followed>();
  let followTimer = 0;
  let selected: number | null = null;
  let status: StreamStatus = { state: 'idle', loaded: 0, lastKill: 0 };

  let itemNames: Map<number, string> | null = null;
  const typeName = (id: number) => {
    const t = ctx.sde.types.get(id);
    if (t) return t.name;
    itemNames ??= new Map(allEveItems.map((i) => [i.t, i.n.trim()]));
    return itemNames.get(id) ?? `#${id}`;
  };
  const isSmartbomb = (id: number) => ctx.sde.types.get(id)?.groupName === 'Smart Bomb';

  const chat = new ChatWatcher(() => matcher, (reports, live) => addIntel(reports, live), () => { if (settings.tab === 'chat') renderSide(); });

  const characters = () => loadStoredCharacters().filter((c) => c.characterId != null && hasTokens(c.characterId));
  const canLocate = (id: number) => hasScope(id, LOCATION_SCOPE);

  const passes = (k: LiveKill) => settings.mode === 'all' || (settings.mode === 'npc') === k.npc;

  function filtered(kills: LiveKill[]) {
    return kills.filter((k) => passes(k) && map?.systems.has(k.systemId));
  }

  const esiCount = (a: SystemActivity) => settings.mode === 'pvp' ? a.ship + a.pod : settings.mode === 'npc' ? a.npc : a.ship + a.pod + a.npc;

  function computeHourly(hour: LiveKill[]) {
    const feed = new Map<number, number>();
    const since = new Map<number, number>();
    const asOf = activity?.asOf ?? Infinity;
    for (const k of hour) {
      feed.set(k.systemId, (feed.get(k.systemId) ?? 0) + 1);
      if (k.time > asOf) since.set(k.systemId, (since.get(k.systemId) ?? 0) + 1);
    }
    const next = new Map<number, number>();
    for (const [id, a] of activity?.map ?? []) {
      const n = esiCount(a);
      if (n > 0 && map?.systems.has(id)) next.set(id, n + (since.get(id) ?? 0));
    }
    for (const [id, n] of feed) next.set(id, Math.max(n, next.get(id) ?? 0));
    hourly = next;
  }

  const battleAt = (id: number) => battles.find((b) => b.systems.includes(id));

  function computeStats() {
    statsTimer = 0;
    const next = new Map<number, SysStat>();
    const hour = liveKills(WINDOW_MS).filter((k) => map?.systems.has(k.systemId));
    computeHourly(hour.filter(passes));
    battles = map && settings.mode !== 'npc' ? findBattles(hour, map.gates) : [];
    const cut = Date.now() - settings.win * 60_000;
    for (const k of hour.filter((x) => x.time >= cut && passes(x))) {
      const st = next.get(k.systemId) ?? { n: 0, pods: 0, gate: 0, value: 0, last: 0, kills: [], camp: false, smartbomb: false };
      st.n++;
      if (k.pod) st.pods++;
      if (k.onGate) st.gate++;
      st.value += k.value;
      st.last = Math.max(st.last, k.time);
      st.kills.push(k);
      next.set(k.systemId, st);
    }
    for (const st of next.values()) {
      if (st.n < 2) continue;
      const a = analyzeKills(st.kills, isSmartbomb);
      st.camp = a.camp && (st.gate >= 2 || a.smartbomb);
      st.smartbomb = a.smartbomb;
    }
    stats = next;
    star?.redraw();
    renderStatus();
    if (!listTimer) listTimer = window.setTimeout(() => { listTimer = 0; if (settings.tab !== 'chat') renderSide(); }, 1200);
  }

  function scheduleStats() {
    if (!statsTimer) statsTimer = window.setTimeout(computeStats, 400);
  }

  function ringRadius(n: number, big: boolean, spacing = 30) {
    return big ? Math.max(8, Math.min(15, spacing * 0.26)) + Math.min(5, Math.sqrt(n)) : 2.5 + Math.min(7, Math.sqrt(n) * 1.8);
  }

  const followedAt = (id: number) => [...followed.values()].some((f) => f.systemId === id);

  function refSystems(): number[] {
    const out = [...followed.values()].map((f) => f.systemId).filter((x): x is number => !!x);
    if (out.length) return [...new Set(out)];
    return settings.ref ? [settings.ref] : [];
  }

  function recomputeDistances() {
    const refs = refSystems();
    dist = map && refs.length ? map.distances(refs, Math.max(settings.range, 15), settings.wh ? whExtra : undefined) : null;
    star?.redraw();
  }

  function refLabel() {
    const names = [...followed.values()].filter((f) => f.systemId).map((f) => f.name);
    if (names.length) return names.join(', ');
    return settings.ref ? map?.systems.get(settings.ref)?.name ?? '' : '';
  }

  function alarm(title: string, body: string, systemId: number) {
    const d = dist?.get(systemId);
    if (d == null || d > settings.range) return;
    if (!isDemo()) playSound(settings.sound, d <= 1 ? 0.5 : d <= 3 ? 0.32 : 0.2);
    if (settings.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, tag: `vyraj-${systemId}` }); } catch { }
    }
    if (!visible) toast(`${title} · ${body}`, 6000);
    el.querySelector('.live-alert')?.remove();
    const box = document.createElement('div');
    box.className = 'live-alert';
    box.innerHTML = `${icon('alert')}<span><b>${esc(title)}</b> ${esc(body)}</span>`;
    box.addEventListener('click', () => { focusSystem(systemId); box.remove(); });
    el.querySelector('.live-canvas')?.appendChild(box);
    setTimeout(() => box.remove(), 9000);
  }

  function handleKill(k: LiveKill, live: boolean) {
    scheduleStats();
    if (!live || !passes(k) || Date.now() - k.time > 5 * 60_000 || !map?.systems.has(k.systemId)) return;
    const s = map?.systems.get(k.systemId);
    if (!s) return;
    const d = dist?.get(k.systemId);
    alarm(tx('Kill la {n} sărituri: {system}', { n: d ?? '?', system: s.name }), `${typeName(k.victimShip)}${k.onGate ? ` · ${tx('la poartă')}` : ''}`, k.systemId);
  }

  function addIntel(reports: IntelReport[], live: boolean) {
    const cut = Date.now() - INTEL_KEEP;
    const fresh = reports.filter((r) => !intelIds.has(r.id) && r.time >= cut);
    if (!fresh.length) return;
    for (const r of fresh) intelIds.add(r.id);
    intel = [...fresh, ...intel].filter((r) => r.time >= cut).sort((a, b) => b.time - a.time).slice(0, 300);
    star?.redraw();
    if (settings.tab === 'chat') renderSide();
    if (!live) return;
    for (const r of fresh) {
      if (r.clear || Date.now() - r.time > 3 * 60_000) continue;
      const near = r.systems.filter((id) => (dist?.get(id) ?? Infinity) <= settings.range).sort((a, b) => dist!.get(a)! - dist!.get(b)!)[0];
      if (near) alarm(tx('Intel la {n} sărituri: {system}', { n: dist!.get(near)!, system: map!.systems.get(near)!.name }), `${r.channel} · ${r.text}`, near);
    }
  }

  function layout() {
    const chars = characters();
    el.innerHTML = `<div class="live-map">
      <div class="live-toolbar">
        <input class="input live-jump" id="liveJump" data-list="liveSystems" placeholder="${esc(tx('Sari la sistem sau regiune'))}" autocomplete="off" spellcheck="false" />
        <div class="live-seg" role="group">${[15, 60].map((w) => `<button class="chip-btn ${settings.win === w ? 'active' : ''}" data-win="${w}">${w === 15 ? '15 min' : '1 h'}</button>`).join('')}</div>
        <div class="live-seg" role="group" title="${esc(tx('PvP: nave de jucători omorâte de jucători. NPC: în fluxul live, nave omorâte doar de NPC-uri; în cifrele ESI pe oră, rați uciși (PvE). Toate: ambele.'))}">${MODES.map(([m, l]) => `<button class="chip-btn ${settings.mode === m ? 'active' : ''}" data-mode="${m}">${m === 'all' ? tx(l) : l}</button>`).join('')}</div>
        <label class="check" title="${esc(tx('Eticheta Kill-uri N de lângă sistem: kill-urile din ultima oră după ESI, plus cele venite live de atunci.'))}"><input type="checkbox" data-opt="labels" ${settings.labels ? 'checked' : ''} /> ${tx('Kill-uri / h')}</label>
        <label class="check" title="${esc(tx('Grupează kill-urile din același sistem sau din sisteme vecine, la cel mult 20 de minute unul de altul, când ambele tabere pierd nave.'))}"><input type="checkbox" data-opt="battles" ${settings.battles ? 'checked' : ''} /> ${tx('Bătălii')}</label>
        <label class="check" title="${esc(tx('Conexiunile spre Thera și Turnur de pe EVE-Scout, ca linii punctate. Intră și în calculul de sărituri.'))}"><input type="checkbox" data-opt="wh" ${settings.wh ? 'checked' : ''} /> Thera / Turnur</label>
        <span class="live-sep"></span>
        <label class="live-field">${tx('Urmărește')}<select class="input" id="liveFollow">
          <option value="">${tx('Nimeni')}</option>
          ${chars.length > 1 ? `<option value="all" ${settings.follow === 'all' ? 'selected' : ''}>${tx('Toate caracterele')}</option>` : ''}
          ${chars.map((c) => `<option value="${c.characterId}" ${settings.follow === String(c.characterId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></label>
        <label class="live-field">${tx('Rază alarmă')}<select class="input" id="liveRange">${RANGES.map((r) => `<option value="${r}" ${settings.range === r ? 'selected' : ''}>${tx('{n} sărituri', { n: r })}</option>`).join('')}</select></label>
        <label class="live-field">${tx('Sunet')}<select class="input" id="liveSound">${([['off', tx('Oprit')], ['blip', 'Blip'], ['chime', tx('Clopoțel')], ['alarm', tx('Alarmă puternică')]] as [SoundKind, string][]).map(([v, l]) => `<option value="${v}" ${settings.sound === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${'Notification' in window ? `<label class="check" title="${esc(tx('Notificare de sistem când apare o alarmă și Vyraj nu e în prim-plan.'))}"><input type="checkbox" data-opt="notify" ${settings.notify ? 'checked' : ''} /> ${tx('Notificări')}</label>` : ''}
        <span class="live-status" id="liveStatus"></span>
      </div>
      <div class="live-ref small dim" id="liveRef"></div>
      <div id="liveGate"></div>
      <div class="live-body">
        <div class="live-canvas">
          <div class="live-stage" id="liveStage"></div>
          <div class="live-zoom">
            <button class="icon-btn" data-zoom="in" aria-label="${esc(tx('Mărește'))}">+</button>
            <button class="icon-btn" data-zoom="out" aria-label="${esc(tx('Micșorează'))}">−</button>
            <button class="icon-btn" data-zoom="fit" aria-label="${esc(tx('Toată harta'))}" data-tip="${esc(tx('Toată harta'))}">${icon('refresh')}</button>
          </div>
          <div class="live-legend small">
            <span><i class="live-lg live-lg-1"></i>1-2</span><span><i class="live-lg live-lg-2"></i>3-7</span><span><i class="live-lg live-lg-3"></i>8+</span>
            <span><i class="live-lg live-lg-camp"></i>${tx('posibil camp')}</span><span><i class="live-lg live-lg-me"></i>${tx('caracterul tău')}</span><span><i class="live-lg live-lg-intel"></i>${tx('intel din chat')}</span><span><i class="live-lg live-lg-battle"></i>${tx('bătălie')}</span>
            <span class="dim">${tx('cerc = kill-uri în fereastra aleasă · Kill-uri N = ultima oră (ESI + live)')}</span>
          </div>
          <div class="live-hint small dim">${tx('Rotița sau două degete pentru zoom · trage ca să muți · click pe un sistem pentru detalii')}</div>
        </div>
        <aside class="live-side">
          <div class="live-tabs">${([['events', tx('Kill-uri')], ['system', tx('Sistem')], ['chat', tx('Intel din chat')]] as [SideTab, string][]).map(([id, l]) => `<button class="chip-btn ${settings.tab === id ? 'active' : ''}" data-side="${id}">${l}</button>`).join('')}</div>
          <div class="live-side-body" id="liveSide"></div>
        </aside>
      </div>
      <datalist id="liveSystems"></datalist>
    </div>`;
  }

  function painterUnder(p: MapPainter) {
    const { ctx: g } = p;
    if (dist && p.spacing > 3) {
      g.fillStyle = p.css('--accent');
      for (const [id, d] of dist) {
        if (d > settings.range) continue;
        const pt = p.at(id);
        if (!pt || pt[0] < -20 || pt[1] < -20 || pt[0] > p.width + 20 || pt[1] > p.height + 20) continue;
        g.globalAlpha = 0.24 - (d / (settings.range + 1)) * 0.14;
        g.beginPath();
        g.arc(pt[0], pt[1], Math.max(4, p.spacing * 0.5), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    if (settings.wh && links.length) {
      g.strokeStyle = p.css('--gold');
      g.lineWidth = 1.3;
      g.setLineDash([3, 4]);
      g.globalAlpha = 0.8;
      g.beginPath();
      for (const l of links) {
        const a = p.at(l.hubId), b = p.at(l.systemId);
        if (!a || !b) continue;
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
      }
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
  }

  function painterOver(p: MapPainter) {
    const { ctx: g } = p;
    const now = Date.now();
    const tones = [p.css('--gold'), p.css('--warn'), p.css('--danger')];
    const big = p.spacing >= 16;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [id, st] of stats) {
      const pt = p.at(id);
      if (!pt || pt[0] < -30 || pt[1] < -30 || pt[0] > p.width + 30 || pt[1] > p.height + 30) continue;
      const tone = tones[st.n >= 8 ? 2 : st.n >= 3 ? 1 : 0];
      const r = big ? ringRadius(st.n, true, p.spacing) : 2.5 + Math.min(7, Math.sqrt(st.n) * 1.8);
      g.fillStyle = tone;
      g.globalAlpha = 0.2;
      g.beginPath();
      g.arc(pt[0], pt[1], r, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = tone;
      g.lineWidth = big ? 2 : 1.4;
      g.stroke();
      if (big) {
        g.font = `700 ${r > 11 ? 11 : 10}px ${p.css('--font-mono')}`;
        g.fillStyle = p.css('--text-bright');
        g.fillText(String(st.n), pt[0], pt[1] + 0.5);
      }
      if (st.camp) {
        g.strokeStyle = p.css('--danger');
        g.lineWidth = 1.6;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.arc(pt[0], pt[1], r + 4, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      const age = now - st.last;
      if (age < 120_000) {
        const phase = ((p.time / 1400) % 1);
        g.globalAlpha = (1 - phase) * (1 - age / 120_000) * 0.9;
        g.strokeStyle = tone;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(pt[0], pt[1], r + 2 + phase * (big ? 22 : 14), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    if (settings.labels) drawHourly(p, tones);
    if (settings.battles && battles.length) drawBattles(p);
    const intelColor = p.css('--slot-rig');
    const okColor = p.css('--ok');
    const shown = new Set<number>();
    for (const r of intel) {
      if (now - r.time > 15 * 60_000) continue;
      for (const id of r.systems) {
        if (shown.has(id)) continue;
        shown.add(id);
        const pt = p.at(id);
        if (!pt) continue;
        const fade = 1 - (now - r.time) / (15 * 60_000);
        g.globalAlpha = 0.35 + fade * 0.65;
        g.strokeStyle = r.clear ? okColor : intelColor;
        g.lineWidth = 2;
        const s = big ? 11 : 6;
        g.beginPath();
        g.moveTo(pt[0], pt[1] - s);
        g.lineTo(pt[0] + s, pt[1]);
        g.lineTo(pt[0], pt[1] + s);
        g.lineTo(pt[0] - s, pt[1]);
        g.closePath();
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    const accent = p.css('--accent');
    g.font = `600 12px ${p.css('--font-body')}`;
    g.textBaseline = 'bottom';
    const bySystem = new Map<number, string[]>();
    for (const f of followed.values()) if (f.systemId) (bySystem.get(f.systemId) ?? bySystem.set(f.systemId, []).get(f.systemId)!).push(f.name);
    for (const [id, names] of bySystem) {
      const pt = p.at(id);
      if (!pt) continue;
      const s = 7;
      g.fillStyle = accent;
      g.strokeStyle = p.css('--bg-void');
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(pt[0], pt[1] - s - 8);
      g.lineTo(pt[0] + s, pt[1] - 8);
      g.lineTo(pt[0], pt[1] + s - 8);
      g.lineTo(pt[0] - s, pt[1] - 8);
      g.closePath();
      g.stroke();
      g.fill();
      const label = names.join(', ');
      g.lineWidth = 3;
      g.strokeText(label, pt[0], pt[1] - 18);
      g.fillStyle = p.css('--text-bright');
      g.fillText(label, pt[0], pt[1] - 18);
    }
    g.textBaseline = 'alphabetic';
  }

  function pill(g: CanvasRenderingContext2D, text: string, x: number, y: number, fg: string, bg: string, border: string) {
    const w = g.measureText(text).width + 10;
    const h = 15;
    g.fillStyle = bg;
    g.globalAlpha = 0.86;
    g.fillRect(x - w / 2, y - h / 2, w, h);
    g.globalAlpha = 1;
    g.strokeStyle = border;
    g.lineWidth = 1;
    g.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
    g.fillStyle = fg;
    g.fillText(text, x, y + 0.5);
    return w;
  }

  function drawHourly(p: MapPainter, tones: string[]) {
    const { ctx: g } = p;
    const min = p.spacing >= 16 ? 1 : p.spacing >= 7 ? 3 : 10;
    const placed: [number, number, number, number][] = [];
    const big = p.spacing >= 16;
    const bg = p.css('--bg-void');
    g.font = `600 10px ${p.css('--font-mono')}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const list = [...hourly.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]);
    for (const [id, n] of list) {
      const pt = p.at(id);
      if (!pt || pt[0] < -40 || pt[1] < -20 || pt[0] > p.width + 40 || pt[1] > p.height + 20) continue;
      const st = stats.get(id);
      const r = st ? (big ? ringRadius(st.n, true, p.spacing) : 2.5 + Math.min(7, Math.sqrt(st.n) * 1.8)) : 3;
      const text = tx('Kill-uri {n}', { n });
      const w = g.measureText(text).width + 10;
      const x = pt[0], y = pt[1] - r - 11;
      const box: [number, number, number, number] = [x - w / 2, y - 8, x + w / 2, y + 8];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      if (!st) {
        g.fillStyle = tones[n >= 8 ? 2 : n >= 3 ? 1 : 0];
        g.globalAlpha = 0.55;
        g.beginPath();
        g.arc(pt[0], pt[1], 2.5, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
      const tone = tones[n >= 8 ? 2 : n >= 3 ? 1 : 0];
      pill(g, text, x, y, tone, bg, tone);
    }
  }

  function drawBattles(p: MapPainter) {
    const { ctx: g } = p;
    const danger = p.css('--danger');
    const bg = p.css('--bg-void');
    const bright = p.css('--text-bright');
    g.font = `700 11px ${p.css('--font-body')}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const b of battles) {
      const pts = b.systems.map((id) => p.at(id)).filter((x): x is [number, number] => !!x);
      if (!pts.length) continue;
      const cx = pts.reduce((t, q) => t + q[0], 0) / pts.length;
      const cy = pts.reduce((t, q) => t + q[1], 0) / pts.length;
      if (cx < -80 || cy < -80 || cx > p.width + 80 || cy > p.height + 80) continue;
      const r = Math.max(14, ...pts.map((q) => Math.hypot(q[0] - cx, q[1] - cy) + 12));
      g.strokeStyle = danger;
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.globalAlpha = Date.now() - b.end < 10 * 60_000 ? 0.95 : 0.55;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      const top = Math.min(cy - r - 10, ...pts.map((q) => q[1] - 46));
      pill(g, `${tx('Bătălie')} · ${compactISK(b.value)} ISK`, cx, top, bright, bg, danger);
    }
  }

  function battleLine(b: Battle) {
    const names = b.systems.slice(0, 4).map((id) => map!.systems.get(id)?.name ?? id).join(', ') + (b.systems.length > 4 ? ` +${b.systems.length - 4}` : '');
    const mins = Math.max(1, Math.round((b.end - b.start) / 60_000));
    return { names, mins, ongoing: Date.now() - b.end < 10 * 60_000 };
  }

  function battleRow(b: Battle) {
    const { names, mins, ongoing } = battleLine(b);
    const d = dist?.get(b.main);
    return `<button class="live-battle" data-sys="${b.main}">
      <span class="live-battle-top"><b>${tx('Bătălie')} · ${compactISK(b.value)} ISK</b>${ongoing ? badge(tx('în desfășurare'), 'danger') : `<span class="dim small">${agoShort(b.end)}</span>`}</span>
      <span class="live-battle-sub">${esc(names)}</span>
      <span class="live-battle-sub dim">${tx('{kills} kill-uri · {pilots} piloți · {mins} min', { kills: b.kills, pilots: b.pilots, mins })}${d != null ? ` · ${tx('{n} sărituri', { n: d })}` : ''}</span>
    </button>`;
  }

  function tooltip(s: NavSystem) {
    const st = stats.get(s.id);
    const a = activity?.map.get(s.id);
    const d = dist?.get(s.id);
    const claim = sov.get(s.id);
    const owner = claim ? cachedName(claim.id) : '';
    const hour = hourly.get(s.id);
    const fight = settings.battles ? battleAt(s.id) : undefined;
    return `<b>${esc(s.name)}</b> ${secSpan(s.sec)}<small>${esc(map!.region(s))} · ${esc(map!.constellation(s))}</small>
      ${owner ? `<small>${esc(owner)}</small>` : ''}
      ${st ? `<span class="tip-row neg-text">${tx('{n} kill-uri în {win}', { n: st.n, win: settings.win === 15 ? '15 min' : '1 h' })}${st.pods ? ` · ${tx('{n} capsule', { n: st.pods })}` : ''}${st.gate ? ` · ${tx('{n} la poartă', { n: st.gate })}` : ''}</span>` : ''}
      ${hour ? `<span class="tip-row">${tx('Kill-uri în ultima oră: {n}', { n: hour })}</span>` : ''}
      ${fight ? `<span class="tip-row neg-text">${tx('Bătălie')} · ${compactISK(fight.value)} ISK · ${tx('{n} kill-uri', { n: fight.kills })}</span>` : ''}
      ${st?.camp ? `<span class="tip-row neg-text">${st.smartbomb ? tx('Smartbomb camp') : tx('Posibil gatecamp')}</span>` : ''}
      ${a ? `<span class="tip-row dim">${tx('ESI ultima oră: {ships} nave, {pods} capsule, {jumps} sărituri', { ships: a.ship, pods: a.pod, jumps: formatInt(a.jumps) })}</span>` : ''}
      ${d != null ? `<span class="tip-row accent-text">${d === 0 ? tx('Ești aici') : tx('{n} sărituri de {who}', { n: d, who: refLabel() })}</span>` : ''}`;
  }

  function renderStatus() {
    const s = el.querySelector<HTMLElement>('#liveStatus');
    if (!s) return;
    const paused = streamPaused();
    const txt = paused ? tx('Pauză')
      : status.state === 'backfill' ? tx('Încarc ultima oră ({n} kill-uri)', { n: status.loaded })
      : status.state === 'error' ? tx('zKillboard nu răspunde')
      : status.state === 'live' ? (status.lastKill ? (Date.now() - status.lastKill > 10 * 60_000 ? tx('Live · zKillboard întârzie, ultimul kill {ago}', { ago: agoShort(status.lastKill) }) : tx('Live · ultimul kill {ago}', { ago: agoShort(status.lastKill) })) : 'Live') : '';
    s.innerHTML = `<button class="live-pill ${paused ? 'paused' : status.state}" data-pause title="${esc(paused ? tx('Pornește fluxul live') : tx('Oprește fluxul live'))}"><i></i>${esc(txt)}</button>`;
  }

  function renderRef() {
    const box = el.querySelector<HTMLElement>('#liveRef');
    if (!box) return;
    const who = refLabel();
    const following = [...followed.values()];
    const off = following.filter((f) => f.online === false).map((f) => f.name);
    const err = following.filter((f) => f.error).map((f) => f.name);
    box.innerHTML = who
      ? `${icon('target')}<span>${tx('Alarmă pentru kill-uri și intel la cel mult {n} sărituri de {who}.', { n: settings.range, who: `<b>${esc(who)}</b>` })}${off.length ? ` <span class="warn-text">${tx('Offline: {list}, arăt ultimul sistem cunoscut.', { list: esc(off.join(', ')) })}</span>` : ''}${err.length ? ` <span class="neg-text">${tx('Nu pot citi locația pentru {list}.', { list: esc(err.join(', ')) })}</span>` : ''}</span>`
      : `${icon('info')}<span>${tx('Alege un caracter la Urmărește sau dă click pe un sistem ca să primești alarme pentru ce se întâmplă în jur.')}</span>`;
  }

  function renderGate() {
    const box = el.querySelector<HTMLElement>('#liveGate');
    if (!box) return;
    const want = settings.follow === 'all' ? characters() : characters().filter((c) => String(c.characterId) === settings.follow);
    const missing = want.filter((c) => !canLocate(c.characterId!)).map((c) => ({ characterId: c.characterId!, name: c.name }));
    box.innerHTML = settings.follow && missing.length ? permissionButtons('location', missing) : '';
  }

  function eventRow(k: LiveKill) {
    const s = map!.systems.get(k.systemId);
    const d = dist?.get(k.systemId);
    const badges = [
      k.onGate ? badge(tx('la poartă'), 'warn') : '',
      k.pod ? badge(tx('capsulă')) : '',
      k.npc ? badge('NPC') : k.solo ? badge('solo', 'gold') : '',
      d != null && d <= settings.range ? badge(tx('{n} sărituri', { n: d }), 'accent') : '',
    ].join('');
    return `<div class="live-ev ${stats.get(k.systemId)?.camp ? 'camp' : ''}" data-sys="${k.systemId}">
      <img class="row-icon" src="${typeIconUrl(k.victimShip, 32)}" alt="" />
      <div class="live-ev-main">
        <div class="live-ev-top"><b>${esc(typeName(k.victimShip))}</b><span class="num dim">${compactISK(k.value)}</span></div>
        <div class="live-ev-sub">${s ? `${secSpan(s.sec)} <span>${esc(s.name)}</span> <span class="dim">· ${esc(map!.region(s))}</span>` : `#${k.systemId}`}</div>
        <div class="live-ev-sub dim">${agoShort(k.time)} · ${tx('{n} atacatori', { n: k.players || k.attackers })} ${badges}</div>
      </div>
      <a class="ext-link" href="https://zkillboard.com/kill/${k.id}/" target="_blank" rel="noopener noreferrer" aria-label="zKillboard">${icon('external')}</a>
    </div>`;
  }

  function eventsHtml() {
    const all = filtered(liveKills(settings.win * 60_000));
    const near = dist ? all.filter((k) => (dist!.get(k.systemId) ?? Infinity) <= settings.range) : [];
    const hot = [...stats.entries()].sort((a, b) => (b[1].n + b[1].pods + (b[1].camp ? 10 : 0)) - (a[1].n + a[1].pods + (a[1].camp ? 10 : 0))).slice(0, 8);
    const camps = [...stats.entries()].filter(([, st]) => st.camp);
    if (status.state === 'backfill' && !all.length) return loader(tx('Încarc kill-urile din ultima oră'));
    if (status.state === 'error' && !all.length) return alertBox(tx('Fluxul zKillboard nu răspunde acum: e căzut sau a limitat temporar cererile din rețeaua ta. Harta reîncearcă singură, rar, ca limita să treacă.'), 'warn');
    const inRange = dist ? camps.filter(([id]) => (dist!.get(id) ?? Infinity) <= settings.range) : camps;
    const campList = (list: typeof camps) => list.slice(0, 6).map(([id]) => {
      const d = dist?.get(id);
      return `${map!.systems.get(id)?.name ?? id}${d != null ? ` (${tx('{n} sărituri', { n: d })})` : ''}`;
    }).join(', ');
    const fights = settings.battles ? battles : [];
    return `${inRange.length ? alertBox(tx('Posibil gatecamp în: {list}', { list: campList(inRange) }), dist ? 'danger' : 'warn') : ''}
      ${fights.length ? `<div class="live-hot"><div class="label">${tx('Bătălii în ultima oră')} <span class="dim">· ${fights.length}</span></div>${fights.slice(0, 6).map(battleRow).join('')}</div>` : ''}
      ${dist ? `<div class="live-near ${near.length ? 'hot' : ''}">${near.length ? tx('{n} kill-uri în raza ta în fereastra aleasă.', { n: near.length }) : tx('Niciun kill în raza ta în fereastra aleasă.')}</div>` : ''}
      <div class="live-hot"><div class="label">${tx('Cele mai active sisteme')}</div>${hot.map(([id, st]) => {
        const s = map!.systems.get(id);
        return s ? `<button class="live-hot-row" data-sys="${id}">${secSpan(s.sec)} <span>${esc(s.name)}</span><span class="dim small">${esc(map!.region(s))}</span><span class="num ${st.n >= 8 ? 'neg-text' : ''}">${st.n}</span>${st.camp ? badge('camp', 'danger') : ''}</button>` : '';
      }).join('') || `<p class="dim small">—</p>`}</div>
      <div class="label live-list-head">${tx('Ultimele kill-uri')} <span class="dim">· ${formatInt(all.length)}</span></div>
      <div class="live-events">${all.slice(0, MAX_EVENTS).map(eventRow).join('') || `<p class="dim small">${tx('Niciun kill în fereastra aleasă.')}</p>`}</div>`;
  }

  function systemHtml() {
    if (!selected || !map) return `<p class="dim small">${tx('Dă click pe un sistem de pe hartă.')}</p>`;
    const s = map.systems.get(selected)!;
    const st = stats.get(s.id);
    const a = activity?.map.get(s.id);
    const d = dist?.get(s.id);
    const claim = sov.get(s.id);
    const kills = st ? [...st.kills].sort((x, y) => y.time - x.time) : [];
    return `<div class="live-sys-head">
        <div><h3>${esc(s.name)} ${secSpan(s.sec)}</h3><div class="dim small">${esc(map.region(s))} · ${esc(map.constellation(s))}${claim ? ` · ${esc(cachedName(claim.id) || '')}${claim.kind === 'alliance' && claim.capital ? ` (${tx('capitală')})` : ''}` : ''}</div></div>
        <div class="live-sys-links">
          <a class="btn ghost sm" href="https://zkillboard.com/system/${s.id}/" target="_blank" rel="noopener noreferrer">${icon('external')}zKillboard</a>
          <a class="btn ghost sm" href="https://evemaps.dotlan.net/system/${encodeURIComponent(s.name.replace(/ /g, '_'))}" target="_blank" rel="noopener noreferrer">${icon('external')}Dotlan</a>
        </div>
      </div>
      <div class="history-kpis live-kpis">
        <div><span class="label">${tx('Kill-uri')} · ${settings.win === 15 ? '15 min' : '1 h'}</span><span class="value ${st ? 'neg-text' : ''}">${st?.n ?? 0}</span></div>
        <div title="${esc(tx('Eticheta Kill-uri N de lângă sistem: kill-urile din ultima oră după ESI, plus cele venite live de atunci.'))}"><span class="label">${tx('Kill-uri / h')}</span><span class="value">${hourly.get(s.id) ?? 0}</span></div>
        <div><span class="label">${tx('Capsule')}</span><span class="value">${st?.pods ?? 0}</span></div>
        <div><span class="label">${tx('La poartă')}</span><span class="value">${st?.gate ?? 0}</span></div>
        <div title="${esc(tx('Nave care au intrat în sistem prin stargate în ultima oră (ESI).'))}"><span class="label">${tx('Sărituri / h')}</span><span class="value">${a ? formatInt(a.jumps) : '—'}</span></div>
        <div title="${esc(tx('NPC-uri (rați) omorâte de jucători în ultima oră (ESI). Arată cât de mult se face PvE aici, nu pericol.'))}"><span class="label">${tx('NPC uciși / h')}</span><span class="value">${a ? formatInt(a.npc) : '—'}</span></div>
        ${d != null ? `<div><span class="label">${tx('Distanță')}</span><span class="value accent-text">${d === 0 ? tx('aici') : tx('{n} sărituri', { n: d })}</span></div>` : ''}
      </div>
      ${(() => { const b = settings.battles ? battleAt(s.id) : undefined; return b ? battleRow(b) : ''; })()}
      ${st?.camp ? alertBox(st.smartbomb ? tx('Smartbomb camp: capsule omorâte repetat de aceiași atacatori.') : tx('Posibil gatecamp: kill-uri repetate de aceiași atacatori, des la poartă.'), 'danger') : ''}
      <div class="row-actions">${button(tx('Folosește ca reper pentru alarmă'), { cls: 'ghost sm', iconName: 'target', attrs: `data-ref="${s.id}"` })}${button(tx('Arată regiunea'), { cls: 'ghost sm', iconName: 'search', attrs: `data-region="${s.regionId}"` })}</div>
      <div class="live-events">${kills.map(eventRow).join('') || `<p class="dim small">${tx('Niciun kill aici în fereastra aleasă.')}</p>`}</div>`;
  }

  function chatHtml() {
    const supported = chatFolderSupported();
    const head = supported
      ? chat.connected
        ? `<div class="live-chat-head"><span>${icon('check')} ${tx('Folder: {name}', { name: `<b>${esc(chat.folderName)}</b>` })}</span>${button(tx('Alt folder'), { cls: 'ghost sm', attrs: 'data-chat-pick' })}</div>
          ${chat.channels.length ? `<div class="label">${tx('Canale citite')}</div><div class="live-channels">${chat.channels.slice(0, 40).map((c) => `<label class="check"><input type="checkbox" data-channel="${esc(c.name)}" ${chat.watched.has(c.name) ? 'checked' : ''} /> ${esc(c.name)}</label>`).join('')}</div>` : `<p class="dim small">${tx('Nu am găsit loguri de chat din ultima săptămână în acest folder.')}</p>`}`
        : `<p class="small">${tx('Vyraj poate citi canalele de intel direct din logurile de chat EVE. Alege folderul Chatlogs:')}</p>
          <ul class="small dim live-paths"><li>Windows: <code>Documents\\EVE\\logs\\Chatlogs</code></li><li>Mac: <code>Documents/EVE/logs/Chatlogs</code></li></ul>
          <div class="row-actions">${button(chat.folderName ? tx('Reconectează {name}', { name: chat.folderName }) : tx('Alege folderul Chatlogs'), { iconName: 'search', attrs: chat.folderName ? 'data-chat-reconnect' : 'data-chat-pick' })}</div>
          ${chat.error ? alertBox(chat.error, 'warn') : ''}
          <p class="dim small">${tx('În joc, bifează Settings → Chat → Log Chat to File. Vyraj doar citește fișierele, pe calculatorul tău; nu trimite nimic nicăieri.')}</p>`
      : `<p class="small">${tx('Citirea automată a logurilor de chat merge doar în Chrome și Edge. Aici poți lipi mesaje din canalul de intel:')}</p>`;
    const reports = intel.slice(0, 80);
    if (isDemo()) return `${alertBox(tx('În demo, canalul de intel e simulat. Cu login real, Vyraj citește logurile tale de chat.'), 'warn')}${chatList(reports)}`;
    return `${head}
      <textarea class="input area" id="livePaste" rows="3" spellcheck="false" placeholder="${esc(tx('Lipește aici mesaje din canalul de intel'))}"></textarea>
      ${chatList(reports)}`;
  }

  function chatList(reports: IntelReport[]) {
    return `<div class="label live-list-head">${tx('Rapoarte din ultimele 30 de minute')} <span class="dim">· ${intel.length}</span></div>
      <div class="live-events">${reports.map((r) => {
        const near = r.systems.map((id) => ({ id, d: dist?.get(id) })).sort((a, b) => (a.d ?? 99) - (b.d ?? 99));
        return `<div class="live-ev intel ${r.clear ? 'clear' : ''}" data-sys="${r.systems[0]}">
          <div class="live-ev-main">
            <div class="live-ev-top"><b>${near.map((x) => esc(map!.systems.get(x.id)?.name ?? '')).join(', ')}</b>${r.clear ? badge(tx('liber'), 'ok') : near[0]?.d != null && near[0].d! <= settings.range ? badge(tx('{n} sărituri', { n: near[0].d! }), 'accent') : ''}</div>
            <div class="live-ev-sub">${esc(r.text)}</div>
            <div class="live-ev-sub dim">${agoShort(r.time)} · ${esc(r.channel)}${r.speaker ? ` · ${esc(r.speaker)}` : ''}</div>
          </div>
        </div>`;
      }).join('') || `<p class="dim small">${tx('Niciun raport cu sisteme recunoscute.')}</p>`}</div>`;
  }

  function renderSide() {
    const box = el.querySelector<HTMLElement>('#liveSide');
    if (!box || !map) return;
    const scroll = box.scrollTop;
    const draft = box.querySelector<HTMLTextAreaElement>('#livePaste')?.value ?? '';
    box.innerHTML = settings.tab === 'events' ? eventsHtml() : settings.tab === 'system' ? systemHtml() : chatHtml();
    const paste = box.querySelector<HTMLTextAreaElement>('#livePaste');
    if (paste) paste.value = draft;
    box.scrollTop = scroll;
    el.querySelectorAll<HTMLElement>('[data-side]').forEach((b) => b.classList.toggle('active', b.dataset.side === settings.tab));
  }

  function setTab(tab: SideTab) {
    settings.tab = tab;
    save();
    renderSide();
  }

  function focusSystem(id: number, closeUp = true) {
    selected = id;
    star?.select(id);
    star?.focus(id, closeUp);
    setTab('system');
  }

  function setRef(id: number) {
    settings.ref = id;
    save();
    recomputeDistances();
    renderRef();
    renderSide();
  }

  async function pollFollow() {
    clearTimeout(followTimer);
    const want = settings.follow === 'all' ? characters() : characters().filter((c) => String(c.characterId) === settings.follow);
    for (const id of [...followed.keys()]) if (!want.some((c) => c.characterId === id)) followed.delete(id);
    const before = refSystems().join(',');
    const moved: Followed[] = [];
    await Promise.all(want.filter((c) => canLocate(c.characterId!)).map(async (c) => {
      const id = c.characterId!;
      const f = followed.get(id) ?? { id, name: c.name, at: 0 };
      followed.set(id, f);
      try {
        const loc = await characterLocation(id);
        if (loc.solar_system_id !== f.systemId) moved.push(f);
        f.systemId = loc.solar_system_id;
        f.error = undefined;
        if (Date.now() - f.at > 60_000) {
          if (hasScope(id, 'esi-location.read_online.v1')) f.online = (await characterOnline(id).catch(() => null))?.online;
          f.at = Date.now();
        }
      } catch (err) {
        f.error = (err as Error).message;
      }
    }));
    if (refSystems().join(',') !== before) {
      recomputeDistances();
      renderSide();
    }
    if (settings.center && moved.length && moved[0].systemId && star) star.centerOn(moved[0].systemId);
    renderRef();
    star?.redraw();
    if (want.length && visible) followTimer = window.setTimeout(pollFollow, 8000);
    else if (want.length) followTimer = window.setTimeout(pollFollow, 30_000);
  }

  function setFollow(v: string) {
    settings.follow = v;
    save();
    followed.clear();
    renderGate();
    pollFollow().then(() => {
      const first = [...followed.values()].find((f) => f.systemId);
      if (first?.systemId) star?.focus(first.systemId);
    });
  }

  async function loadLinks() {
    try {
      links = await wormholeLinks();
    } catch {
      links = [];
    }
    whExtra = new Map();
    for (const l of links) {
      (whExtra.get(l.hubId) ?? whExtra.set(l.hubId, []).get(l.hubId)!).push(l.systemId);
      (whExtra.get(l.systemId) ?? whExtra.set(l.systemId, []).get(l.systemId)!).push(l.hubId);
    }
    recomputeDistances();
  }

  async function loadContext() {
    activity = await systemActivity().catch(() => activity);
    const claims = await sovereignty().catch(() => sov);
    sov = claims;
    const owners = [...new Set([...claims.values()].filter((c) => c?.kind === 'alliance').map((c) => c!.id))];
    await resolveNames(owners).catch(() => null);
  }

  function bind() {
    const datalist = el.querySelector<HTMLDataListElement>('#liveSystems')!;
    const jump = el.querySelector<HTMLInputElement>('#liveJump')!;
    jump.addEventListener('input', () => {
      if (!map) return;
      const q = fold(jump.value.trim());
      const regions = q ? [...map.regions.entries()].filter(([, n]) => fold(n).startsWith(q)).slice(0, 4) : [];
      datalist.innerHTML = [
        ...regions.map(([, n]) => `<option value="${esc(n)}">${tx('regiune')}</option>`),
        ...map.suggest(jump.value).map((s) => `<option value="${esc(s.name)}">${esc(map!.region(s))} · ${formatNum(displaySec(s.sec), 1)}</option>`),
      ].join('');
    });
    const go = () => {
      if (!map) return;
      const q = jump.value.trim();
      if (!q) return;
      const region = [...map.regions.entries()].find(([, n]) => fold(n) === fold(q));
      if (region) { star?.fitRegion(region[0]); return; }
      const s = map.find(q);
      if (!s) { toast(tx('Nu găsesc sistemul {name}', { name: q })); return; }
      focusSystem(s.id);
      if (!followed.size) setRef(s.id);
    };
    jump.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    jump.addEventListener('change', go);

    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('a')) return;
      const win = t.closest<HTMLElement>('[data-win]');
      if (win) {
        settings.win = Number(win.dataset.win);
        save();
        el.querySelectorAll<HTMLElement>('[data-win]').forEach((b) => b.classList.toggle('active', b === win));
        computeStats();
        renderSide();
        return;
      }
      const mode = t.closest<HTMLElement>('[data-mode]');
      if (mode) {
        settings.mode = mode.dataset.mode as KillMode;
        save();
        el.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.classList.toggle('active', b === mode));
        computeStats();
        renderSide();
        return;
      }
      const side = t.closest<HTMLElement>('[data-side]');
      if (side) { setTab(side.dataset.side as SideTab); return; }
      const zoom = t.closest<HTMLElement>('[data-zoom]');
      if (zoom && star) {
        if (zoom.dataset.zoom === 'in') star.zoomBy(1.6);
        else if (zoom.dataset.zoom === 'out') star.zoomBy(1 / 1.6);
        else star.fitAll();
        return;
      }
      if (t.closest('[data-pause]')) {
        setStreamPaused(!streamPaused());
        renderStatus();
        return;
      }
      const ref = t.closest<HTMLElement>('[data-ref]');
      if (ref) { setRef(Number(ref.dataset.ref)); return; }
      const reg = t.closest<HTMLElement>('[data-region]');
      if (reg) { star?.fitRegion(Number(reg.dataset.region)); return; }
      if (t.closest('[data-chat-pick]')) { chat.pick().catch((err) => { if ((err as Error).name !== 'AbortError') toast((err as Error).message); }); return; }
      if (t.closest('[data-chat-reconnect]')) { chat.reconnect().catch((err) => toast((err as Error).message)); return; }
      const sys = t.closest<HTMLElement>('[data-sys]');
      if (sys && !t.closest('input, textarea, label')) focusSystem(Number(sys.dataset.sys));
    });

    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      if (t.dataset.opt) {
        const key = t.dataset.opt as 'labels' | 'battles' | 'wh' | 'notify';
        settings[key] = (t as HTMLInputElement).checked;
        save();
        if (key === 'labels') star?.redraw();
        if (key === 'battles') { star?.redraw(); renderSide(); }
        if (key === 'wh') recomputeDistances();
        if (key === 'notify' && settings.notify && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => undefined);
        return;
      }
      if (t.dataset.channel != null) {
        const names = [...el.querySelectorAll<HTMLInputElement>('[data-channel]')].filter((x) => x.checked).map((x) => x.dataset.channel!);
        chat.setWatched(names);
        return;
      }
      if (t.id === 'liveFollow') { setFollow(t.value); return; }
      if (t.id === 'liveRange') { settings.range = Number(t.value); save(); recomputeDistances(); renderRef(); renderSide(); return; }
      if (t.id === 'liveSound') {
        settings.sound = t.value as SoundKind;
        settings.soundSet = true;
        save();
        unlockAudio();
        playSound(settings.sound);
      }
    });

    el.addEventListener('paste', (e) => {
      const t = e.target as HTMLElement;
      if (t.id !== 'livePaste' || !matcher) return;
      setTimeout(() => {
        const area = t as HTMLTextAreaElement;
        const found = parseIntel(area.value, tx('lipit'), matcher!);
        area.value = '';
        if (!found.length) { toast(tx('Nu am recunoscut niciun sistem în text.')); return; }
        addIntel(found, true);
      }, 0);
    });
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
    matcher = new SystemMatcher(map);
    layout();
    renderStatus();
    renderRef();
    renderGate();
    bind();
    star = new StarMap(el.querySelector<HTMLElement>('#liveStage')!, map, {
      under: painterUnder,
      over: painterOver,
      tooltip,
      labelGap: (id, gap) => {
        const st = stats.get(id);
        return st ? ringRadius(st.n, true, gap) + 3 : 0;
      },
      labelFirst: (id) => stats.has(id) || hourly.has(id) || followedAt(id),
      onSelect: (id) => {
        selected = id;
        if (id) setTab('system');
      },
      animate: () => visible && !document.hidden && ([...stats.values()].some((s) => Date.now() - s.last < 120_000)),
    });
    const refSys = settings.ref && !settings.follow ? map.systems.get(settings.ref) : null;
    if (refSys) star.fitRegion(refSys.regionId);
    onStreamStatus((s) => {
      const prev = status.state;
      status = s;
      renderStatus();
      if (prev !== s.state) renderSide();
    });
    onKill(handleKill);
    startKillStream();
    computeStats();
    renderSide();
    recomputeDistances();
    loadLinks();
    setInterval(loadLinks, 10 * 60_000);
    loadContext().then(() => computeStats());
    setInterval(() => loadContext().then(() => computeStats()), 5 * 60_000);
    setInterval(() => { renderStatus(); computeStats(); }, 15_000);
    if (settings.follow) setFollow(settings.follow);
    if (isDemo()) startDemoIntel();
    else chat.restore().then(() => { if (settings.tab === 'chat') renderSide(); }).catch(() => undefined);
  }

  async function startDemoIntel() {
    const feed = await (await import('../demo/liveFeed')).createDemoIntel('Venal.Intel');
    addIntel(feed.backfill(), false);
    const tick = () => {
      const { reports, wait } = feed.next();
      addIntel(reports, true);
      window.setTimeout(tick, wait);
    };
    window.setTimeout(tick, 15_000);
  }

  return {
    show() {
      visible = true;
      if (!started) { started = true; init(); return; }
      star?.redraw();
      if (settings.follow) pollFollow();
    },
    hide() {
      visible = false;
    },
  };
}
