import { loader, alertBox, esc, formatInt, compactISK, badge, button } from '../ui/components';
import { icon } from '../ui/icons';
import { isDemo } from '../storage';
import { typeIconUrl } from '../services/market';
import { tx } from '../i18n';
import type { SoundKind } from '../ui/sound';
import type { NavSystem } from '../services/navigation';
import { cachedName } from '../services/recon';
import { liveKills, type LiveKill } from '../services/killstream';
import { chatFolderSupported, type IntelReport } from '../services/chatIntel';
import { agoShort, secSpan, type Battle, type KillMode, type LiveEnv, type SideTab } from './liveMapShared';

const RANGES = [1, 2, 3, 5, 7, 10, 15];
const MAX_EVENTS = 150;
const MODES: [KillMode, string][] = [['pvp', 'PvP'], ['npc', 'NPC'], ['all', 'Toate']];

export function createLiveHtml(env: LiveEnv) {
  const { el, settings, chat, typeName, filtered, battleAt, refLabel } = env;

  function layout() {
    const chars = env.characters();
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

  function battleLine(b: Battle) {
    const { map } = env;
    const names = b.systems.slice(0, 4).map((id) => map!.systems.get(id)?.name ?? id).join(', ') + (b.systems.length > 4 ? ` +${b.systems.length - 4}` : '');
    const mins = Math.max(1, Math.round((b.end - b.start) / 60_000));
    return { names, mins, ongoing: Date.now() - b.end < 10 * 60_000 };
  }

  function battleRow(b: Battle) {
    const { dist } = env;
    const { names, mins, ongoing } = battleLine(b);
    const d = dist?.get(b.main);
    return `<button class="live-battle" data-sys="${b.main}">
      <span class="live-battle-top"><b>${tx('Bătălie')} · ${compactISK(b.value)} ISK</b>${ongoing ? badge(tx('în desfășurare'), 'danger') : `<span class="dim small">${agoShort(b.end)}</span>`}</span>
      <span class="live-battle-sub">${esc(names)}</span>
      <span class="live-battle-sub dim">${tx('{kills} kill-uri · {pilots} piloți · {mins} min', { kills: b.kills, pilots: b.pilots, mins })}${d != null ? ` · ${tx('{n} sărituri', { n: d })}` : ''}</span>
    </button>`;
  }

  function tooltip(s: NavSystem) {
    const { map, stats, activity, dist, sov, hourly } = env;
    const st = stats.get(s.id);
    const a = activity?.map.get(s.id);
    const d = dist?.get(s.id);
    const claim = sov.get(s.id);
    const owner = claim ? cachedName(claim.id) : '';
    const hour = hourly.get(s.id);
    const fight = settings.battles ? battleAt(s.id) : undefined;
    return `<b>${esc(s.name)}</b> ${secSpan(s.sec)}<small>${esc(map!.region(s))} · ${esc(map!.constellation(s))}</small>
      ${owner ? `<small>${esc(owner)}</small>` : ''}
      ${st ? `<span class="tip-row neg-text">${tx('{n} kill-uri zKillboard în {win}', { n: st.n, win: settings.win === 15 ? '15 min' : '1 h' })}${st.pods ? ` · ${tx('{n} capsule', { n: st.pods })}` : ''}${st.gate ? ` · ${tx('{n} la poartă', { n: st.gate })}` : ''}</span>` : ''}
      ${hour ? `<span class="tip-row">${tx('Kill-uri ESI în ultima oră: {n}', { n: hour })}</span>` : ''}
      ${fight ? `<span class="tip-row neg-text">${tx('Bătălie')} · ${compactISK(fight.value)} ISK · ${tx('{n} kill-uri', { n: fight.kills })}</span>` : ''}
      ${st?.camp ? `<span class="tip-row neg-text">${st.smartbomb ? tx('Smartbomb camp') : tx('Posibil gatecamp')}</span>` : ''}
      ${a ? `<span class="tip-row dim">${tx('ESI ultima oră: {ships} nave, {pods} capsule, {jumps} sărituri', { ships: a.ship, pods: a.pod, jumps: formatInt(a.jumps) })}</span>` : ''}
      ${d != null ? `<span class="tip-row accent-text">${d === 0 ? tx('Ești aici') : tx('{n} sărituri de {who}', { n: d, who: esc(refLabel()) })}</span>` : ''}`;
  }

  function eventRow(k: LiveKill) {
    const { map, dist, stats } = env;
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
    const { map, dist, stats, status, battles } = env;
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
    const { map, selected, stats, activity, dist, sov, hourly } = env;
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
        <div><span class="label">${tx('Kill-uri zKillboard')} · ${settings.win === 15 ? '15 min' : '1 h'}</span><span class="value ${st ? 'neg-text' : ''}">${st?.n ?? 0}</span></div>
        <div title="${esc(tx('Eticheta Kill-uri N de lângă sistem: kill-urile din ultima oră după ESI, plus cele venite live de atunci.'))}"><span class="label">${tx('Kill-uri ESI · 1 h')}</span><span class="value">${hourly.get(s.id) ?? 0}</span></div>
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
    const { intel } = env;
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
    const { map, dist, intel } = env;
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

  return { layout, tooltip, eventsHtml, systemHtml, chatHtml };
}
