import { accessToken, hasScope } from '../character/sso';
import { ESI, esiFetch } from './esiClient';
import { loadJson, saveJson } from '../storage';
import { tx } from '../i18n';

export const MAIL_READ_SCOPE = 'esi-mail.read_mail.v1';
export const MAIL_ORGANIZE_SCOPE = 'esi-mail.organize_mail.v1';
export const MAIL_SEND_SCOPE = 'esi-mail.send_mail.v1';

export const LABEL_INBOX = 1;
export const LABEL_SENT = 2;
export const LABEL_CORP = 4;
export const LABEL_ALLIANCE = 8;

export type RecipientType = 'character' | 'corporation' | 'alliance' | 'mailing_list';

export interface MailRecipient { recipient_id: number; recipient_type: RecipientType }

export interface MailHeader {
  mail_id: number;
  from?: number;
  recipients?: MailRecipient[];
  subject?: string;
  timestamp?: string;
  labels?: number[];
  is_read?: boolean;
}

export interface MailBody {
  body?: string;
  from?: number;
  labels?: number[];
  read?: boolean;
  recipients?: MailRecipient[];
  subject?: string;
  timestamp?: string;
}

export interface MailLabel { label_id: number; name: string; color?: string; unread_count?: number }

export interface MailLabels { labels: MailLabel[]; total_unread_count?: number }

export interface MailingList { mailing_list_id: number; name: string }

export const LABEL_COLORS = ['#0000fe', '#006634', '#0099ff', '#00ff33', '#01ffff', '#349800', '#660066', '#666666', '#999999', '#99ffff', '#9a0000', '#ccff9a', '#e6e6e6', '#fe0000', '#ff6600', '#ffff01', '#ffffcd', '#ffffff'];

export const canRead = (characterId: number) => hasScope(characterId, MAIL_READ_SCOPE);
export const canOrganize = (characterId: number) => hasScope(characterId, MAIL_ORGANIZE_SCOPE);
export const canSend = (characterId: number) => hasScope(characterId, MAIL_SEND_SCOPE);

async function call<T>(characterId: number, path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(characterId);
  const res = await esiFetch(`${ESI}/characters/${characterId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 520 && /cspa/i.test(text)) throw new Error(tx('Destinatarul cere taxă CSPA pentru mailuri. Trimite-l din joc dacă vrei să plătești taxa.'));
    if (res.status === 403) throw new Error(tx('EVE a refuzat cererea (lipsă permisiune sau acces).'));
    throw new Error(`ESI ${path}: ${res.status} ${text}`);
  }
  if (res.status === 204) return undefined as T;
  const raw = await res.text();
  return (raw ? JSON.parse(raw) : undefined) as T;
}

export interface Fresh<T> { data: T; expires: number; etag?: string }

const DEFAULT_TTL = 30_000;

export async function cachedGet<T>(characterId: number, path: string, prev?: Fresh<T> | null, force = false): Promise<{ entry: Fresh<T>; changed: boolean }> {
  if (prev && !force && Date.now() < prev.expires) return { entry: prev, changed: false };
  const token = await accessToken(characterId);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (prev?.etag) headers['If-None-Match'] = prev.etag;
  const res = await esiFetch(`${ESI}/characters/${characterId}${path}`, { headers });
  const expires = Date.parse(res.headers.get('expires') ?? '') || Date.now() + DEFAULT_TTL;
  if (res.status === 304 && prev) return { entry: { ...prev, expires }, changed: false };
  if (!res.ok) {
    if (res.status === 403) throw new Error(tx('EVE a refuzat cererea (lipsă permisiune sau acces).'));
    throw new Error(`ESI ${path}: ${res.status} ${await res.text()}`);
  }
  const etag = res.headers.get('etag') ?? undefined;
  const data = (await res.json()) as T;
  return { entry: { data, expires, etag }, changed: !prev || !etag || etag !== prev.etag };
}

export function mailPath({ labels, lastMailId }: { labels?: number[]; lastMailId?: number } = {}): string {
  const q = new URLSearchParams();
  if (labels?.length) q.set('labels', labels.join(','));
  if (lastMailId) q.set('last_mail_id', String(lastMailId));
  const qs = q.toString();
  return `/mail/${qs ? `?${qs}` : ''}`;
}

export const listMail = (characterId: number, opts: { labels?: number[]; lastMailId?: number } = {}) => call<MailHeader[]>(characterId, mailPath(opts));

export const readMail = (characterId: number, mailId: number) => call<MailBody>(characterId, `/mail/${mailId}/`);

export const updateMail = (characterId: number, mailId: number, change: { read?: boolean; labels?: number[] }) =>
  call<void>(characterId, `/mail/${mailId}/`, { method: 'PUT', body: JSON.stringify(change) });

export const deleteMail = (characterId: number, mailId: number) => call<void>(characterId, `/mail/${mailId}/`, { method: 'DELETE' });


export const createLabel = (characterId: number, name: string, color: string) =>
  call<number>(characterId, '/mail/labels/', { method: 'POST', body: JSON.stringify({ name, color }) });

export const deleteLabel = (characterId: number, labelId: number) => call<void>(characterId, `/mail/labels/${labelId}/`, { method: 'DELETE' });


export const sendMail = (characterId: number, mail: { recipients: MailRecipient[]; subject: string; body: string }) =>
  call<number>(characterId, '/mail/', { method: 'POST', body: JSON.stringify({ ...mail, approved_cost: 0 }) });

export async function lookupRecipients(names: string[]): Promise<{ found: (MailRecipient & { name: string })[]; missing: string[] }> {
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!wanted.length) return { found: [], missing: [] };
  const res = await esiFetch(`${ESI}/universe/ids/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wanted) });
  if (!res.ok) throw new Error(tx('Nu am putut căuta destinatarii ({status}).', { status: res.status }));
  const data = (await res.json()) as Partial<Record<'characters' | 'corporations' | 'alliances', { id: number; name: string }[]>>;
  const found: (MailRecipient & { name: string })[] = [];
  const kinds: ['characters' | 'corporations' | 'alliances', RecipientType][] = [['characters', 'character'], ['corporations', 'corporation'], ['alliances', 'alliance']];
  for (const [key, type] of kinds) for (const x of data[key] ?? []) found.push({ recipient_id: x.id, recipient_type: type, name: x.name });
  const hit = new Set(found.map((f) => f.name.toLowerCase()));
  return { found, missing: wanted.filter((n) => !hit.has(n.toLowerCase())) };
}

const NAMES_KEY = 'eve-mail:names';
const nameCache = new Map<number, string>(Object.entries(loadJson<Record<string, string>>(NAMES_KEY, {})).map(([k, v]) => [Number(k), v]));
const nameMisses = new Set<number>();

async function namesBatch(ids: number[]): Promise<void> {
  const res = await esiFetch(`${ESI}/universe/names/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids) }).catch(() => null);
  if (res?.ok) {
    for (const x of (await res.json()) as { id: number; name: string }[]) nameCache.set(x.id, x.name);
    return;
  }
  if (res?.status === 404 && ids.length > 1) {
    const mid = Math.ceil(ids.length / 2);
    await Promise.all([namesBatch(ids.slice(0, mid)), namesBatch(ids.slice(mid))]);
    return;
  }
  for (const id of ids) nameMisses.add(id);
}

export const cachedMailName = (id: number) => nameCache.get(id);

export async function mailNames(ids: number[]): Promise<boolean> {
  const missing = [...new Set(ids)].filter((id) => id > 0 && !nameCache.has(id) && !nameMisses.has(id));
  if (!missing.length) return false;
  await Promise.all(Array.from({ length: Math.ceil(missing.length / 1000) }, (_, i) => namesBatch(missing.slice(i * 1000, i * 1000 + 1000))));
  saveJson(NAMES_KEY, Object.fromEntries(nameCache));
  return true;
}

const ALLOWED = new Set(['B', 'I', 'U', 'BR', 'P', 'DIV', 'SPAN', 'A', 'FONT', 'UL', 'OL', 'LI']);

function color(raw: string | null): string | null {
  const m = raw?.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return null;
  const hex = m[1].length === 8 ? m[1].slice(2) : m[1];
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  if (Math.max(...rgb) - Math.min(...rgb) < 40) return null;
  return `#${hex}`;
}

function clean(node: Node, doc: Document): Node[] {
  if (node.nodeType === Node.TEXT_NODE) return [doc.createTextNode(node.textContent ?? '')];
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as Element;
  const kids = () => [...el.childNodes].flatMap((c) => clean(c, doc));
  if (!ALLOWED.has(el.tagName)) return kids();
  if (el.tagName === 'BR') return [doc.createElement('br')];
  let out: HTMLElement;
  if (el.tagName === 'A') {
    const href = el.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      const a = doc.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      out = a;
    } else {
      out = doc.createElement('span');
      out.className = 'mail-ref';
    }
  } else if (el.tagName === 'FONT') {
    out = doc.createElement('span');
    const c = color(el.getAttribute('color'));
    if (c) { out.className = 'mail-fc'; out.style.setProperty('--mail-fc', c); }
  } else {
    out = doc.createElement(el.tagName.toLowerCase());
  }
  out.append(...kids());
  return [out];
}

export function mailHtml(body: string): string {
  const src = new DOMParser().parseFromString(`<body>${body.replace(/\r?\n/g, '<br>')}</body>`, 'text/html');
  const doc = document.implementation.createHTMLDocument('');
  const wrap = doc.createElement('div');
  wrap.append(...[...src.body.childNodes].flatMap((c) => clean(c, doc)));
  return wrap.innerHTML;
}

export function mailText(body: string): string {
  const src = new DOMParser().parseFromString(`<body>${body.replace(/<br\s*\/?>/gi, '\n')}</body>`, 'text/html');
  return (src.body.textContent ?? '').trim();
}

export function bodyFromText(text: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return esc(text).replace(/\r?\n/g, '<br>');
}
