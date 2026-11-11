import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatNum, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson, isDemo } from '../storage';
import { DEMO_ID } from '../demo/identity';
import { characterLocation, characterOnline } from '../character/esi';
import { hasScope, hasTokens } from '../character/sso';
import { loadStoredCharacters } from '../character/characters';
import { permissionButtons } from '../character/permissions';
import { allEveItems } from '../data/items';
import { tx } from '../i18n';
import { notify } from '../services/pwa';
import { fold } from '../ui/fold';
import { StarMap } from '../ui/starMap';
import { playSound, unlockAudio, type SoundKind } from '../ui/sound';
import { loadMap, wormholeLinks, type NavMap, type WormholeLink } from '../services/navigation';
import { analyzeKills, systemActivity, sovereignty, resolveNames, displaySec, type ActivitySnapshot, type SystemActivity, type SovClaim } from '../services/recon';
import { startKillStream, onKill, onStreamStatus, liveKills, setStreamPaused, streamPaused, WINDOW_MS, type LiveKill, type StreamStatus } from '../services/killstream';
import { recordVisit } from '../services/visited';
import { ChatWatcher, SystemMatcher, parseIntel, type IntelReport } from '../services/chatIntel';
import { agoShort, findBattles, ringRadius, type Battle, type Followed, type KillMode, type LiveEnv, type LiveSettings, type SideTab, type SysStat } from './liveMapShared';
import { createLivePainters } from './liveMapPaint';
import { createLiveHtml } from './liveMapHtml';

const SETTINGS_KEY = 'eve-live:settings';
const DEFAULTS: LiveSettings = { win: 60, mode: 'pvp', labels: true, battles: true, follow: '', range: 5, sound: 'off', notify: false, wh: true, center: true, ref: 0, tab: 'events' };
const LOCATION_SCOPE = 'esi-location.read_location.v1';
const INTEL_KEEP = 30 * 60_000;

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

  const env: LiveEnv = {
    el, settings, followed, chat, characters, typeName, filtered, battleAt, refLabel,
    get map() { return map; },
    get stats() { return stats; },
    get hourly() { return hourly; },
    get battles() { return battles; },
    get dist() { return dist; },
    get intel() { return intel; },
    get links() { return links; },
    get activity() { return activity; },
    get sov() { return sov; },
    get selected() { return selected; },
    get status() { return status; },
  };
  const { painterUnder, painterOver } = createLivePainters(env);
  const { layout, tooltip, eventsHtml, systemHtml, chatHtml } = createLiveHtml(env);

  function alarm(title: string, body: string, systemId: number) {
    const d = dist?.get(systemId);
    if (d == null || d > settings.range) return;
    if (!isDemo()) playSound(settings.sound, d <= 1 ? 0.5 : d <= 3 ? 0.32 : 0.2);
    if (settings.notify && document.hidden) notify(title, { body, tag: `vyraj-${systemId}` });
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
        recordVisit(c.name, loc.solar_system_id);
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
    recomputeDistances();
    renderSide();
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
    const onScreen = () => visible && !document.hidden;
    setInterval(() => { if (onScreen()) loadLinks(); }, 10 * 60_000);
    loadContext().then(() => computeStats());
    setInterval(() => { if (onScreen()) loadContext().then(() => computeStats()); }, 5 * 60_000);
    setInterval(() => { if (onScreen()) { renderStatus(); computeStats(); } }, 15_000);
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
      renderStatus();
      computeStats();
      if (settings.follow) pollFollow();
    },
    hide() {
      visible = false;
    },
  };
}
