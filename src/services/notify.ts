import { loadJson, saveJson, isDemo } from '../storage';
import { loadStoredCharacters } from '../character/characters';
import { hasScope } from '../character/sso';
import { rosterCharacters } from '../character/roster';
import { industryJobs, ACTIVITY } from './industry';
import { loadPi, fetchColonies, loadColonies, saveColonies, planetNames, PI_SCOPE } from './pi';
import { scanContracts, lastContracts, contractCharacters, dueAt, isActive } from './contracts';
import { typeName, resolveTypeNames } from './typeNames';
import { toast } from '../ui/components';
import { tx } from '../i18n';
import { notify } from './pwa';

export type NotifyKind = 'skill' | 'queue' | 'industry' | 'contracts' | 'pi';

export interface NotifySettings {
  enabled: boolean;
  kinds: Record<NotifyKind, { on: boolean; lead: number }>;
}

export interface Upcoming { key: string; kind: NotifyKind; at: number; title: string; body: string }

export const NOTIFY_EVENT = 'vyraj-notify-updated';
export const LEADS = [0, 1, 2, 4, 12, 24];

const SETTINGS_KEY = 'eve-notify:settings';
const FIRED_KEY = 'eve-notify:fired';
const CHECK_MS = 5 * 60 * 1000;
const FETCH_MS = 20 * 60 * 1000;
const STALE_MS = 6 * 3_600_000;
const HOUR = 3_600_000;

export const NOTIFY_KINDS: { id: NotifyKind; label: string; hint: string; lead: boolean }[] = [
  { id: 'skill', label: tx('Skill terminat'), hint: tx('Fiecare skill din coada de antrenament, când se termină.'), lead: false },
  { id: 'queue', label: tx('Coada de skill-uri se golește'), hint: tx('Înainte să se termine ultimul skill din coadă, ca să adaugi altele.'), lead: true },
  { id: 'industry', label: tx('Job de industrie gata'), hint: tx('Fabricație, cercetare, invenție și reacții, când se termină.'), lead: true },
  { id: 'contracts', label: tx('Contract care expiră'), hint: tx('Contractele tale active și termenele de livrare la curier.'), lead: true },
  { id: 'pi', label: tx('Extractor PI oprit'), hint: tx('Când un extractor planetar ajunge la capătul ciclului și trebuie repornit.'), lead: true },
];

const DEFAULTS: NotifySettings = {
  enabled: false,
  kinds: { skill: { on: true, lead: 0 }, queue: { on: true, lead: 12 }, industry: { on: true, lead: 0 }, contracts: { on: true, lead: 4 }, pi: { on: true, lead: 2 } },
};

export function notifySettings(): NotifySettings {
  const s = loadJson<Partial<NotifySettings>>(SETTINGS_KEY, {});
  return { enabled: s.enabled ?? DEFAULTS.enabled, kinds: { ...DEFAULTS.kinds, ...(s.kinds ?? {}) } };
}

export function saveNotifySettings(s: NotifySettings) {
  saveJson(SETTINGS_KEY, s);
  if (s.enabled && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}).finally(() => window.dispatchEvent(new Event(NOTIFY_EVENT)));
  window.dispatchEvent(new Event(NOTIFY_EVENT));
  check().catch(() => {});
}

export const browserPermission = (): NotificationPermission | 'unsupported' => ('Notification' in window ? Notification.permission : 'unsupported');

interface Cache { jobs: Map<number, Upcoming[]>; pi: Upcoming[]; at: { jobs: number; pi: number; contracts: number } }
const cache: Cache = { jobs: new Map(), pi: [], at: { jobs: 0, pi: 0, contracts: 0 } };

function skillEvents(): Upcoming[] {
  const out: Upcoming[] = [];
  for (const c of loadStoredCharacters().filter((x) => x.kind === 'esi' && x.characterId)) {
    const queue = c.queue.filter((q) => q.finish && Date.parse(q.finish) > Date.now() - STALE_MS);
    for (const q of queue) out.push({ key: `skill:${c.characterId}:${q.skillId}:${q.level}`, kind: 'skill', at: Date.parse(q.finish!), title: tx('Skill terminat · {name}', { name: c.name }), body: `${typeName(q.skillId)} ${['', 'I', 'II', 'III', 'IV', 'V'][q.level] ?? q.level}` });
    const last = queue[queue.length - 1];
    if (last) out.push({ key: `queue:${c.characterId}:${last.finish}`, kind: 'queue', at: Date.parse(last.finish!), title: tx('Coada de skill-uri se golește · {name}', { name: c.name }), body: tx('Ultimul skill din coadă: {skill}', { skill: `${typeName(last.skillId)} ${['', 'I', 'II', 'III', 'IV', 'V'][last.level] ?? last.level}` }) });
  }
  return out;
}

async function jobEvents(force: boolean): Promise<Upcoming[]> {
  if (force || Date.now() - cache.at.jobs > FETCH_MS) {
    cache.at.jobs = Date.now();
    for (const c of rosterCharacters().filter((x) => hasScope(x.characterId!, 'esi-industry.read_character_jobs.v1'))) {
      try {
        const jobs = (await industryJobs(c.characterId!)).filter((j) => j.status === 'active');
        await resolveTypeNames(jobs.map((j) => j.product_type_id ?? j.blueprint_type_id));
        cache.jobs.set(c.characterId!, jobs.map((j) => ({ key: `job:${j.job_id}`, kind: 'industry', at: Date.parse(j.end_date), title: tx('Job de industrie gata · {name}', { name: c.name }), body: `${ACTIVITY[j.activity_id] ?? ''} · ${typeName(j.product_type_id ?? j.blueprint_type_id)} × ${j.runs}` })));
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
    return [{ key: `contract:${c.contract_id}:${at}`, kind: 'contracts' as const, at, title: courier ? tx('Termen de livrare curier') : tx('Contract care expiră'), body: c.title?.trim() || (courier ? tx('Contract de curier') : tx('Contract #{id}', { id: c.contract_id })) }];
  });
}

export async function upcoming(force = false): Promise<Upcoming[]> {
  const s = notifySettings();
  const [jobs, pi, contracts] = await Promise.all([
    s.kinds.industry.on ? jobEvents(force) : Promise.resolve([]),
    s.kinds.pi.on ? piEvents(force) : Promise.resolve([]),
    s.kinds.contracts.on ? contractEvents(force) : Promise.resolve([]),
  ]);
  await resolveTypeNames(loadStoredCharacters().flatMap((c) => c.queue.map((q) => q.skillId))).catch(() => {});
  return [...skillEvents().filter((e) => s.kinds[e.kind].on), ...jobs, ...pi, ...contracts].filter((e) => e.at > Date.now() - STALE_MS).sort((a, b) => a.at - b.at);
}

export const fireAt = (e: Upcoming, s = notifySettings()) => e.at - s.kinds[e.kind].lead * HOUR;

let running = false;

export async function check(force = false): Promise<void> {
  const s = notifySettings();
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
      const body = when ? `${e.body} · ${when}` : e.body;
      if (browserPermission() === 'granted' && !isDemo()) notify(e.title, { body, tag: e.key });
      else toast(`${e.title}: ${body}`, 5000);
    }
    for (const e of due.slice(6)) fired[e.key] = now;
    saveJson(FIRED_KEY, fired);
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
    if (!notifySettings().enabled) return;
    const job = () => check();
    (navigator.locks ? navigator.locks.request('vyraj-notify', { ifAvailable: true }, (lock) => (lock ? job() : undefined)) : job()).catch(() => {});
  };
  if (!isDemo()) setTimeout(run, 15_000);
  setInterval(run, CHECK_MS);
}
