import { DEMO_ID } from './identity';
import { tx } from '../i18n';

const HOUR = 3_600_000;
const DAY = 86_400_000;

const FC = 990_001;
const LOGI = 990_002;
const DIRECTOR = 990_003;
const TRADER = 990_004;
const RECRUIT = 990_005;
const CORP = 990_100;
const ALLIANCE = 990_200;
const OPS_LIST = 990_300;
const TRADE_LIST = 990_301;
const LABEL_OPS = 256;
const LABEL_TRADE = 512;

type Recipient = { recipient_id: number; recipient_type: 'character' | 'corporation' | 'alliance' | 'mailing_list' };

interface DemoMail {
  mail_id: number;
  from: number;
  recipients: Recipient[];
  subject: string;
  body: string;
  timestamp: string;
  labels: number[];
  is_read: boolean;
}

const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

export const demoNames = (): Record<number, string> => ({
  [DEMO_ID]: tx('Pilot demo'),
  [FC]: tx('Comandant de flotă'),
  [LOGI]: tx('Coordonator logistică'),
  [DIRECTOR]: tx('Director corporație'),
  [TRADER]: tx('Comerciant'),
  [RECRUIT]: tx('Pilot nou'),
  [CORP]: tx('Corporație demo'),
  [ALLIANCE]: tx('Alianță demo'),
});

const me = (): Recipient => ({ recipient_id: DEMO_ID, recipient_type: 'character' });

function seed(now: number): DemoMail[] {
  return [
    { mail_id: 4100, from: FC, recipients: [{ recipient_id: OPS_LIST, recipient_type: 'mailing_list' }], subject: tx('Operațiune de flotă diseară la 19:00 EVE'), body: tx('Formăm la 18:45 EVE în sistemul de casă.<br><br><b>Doctrină:</b> cruisere de atac cu drone, logistică T2.<br><font color="#ffe3a33a">Aduceți muniție și drone de rezervă.</font><br><br>Comunicarea vocală se anunță în canalul de flotă.'), timestamp: iso(now - 2 * HOUR), labels: [1, LABEL_OPS], is_read: false },
    { mail_id: 4099, from: DIRECTOR, recipients: [{ recipient_id: CORP, recipient_type: 'corporation' }], subject: tx('Taxa corporației se schimbă de luni'), body: tx('Salut tuturor,<br><br>De luni taxa pe recompense scade la 5%. Venitul strâns merge în fondul de nave pentru operațiunile de flotă.<br><br>Întrebările le puneți pe forumul corporației.'), timestamp: iso(now - 9 * HOUR), labels: [1, 4], is_read: false },
    { mail_id: 4098, from: LOGI, recipients: [me()], subject: tx('Contractul de transport e gata'), body: tx('Am livrat contractul în stația din hub. Verifică te rog cantitățile și confirmă.<br><br><a href="showinfo:2//60003760">Stația de hub</a> · colateral rambursat integral.'), timestamp: iso(now - 26 * HOUR), labels: [1], is_read: true },
    { mail_id: 4097, from: TRADER, recipients: [{ recipient_id: TRADE_LIST, recipient_type: 'mailing_list' }], subject: tx('Prețuri de săptămâna asta pentru minereuri'), body: tx('Rezumatul săptămânii: mineralele de bază au crescut ușor, cele rare stau pe loc.<br><br>Tabelul complet: <a href="https://example.com/">link extern</a>.'), timestamp: iso(now - 2 * DAY), labels: [1, LABEL_TRADE], is_read: true },
    { mail_id: 4096, from: DIRECTOR, recipients: [{ recipient_id: ALLIANCE, recipient_type: 'alliance' }], subject: tx('Anunț de alianță: întreținere structuri'), body: tx('Structurile din regiunea de casă intră în mentenanță joi. Mutați-vă bunurile din timp dacă aveți nevoie de ele în weekend.'), timestamp: iso(now - 3 * DAY), labels: [8], is_read: false },
    { mail_id: 4095, from: RECRUIT, recipients: [me()], subject: tx('Întrebare despre fitting'), body: tx('Salut! Am văzut fitul de cruiser din doctrină. Merge și cu skill-uri mai mici la arme? Mulțumesc!'), timestamp: iso(now - 4 * DAY), labels: [1], is_read: true },
    { mail_id: 4094, from: DEMO_ID, recipients: [{ recipient_id: RECRUIT, recipient_type: 'character' }], subject: tx('Re: Întrebare despre fitting'), body: tx('Da, merge. Pune module meta în loc de T2 până termini skill-urile, iar Vyraj îți arată exact ce lipsește.'), timestamp: iso(now - 4 * DAY + 3 * HOUR), labels: [2], is_read: true },
    { mail_id: 4093, from: FC, recipients: [{ recipient_id: OPS_LIST, recipient_type: 'mailing_list' }], subject: tx('Raport după operațiunea de duminică'), body: tx('Operațiune reușită: obiectivul a fost atins fără pierderi de logistică.<br><br>Mulțumim tuturor celor care au venit.'), timestamp: iso(now - 6 * DAY), labels: [1, LABEL_OPS], is_read: true },
  ];
}

let store: { mails: DemoMail[]; labels: { label_id: number; name: string; color: string }[]; next: number } | null = null;

function state(now: number) {
  store ??= {
    mails: seed(now),
    labels: [
      { label_id: 1, name: 'Inbox', color: '#ffffff' },
      { label_id: 2, name: 'Sent', color: '#ffffff' },
      { label_id: 4, name: '[Corp]', color: '#ffffff' },
      { label_id: 8, name: '[Alliance]', color: '#ffffff' },
      { label_id: LABEL_OPS, name: tx('Operațiuni'), color: '#ff6600' },
      { label_id: LABEL_TRADE, name: tx('Comerț'), color: '#00ff33' },
    ],
    next: 5000,
  };
  return store;
}

type Reply = { body: unknown; status?: number };

export function demoMail(route: string, method: string, url: URL, body: unknown, now: number): Reply | null {
  if (!route.startsWith('mail')) return null;
  const s = state(now);
  if (route === 'mail/lists') return { body: [{ mailing_list_id: OPS_LIST, name: tx('Operațiuni flotă') }, { mailing_list_id: TRADE_LIST, name: tx('Comerț și piață') }] };
  if (route === 'mail/labels') {
    if (method === 'POST') {
      const b = body as { name: string; color: string };
      const id = Math.max(...s.labels.map((l) => l.label_id)) * 2;
      s.labels.push({ label_id: id, name: b.name, color: b.color });
      return { body: id, status: 201 };
    }
    const labels = s.labels.map((l) => ({ ...l, unread_count: s.mails.filter((m) => !m.is_read && m.labels.includes(l.label_id)).length }));
    return { body: { labels, total_unread_count: s.mails.filter((m) => !m.is_read).length } };
  }
  const label = route.match(/^mail\/labels\/(\d+)$/);
  if (label && method === 'DELETE') {
    const id = Number(label[1]);
    s.labels = s.labels.filter((l) => l.label_id !== id || id <= 8);
    for (const m of s.mails) m.labels = m.labels.filter((x) => x !== id);
    return { body: null, status: 204 };
  }
  if (route === 'mail') {
    if (method === 'POST') {
      const b = body as { recipients: Recipient[]; subject: string; body: string };
      const id = s.next++;
      s.mails.unshift({ mail_id: id, from: DEMO_ID, recipients: b.recipients, subject: b.subject, body: b.body, timestamp: iso(now), labels: [2], is_read: true });
      return { body: id, status: 201 };
    }
    const wanted = (url.searchParams.get('labels') ?? '').split(',').filter(Boolean).map(Number);
    const last = Number(url.searchParams.get('last_mail_id')) || Infinity;
    const list = s.mails
      .filter((m) => m.mail_id < last && (!wanted.length || m.labels.some((l) => wanted.includes(l))))
      .sort((a, b) => b.mail_id - a.mail_id)
      .slice(0, 50)
      .map((m) => ({ mail_id: m.mail_id, from: m.from, recipients: m.recipients, subject: m.subject, timestamp: m.timestamp, labels: m.labels, is_read: m.is_read }));
    return { body: list };
  }
  const one = route.match(/^mail\/(\d+)$/);
  if (!one) return null;
  const m = s.mails.find((x) => x.mail_id === Number(one[1]));
  if (!m) return { body: { error: 'Mail not found' }, status: 404 };
  if (method === 'DELETE') { s.mails = s.mails.filter((x) => x !== m); return { body: null, status: 204 }; }
  if (method === 'PUT') {
    const b = body as { read?: boolean; labels?: number[] };
    if (b.read != null) m.is_read = b.read;
    if (b.labels) m.labels = b.labels;
    return { body: null, status: 204 };
  }
  return { body: { body: m.body, from: m.from, labels: m.labels, read: m.is_read, recipients: m.recipients, subject: m.subject, timestamp: m.timestamp } };
}

export function demoNameLookup(ids: number[]): { known: { id: number; name: string; category: string }[]; rest: number[] } {
  const names = demoNames();
  const category = (id: number) => (id === CORP ? 'corporation' : id === ALLIANCE ? 'alliance' : 'character');
  return {
    known: ids.filter((id) => names[id]).map((id) => ({ id, name: names[id], category: category(id) })),
    rest: ids.filter((id) => !names[id]),
  };
}

export function demoIdLookup(wanted: string[]): Record<string, { id: number; name: string }[]> {
  const names = Object.entries(demoNames()).map(([id, name]) => ({ id: Number(id), name }));
  const out: Record<string, { id: number; name: string }[]> = {};
  for (const w of wanted) {
    const hit = names.find((n) => n.name.toLowerCase() === w.toLowerCase());
    if (!hit) continue;
    const key = hit.id === CORP ? 'corporations' : hit.id === ALLIANCE ? 'alliances' : 'characters';
    (out[key] ??= []).push(hit);
  }
  return out;
}
