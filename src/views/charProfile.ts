import type { AppContext } from '../app/context';
import { Category, type Sde } from '../data/sde';
import type { StoredCharacter } from '../character/characters';
import { currentShip, characterLocation, listAssets, portraitUrl, universeNames } from '../character/esi';
import { hasPermission, permissionGate } from '../character/permissions';
import { directRequirements } from '../character/requirements';
import { skillRank, spForLevel } from '../character/training';
import { characterPublic, corporationHistory, loadActivities } from '../services/operations';
import { bountyTicks, periodStart, pveSessions, since, syncWallet } from '../services/wallet';
import { npcClass, npcInfo, type NpcClass } from '../services/npcKills';
import { pilotStats } from '../services/recon';
import { typeIconUrl } from '../services/market';
import { decodeCode, encodeCode } from '../io/shareLink';
import { shortLink } from '../io/shortLink';
import { shareLinkUrl } from '../app/route';
import { openShareModal } from '../ui/shareModal';
import { alertBox, badge, button, compactISK, dataStamp, esc, formatInt, loader, openModal, panel } from '../ui/components';
import { icon } from '../ui/icons';
import { roman, showItemInfo } from '../ui/itemInfo';
import { skillGroupLabel } from './skills';
import { isDemo, loadJson, saveJson } from '../storage';
import { locale, tx } from '../i18n';

const CACHE_KEY = (id: number) => `eve-fit:profile:${id}`;
const SHARE_KEY = 'eve-fit:profile-share';

type Part = 'skills' | 'isk' | 'loc' | 'pve' | 'pvp' | 'hist' | 'ships' | 'imp';
const PARTS: { id: Part; label: string; on: boolean }[] = [
  { id: 'skills', label: tx('Skill-uri și ce poate zbura'), on: true },
  { id: 'pve', label: tx('Activitate PvE'), on: true },
  { id: 'pvp', label: tx('Statistici PvP'), on: true },
  { id: 'hist', label: tx('Istoric corporații'), on: true },
  { id: 'ships', label: tx('Nave deținute'), on: true },
  { id: 'isk', label: tx('ISK în portofel'), on: false },
  { id: 'loc', label: tx('Locația și nava de acum'), on: false },
  { id: 'imp', label: tx('Implanturi'), on: false },
];

interface Pve { t: number; h: number; d: number; n: number; src: Record<string, number>; k: Partial<Record<NpcClass, number>> }
interface Pvp { k: number; l: number; s: number; d: number; i: number; top: [number, number][] }

export interface Snap {
  v: 1;
  at: number;
  id: number;
  name: string;
  sp: number;
  corp?: [number, string];
  ally?: [number, string];
  birth?: string;
  sec?: number;
  title?: string;
  ach?: number;
  clone?: string;
  sk?: [number, number][];
  isk?: number;
  loc?: [number, string, number];
  pve?: Pve;
  pvp?: Pvp;
  hist?: [number, string, string][];
  ships?: [number, number][];
  imp?: number[];
}

const DEMO_PVP: Pvp = { k: 214, l: 37, s: 41, d: 72, i: 18_400_000_000, top: [[17843, 61], [11993, 38], [29984, 22]] };

const num = (v: unknown, min = -1e15, max = 1e15) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
const int = (v: unknown, min = 0, max = 2 ** 31) => { const n = num(v, min, max); return n === undefined ? undefined : Math.round(n); };
const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

function readSnap(raw: unknown): Snap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = int(r.id, 1);
  const name = str(r.name, 60);
  if (r.v !== 1 || !id || !name) return null;
  const pair = (v: unknown): [number, string] | undefined => { const a = arr(v, 2); const i = int(a[0], 1); return i ? [i, str(a[1]) ?? ''] : undefined; };
  const s: Snap = { v: 1, at: int(r.at, 0, 1e14) ?? 0, id, name, sp: int(r.sp, 0, 1e10) ?? 0 };
  s.corp = pair(r.corp);
  s.ally = pair(r.ally);
  s.birth = str(r.birth, 40);
  s.sec = num(r.sec, -10, 10);
  s.title = str(r.title);
  s.ach = int(r.ach, 0, 1e9);
  s.clone = ['alpha', 'omega'].includes(r.clone as string) ? (r.clone as string) : undefined;
  if (r.sk !== undefined) s.sk = arr(r.sk, 1000).map((x) => arr(x, 2)).map((x) => [int(x[0], 1) ?? 0, int(x[1], 0, 5) ?? 0] as [number, number]).filter((x) => x[0] && x[1]);
  s.isk = num(r.isk, -1e15, 1e15);
  if (r.loc !== undefined) { const l = arr(r.loc, 3); const sys = int(l[0], 1); if (sys) s.loc = [sys, str(l[1]) ?? '', int(l[2]) ?? 0]; }
  if (r.pve && typeof r.pve === 'object') {
    const p = r.pve as Record<string, unknown>;
    const rec = (v: unknown, keys?: string[]) => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([k]) => !keys || keys.includes(k)).map(([k, x]) => [k.slice(0, 20), int(x, 0, 1e15) ?? 0]).slice(0, 20));
    s.pve = { t: int(p.t, 0, 1e15) ?? 0, h: num(p.h, 0, 1e5) ?? 0, d: int(p.d, 0, 1e4) ?? 0, n: int(p.n, 0, 1e6) ?? 0, src: rec(p.src), k: rec(p.k, ['sub', 'cap', 'super', 'titan', 'offBs', 'offCr', 'offFr']) };
  }
  if (r.pvp && typeof r.pvp === 'object') {
    const p = r.pvp as Record<string, unknown>;
    s.pvp = { k: int(p.k, 0, 1e8) ?? 0, l: int(p.l, 0, 1e8) ?? 0, s: int(p.s, 0, 1e8) ?? 0, d: int(p.d, 0, 100) ?? 0, i: int(p.i, 0, 1e16) ?? 0, top: arr(p.top, 5).map((x) => arr(x, 2)).map((x) => [int(x[0], 1) ?? 0, int(x[1], 0, 1e8) ?? 0] as [number, number]).filter((x) => x[0]) };
  }
  if (r.hist !== undefined) s.hist = arr(r.hist, 100).map((x) => arr(x, 3)).map((x) => [int(x[0], 1) ?? 0, str(x[1]) ?? '', str(x[2], 40) ?? ''] as [number, string, string]).filter((x) => x[0] && !Number.isNaN(Date.parse(x[2])));
  if (r.ships !== undefined) s.ships = arr(r.ships, 200).map((x) => arr(x, 2)).map((x) => [int(x[0], 1) ?? 0, int(x[1], 1, 1e6) ?? 1] as [number, number]).filter((x) => x[0]);
  if (r.imp !== undefined) s.imp = arr(r.imp, 20).map((x) => int(x, 1) ?? 0).filter(Boolean);
  return s;
}

async function pveSummary(rows: Parameters<typeof bountyTicks>[0]): Promise<Pve> {
  const { SOURCES } = await import('./pveActivity');
  const paid = (e: { amount?: number }) => (e.amount ?? 0) > 0;
  const src: Record<string, number> = {};
  for (const s of SOURCES) {
    const isk = rows.filter((e) => s.refs.includes(e.ref_type) && paid(e)).reduce((a, e) => a + (e.amount ?? 0), 0);
    if (isk) src[s.id] = Math.round(isk);
  }
  const days = new Set(rows.filter((e) => paid(e) && SOURCES.some((s) => s.refs.includes(e.ref_type))).map((e) => Math.floor(Date.parse(e.date) / 86400000))).size;
  const hours = pveSessions(rows).reduce((a, x) => a + (x.end - x.start), 0) / 3600000;
  const ticks = bountyTicks(rows);
  const info = await npcInfo([...new Set(ticks.flatMap((k) => k.kills.map(([id]) => id)))]).catch(() => new Map<number, { group: string }>());
  const k: Partial<Record<NpcClass, number>> = {};
  for (const t of ticks) for (const [id, n] of t.kills) { const cls = npcClass(info.get(id)?.group ?? ''); k[cls] = (k[cls] ?? 0) + n; }
  return { t: Object.values(src).reduce((a, x) => a + x, 0), h: Math.round(hours * 10) / 10, d: days, n: ticks.length, src, k };
}

async function collect(ctx: AppContext, c: StoredCharacter, force: boolean): Promise<Snap> {
  const id = c.characterId!;
  const sde = ctx.sde;
  const snap: Snap = {
    v: 1, at: Date.now(), id, name: c.name, sp: c.totalSp ?? 0,
    clone: ctx.character.clone === 'unknown' ? undefined : ctx.character.clone,
    sk: Object.entries(c.skills).filter(([, x]) => x.level > 0).map(([k, x]) => [Number(k), x.level]),
    imp: c.implants,
  };
  const [pub, hist] = await Promise.all([characterPublic(id), corporationHistory(id).catch(() => [])]);
  const names = await universeNames([pub?.corporation_id ?? 0, pub?.alliance_id ?? 0, ...hist.map((h) => h.corporation_id)].filter((x) => x > 0)).catch(() => new Map<number, string>());
  if (pub) {
    snap.corp = [pub.corporation_id, names.get(pub.corporation_id) ?? ''];
    if (pub.alliance_id) snap.ally = [pub.alliance_id, names.get(pub.alliance_id) ?? ''];
    snap.birth = pub.birthday;
    snap.sec = pub.security_status;
    snap.ach = pub.achievement_score;
    if (pub.character_title_id) snap.title = (await loadActivities().catch(() => null))?.titles?.[pub.character_title_id];
  }
  snap.hist = [...hist].sort((a, b) => Date.parse(b.start_date) - Date.parse(a.start_date)).map((h) => [h.corporation_id, names.get(h.corporation_id) ?? `#${h.corporation_id}`, h.start_date]);
  await Promise.all([
    (async () => {
      if (!hasPermission(id, 'wallet')) return;
      const w = await syncWallet(id, force);
      snap.isk = w.balance;
      snap.pve = await pveSummary(since(w.entries, periodStart('30d')));
    })().catch(() => {}),
    (async () => {
      if (!hasPermission(id, 'location')) return;
      const [loc, ship] = await Promise.all([characterLocation(id), currentShip(id).catch(() => null)]);
      const sys = (await universeNames([loc.solar_system_id]).catch(() => new Map<number, string>())).get(loc.solar_system_id) ?? '';
      snap.loc = [loc.solar_system_id, sys, ship?.ship_type_id ?? 0];
    })().catch(() => {}),
    (async () => {
      const p = isDemo() ? DEMO_PVP : await pilotStats(id).then((x) => x && { k: x.kills, l: x.losses, s: x.solo, d: Math.round(x.danger), i: Math.round(x.iskKilled), top: x.topShips.map((t) => [t.id, t.kills] as [number, number]) });
      if (p) snap.pvp = p;
    })().catch(() => {}),
    (async () => {
      if (!hasPermission(id, 'assets')) return;
      const counts = new Map<number, number>();
      for (const a of await listAssets(id)) if (sde.types.get(a.type_id)?.categoryId === Category.Ship) counts.set(a.type_id, (counts.get(a.type_id) ?? 0) + a.quantity);
      snap.ships = [...counts].slice(0, 200);
    })().catch(() => {}),
  ]);
  return snap;
}

function age(birth: string) {
  const b = new Date(birth);
  const n = new Date();
  let m = (n.getFullYear() - b.getFullYear()) * 12 + n.getMonth() - b.getMonth() - (n.getDate() < b.getDate() ? 1 : 0);
  const y = Math.floor(m / 12);
  m %= 12;
  return y ? tx('{y} ani, {m} luni', { y, m }) : tx('{m} luni', { m });
}

const day = (iso: string | number) => new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });

function span(ms: number) {
  const d = Math.max(0, Math.floor(ms / 86400000));
  if (d < 60) return tx('{n} zile', { n: d });
  const m = Math.floor(d / 30.44);
  return m < 24 ? tx('{m} luni', { m }) : tx('{y} ani, {m} luni', { y: Math.floor(m / 12), m: m % 12 });
}

function flyGroups(sde: Sde, lv: Map<number, number>) {
  const massId = sde.attrId('mass');
  const groups = new Map<string, { fly: number; total: number; mass: number }>();
  for (const t of sde.typesInCategory(Category.Ship)) {
    if (!t.marketGroupId) continue;
    const g = groups.get(t.groupName) ?? { fly: 0, total: 0, mass: 0 };
    g.total++;
    g.mass += sde.baseAttr(t.id, massId);
    if (directRequirements(sde, t.id).every((r) => (lv.get(r.skillId) ?? 0) >= r.level)) g.fly++;
    groups.set(t.groupName, g);
  }
  return [...groups].map(([name, g]) => ({ name, ...g, mass: g.mass / g.total })).sort((a, b) => a.mass - b.mass);
}

function skillGroups(sde: Sde) {
  const groups = new Map<string, number[]>();
  for (const s of sde.typesInCategory(Category.Skill).sort((a, b) => a.name.localeCompare(b.name))) groups.set(s.groupName, [...(groups.get(s.groupName) ?? []), s.id]);
  return [...groups].sort((a, b) => skillGroupLabel(a[0]).localeCompare(skillGroupLabel(b[0])));
}

const gate = (title: string, body: string) => panel({ title, body });

async function dossier(sde: Sde, s: Snap, o: { own: boolean; actions?: string }) {
  const { SOURCES, RATTING, OFFICERS, tile } = await import('./pveActivity');
  const lv = new Map(s.sk ?? []);
  const fly = s.sk ? flyGroups(sde, lv) : [];
  const flyN = fly.reduce((a, g) => a + g.fly, 0);
  const flyTotal = fly.reduce((a, g) => a + g.total, 0);
  const atV = (s.sk ?? []).filter(([, l]) => l === 5).length;
  const logo = (kind: string, id: number) => `<img class="prof-logo" src="https://images.evetech.net/${kind}/${id}/logo?size=64" alt="" loading="lazy" />`;
  const fact = (label: string, value: string) => `<div><span class="label">${esc(label)}</span><span class="value">${value}</span></div>`;

  const hero = `<section class="panel prof-hero">
      <img class="prof-portrait" src="${portraitUrl(s.id, 256)}" alt="" />
      <div class="prof-id">
        <h2>${esc(s.name)}</h2>
        <div class="prof-org">
          ${s.corp ? `<span>${logo('corporations', s.corp[0])}${esc(s.corp[1])}</span>` : ''}
          ${s.ally ? `<span>${logo('alliances', s.ally[0])}${esc(s.ally[1])}</span>` : ''}
        </div>
        <div class="meta">
          ${s.clone === 'omega' ? badge('Omega', 'gold', true) : s.clone === 'alpha' ? badge('Alpha', '', true) : ''}
          ${s.sec !== undefined ? badge(tx('Securitate {n}', { n: s.sec.toFixed(1) }), s.sec < 0 ? 'danger' : '') : ''}
          ${s.title ? badge(s.title, 'accent') : ''}
        </div>
        <div class="prof-facts">
          ${s.birth ? fact(tx('Vârstă'), `${esc(age(s.birth))} <span class="dim small">${esc(day(s.birth))}</span>`) : ''}
          ${s.ach !== undefined ? fact(tx('Scor realizări'), formatInt(s.ach)) : ''}
          ${s.loc ? fact(tx('Acum'), `${esc(s.loc[1])}${s.loc[2] ? ` · ${esc(sde.types.get(s.loc[2])?.name ?? '')}` : ''}`) : ''}
        </div>
        ${o.actions ?? ''}
      </div>
    </section>`;

  const kpis = panel({
    body: `<div class="history-kpis prof-kpis">
        ${fact(tx('SP total'), formatInt(s.sp))}
        ${s.sk ? fact(tx('Skill-uri antrenate'), formatInt(s.sk.length)) : ''}
        ${s.sk ? fact(tx('Skill-uri la V'), formatInt(atV)) : ''}
        ${s.sk ? fact(tx('Nave pe care le poate zbura'), formatInt(flyN)) : ''}
        ${s.isk !== undefined ? fact(tx('ISK în portofel'), compactISK(s.isk)) : ''}
        ${s.pve ? fact(tx('Venit PvE 30 de zile'), compactISK(s.pve.t)) : ''}
        ${s.pvp ? fact(tx('Kill-uri PvP'), formatInt(s.pvp.k)) : ''}
      </div>`,
  });

  let skills = '';
  if (s.sk) {
    const cats = skillGroups(sde).map(([g, ids]) => ({ g, sp: ids.reduce((a, id) => a + spForLevel(skillRank(sde, id), lv.get(id) ?? 0), 0) })).filter((x) => x.sp > 0).sort((a, b) => b.sp - a.sp);
    const max = cats[0]?.sp ?? 1;
    skills = panel({
      title: tx('Ce poate zbura'),
      count: tx('{n} din {m} nave', { n: formatInt(flyN), m: formatInt(flyTotal) }),
      body: `<div class="prof-chips">${fly.filter((g) => g.fly).map((g) => `<span class="prof-chip ${g.fly === g.total ? 'full' : ''}">${esc(g.name)}<b>${g.fly}/${g.total}</b></span>`).join('') || `<span class="dim">${tx('Nicio navă încă.')}</span>`}</div>`,
    }) + panel({
      title: tx('SP pe categorii'),
      body: `<div class="pva-share prof-bars">${cats.map((x) => `<div class="pva-share-row"><span>${esc(skillGroupLabel(x.g))}</span><span class="pva-bar"><i style="width:${Math.max(1, (x.sp / max) * 100).toFixed(1)}%"></i></span><span class="num dim">${compactISK(x.sp)}</span></div>`).join('')}</div>`,
    });
  }

  let pve = '';
  if (s.pve) {
    const p = s.pve;
    const n = (id: NpcClass) => p.k[id] ?? 0;
    pve = panel({
      title: tx('Activitate PvE'),
      count: tx('ultimele 30 de zile'),
      body: `<div class="history-kpis compact">
          ${fact(tx('Total PvE'), `<span class="up">${compactISK(p.t)}</span>`)}
          ${fact(tx('Ore PvE'), p.h ? p.h.toFixed(1) : '—')}
          ${fact(tx('ISK / oră'), p.h ? compactISK(p.t / p.h) : '—')}
          ${fact(tx('Zile active'), formatInt(p.d))}
          ${fact(tx('Tick-uri'), formatInt(p.n))}
        </div>
        <div class="pva-groups">
          <div class="pva-group"><div class="pva-group-head">${tx('Ratting')}</div><div class="pva-tiles">${RATTING.map((r) => tile({ label: r.label, hint: r.hint, value: formatInt(n(r.id)), on: n(r.id) > 0, icon: r.icon })).join('')}</div></div>
          <div class="pva-group"><div class="pva-group-head">${tx('Officers')}</div><div class="pva-tiles">${OFFICERS.map((r) => tile({ label: r.label, hint: r.label, value: formatInt(n(r.id)), on: n(r.id) > 0, icon: r.icon })).join('')}</div></div>
          ${Object.keys(p.src).length ? `<div class="pva-group"><div class="pva-group-head">${tx('Venit pe surse')}</div><div class="pva-tiles">${SOURCES.filter((x) => p.src[x.id]).map((x) => tile({ label: x.label, hint: x.hint, value: `+${compactISK(p.src[x.id])}`, on: true })).join('')}</div></div>` : ''}
        </div>`,
    });
  } else if (o.own && !hasPermission(s.id, 'wallet')) pve = gate(tx('Activitate PvE'), permissionGate('wallet', s.id, s.name));

  const pvp = s.pvp ? panel({
    title: tx('Statistici PvP'),
    actions: `<a class="btn ghost sm" href="https://zkillboard.com/character/${s.id}/" target="_blank" rel="noopener">${icon('external')}zKillboard</a>`,
    body: `<div class="history-kpis compact">
        ${fact(tx('Kill-uri'), `<span class="up">${formatInt(s.pvp.k)}</span>`)}
        ${fact(tx('Pierderi'), formatInt(s.pvp.l))}
        ${fact(tx('Solo'), formatInt(s.pvp.s))}
        ${fact(tx('Periculozitate'), `${s.pvp.d}%`)}
        ${fact(tx('ISK distrus'), compactISK(s.pvp.i))}
      </div>
      ${s.pvp.top.length ? `<div class="pva-group-head">${tx('Navele cu cele mai multe kill-uri')}</div><div class="prof-ships">${s.pvp.top.map(([t, k]) => `<button class="prof-ship" data-prof-info="${t}"><img src="${typeIconUrl(t, 32)}" alt="" loading="lazy" /><span>${esc(sde.types.get(t)?.name ?? `#${t}`)}</span><b>${formatInt(k)}</b></button>`).join('')}</div>` : ''}`,
  }) : '';

  const hist = s.hist?.length ? panel({
    title: tx('Istoric corporații'),
    count: tx('{n} corporații', { n: s.hist.length }),
    body: `<table class="table compact"><thead><tr><th>${tx('Corporație')}</th><th>${tx('De la')}</th><th class="r">${tx('Durată')}</th></tr></thead><tbody>
      ${s.hist.map(([id, name, start], i) => `<tr><td><span class="recon-ship">${logo('corporations', id)}<span>${esc(name)}</span></span></td><td class="num dim">${esc(day(start))}</td><td class="r num">${esc(span((i ? Date.parse(s.hist![i - 1][2]) : s.at) - Date.parse(start)))}</td></tr>`).join('')}
      </tbody></table>`,
  }) : '';

  let ships = '';
  if (s.ships) {
    const list = s.ships.map(([t, n]) => ({ t, n, info: sde.types.get(t) })).sort((a, b) => (a.info?.groupName ?? '').localeCompare(b.info?.groupName ?? '') || (a.info?.name ?? '').localeCompare(b.info?.name ?? ''));
    ships = panel({
      title: tx('Nave deținute'),
      count: formatInt(list.reduce((a, x) => a + x.n, 0)),
      body: list.length ? `<div class="prof-ships">${list.map((x) => `<button class="prof-ship" data-prof-info="${x.t}" title="${esc(x.info?.groupName ?? '')}"><img src="${typeIconUrl(x.t, 32)}" alt="" loading="lazy" /><span>${esc(x.info?.name ?? `#${x.t}`)}</span>${x.n > 1 ? `<b>×${formatInt(x.n)}</b>` : ''}</button>`).join('')}</div>` : `<p class="dim">${tx('Nicio navă în bunuri.')}</p>`,
    });
  } else if (o.own && !hasPermission(s.id, 'assets')) ships = gate(tx('Nave deținute'), permissionGate('assets', s.id, s.name));

  const slotOf = (id: number) => sde.baseAttr(id, sde.attrId('implantness')) || 99;
  const imp = s.imp?.length ? panel({
    title: tx('Implanturi'),
    count: s.imp.length,
    body: `<div class="prof-ships">${[...s.imp].sort((a, b) => slotOf(a) - slotOf(b)).map((id) => `<button class="prof-ship" data-prof-info="${id}"><img src="${typeIconUrl(id, 32)}" alt="" loading="lazy" /><span>${esc(sde.types.get(id)?.name ?? `#${id}`)}</span>${slotOf(id) < 99 ? `<b>${slotOf(id)}</b>` : ''}</button>`).join('')}</div>`,
  }) : '';

  return `${hero}${kpis}${skills}${pve}${pvp}${hist}${ships}${imp}`;
}

function treeHtml(sde: Sde, s: Snap, open: Set<string>) {
  const lv = new Map(s.sk ?? []);
  const groups = skillGroups(sde);
  const trained = (s.sk ?? []).length;
  return `<section class="panel char-skills"><div class="sidebar-head"><div class="window-title">${tx('Skill-uri')}<span class="count">${trained}</span></div><p class="side-note">${formatInt(s.sp)} SP</p></div>
    <div class="side-nav skill-tree">${groups.map(([g, ids]) => {
      const any = ids.filter((id) => (lv.get(id) ?? 0) > 0).length;
      const isOpen = open.has(g);
      return `<div class="tree-group sub skill-group ${isOpen ? 'open' : ''}" style="--depth:0">
        <button class="tree-head" data-prof-group="${esc(g)}">${icon('chevron', 'chev')}<span>${esc(skillGroupLabel(g))}</span><span class="count">${any}/${ids.length}</span></button>
        <div class="tree-items"><div class="skill-list">${isOpen ? ids.map((id) => {
          const l = lv.get(id) ?? 0;
          return `<div class="skill-row"><button class="link" data-prof-info="${id}">${esc(sde.types.get(id)?.name ?? '')}</button><span class="dim small">${l ? roman(l) : ''}</span><span class="skill-pips">${Array.from({ length: 5 }, (_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('')}</span></div>`;
        }).join('') : ''}</div></div>
      </div>`;
    }).join('')}</div></section>`;
}

export function createShowcase(ctx: AppContext, own: HTMLElement, shared: HTMLElement, ownWrap: HTMLElement) {
  const sde = ctx.sde;
  let seq = 0;
  let mounted: { box: HTMLElement; c: StoredCharacter; actions: string } | null = null;
  let current: Snap | null = null;
  let sharedSnap: Snap | null = null;
  const openGroups = new Set<string>();

  async function draw(snap: Snap) {
    if (!mounted) return;
    const mine = seq;
    current = snap;
    const actions = `<div class="prof-actions">
        ${button(tx('Share profil'), { iconName: 'link', cls: 'sm', attrs: 'data-prof-share' })}
        ${dataStamp(snap.at, 'data-prof-refresh', { label: tx('Date din {time}'), title: tx('Profilul e păstrat până îl reîmprospătezi. Click pentru a-l citi din nou din EVE.') })}
        ${mounted.actions}
      </div>`;
    const html = await dossier(sde, snap, { own: true, actions });
    if (mine === seq && mounted) mounted.box.innerHTML = html;
  }

  async function refresh(force: boolean) {
    if (!mounted) return;
    const mine = ++seq;
    const { c } = mounted;
    if (!current) mounted.box.innerHTML = panel({ body: loader(tx('Adun datele profilului')) });
    try {
      const snap = await collect(ctx, c, force);
      if (mine !== seq) return;
      saveJson(CACHE_KEY(c.characterId!), snap);
      await draw(snap);
    } catch (err) {
      if (mine === seq && mounted) mounted.box.innerHTML = panel({ body: alertBox((err as Error).message, 'danger') });
    }
  }

  function openShare() {
    if (!current) return;
    const snap = current;
    const saved = loadJson<Partial<Record<Part, boolean>>>(SHARE_KEY, {});
    const m = openModal(tx('Share profil'), `<div class="prof-share">
        <p class="dim small">${tx('Alege ce vede cine deschide linkul. Linkul arată profilul de acum.')}</p>
        <div class="prof-share-list">${PARTS.map((p) => `<label class="check"><input type="checkbox" data-part="${p.id}" ${saved[p.id] ?? p.on ? 'checked' : ''} /> ${esc(p.label)}</label>`).join('')}</div>
        <div class="row-actions">${button(tx('Creează linkul'), { iconName: 'link', cls: 'sm', attrs: 'data-prof-make' })}</div>
      </div>`);
    m.addEventListener('click', async (e) => {
      if (!(e.target as HTMLElement).closest('[data-prof-make]')) return;
      const picked = Object.fromEntries([...m.querySelectorAll<HTMLInputElement>('[data-part]')].map((i) => [i.dataset.part!, i.checked])) as Record<Part, boolean>;
      saveJson(SHARE_KEY, picked);
      const out: Snap = { ...snap };
      if (!picked.skills) delete out.sk;
      for (const k of ['isk', 'loc', 'pve', 'pvp', 'hist', 'ships', 'imp'] as const) if (!picked[k]) delete out[k];
      const code = await encodeCode(out);
      openShareModal(shareLinkUrl('profile', code), {
        title: tx('Share profil'),
        text: tx('Profilul lui {name} în Vyraj', { name: snap.name }),
        hint: tx('Linkul scurt se salvează pe serverul Vyraj.'),
        shorten: () => shortLink('profile', code),
      });
    });
  }

  async function drawShared() {
    if (!sharedSnap) return;
    const s = sharedSnap;
    const body = await dossier(sde, s, { own: false });
    shared.innerHTML = `<div class="prof-banner">${icon('link')}<span>${esc(tx('Profil partajat · date din {date}', { date: day(s.at) }))}</span>${button(tx('Înapoi la profilul meu'), { cls: 'ghost sm', attrs: 'data-prof-close' })}</div>
      <div class="char-profile"><div class="stack">${body}</div><div>${s.sk ? treeHtml(sde, s, openGroups) : ''}</div></div>`;
  }

  const onClick = (e: Event) => {
    const t = e.target as HTMLElement;
    const at = (sel: string) => t.closest<HTMLElement>(sel);
    const info = at('[data-prof-info]');
    if (info) { showItemInfo(ctx, Number(info.dataset.profInfo)); return; }
    if (at('[data-prof-share]')) { openShare(); return; }
    if (at('[data-prof-refresh]')) { refresh(true); return; }
    if (at('[data-prof-close]')) { sharedSnap = null; shared.hidden = true; shared.innerHTML = ''; ownWrap.hidden = false; return; }
    const group = at('[data-prof-group]');
    if (group) {
      const g = group.dataset.profGroup!;
      if (openGroups.has(g)) openGroups.delete(g); else openGroups.add(g);
      drawShared();
    }
  };
  own.addEventListener('click', onClick);
  shared.addEventListener('click', onClick);

  return {
    mount(box: HTMLElement, c: StoredCharacter, actions: string) {
      seq++;
      mounted = { box, c, actions };
      current = null;
      const cached = loadJson<Snap | null>(CACHE_KEY(c.characterId!), null);
      if (cached?.v === 1) draw(cached);
      else refresh(false);
    },
    unmount() { seq++; mounted = null; current = null; },
    async openShared(code: string) {
      ownWrap.hidden = true;
      shared.hidden = false;
      shared.innerHTML = panel({ body: loader(tx('Deschid profilul')) });
      try {
        sharedSnap = readSnap(await decodeCode(code));
        if (!sharedSnap) throw new Error('invalid');
        openGroups.clear();
        await drawShared();
      } catch {
        shared.innerHTML = `<div class="prof-banner">${icon('alert')}<span>${esc(tx('Linkul de profil nu e valid sau e incomplet.'))}</span>${button(tx('Înapoi la profilul meu'), { cls: 'ghost sm', attrs: 'data-prof-close' })}</div>`;
      }
    },
  };
}

export const forgetProfile = (characterId: number) => localStorage.removeItem(CACHE_KEY(characterId));
