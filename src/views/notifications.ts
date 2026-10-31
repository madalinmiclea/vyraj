import type { AppContext } from '../app/context';
import { pageHead, panel, esc, loader, alertBox, button, badge, windowTitle, confirmDialog, emptyState } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { tx, locale } from '../i18n';
import { rosterCharacters } from '../character/roster';
import { hasTokens, hasScope } from '../character/sso';
import { hasPermission, permission, permissionGate } from '../character/permissions';
import {
  GROUPS, KINDS, LEADS, NOTICE_EVENT, LOG_EVENT, kindInfo, noticeSettings, saveNoticeSettings, browserPermission, askBrowser,
  loadLog, markAllRead, clearLog, unreadCount, testNotice, type NoticeGroup, type NoticeKind, type Notice,
} from '../services/notices';
import { upcoming, fireAt, left, type Upcoming } from '../services/notify';
import { gameNotices, gameKind, gameTitle, humanType, GAME_SCOPE, type GameNotice } from '../services/gameNotices';
import { nearbyStatus, NEARBY_EVENT } from '../services/nearbyKills';
import { loadMap, type NavMap } from '../services/navigation';

type Section = 'settings' | 'history' | 'upcoming' | 'game';

const SECTION_KEY = 'eve-notify:section';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'settings', label: tx('Ce primești') },
  { id: 'history', label: tx('Istoric') },
  { id: 'upcoming', label: tx('Următoarele') },
  { id: 'game', label: tx('Din joc') },
];

const leadLabel = (h: number) => (h === 0 ? tx('la momentul respectiv') : tx('cu {n} h înainte', { n: h }));
const when = (ms: number) => new Date(ms).toLocaleString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const time = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
const day = (ms: number) => new Date(ms).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
const groupIcon = (g: NoticeGroup) => GROUPS.find((x) => x.id === g)!.icon;

export interface NotificationsView { show(section?: Section): void }

export function createNotificationsView(el: HTMLElement, ctx: AppContext, side: HTMLElement): NotificationsView {
  const saved = loadJson<Section>(SECTION_KEY, 'settings');
  let section: Section = SECTIONS.some((s) => s.id === saved) ? saved : 'settings';
  let filter: NoticeGroup | 'all' = 'all';
  let next: Upcoming[] | null = null;
  let nextBusy = false;
  let game: { charId: number; list: GameNotice[] } | null = null;
  let gameBusy = false;
  let gameError = '';
  let map: NavMap | null = null;

  el.innerHTML = `${pageHead(tx('Notificări'), tx('Alegi ce te anunță Vyraj · piață, pilot, producție, PvP și notificările din joc'), 'Glas')}<div id="ntBody"></div>`;
  const body = el.querySelector<HTMLElement>('#ntBody')!;

  const visible = () => el.classList.contains('active');

  function renderSide() {
    const unread = unreadCount();
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Notificări'))}</div>
      <div class="side-nav">${SECTIONS.map((s) => `<button class="side-link ${s.id === section ? 'active' : ''}" data-nt-section="${s.id}">${esc(s.label)}${s.id === 'history' && unread ? `<span class="count">${unread}</span>` : ''}</button>`).join('')}</div>`;
  }

  const anyHas = (perm: NonNullable<ReturnType<typeof kindInfo>['perm']>) => rosterCharacters().some((c) => c.characterId != null && hasPermission(c.characterId, perm));

  function grantButton(perm: NonNullable<ReturnType<typeof kindInfo>['perm']>) {
    const c = ctx.character;
    const id = c.kind === 'esi' && c.characterId && hasTokens(c.characterId) ? c.characterId : null;
    return id ? button(tx('Permite'), { iconName: 'login', cls: 'ghost sm', attrs: `data-grant="${perm}" data-grant-char="${id}"` }) : '';
  }

  function nearbyLine() {
    const list = nearbyStatus();
    if (!list.length) return '';
    return `<div class="small dim nt-status">${list.map((p) => {
      const sys = p.systemId ? map?.systems.get(p.systemId)?.name ?? `#${p.systemId}` : null;
      return esc(sys ? tx('{name} în {system} din {time}', { name: p.name, system: sys, time: time(p.arrivedAt) }) : p.online === false ? tx('{name} e offline', { name: p.name }) : tx('{name}: căutăm locația', { name: p.name }));
    }).join(' · ')}</div>`;
  }

  function settingsSection() {
    const s = noticeSettings();
    const perm = browserPermission();
    const permState = perm === 'unsupported' ? tx('Browserul nu suportă notificări de sistem; le vezi ca mesaje în aplicație și în Istoric.')
      : perm === 'denied' ? tx('Browserul a blocat notificările pentru acest site. Le vezi ca mesaje în aplicație până le permiți din setările browserului.')
        : perm === 'default' ? tx('Browserul încă nu a primit acordul pentru notificări.') : tx('Browserul are acordul pentru notificări.');
    const delivery = panel({
      title: tx('Livrare'),
      count: s.enabled ? tx('pornite') : tx('oprite'),
      actions: button(tx('Trimite o probă'), { iconName: 'play', cls: 'ghost sm', attrs: 'data-nt-test' }),
      body: `<div class="nt-delivery">
          <label class="ord-toggle nt-master"><input type="checkbox" data-nt-enabled ${s.enabled ? 'checked' : ''} /> <b>${tx('Notificări Vyraj pornite')}</b></label>
          <label class="ord-toggle"><input type="checkbox" data-nt-system ${s.system ? 'checked' : ''} ${s.enabled && perm !== 'unsupported' ? '' : 'disabled'} /> ${tx('Notificări de sistem, și când Vyraj nu e în prim-plan')}</label>
          <p class="small dim">${esc(permState)} ${perm === 'default' && s.enabled && s.system ? button(tx('Permite în browser'), { cls: 'sm', attrs: 'data-nt-ask' }) : ''}</p>
          <p class="small dim">${tx('Vyraj verifică doar cât timp e deschis într-un tab, pentru toate caracterele logate. Ce s-a întâmplat cât a fost închis (ordine vândute, mailuri, notificări din joc) apare la următoarea deschidere. Tot ce primești rămâne în Istoric.')}</p>
        </div>`,
    });
    const groups = GROUPS.map((g) => {
      const kinds = KINDS.filter((k) => k.group === g.id);
      const rows = kinds.map((k) => {
        const conf = s.kinds[k.id];
        const missing = k.perm && !anyHas(k.perm);
        return `<div class="nt-kind ${conf.on ? '' : 'muted'}">
          <label class="ord-toggle"><input type="checkbox" data-nt-kind="${k.id}" ${conf.on ? 'checked' : ''} ${s.enabled ? '' : 'disabled'} /> ${esc(k.label)}</label>
          <div class="nt-kind-side">${k.lead ? `<select class="input plain nt-lead" data-nt-lead="${k.id}" ${s.enabled && conf.on ? '' : 'disabled'}>${LEADS.map((h) => `<option value="${h}" ${h === conf.lead ? 'selected' : ''}>${esc(leadLabel(h))}</option>`).join('')}</select>` : ''}</div>
          <div class="small dim nt-hint">${esc(k.hint)}</div>
          ${missing ? `<div class="nt-missing small">${icon('alert')}<span>${esc(tx('Niciun caracter nu are permisiunea {perm}.', { perm: permission(k.perm!).label }))}</span>${grantButton(k.perm!)}</div>` : ''}
          ${k.id === 'nearby' && conf.on && s.enabled ? nearbyLine() : ''}
        </div>`;
      }).join('');
      const extra = g.id === 'pvp' ? `<div class="nt-kind nt-link"><span>${icon('recon')} ${tx('Alarmele hărții live, pe raza aleasă de tine, se setează din Intel PvP > Hartă live.')}</span><a class="btn ghost sm" href="#/recon">${tx('Deschide')}</a></div>` : '';
      const on = kinds.filter((k) => s.kinds[k.id].on).length;
      return panel({
        title: g.label,
        count: `${on}/${kinds.length}`,
        actions: `<button class="chip-btn" data-nt-group="${g.id}" data-nt-group-on="${on < kinds.length ? 1 : 0}" ${s.enabled ? '' : 'disabled'}>${on < kinds.length ? tx('Toate') : tx('Niciuna')}</button>`,
        body: `<div class="nt-kinds ${s.enabled ? '' : 'off'}">${rows}${extra}</div>`,
      });
    }).join('');
    return `${delivery}<div class="nt-groups">${groups}</div>`;
  }

  function historySection() {
    const all = loadLog();
    const list = filter === 'all' ? all : all.filter((n) => kindInfo(n.kind)?.group === filter);
    const chips = `<div class="advice-sort"><button class="chip-btn ${filter === 'all' ? 'active' : ''}" data-nt-filter="all">${tx('Toate')}</button>${GROUPS.map((g) => `<button class="chip-btn ${filter === g.id ? 'active' : ''}" data-nt-filter="${g.id}">${esc(g.label)}</button>`).join('')}</div>`;
    const actions = `${chips}${all.length ? button(tx('Golește'), { iconName: 'trash', cls: 'ghost sm', attrs: 'data-nt-clear' }) : ''}`;
    if (!all.length) return panel({ title: tx('Istoric'), body: emptyState({ title: tx('Nicio notificare încă'), text: tx('Tot ce îți trimite Vyraj apare aici, cu ora și caracterul, ca să nu pierzi nimic dacă n-ai fost la calculator.') }) });
    let lastDay = '';
    const rows = list.map((n: Notice) => {
      const d = day(n.at);
      const head = d !== lastDay ? `<div class="nt-day">${esc(d)}</div>` : '';
      lastDay = d;
      const k = kindInfo(n.kind);
      const tag = n.url ? 'a' : 'div';
      return `${head}<${tag} class="nt-row ${n.read ? '' : 'unread'}" ${n.url ? `href="${esc(n.url)}"` : ''}>
        <span class="nt-ico">${icon(groupIcon(k?.group ?? 'pilot'))}</span>
        <span class="nt-text"><b>${esc(n.title)}</b><span class="dim">${esc(n.body).replace(/\n/g, '<br>')}</span></span>
        <span class="nt-meta small dim"><span class="num">${time(n.at)}</span>${k ? `<span>${esc(k.label)}</span>` : ''}</span>
      </${tag}>`;
    }).join('');
    return panel({ title: tx('Istoric'), count: list.length, actions, body: list.length ? `<div class="nt-log">${rows}</div>` : `<p class="dim">${tx('Nimic pentru filtrul ales.')}</p>` });
  }

  function upcomingSection() {
    const s = noticeSettings();
    if (!s.enabled) return panel({ title: tx('Următoarele'), body: `<p class="dim">${tx('Notificările sunt oprite. Pornește-le din Ce primești.')}</p>` });
    const list = (next ?? []).filter((e) => s.kinds[e.kind].on && e.at > Date.now()).slice(0, 40);
    const actions = button(nextBusy ? tx('Se verifică…') : tx('Verifică acum'), { iconName: 'refresh', cls: 'ghost sm', attrs: `data-nt-refresh ${nextBusy ? 'disabled' : ''}` });
    const content = next === null || nextBusy ? loader(tx('Adunăm evenimentele'))
      : list.length ? `<div class="table-scroll"><table class="table compact"><thead><tr><th>${tx('Eveniment')}</th><th>${tx('Tip')}</th><th class="r">${tx('Mai e')}</th><th class="r">${tx('Te anunțăm')}</th></tr></thead><tbody>${list.map((e) => `<tr>
          <td>${esc(e.title)}<div class="small dim">${esc(e.body)}</div></td>
          <td class="small dim">${esc(kindInfo(e.kind).label)}</td>
          <td class="r num nowrap">${left(e.at - Date.now())}</td>
          <td class="r small dim nowrap">${esc(when(fireAt(e, s)))}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="dim">${tx('Nimic programat acum.')}</p>`;
    return panel({ title: tx('Următoarele'), count: list.length || undefined, actions, body: `${content}<p class="small dim">${tx('Skill-uri, coada de antrenament, ordine care expiră, joburi de industrie, extractoare PI și contracte, pentru toate caracterele logate.')}</p>` });
  }

  function gameSection() {
    const c = ctx.character;
    if (c.kind !== 'esi' || !c.characterId || !hasTokens(c.characterId)) return panel({ body: alertBox(tx('Fă login cu un caracter EVE ca să vezi notificările din joc.')) });
    if (!hasScope(c.characterId, GAME_SCOPE)) return panel({ body: permissionGate('notifications', c.characterId, c.name) });
    const actions = button(gameBusy ? tx('Se încarcă…') : tx('Reîncarcă'), { iconName: 'refresh', cls: 'ghost sm', attrs: `data-nt-game-refresh ${gameBusy ? 'disabled' : ''}` });
    if (gameError) return panel({ title: tx('Din joc'), actions, body: alertBox(gameError) });
    if (!game || game.charId !== c.characterId || gameBusy) return panel({ title: tx('Din joc'), actions, body: loader(tx('Citim notificările din joc')) });
    const s = noticeSettings();
    const rows = game.list.slice(0, 80).map((n) => {
      const k = gameKind(n.type);
      return `<div class="nt-row ${n.is_read ? '' : 'unread'}">
        <span class="nt-ico">${icon('structure')}</span>
        <span class="nt-text"><b>${esc(gameTitle(n.type))}</b><span class="dim">${esc(humanType(n.type))}</span></span>
        <span class="nt-meta small dim"><span class="num">${esc(when(Date.parse(n.timestamp)))}</span>${badge(kindInfo(k).label, s.kinds[k].on ? 'ok' : '', true)}</span>
      </div>`;
    }).join('');
    return panel({
      title: tx('Din joc'), count: game.list.length, actions,
      body: `${game.list.length ? `<div class="nt-log">${rows}</div>` : `<p class="dim">${tx('Nicio notificare din joc în ultimele zile.')}</p>`}
        <p class="small dim">${tx('Ultimele notificări din joc ale caracterului {name}, citite din ESI (EVE le ține doar câteva zile și le actualizează la 10 minute). Punctul verde arată categoriile pentru care primești notificare.', { name: c.name })}</p>`,
    });
  }

  function render() {
    renderSide();
    if (section === 'history' && visible()) markAllRead();
    body.innerHTML = section === 'settings' ? settingsSection() : section === 'history' ? historySection() : section === 'upcoming' ? upcomingSection() : gameSection();
  }

  async function loadUpcoming(force = false) {
    if (nextBusy || !noticeSettings().enabled) return;
    nextBusy = true;
    render();
    try { next = await upcoming(force); } catch { next = []; } finally { nextBusy = false; if (section === 'upcoming') render(); }
  }

  async function loadGame(force = false) {
    const c = ctx.character;
    if (gameBusy || c.kind !== 'esi' || !c.characterId || !hasScope(c.characterId, GAME_SCOPE)) return;
    const charId = c.characterId;
    gameBusy = true;
    gameError = '';
    render();
    try { game = { charId, list: await gameNotices(charId, force) }; } catch (err) { gameError = (err as Error).message; } finally { gameBusy = false; if (section === 'game') render(); }
  }

  function show(s?: Section) {
    if (s) { section = s; saveJson(SECTION_KEY, s); }
    render();
    if (section === 'upcoming' && next === null) loadUpcoming();
    if (section === 'game' && (!game || game.charId !== ctx.character.characterId)) loadGame();
    if (section === 'settings' && !map && noticeSettings().kinds.nearby.on) loadMap().then((m) => { map = m; if (section === 'settings') render(); }).catch(() => {});
  }

  side.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-nt-section]');
    if (!b) return;
    show(b.dataset.ntSection as Section);
    el.closest('.main')?.scrollTo({ top: 0 });
  });

  body.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-nt-test]')) { testNotice(); return; }
    if (t.closest('[data-nt-ask]')) { askBrowser(); return; }
    if (t.closest('[data-nt-refresh]')) { loadUpcoming(true); return; }
    if (t.closest('[data-nt-game-refresh]')) { loadGame(true); return; }
    const f = t.closest<HTMLElement>('[data-nt-filter]');
    if (f) { filter = f.dataset.ntFilter as NoticeGroup | 'all'; render(); return; }
    const g = t.closest<HTMLElement>('[data-nt-group]');
    if (g) {
      const s = noticeSettings();
      const on = g.dataset.ntGroupOn === '1';
      for (const k of KINDS.filter((x) => x.group === g.dataset.ntGroup)) s.kinds[k.id] = { ...s.kinds[k.id], on };
      saveNoticeSettings(s);
      return;
    }
    if (t.closest('[data-nt-clear]') && await confirmDialog(tx('Ștergi tot istoricul de notificări?'), { ok: tx('Golește'), danger: true })) clearLog();
  });

  body.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const s = noticeSettings();
    if (t.matches('[data-nt-enabled]')) s.enabled = (t as HTMLInputElement).checked;
    else if (t.matches('[data-nt-system]')) s.system = (t as HTMLInputElement).checked;
    else if (t.matches('[data-nt-kind]')) { const id = (t as HTMLElement).dataset.ntKind as NoticeKind; s.kinds[id] = { ...s.kinds[id], on: (t as HTMLInputElement).checked }; }
    else if (t.matches('[data-nt-lead]')) { const id = (t as HTMLElement).dataset.ntLead as NoticeKind; s.kinds[id] = { ...s.kinds[id], lead: Number(t.value) }; }
    else return;
    saveNoticeSettings(s);
    next = null;
  });

  window.addEventListener(NOTICE_EVENT, () => { if (section === 'settings' || section === 'upcoming') show(); });
  window.addEventListener(LOG_EVENT, () => { if (section === 'history' && visible()) render(); else renderSide(); });
  ctx.onCharacterChange(() => { game = null; show(); });
  let nearbyKey = '';
  window.addEventListener(NEARBY_EVENT, () => {
    const key = JSON.stringify(nearbyStatus());
    if (key === nearbyKey) return;
    nearbyKey = key;
    if (section === 'settings' && visible()) render();
  });

  show();
  return { show };
}
