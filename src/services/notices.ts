import { loadJson, saveJson, isDemo } from '../storage';
import { toast } from '../ui/components';
import { tx } from '../i18n';
import { notify } from './pwa';
import type { PermId } from '../character/permissions';

export type NoticeKind = 'filled' | 'expired' | 'expiring' | 'outbid' | 'alerts' | 'skill' | 'queue' | 'mail' | 'industry' | 'pi' | 'contracts' | 'nearby' | 'gStructure' | 'gWar' | 'gCorp' | 'gKill' | 'gOther';

export type NoticeGroup = 'market' | 'pilot' | 'production' | 'pvp' | 'game';

export interface KindInfo { id: NoticeKind; group: NoticeGroup; label: string; hint: string; lead: boolean; perm?: PermId }

export interface NoticeSettings {
  enabled: boolean;
  system: boolean;
  kinds: Record<NoticeKind, { on: boolean; lead: number }>;
}

export interface Notice { id: string; kind: NoticeKind; at: number; title: string; body: string; url?: string; charId?: number; read?: boolean }

export const NOTICE_EVENT = 'vyraj-notify-updated';
export const LOG_EVENT = 'vyraj-notice-log';
export const LEADS = [0, 1, 2, 4, 12, 24];

const SETTINGS_KEY = 'eve-notify:settings';
const LOG_KEY = 'eve-notify:log';
const LOG_MAX = 300;

export const GROUPS: { id: NoticeGroup; label: string; icon: string }[] = [
  { id: 'market', label: tx('Piață și comerț'), icon: 'orders' },
  { id: 'pilot', label: tx('Pilot'), icon: 'character' },
  { id: 'production', label: tx('Producție'), icon: 'industry' },
  { id: 'pvp', label: tx('Intel PvP'), icon: 'recon' },
  { id: 'game', label: tx('Notificări din joc'), icon: 'structure' },
];

export const KINDS: KindInfo[] = [
  { id: 'filled', group: 'market', label: tx('Ordin vândut sau cumpărat'), hint: tx('Când cineva cumpără din ordinul tău de vânzare sau îți vinde în ordinul de cumpărare, și la ordinele umplute doar parțial.'), lead: false, perm: 'orders' },
  { id: 'expired', group: 'market', label: tx('Ordin expirat'), hint: tx('Un ordin a ajuns la capătul duratei cu iteme rămase nevândute sau necumpărate.'), lead: false, perm: 'orders' },
  { id: 'expiring', group: 'market', label: tx('Ordin care expiră curând'), hint: tx('Înainte să expire un ordin activ, ca să-l reînnoiești la timp.'), lead: true, perm: 'orders' },
  { id: 'outbid', group: 'market', label: tx('Outbid și undercut'), hint: tx('Când altcineva pune un preț mai bun decât ordinul tău în aceeași stație sau regiune.'), lead: false, perm: 'orders' },
  { id: 'alerts', group: 'market', label: tx('Alerte de preț Jita'), hint: tx('Alertele de preț pe care le pui în Ordine de piață > Alerte preț.'), lead: false },
  { id: 'skill', group: 'pilot', label: tx('Skill terminat'), hint: tx('Fiecare skill din coada de antrenament, când se termină.'), lead: false },
  { id: 'queue', group: 'pilot', label: tx('Coada de skill-uri se golește'), hint: tx('Înainte să se termine ultimul skill din coadă, ca să adaugi altele.'), lead: true },
  { id: 'mail', group: 'pilot', label: tx('Mail nou'), hint: tx('Un mail necitit nou în Inbox, de la alt pilot, corporație sau alianță.'), lead: false, perm: 'mail' },
  { id: 'industry', group: 'production', label: tx('Job de industrie gata'), hint: tx('Fabricație, cercetare, invenție și reacții, când se termină.'), lead: true, perm: 'industry' },
  { id: 'pi', group: 'production', label: tx('Extractor PI oprit'), hint: tx('Când un extractor planetar ajunge la capătul ciclului și trebuie repornit.'), lead: true, perm: 'planets' },
  { id: 'contracts', group: 'production', label: tx('Contract care expiră'), hint: tx('Contractele tale active și termenele de livrare la curier.'), lead: true, perm: 'contracts' },
  { id: 'nearby', group: 'pvp', label: tx('Kill PvP lângă tine'), hint: tx('Un kill PvP în sistemul în care ești sau într-un sistem legat direct prin stargate de el. Contează doar kill-urile făcute după ce ai ajuns în sistem, așa că nu primești nimic din urmă când treci prin sisteme. Caracterele offline sunt ignorate.'), lead: false, perm: 'location' },
  { id: 'gStructure', group: 'game', label: tx('Structuri'), hint: tx('Structură atacată, scut sau armură pierdute, combustibil pe terminate, servicii oprite, suveranitate și skyhook-uri.'), lead: false, perm: 'notifications' },
  { id: 'gWar', group: 'game', label: tx('Războaie'), hint: tx('Războaie declarate, retrase sau încheiate, aliați noi și Faction Warfare.'), lead: false, perm: 'notifications' },
  { id: 'gCorp', group: 'game', label: tx('Corporație și alianță'), hint: tx('Cereri de intrare, membri care pleacă, voturi, roluri, facturi și taxe.'), lead: false, perm: 'notifications' },
  { id: 'gKill', group: 'game', label: tx('Kill-uri, asigurări și recompense'), hint: tx('Kill report-uri, plăți de asigurare, bounty-uri puse pe tine sau încasate și activări de clone.'), lead: false, perm: 'notifications' },
  { id: 'gOther', group: 'game', label: tx('Alte notificări din joc'), hint: tx('Orice altă notificare din joc care nu intră în categoriile de mai sus.'), lead: false, perm: 'notifications' },
];

export const kindInfo = (id: NoticeKind) => KINDS.find((k) => k.id === id)!;

const DEFAULT_KINDS: NoticeSettings['kinds'] = {
  filled: { on: true, lead: 0 },
  expired: { on: true, lead: 0 },
  expiring: { on: false, lead: 24 },
  outbid: { on: true, lead: 0 },
  alerts: { on: true, lead: 0 },
  skill: { on: true, lead: 0 },
  queue: { on: true, lead: 12 },
  mail: { on: true, lead: 0 },
  industry: { on: true, lead: 0 },
  pi: { on: true, lead: 2 },
  contracts: { on: true, lead: 4 },
  nearby: { on: false, lead: 0 },
  gStructure: { on: true, lead: 0 },
  gWar: { on: true, lead: 0 },
  gCorp: { on: true, lead: 0 },
  gKill: { on: false, lead: 0 },
  gOther: { on: false, lead: 0 },
};

export function noticeSettings(): NoticeSettings {
  const s = loadJson<Partial<NoticeSettings>>(SETTINGS_KEY, {});
  const kinds = { ...DEFAULT_KINDS, ...(s.kinds ?? {}) };
  if (!s.kinds?.outbid) kinds.outbid = { on: loadJson<boolean>('eve-orders:notify', true), lead: 0 };
  return { enabled: s.enabled ?? true, system: s.system ?? true, kinds };
}

export function saveNoticeSettings(s: NoticeSettings) {
  saveJson(SETTINGS_KEY, s);
  if (s.enabled && s.system) askBrowser();
  window.dispatchEvent(new Event(NOTICE_EVENT));
}

export const kindOn = (id: NoticeKind, s = noticeSettings()) => s.enabled && s.kinds[id].on;

export function setKind(id: NoticeKind, on: boolean) {
  const s = noticeSettings();
  s.kinds[id] = { ...s.kinds[id], on };
  saveNoticeSettings(s);
}

export const browserPermission = (): NotificationPermission | 'unsupported' => ('Notification' in window ? Notification.permission : 'unsupported');

export function askBrowser(): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'default') return Promise.resolve();
  return Notification.requestPermission().then(() => undefined).catch(() => undefined).finally(() => window.dispatchEvent(new Event(NOTICE_EVENT)));
}

export const loadLog = () => loadJson<Notice[]>(LOG_KEY, []);

export function saveLog(list: Notice[]) {
  saveJson(LOG_KEY, list.slice(0, LOG_MAX));
  window.dispatchEvent(new Event(LOG_EVENT));
}

export const unreadCount = () => loadLog().filter((n) => !n.read).length;

export function markAllRead() {
  const list = loadLog();
  if (!list.some((n) => !n.read)) return;
  saveLog(list.map((n) => ({ ...n, read: true })));
}

export const clearLog = () => saveLog([]);

export function forgetCharacterNotices(characterId: number) {
  const list = loadLog();
  if (list.some((n) => n.charId === characterId)) saveLog(list.filter((n) => n.charId !== characterId));
  for (const key of ['eve-notify:mail-seen', 'eve-notify:game-seen']) {
    const seen = loadJson<Record<string, number>>(key, {});
    if (seen[characterId] != null) { delete seen[characterId]; saveJson(key, seen); }
  }
  const snap = loadJson<Record<string, { c: number }>>('eve-orders:snapshot', {});
  if (Object.values(snap).some((o) => o.c === characterId)) saveJson('eve-orders:snapshot', Object.fromEntries(Object.entries(snap).filter(([, o]) => o.c !== characterId)));
}

export interface Delivery { title: string; body: string; url?: string; charId?: number; tag?: string; short?: string; at?: number }

export function deliver(kind: NoticeKind, d: Delivery): boolean {
  const s = noticeSettings();
  if (!kindOn(kind, s)) return false;
  const now = Date.now();
  const entry: Notice = { id: `${now}-${Math.random().toString(36).slice(2, 7)}`, kind, at: d.at ?? now, title: d.title, body: d.body, url: d.url, charId: d.charId };
  saveLog([entry, ...loadLog()]);
  if (document.visibilityState === 'visible') toast(d.short ?? `${d.title}: ${d.body.split('\n')[0]}`, 5000);
  if (s.system && browserPermission() === 'granted' && !isDemo()) notify(d.title, { body: d.body, tag: d.tag ?? entry.id, url: d.url });
  return true;
}

export function testNotice() {
  const s = noticeSettings();
  const title = tx('Notificare de probă');
  const body = tx('Așa arată o notificare Vyraj.');
  saveLog([{ id: `test-${Date.now()}`, kind: 'alerts', at: Date.now(), title, body }, ...loadLog()]);
  toast(`${title}: ${body}`, 4000);
  if (s.system && browserPermission() === 'granted') notify(title, { body, tag: 'vyraj-test' });
}
