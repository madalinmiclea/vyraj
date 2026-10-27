import type { AppContext } from '../app/context';
import { portraitUrl } from '../character/esi';
import { hasTokens } from '../character/sso';
import { formatDuration } from '../character/training';
import { accountKey, fetchRosterEntry, loadAccounts, loadRoster, omegaUntil, refreshRoster, resolvePlaces, rosterCharacters, ROSTER_TTL, saveRoster, setAccount, type Places, type RosterEntry } from '../character/roster';
import { displaySec, secClass } from '../services/recon';
import { badge, button, closeModal, compactISK, esc, formatInt, lore, openModal, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { roman } from '../ui/itemInfo';
import { loadJson, saveJson } from '../storage';
import { tx, locale } from '../i18n';
import type { StoredCharacter } from '../character/characters';

const SORT_KEY = 'eve-fit:ui:roster-sort';
const DAY = 86_400_000;

type SortId = 'name' | 'queue' | 'omega' | 'sp';

const SORTS: [SortId, string][] = [
  ['name', tx('Nume')],
  ['queue', tx('Coada se termină')],
  ['omega', tx('Omega expiră')],
  ['sp', 'SP'],
];

export function createRosterView(el: HTMLElement, ctx: AppContext) {
  const sde = ctx.sde;
  let roster = loadRoster();
  let places: Places = { systems: new Map(), names: new Map() };
  let busy = false;
  let sort = loadJson<SortId>(SORT_KEY, 'name');

  const queueEnd = (e?: RosterEntry) => {
    const last = e?.queue.at(-1)?.finish;
    return last ? new Date(last).getTime() : 0;
  };

  const omegaEnd = (id: string) => {
    const d = omegaUntil(loadAccounts(), id);
    return d ? new Date(d + 'T23:59:59').getTime() : 0;
  };

  function sorted(chars: StoredCharacter[]) {
    const by: Record<SortId, (a: StoredCharacter, b: StoredCharacter) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      queue: (a, b) => queueEnd(roster[a.id]) - queueEnd(roster[b.id]),
      omega: (a, b) => (omegaEnd(a.id) || Infinity) - (omegaEnd(b.id) || Infinity),
      sp: (a, b) => (roster[b.id]?.totalSp ?? b.totalSp ?? 0) - (roster[a.id]?.totalSp ?? a.totalSp ?? 0),
    };
    return [...chars].sort((a, b) => by[sort](a, b) || a.name.localeCompare(b.name));
  }

  function trainingCell(e: RosterEntry | undefined, now: number) {
    if (!e || e.error) return '<span class="dim">—</span>';
    if (e.missing.includes('esi-skills.read_skillqueue.v1')) return '<span class="dim">—</span>';
    const cur = e.queue[0];
    if (!cur) return badge(tx('Coadă goală'), 'danger', true);
    const name = esc(sde.types.get(cur.skillId)?.name ?? String(cur.skillId));
    if (!cur.finish) return `<div class="roster-skill">${name} ${roman(cur.level)}</div>${badge(tx('Pauză'), 'warn', true)}`;
    const start = cur.start ? new Date(cur.start).getTime() : now;
    const finish = new Date(cur.finish).getTime();
    let pct = 0;
    if (cur.levelStartSp != null && cur.endSp != null && cur.startSp != null && finish > start) {
      const sp = cur.startSp + ((now - start) / (finish - start)) * (cur.endSp - cur.startSp);
      pct = ((sp - cur.levelStartSp) / (cur.endSp - cur.levelStartSp)) * 100;
    }
    const left = queueEnd(e) - now;
    const tone = left < DAY ? 'warn' : '';
    return `<div class="roster-skill">${name} ${roman(cur.level)} <span class="dim num">${formatDuration((finish - now) / 1000)}</span></div>
      <div class="roster-bar"><span style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></span></div>
      <div class="small ${tone ? 'warn-text' : 'dim'}">${tx('Coadă: {n} skill-uri · {time}', { n: e.queue.length, time: formatDuration(left / 1000) })}</div>`;
  }

  function locationCell(e: RosterEntry | undefined) {
    if (!e || e.systemId == null) return '<span class="dim">—</span>';
    const sys = places.systems.get(e.systemId);
    const sec = sys ? `<span class="num ${secClass(sys.sec)}">${displaySec(sys.sec).toFixed(1)}</span> ` : '';
    const dock = e.stationId ?? e.structureId;
    const where = dock != null ? places.names.get(dock) ?? (e.structureId != null ? tx('Structură privată') : '') : tx('În spațiu');
    const ship = e.shipTypeId ? `${sde.types.get(e.shipTypeId)?.name ?? ''}${e.shipName ? ` · ${e.shipName}` : ''}` : '';
    return `<div>${sec}<b>${esc(sys?.name ?? String(e.systemId))}</b></div>
      ${where ? `<div class="small dim roster-ellipsis" title="${esc(where)}">${esc(where)}</div>` : ''}
      ${ship ? `<div class="small dim roster-ellipsis" title="${esc(ship)}">${esc(ship)}</div>` : ''}`;
  }

  function omegaCell(c: StoredCharacter, e: RosterEntry | undefined, now: number) {
    const accounts = loadAccounts();
    const until = omegaUntil(accounts, c.id);
    const account = accounts.chars[c.id];
    let main = button(tx('Setează'), { cls: 'ghost sm', attrs: `data-roster-edit="${esc(c.id)}"` });
    if (until) {
      const end = new Date(until + 'T23:59:59').getTime();
      const days = Math.ceil((end - now) / DAY);
      const date = new Date(until + 'T12:00:00').toLocaleDateString(locale);
      main = `<button class="link" data-roster-edit="${esc(c.id)}">${days < 0
        ? badge(tx('Expirat {date}', { date }), 'danger', true)
        : badge(`${date} · ${tx('{n} zile', { n: days })}`, days <= 7 ? 'warn' : 'ok', true)}</button>`;
    }
    const detected = e?.clone === 'alpha'
      ? `<span title="${esc(tx('Detectat din skill-uri sau din viteza de antrenament'))}">${badge('Alpha', 'warn')}</span>`
      : e?.clone === 'omega'
        ? `<span title="${esc(tx('Detectat din viteza de antrenament'))}">${badge('Omega', 'accent')}</span>`
        : e ? `<span title="${esc(e.error ? tx('Nu am date ESI pentru caracter (delogat sau eroare la citire)') : tx('Nu se poate determina: niciun skill peste limita Alpha și nimic în antrenament acum'))}">${badge('?', '')}</span>` : '';
    return `${main}<div class="roster-tags">${detected}${account ? `<span class="small dim">${esc(account)}</span>` : ''}</div>`;
  }

  function characterCell(c: StoredCharacter, e: RosterEntry | undefined, now: number) {
    const status = e?.error === 'logged-out' || !hasTokens(c.characterId!)
      ? badge(tx('Delogat'), 'danger')
      : e?.missing.length
        ? `<span title="${esc(e.missing.join('\n'))}">${badge(tx('Permisiuni lipsă'), 'warn')}</span>`
        : '';
    const onlineDot = e?.online != null ? `<span class="roster-dot ${e.online ? 'on' : ''}" title="${e.online ? 'Online' : 'Offline'}"></span>` : '';
    const seen = e?.online === false && e.lastLogin ? ` · ${tx('login acum {time}', { time: formatDuration((now - new Date(e.lastLogin).getTime()) / 1000) })}` : '';
    return `<div class="roster-who">
      <span class="roster-portrait"><img src="${portraitUrl(c.characterId!, 64)}" alt="" />${onlineDot}</span>
      <div><button class="link roster-name" data-roster-use="${esc(c.id)}">${esc(c.name)}</button>
        <div class="small dim">${formatInt(e?.totalSp ?? c.totalSp ?? 0)} SP${seen}</div>${status}</div>
    </div>`;
  }

  function render() {
    const chars = rosterCharacters();
    if (!chars.length) { el.innerHTML = ''; return; }
    const now = Date.now();
    const entries = chars.map((c) => roster[c.id]);
    const training = entries.filter((e) => e?.queue[0]?.finish).length;
    const empty = entries.filter((e) => e && !e.error && !e.missing.includes('esi-skills.read_skillqueue.v1') && !e.queue.length).length;
    const ending = entries.filter((e) => e?.queue.length && queueEnd(e) && queueEnd(e) - now < DAY).length;
    const omegaSoon = chars.filter((c) => { const end = omegaEnd(c.id); return end && end - now <= 7 * DAY; }).length;
    const online = entries.filter((e) => e?.online).length;
    const totalSp = chars.reduce((s, c) => s + (roster[c.id]?.totalSp ?? c.totalSp ?? 0), 0);
    const isk = entries.reduce((s, e) => s + (e?.wallet ?? 0), 0);
    const needLogin = entries.some((e) => e?.missing.some((m) => m.startsWith('esi-location') || m.startsWith('esi-universe')));
    const accounts = new Set(chars.map((c) => accountKey(loadAccounts(), c.id))).size;
    const chip = (label: string, value: string | number, tone = '') => `<div class="roster-chip ${tone}"><span class="label">${label}</span><span class="value num">${value}</span></div>`;
    const updated = entries.reduce((m, e) => Math.max(m, e?.fetched ?? 0), 0);

    el.innerHTML = `<section class="panel roster">
      <div class="panel-head">
        <div class="window-title">${lore(esc(tx('Toate caracterele')), 'Clade Census')}<span class="count">${chars.length}</span></div>
        <div class="panel-actions">
          <select class="input plain sm" data-roster-sort>${SORTS.map(([id, label]) => `<option value="${id}" ${id === sort ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
          ${button(busy ? tx('Se actualizează…') : tx('Actualizează toate'), { iconName: 'refresh', cls: 'ghost sm', attrs: `data-roster-refresh ${busy ? 'disabled' : ''}` })}
        </div>
      </div>
      <div class="panel-body">
        <div class="roster-chips">
          ${chip(tx('În antrenament'), `${training}/${chars.length}`)}
          ${chip(tx('Cozi goale'), empty, empty ? 'danger' : '')}
          ${chip(tx('Coada se termină în 24h'), ending, ending ? 'warn' : '')}
          ${chip(tx('Omega expiră în 7 zile'), omegaSoon, omegaSoon ? 'warn' : '')}
          ${chip('Online', online)}
          ${chip(tx('Conturi'), accounts)}
          ${chip(tx('SP total'), formatInt(totalSp))}
          ${chip('ISK', compactISK(isk))}
        </div>
        ${needLogin ? `<p class="small dim roster-note">${tx('Unele caractere au fost logate înainte ca Vyraj să ceară locația și statusul online. Fă din nou login cu ele din „Adaugă caracter”, dreapta sus.')}</p>` : ''}
        <div class="table-scroll">
          <table class="table roster-table">
            <thead><tr><th>${tx('Caracter')}</th><th>${tx('Antrenează')}</th><th>${tx('Locație')}</th><th>Omega</th><th class="r">ISK</th><th></th></tr></thead>
            <tbody>${sorted(chars).map((c) => {
              const e = roster[c.id];
              return `<tr class="${c.id === ctx.character.id ? 'active' : ''}">
                <td>${characterCell(c, e, now)}</td>
                <td data-label="${tx('Antrenează')}">${trainingCell(e, now)}</td>
                <td data-label="${tx('Locație')}">${locationCell(e)}</td>
                <td data-label="Omega">${omegaCell(c, e, now)}</td>
                <td class="r num" data-label="ISK">${e?.wallet != null ? compactISK(e.wallet) : '<span class="dim">—</span>'}</td>
                <td class="r"><button class="btn ghost sm icon-only" data-roster-edit="${esc(c.id)}" title="${tx('Cont și Omega')}">${icon('settings')}</button></td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
        <p class="small dim roster-note">${tx('ESI nu spune când expiră Omega și nici ce caractere sunt pe același cont. Vyraj detectează Alpha/Omega din skill-uri și viteza de antrenament; data de expirare o pui tu o dată pe cont, iar caracterele cu același nume de cont o împart.')}${updated ? ` ${tx('Actualizat la {time}.', { time: new Date(updated).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}` : ''}</p>
      </div>
    </section>`;
  }

  async function loadPlaces() {
    places = await resolvePlaces(Object.values(roster)).catch(() => places);
    render();
  }

  async function refreshAll() {
    if (busy) return;
    busy = true;
    render();
    try {
      roster = await refreshRoster(sde, (e) => { roster = { ...roster, [e.id]: e }; });
    } finally {
      busy = false;
    }
    const active = ctx.character;
    if (active.kind === 'esi' && roster[active.id] && roster[active.id].clone !== active.clone) ctx.reloadCharacters();
    render();
    await loadPlaces();
  }

  function editAccount(id: string) {
    const c = rosterCharacters().find((x) => x.id === id);
    if (!c) return;
    const accounts = loadAccounts();
    const names = [...new Set(Object.values(accounts.chars))].sort();
    const current = omegaUntil(accounts, id) ?? '';
    const modal = openModal(tx('Cont și Omega · {name}', { name: c.name }), `
      <div class="stack roster-form">
        <label class="small dim">${tx('Nume cont (caracterele cu același nume împart data Omega)')}</label>
        <input class="input plain" id="rosterAccount" data-list="rosterAccounts" value="${esc(accounts.chars[id] ?? '')}" placeholder="${tx('ex: cont principal')}" spellcheck="false" />
        <datalist id="rosterAccounts">${names.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
        <label class="small dim">${tx('Omega expiră pe')}</label>
        <input class="input plain date-input" id="rosterOmega" type="text" data-date readonly value="${esc(current)}" placeholder="${tx('Alege data')}" />
        <div class="row-actions">${[30, 90, 180, 365].map((d) => button(`+${d} ${tx('zile')}`, { cls: 'ghost sm', attrs: `data-add-days="${d}"` })).join('')}</div>
        <p class="small dim">${tx('Data o găsești în launcher sau pe secure.eveonline.com, la Account Management.')}</p>
        <div class="row-actions">${button(tx('Salvează'), { cls: 'sm', attrs: 'data-roster-save' })}${button(tx('Șterge data'), { cls: 'ghost sm', attrs: 'data-roster-clear' })}</div>
      </div>`);
    const accountInput = modal.querySelector<HTMLInputElement>('#rosterAccount')!;
    const dateInput = modal.querySelector<HTMLInputElement>('#rosterOmega')!;
    accountInput.addEventListener('change', () => {
      const shared = loadAccounts().omega[accountInput.value.trim()];
      if (shared) dateInput.value = shared;
    });
    modal.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      const add = t.closest<HTMLElement>('[data-add-days]');
      if (add) {
        const from = Math.max(Date.now(), dateInput.value ? new Date(dateInput.value + 'T12:00:00').getTime() : 0);
        dateInput.value = new Date(from + Number(add.dataset.addDays) * DAY).toISOString().slice(0, 10);
        return;
      }
      if (t.closest('[data-roster-save]') || t.closest('[data-roster-clear]')) {
        setAccount(id, accountInput.value, t.closest('[data-roster-clear]') ? '' : dateInput.value);
        closeModal();
        toast(tx('Salvat'));
        render();
      }
    });
  }

  el.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest('[data-roster-refresh]')) { refreshAll(); return; }
    const use = t.closest<HTMLElement>('[data-roster-use]');
    if (use) { ctx.setCharacter(use.dataset.rosterUse!); document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const edit = t.closest<HTMLElement>('[data-roster-edit]');
    if (edit) editAccount(edit.dataset.rosterEdit!);
  });

  el.addEventListener('change', (ev) => {
    const s = (ev.target as HTMLElement).closest<HTMLSelectElement>('[data-roster-sort]');
    if (!s) return;
    sort = s.value as SortId;
    saveJson(SORT_KEY, sort);
    render();
  });

  const visible = () => document.visibilityState === 'visible' && Boolean(el.closest('.view.active'));
  const stale = () => rosterCharacters().some((c) => !roster[c.id] || Date.now() - roster[c.id].fetched > ROSTER_TTL);

  ctx.onCharacterChange(async () => {
    const fresh = rosterCharacters().filter((c) => !roster[c.id]);
    render();
    if (!fresh.length) return;
    for (const c of fresh) roster = { ...roster, [c.id]: await fetchRosterEntry(sde, c).catch(() => ({ id: c.id, characterId: c.characterId!, fetched: Date.now(), queue: [], clone: 'unknown' as const, missing: [], error: 'failed' })) };
    saveRoster(roster);
    render();
    loadPlaces();
  });

  setInterval(() => {
    if (!visible()) return;
    if (stale()) refreshAll(); else render();
  }, 60_000);

  render();
  if (rosterCharacters().length) {
    if (stale()) refreshAll(); else loadPlaces();
  }
}
