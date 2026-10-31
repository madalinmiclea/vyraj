import { loadJson, saveJson, isDemo } from '../storage';
import { loadStoredCharacters } from '../character/characters';
import { hasScope } from '../character/sso';
import { rosterCharacters } from '../character/roster';
import { industryJobs, ACTIVITY } from './industry';
import { loadPi, fetchColonies, loadColonies, saveColonies, planetNames, PI_SCOPE } from './pi';
import { scanContracts, lastContracts, contractCharacters, dueAt, isActive } from './contracts';
import { lastScan, expiresAt } from './orders';
import { listMail, canRead, mailNames, cachedMailName, LABEL_INBOX } from './mail';
import { pollGame } from './gameNotices';
import { typeName, resolveTypeNames } from './typeNames';
import { tx } from '../i18n';
import { noticeSettings, deliver, kindOn, type NoticeKind } from './notices';

export interface Upcoming { key: string; kind: NoticeKind; at: number; title: string; body: string; url?: string; charId?: number }

const FIRED_KEY = 'eve-notify:fired';
const MAIL_SEEN_KEY = 'eve-notify:mail-seen';
const CHECK_MS = 5 * 60 * 1000;
const FETCH_MS = 20 * 60 * 1000;
const STALE_MS = 6 * 3_600_000;
const HOUR = 3_600_000;

interface Cache { jobs: Map<number, Upcoming[]>; pi: Upcoming[]; at: { jobs: number; pi: number; contracts: number } }
const cache: Cache = { jobs: new Map(), pi: [], at: { jobs: 0, pi: 0, contracts: 0 } };

const roman = (n: number) => ['', 'I', 'II', 'III', 'IV', 'V'][n] ?? String(n);

function skillEvents(): Upcoming[] {
  const out: Upcoming[] = [];
  for (const c of loadStoredCharacters().filter((x) => x.kind === 'esi' && x.characterId)) {
    const queue = c.queue.filter((q) => q.finish && Date.parse(q.finish) > Date.now() - STALE_MS);
    for (const q of queue) out.push({ key: `skill:${c.characterId}:${q.skillId}:${q.level}`, kind: 'skill', at: Date.parse(q.finish!), title: tx('Skill terminat · {name}', { name: c.name }), body: `${typeName(q.skillId)} ${roman(q.level)}`, url: '#/character', charId: c.characterId });
    const last = queue[queue.length - 1];
    if (last) out.push({ key: `queue:${c.characterId}:${last.finish}`, kind: 'queue', at: Date.parse(last.finish!), title: tx('Coada de skill-uri se golește · {name}', { name: c.name }), body: tx('Ultimul skill din coadă: {skill}', { skill: `${typeName(last.skillId)} ${roman(last.level)}` }), url: '#/character', charId: c.characterId });
  }
  return out;
}

function orderEvents(): Upcoming[] {
  return (lastScan()?.orders ?? []).map((o) => ({
    key: `order-exp:${o.characterId}:${o.order_id}`, kind: 'expiring' as const, at: expiresAt(o),
    title: tx('Ordin care expiră · {name}', { name: o.characterName }),
    body: `${typeName(o.type_id)} (${o.is_buy_order ? 'buy' : 'sell'}) · ${tx('rămase {n} din {total}', { n: o.volume_remain, total: o.volume_total })}`,
    url: '#/orders', charId: o.characterId,
  }));
}

async function jobEvents(force: boolean): Promise<Upcoming[]> {
  if (force || Date.now() - cache.at.jobs > FETCH_MS) {
    cache.at.jobs = Date.now();
    for (const c of rosterCharacters().filter((x) => hasScope(x.characterId!, 'esi-industry.read_character_jobs.v1'))) {
      try {
        const jobs = (await industryJobs(c.characterId!)).filter((j) => j.status === 'active');
        await resolveTypeNames(jobs.map((j) => j.product_type_id ?? j.blueprint_type_id));
        cache.jobs.set(c.characterId!, jobs.map((j) => ({ key: `job:${j.job_id}`, kind: 'industry', at: Date.parse(j.end_date), title: tx('Job de industrie gata · {name}', { name: c.name }), body: `${ACTIVITY[j.activity_id] ?? ''} · ${typeName(j.product_type_id ?? j.blueprint_type_id)} × ${j.runs}`, url: '#/industry', charId: c.characterId })));
      } catch { }
    }
  }
  return [...cache.jobs.values()].flat();
}

async function piEvents(force: boolean): Promise<Upcoming[]> {
  if (force || Date.now() - cache.at.pi > FETCH_MS) {
    cache.at.pi = Date.now();
    const chars = rosterCharacters().filter((x) => hasScope(x.characterId!, PI_SCOPE));
    if (chars.length) {
      try {
        const pi = await loadPi();
        const all = loadColonies();
        for (const c of chars) all[c.characterId!] = await fetchColonies(pi, c.characterId!);
        saveColonies(all);
      } catch { }
    }
    const all = loadColonies();
    const names = await planetNames(Object.values(all).flatMap((e) => e.colonies.map((p) => p.planetId))).catch(() => new Map<number, string>());
    const who = new Map(rosterCharacters().map((c) => [c.characterId!, c.name]));
    cache.pi = Object.values(all).flatMap((e) => e.colonies.flatMap((p) => p.extractors.filter((x) => x.expiry).map((x) => ({
      key: `pi:${x.pinId}:${x.expiry}`, kind: 'pi' as const, at: x.expiry,
      title: tx('Extractor PI oprit · {name}', { name: who.get(e.characterId) ?? '' }),
      body: tx('{planet}: extractorul de {product} se oprește.', { planet: names.get(p.planetId) ?? `#${p.planetId}`, product: typeName(x.product) }),
      url: '#/pi', charId: e.characterId,
    }))));
  }
  return cache.pi;
}

async function contractEvents(force: boolean): Promise<Upcoming[]> {
  if (!contractCharacters().length) return [];
  if (force || Date.now() - cache.at.contracts > FETCH_MS || !lastContracts()) {
    cache.at.contracts = Date.now();
    await scanContracts().catch(() => null);
  }
  const mine = new Set(rosterCharacters().map((c) => c.characterId!));
  return (lastContracts()?.personal ?? []).filter((c) => isActive(c) && (mine.has(c.issuer_id) || mine.has(c.acceptor_id) || mine.has(c.assignee_id))).flatMap((c) => {
    const at = dueAt(c);
    if (at == null) return [];
    const courier = c.type === 'courier' && c.status === 'in_progress';
    return [{ key: `contract:${c.contract_id}:${at}`, kind: 'contracts' as const, at, title: courier ? tx('Termen de livrare curier') : tx('Contract care expiră'), body: c.title?.trim() || (courier ? tx('Contract de curier') : tx('Contract #{id}', { id: c.contract_id })), url: '#/orders' }];
  });
}

export async function upcoming(force = false): Promise<Upcoming[]> {
  const s = noticeSettings();
  const [jobs, pi, contracts] = await Promise.all([
    s.kinds.industry.on ? jobEvents(force) : Promise.resolve([]),
    s.kinds.pi.on ? piEvents(force) : Promise.resolve([]),
    s.kinds.contracts.on ? contractEvents(force) : Promise.resolve([]),
  ]);
  await resolveTypeNames(loadStoredCharacters().flatMap((c) => c.queue.map((q) => q.skillId))).catch(() => {});
  const orders = s.kinds.expiring.on ? orderEvents() : [];
  return [...skillEvents().filter((e) => s.kinds[e.kind].on), ...orders, ...jobs, ...pi, ...contracts].filter((e) => e.at > Date.now() - STALE_MS).sort((a, b) => a.at - b.at);
}

export const fireAt = (e: Upcoming, s = noticeSettings()) => e.at - s.kinds[e.kind].lead * HOUR;

async function pollMail() {
  if (!kindOn('mail')) return;
  const seen = loadJson<Record<string, number>>(MAIL_SEEN_KEY, {});
  for (const c of rosterCharacters().filter((x) => x.characterId != null && canRead(x.characterId))) {
    const id = c.characterId!;
    let list;
    try { list = await listMail(id, { labels: [LABEL_INBOX] }); } catch { continue; }
    const max = list.reduce((m, h) => Math.max(m, h.mail_id), 0);
    const last = seen[id];
    seen[id] = Math.max(last ?? 0, max);
    if (last == null) continue;
    const fresh = list.filter((h) => h.mail_id > last && !h.is_read && h.from !== id).slice(0, 5).reverse();
    if (!fresh.length) continue;
    await mailNames(fresh.map((h) => h.from ?? 0).filter(Boolean)).catch(() => false);
    for (const h of fresh) deliver('mail', { title: tx('Mail nou · {name}', { name: c.name }), body: `${cachedMailName(h.from ?? 0) ?? '?'}: ${h.subject ?? ''}`, url: '#/mail', charId: id, tag: `vyraj-mail-${h.mail_id}`, at: Date.parse(h.timestamp ?? '') || Date.now() });
  }
  saveJson(MAIL_SEEN_KEY, seen);
}

let running = false;

export async function check(force = false): Promise<void> {
  const s = noticeSettings();
  if (!s.enabled || running) return;
  running = true;
  try {
    const now = Date.now();
    const fired = loadJson<Record<string, number>>(FIRED_KEY, {});
    for (const [k, t] of Object.entries(fired)) if (now - t > 14 * 24 * HOUR) delete fired[k];
    const due = (await upcoming(force)).filter((e) => !fired[e.key] && fireAt(e, s) <= now && e.at > now - STALE_MS);
    for (const e of due.slice(0, 6)) {
      fired[e.key] = now;
      const when = e.at > now ? tx('{t} rămase', { t: left(e.at - now) }) : '';
      deliver(e.kind, { title: e.title, body: when ? `${e.body} · ${when}` : e.body, url: e.url, charId: e.charId, tag: e.key });
    }
    for (const e of due.slice(6)) fired[e.key] = now;
    saveJson(FIRED_KEY, fired);
    await pollMail().catch(() => {});
    await pollGame().catch(() => {});
  } finally {
    running = false;
  }
}

export function left(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  return tx('{n} zile', { n: Math.floor(h / 24) });
}

export function startNotifyWatcher() {
  const run = () => {
    if (!noticeSettings().enabled) return;
    const job = () => check();
    (navigator.locks ? navigator.locks.request('vyraj-notify', { ifAvailable: true }, (lock) => (lock ? job() : undefined)) : job()).catch(() => {});
  };
  if (!isDemo()) setTimeout(run, 15_000);
  setInterval(run, CHECK_MS);
}
