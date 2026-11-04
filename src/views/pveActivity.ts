import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, compactISK, dataStamp } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { hasScope, loginProblem } from '../character/sso';
import { permissionGate } from '../character/permissions';
import { loyaltyPoints, universeNames, type WalletEntry } from '../character/esi';
import { syncWallet, PERIODS, periodStart, since, bountyTicks, pveSessions, WALLET_SCOPE, type Period } from '../services/wallet';
import { npcInfo, npcClass, type NpcClass, type NpcInfo } from '../services/npcKills';
import { loadMap, displaySec, secClass, type NavMap } from '../services/navigation';
import { typeIconUrl } from '../services/market';
import { tx, locale } from '../i18n';

const PERIOD_KEY = 'eve-missions:activity-period';
const LP_SCOPE = 'esi-characters.read_loyalty.v1';
const NOTABLE_LIMIT = 40;

interface Source { id: string; label: string; hint: string; refs: string[]; unit: string; countRef?: string }

const SOURCES: Source[] = [
  { id: 'bounty', label: tx('Recompense NPC'), hint: tx('Bounty plătit de CONCORD la fiecare tick de 20 de minute, după taxa corporației'), refs: ['bounty_prizes', 'bounty_prize'], unit: tx('{n} tick-uri') },
  { id: 'ess', label: 'ESS', hint: tx('Partea de bounty ținută în ESS-ul sistemului și plătită la final'), refs: ['ess_escrow_transfer'], unit: tx('{n} plăți') },
  { id: 'missions', label: tx('Misiuni'), hint: tx('Recompensa agentului plus bonusul pentru misiunea terminată repede'), refs: ['agent_mission_reward', 'agent_mission_time_bonus_reward'], unit: tx('{n} misiuni'), countRef: 'agent_mission_reward' },
  { id: 'concord', label: tx('Incursiuni'), hint: tx('Plăți CONCORD pentru site-uri de incursiune și alte recompense de corporație'), refs: ['corporate_reward_payout'], unit: tx('{n} plăți') },
  { id: 'goals', label: tx('Obiective zilnice'), hint: tx('Recompensele pentru obiectivele zilnice'), refs: ['daily_goal_payouts'], unit: tx('{n} plăți') },
  { id: 'pd', label: 'Project Discovery', hint: tx('Recompense din Project Discovery'), refs: ['project_discovery_reward'], unit: tx('{n} plăți') },
];

const SHAPES: Record<string, string> = {
  frigate: '<path d="M4 15 10 6l6 9Z"/>',
  cruiser: '<path d="M4 16V9.5L10 4l6 5.5V16Z"/>',
  battleship: '<path d="M4 17 10 9l6 8M4 11l6-8 6 8"/>',
  capital: '<path d="M10 2.5 17.5 10 10 17.5 2.5 10Z"/>',
  super: '<path d="M10 2 17 9l-7 7-7-7ZM3 12.5 10 19.5l7-7"/>',
  titan: '<path d="M4 19l6-6 6 6M4 13.5l6-6 6 6M4 8l6-6 6 6"/>',
};

const shape = (id: string) => `<svg class="pva-shape" viewBox="0 0 20 21" aria-hidden="true">${SHAPES[id]}</svg>`;

const RATTING: { id: NpcClass; label: string; hint: string; icon: string }[] = [
  { id: 'sub', label: tx('Subcapitale'), hint: tx('Nave NPC subcapitale distruse (fregate până la battleship-uri)'), icon: 'battleship' },
  { id: 'cap', label: tx('Capitale'), hint: tx('Dreadnought-uri, carrier-e și alte capitale NPC distruse'), icon: 'capital' },
  { id: 'super', label: tx('Supercarrier-e'), hint: tx('Supercarrier-e NPC distruse'), icon: 'super' },
  { id: 'titan', label: tx('Titani'), hint: tx('Titani NPC distruși'), icon: 'titan' },
];

const OFFICERS: { id: NpcClass; label: string; icon: string }[] = [
  { id: 'offBs', label: tx('Officer battleship'), icon: 'battleship' },
  { id: 'offCr', label: tx('Officer cruiser'), icon: 'cruiser' },
  { id: 'offFr', label: tx('Officer fregată'), icon: 'frigate' },
];

const CLASS_NAME: Record<NpcClass, string> = {
  sub: tx('Subcapitală'), cap: tx('Capitală'), super: tx('Supercarrier'), titan: tx('Titan'),
  offBs: tx('Officer battleship'), offCr: tx('Officer cruiser'), offFr: tx('Officer fregată'),
};

const dateTime = (ms: number) => new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const day = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });

function tile(o: { label: string; hint: string; value: string; sub?: string; on: boolean; icon?: string }) {
  return `<div class="pva-tile ${o.on ? 'on' : ''}" title="${esc(o.hint)}">
    ${o.icon ? `<span class="pva-icon">${shape(o.icon)}</span>` : ''}
    <span class="pva-tile-text"><span class="label">${esc(o.label)}</span><span class="value">${o.on ? o.value : '—'}</span>${o.sub && o.on ? `<span class="pva-sub dim small">${esc(o.sub)}</span>` : ''}</span>
  </div>`;
}

export interface PveActivityPanel { show(): void; hide(): void }

export function createPveActivityPanel(el: HTMLElement, ctx: AppContext): PveActivityPanel {
  let visible = false;
  let seq = 0;
  let period = loadJson<Period>(PERIOD_KEY, '30d');
  if (!PERIODS.some((p) => p.id === period)) period = '30d';
  let data: { charId: number; entries: WalletEntry[]; at: number } | null = null;
  const lpCache = new Map<number, { corp: number; name: string; lp: number }[]>();

  async function load(force = false) {
    if (!visible) return;
    const c = ctx.character;
    const problem = loginProblem(c);
    if (problem || !c.characterId) { el.innerHTML = panel({ body: alertBox(problem ?? '') }); return; }
    if (!hasScope(c.characterId, WALLET_SCOPE)) { el.innerHTML = panel({ title: tx('Activitate PvE'), body: permissionGate('wallet', c.characterId, c.name) }); return; }
    const mine = ++seq;
    const charId = c.characterId;
    if (force || data?.charId !== charId) {
      try {
        const r = await syncWallet(charId, force, () => { if (mine === seq) el.innerHTML = panel({ body: loader(tx('Citesc jurnalul portofelului')) }); });
        if (mine !== seq) return;
        data = { charId, entries: r.entries, at: r.at };
      } catch (err) {
        if (mine === seq) el.innerHTML = panel({ body: alertBox((err as Error).message, 'danger') });
        return;
      }
    }
    if (force) lpCache.delete(charId);
    render(mine);
  }

  function income(rows: WalletEntry[]) {
    const sums = SOURCES.map((s) => {
      const list = rows.filter((e) => s.refs.includes(e.ref_type) && (e.amount ?? 0) > 0);
      return { s, isk: list.reduce((a, e) => a + (e.amount ?? 0), 0), n: list.filter((e) => !s.countRef || e.ref_type === s.countRef).length };
    });
    const total = sums.reduce((a, x) => a + x.isk, 0);
    const sessions = pveSessions(rows);
    const hours = sessions.reduce((a, x) => a + (x.end - x.start), 0) / 3600000;
    const days = new Set(rows.filter((e) => SOURCES.some((s) => s.refs.includes(e.ref_type)) && (e.amount ?? 0) > 0).map((e) => Math.floor(Date.parse(e.date) / 86400000))).size;
    const shown = sums.filter((x) => x.isk > 0 || ['bounty', 'ess', 'missions', 'concord'].includes(x.s.id));
    const share = sums.filter((x) => x.isk > 0).sort((a, b) => b.isk - a.isk);
    return panel({
      title: tx('Venit PvE'),
      body: `<div class="history-kpis compact">
          <div><span class="label">${tx('Total PvE')}</span><span class="value up">${compactISK(total)}</span></div>
          <div title="${esc(tx('Timpul estimat din tick-uri și plăți apropiate: o pauză de peste 30 de minute începe o sesiune nouă'))}"><span class="label">${tx('Ore PvE')}</span><span class="value">${hours ? hours.toFixed(1) : '—'}</span></div>
          <div><span class="label">${tx('ISK / oră')}</span><span class="value">${hours ? compactISK(total / hours) : '—'}</span></div>
          <div><span class="label">${tx('Zile active')}</span><span class="value">${formatInt(days)}</span></div>
          <div><span class="label">${tx('Sesiuni')}</span><span class="value">${formatInt(sessions.length)}</span></div>
        </div>
        <div class="pva-tiles">${shown.map((x) => tile({ label: x.s.label, hint: x.s.hint, value: `+${compactISK(x.isk)}`, sub: tx(x.s.unit, { n: formatInt(x.n) }), on: x.isk > 0 })).join('')}</div>
        ${share.length > 1 ? `<div class="pva-share">${share.map((x) => {
          const pct = (x.isk / total) * 100;
          return `<div class="pva-share-row"><span>${esc(x.s.label)}</span><span class="pva-bar"><i style="width:${Math.max(1, pct).toFixed(1)}%"></i></span><span class="num dim">${pct.toFixed(pct < 10 ? 1 : 0)}%</span></div>`;
        }).join('')}</div>` : ''}`,
    });
  }

  function render(mine: number) {
    if (!data) return;
    const from = periodStart(period);
    const rows = since(data.entries, from);
    const oldest = data.entries.length ? Date.parse(data.entries[data.entries.length - 1].date) : Date.now();
    const partial = data.entries.length > 0 && from < oldest - 3600000;
    const chips = PERIODS.map((p) => `<button class="chip-btn ${p.id === period ? 'active' : ''}" data-pva-period="${p.id}">${p.label}</button>`).join('');
    el.innerHTML = `<div class="stack pva">
      <div class="wallet-bar">
        <span class="dim small">${data.entries.length ? tx('Istoric salvat din {date}', { date: day(oldest) }) : tx('Nicio intrare în jurnal')}</span>
        <span class="wallet-bar-actions">${dataStamp(data.at, 'data-pva-refresh', { label: tx('Date din {time}'), title: tx('Jurnalul și soldul sunt păstrate până le reîmprospătezi. Click pentru a le citi din nou din ESI.') })}<span class="advice-sort">${chips}</span></span>
      </div>
      ${partial ? `<p class="dim small wallet-note">${tx('EVE dă doar ultimele 30 de zile din jurnal. Perioadele mai lungi se completează pe măsură ce Vyraj citește jurnalul în timp.')}</p>` : ''}
      ${income(rows)}
      <div id="pvaRatting">${panel({ title: tx('Activitate ratting'), body: loader(tx('Citesc numele NPC-urilor')) })}</div>
      <div id="pvaLp"></div>
    </div>`;
    ratting(mine, rows);
    loyalty(mine);
  }

  async function ratting(mine: number, rows: WalletEntry[]) {
    const box = el.querySelector<HTMLElement>('#pvaRatting');
    if (!box) return;
    const ticks = bountyTicks(rows);
    const ids = [...new Set(ticks.flatMap((k) => k.kills.map(([id]) => id)))];
    const [info, nav] = await Promise.all([
      npcInfo(ids).catch(() => new Map<number, NpcInfo>()),
      loadMap().catch(() => null as NavMap | null),
    ]);
    if (mine !== seq || !visible) return;
    const count = new Map<NpcClass, number>();
    const notable: { t: number; systemId?: number; id: number; n: number; cls: NpcClass }[] = [];
    for (const k of ticks) {
      for (const [id, n] of k.kills) {
        const cls = npcClass(info.get(id)?.group ?? '');
        count.set(cls, (count.get(cls) ?? 0) + n);
        if (cls !== 'sub') notable.push({ t: k.t, systemId: k.systemId, id, n, cls });
      }
    }
    const missing = ticks.some((k) => !k.kills.length);
    const sys = (id?: number) => {
      const x = id ? nav?.systems.get(id) : undefined;
      return x ? `${esc(x.name)} <span class="sec ${secClass(x.sec)}">${displaySec(x.sec).toFixed(1)}</span>` : `<span class="dim">${id ? `#${id}` : '—'}</span>`;
    };
    const n = (id: NpcClass) => count.get(id) ?? 0;
    box.innerHTML = panel({
      title: tx('Activitate ratting'),
      count: ticks.length ? tx('{n} tick-uri în perioadă', { n: formatInt(ticks.length) }) : '',
      body: `<div class="pva-groups">
          <div class="pva-group"><div class="pva-group-head">${tx('Ratting')}</div><div class="pva-tiles">${RATTING.map((r) => tile({ label: r.label, hint: r.hint, value: formatInt(n(r.id)), on: n(r.id) > 0, icon: r.icon })).join('')}</div></div>
          <div class="pva-group"><div class="pva-group-head">${tx('Officers')}</div><div class="pva-tiles">${OFFICERS.map((r) => tile({ label: r.label, hint: tx('Officer NPC-uri distruse, clasa {c}', { c: r.label }), value: formatInt(n(r.id)), on: n(r.id) > 0, icon: r.icon })).join('')}</div></div>
        </div>
        ${!ticks.length ? `<p class="dim">${tx('Niciun tick de recompense NPC în perioada aleasă. Tick-urile apar după ratting în anomalii sau misiuni, la fiecare 20 de minute.')}</p>` : ''}
        ${missing ? `<p class="dim small wallet-note">${tx('Unele tick-uri nu au lista de NPC-uri de la EVE, așa că nu intră în numărătoare.')}</p>` : ''}
        ${notable.length ? `<div class="pva-group-head">${tx('Capitale și officers distruși')}</div>
          <div class="wallet-scroll"><table class="table compact"><thead><tr><th>${tx('Data')}</th><th>NPC</th><th>${tx('Clasă')}</th><th>${tx('Sistem')}</th><th class="r">#</th></tr></thead><tbody>
          ${notable.slice(0, NOTABLE_LIMIT).map((x) => `<tr><td class="num dim">${dateTime(x.t)}</td><td><span class="recon-ship"><img class="row-icon" src="${typeIconUrl(x.id, 32)}" alt="" loading="lazy" /><span>${esc(info.get(x.id)?.name ?? `#${x.id}`)}</span></span></td><td><span class="badge ${x.cls.startsWith('off') ? 'gold' : 'accent'}">${esc(CLASS_NAME[x.cls])}</span></td><td>${sys(x.systemId)}</td><td class="r num">×${formatInt(x.n)}</td></tr>`).join('')}
          </tbody></table></div>` : ''}`,
    });
  }

  async function loyalty(mine: number) {
    const box = el.querySelector<HTMLElement>('#pvaLp');
    const c = ctx.character;
    if (!box || !c.characterId) return;
    const title = tx('Puncte de loialitate');
    if (!hasScope(c.characterId, LP_SCOPE)) { box.innerHTML = panel({ title, body: permissionGate('loyalty', c.characterId, c.name) }); return; }
    let list = lpCache.get(c.characterId);
    if (!list) {
      box.innerHTML = panel({ title, body: loader(tx('Citesc LP-urile')) });
      try {
        const raw = (await loyaltyPoints(c.characterId)).filter((x) => x.loyalty_points > 0);
        const names = await universeNames(raw.map((x) => x.corporation_id)).catch(() => new Map<number, string>());
        list = raw.map((x) => ({ corp: x.corporation_id, name: names.get(x.corporation_id) ?? `#${x.corporation_id}`, lp: x.loyalty_points })).sort((a, b) => b.lp - a.lp);
        lpCache.set(c.characterId, list);
      } catch (err) {
        if (mine === seq) box.innerHTML = panel({ title, body: `<p class="dim">${esc((err as Error).message)}</p>` });
        return;
      }
      if (mine !== seq || !visible) return;
    }
    const total = list.reduce((a, x) => a + x.lp, 0);
    box.innerHTML = panel({
      title,
      count: list.length ? tx('{n} LP în total', { n: formatInt(total) }) : '',
      body: list.length ? `<div class="pva-tiles lp">${list.map((x) => `<div class="pva-tile on" title="${esc(x.name)}">
          <img class="pva-logo" src="https://images.evetech.net/corporations/${x.corp}/logo?size=64" alt="" loading="lazy" />
          <span class="pva-tile-text"><span class="label">${esc(x.name)}</span><span class="value">${formatInt(x.lp)}</span></span>
        </div>`).join('')}</div>
        <p class="dim small wallet-note">${tx('LP-ul vine din misiuni, incursiuni și Faction Warfare. Vezi ce merită cumpărat în Magazin LP.')}</p>` : `<p class="dim">${tx('Nu ai LP la nicio corporație.')}</p>`,
    });
  }

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const p = t.closest<HTMLElement>('[data-pva-period]');
    if (p) {
      period = p.dataset.pvaPeriod as Period;
      saveJson(PERIOD_KEY, period);
      render(++seq);
      return;
    }
    if (t.closest('[data-pva-refresh]')) load(true);
  });

  ctx.onCharacterChange(() => { data = null; if (visible) load(); });

  return {
    show() { visible = true; load(); },
    hide() { visible = false; seq++; },
  };
}
