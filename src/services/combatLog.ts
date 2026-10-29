export type Dir = 'out' | 'in';
export type EventKind = 'dmg' | 'miss' | 'neut' | 'nos' | 'rep' | 'tackle' | 'jam' | 'reload' | 'capEmpty' | 'warpBlocked' | 'warp';

export interface Actor {
  key: string;
  name: string;
  ship: string;
  corp: string;
  alliance: string;
  player: boolean;
}

export interface CombatEvent {
  t: number;
  kind: EventKind;
  dir: Dir;
  amount: number;
  who: string;
  weapon: string;
  quality: string;
  sub: string;
}

export interface ParsedLog {
  listener: string;
  started: number;
  events: CombatEvent[];
  actors: Map<string, Actor>;
  places: { t: number; system: string }[];
}

export interface Encounter {
  id: string;
  listener: string;
  start: number;
  end: number;
  system: string;
  events: CombatEvent[];
  actors: Map<string, Actor>;
  dmgOut: number;
  dmgIn: number;
  pvp: boolean;
}

export const QUALITIES = ['Wrecks', 'Smashes', 'Penetrates', 'Hits', 'Glances Off', 'Grazes'] as const;
const QUALITY_SET = new Set<string>(QUALITIES);
const GAP_MS = 60_000;
const TAIL_MS = 30_000;

const LINE = /^\s*\[\s*(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s*\]\s*\((\w+)\)\s?(.*)$/;
const HEAD_LISTENER = /^\s*Listener:\s*(.+?)\s*$/m;
const HEAD_STARTED = /^\s*Session Started:\s*(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/m;

const DAMAGE = /^(-?\d+) (from|to) (.+)$/;
const NEUT = /^(-?\d+) GJ energy neutralized (.+?)(?: - (.*))?$/;
const NOS = /^([+-]?\d+) GJ energy drained (from|to) (.+?)(?: - (.*))?$/;
const REMOTE = /^(\d+)(?: GJ)? remote (armor|shield|hull|structure|capacitor) \w+ (by|to) (.+?)(?: - (.*))?$/;
const TACKLE = /^Warp (scramble|disruption) attempt from (.+?) to (.+?)!?$/;
const MISS_IN = /^(.+?) misses you completely(?: - (.*))?$/;
const MISS_OUT = /^Your (?:group of )?(.+?) misses (.+?) completely(?: - (.*))?$/;
const JAM = /^You(?:'re| are) jammed by (.+?)(?: - (.*))?$/;
const RELOAD = /^(.+?) has run out of charges/;
const CAP_EMPTY = /^(.+?) requires [\d.,]+ units of charge\. The capacitor has only ([\d.,]+) units/;
const WARP_BLOCKED = /^External factors are preventing your warp/;
const WARPING = /^You cannot do that while warping/;
const JUMP = /^Jumping from .+? to (.+)$/;
const UNDOCK = /^Undocking from .+? to (.+?) solar system/;

const strip = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const stamp = (y: string, mo: string, d: string, h: string, mi: string, s: string) => Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);

function actorOf(raw: string): Actor {
  const text = raw.trim().replace(/\s+-$/, '').trim();
  const owned = /^.+? belonging to (.+)$/.exec(text);
  if (owned) {
    const name = owned[1].trim();
    return { key: name.toLowerCase(), name, ship: '', corp: '', alliance: '', player: true };
  }
  const dmg = /^(.+?)\[([^\]]*)\]\((.+)\)$/.exec(text);
  if (dmg) {
    const name = dmg[1].trim();
    const ship = dmg[3].trim();
    if (OBJECT.test(ship) || OBJECT.test(name)) return { key: text.toLowerCase(), name, ship: '', corp: dmg[2].trim(), alliance: '', player: false };
    return { key: name.toLowerCase(), name, ship, corp: dmg[2].trim(), alliance: '', player: true };
  }
  const br = /^(.+?)((?:\s*\[[^\]]*\])+)$/.exec(text);
  if (br) {
    const tags = [...br[2].matchAll(/\[([^\]]*)\]/g)].map((m) => m[1].trim());
    const ship = br[1].trim();
    if (tags.length >= 2) {
      const name = tags[tags.length - 1];
      return { key: name.toLowerCase(), name, ship, corp: tags[tags.length - 2], alliance: tags.length >= 3 ? tags[tags.length - 3] : '', player: true };
    }
    return { key: `${ship}|${tags[0]}`.toLowerCase(), name: ship, ship, corp: tags[0], alliance: '', player: true };
  }
  return { key: text.toLowerCase(), name: text, ship: '', corp: '', alliance: '', player: false };
}

function mergeActor(map: Map<string, Actor>, a: Actor): string {
  const cur = map.get(a.key);
  if (!cur) { map.set(a.key, a); return a.key; }
  if (!cur.ship && a.ship) cur.ship = a.ship;
  if (!cur.corp && a.corp) cur.corp = a.corp;
  if (!cur.alliance && a.alliance) cur.alliance = a.alliance;
  return cur.key;
}

function splitTail(rest: string): { who: string; weapon: string; quality: string } {
  const parts = rest.replace(/\]\s+-(?=\s|$)/g, ']').split(' - ').map((p) => p.trim()).filter(Boolean);
  const who = parts.shift() ?? '';
  let quality = '';
  if (parts.length && QUALITY_SET.has(parts[parts.length - 1])) quality = parts.pop()!;
  return { who, weapon: parts.join(' - '), quality };
}

const OBJECT = /\b(?:Wreck|Container|Jetcan|Debris)$/i;

const isYou = (s: string) => /^you$/i.test(s.trim());

export function parseCombatLog(raw: string): ParsedLog {
  const listener = HEAD_LISTENER.exec(raw)?.[1] ?? '';
  const st = HEAD_STARTED.exec(raw);
  const out: ParsedLog = { listener, started: st ? stamp(st[1], st[2], st[3], st[4], st[5], st[6]) : 0, events: [], actors: new Map(), places: [] };
  for (const line of raw.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (!m) continue;
    const t = stamp(m[1], m[2], m[3], m[4], m[5], m[6]);
    const channel = m[7];
    const body = m[8];
    const text = strip(body);
    if (channel === 'None') {
      const j = JUMP.exec(text) ?? UNDOCK.exec(text);
      if (j) out.places.push({ t, system: j[1].trim() });
      continue;
    }
    if (channel === 'notify') {
      const r = RELOAD.exec(text);
      if (r) out.events.push({ t, kind: 'reload', dir: 'out', amount: 0, who: '', weapon: r[1].trim(), quality: '', sub: '' });
      const c = CAP_EMPTY.exec(text);
      if (c) out.events.push({ t, kind: 'capEmpty', dir: 'in', amount: parseFloat(c[2].replace(',', '.')), who: '', weapon: c[1].trim(), quality: '', sub: '' });
      if (WARP_BLOCKED.test(text)) out.events.push({ t, kind: 'warpBlocked', dir: 'in', amount: 0, who: '', weapon: '', quality: '', sub: '' });
      if (WARPING.test(text)) out.events.push({ t, kind: 'warp', dir: 'out', amount: 0, who: '', weapon: '', quality: '', sub: '' });
      continue;
    }
    if (channel !== 'combat') continue;
    const color = /<color=0x([0-9a-f]{8})>/i.exec(body)?.[1].toLowerCase() ?? '';
    const push = (kind: EventKind, dir: Dir, amount: number, who: string, weapon = '', quality = '', sub = '') => {
      const key = who ? mergeActor(out.actors, actorOf(who)) : '';
      out.events.push({ t, kind, dir, amount, who: key, weapon: weapon.trim(), quality, sub });
    };
    let r: RegExpExecArray | null;
    if ((r = NEUT.exec(text))) {
      const tail = splitTail(`${r[2]}${r[3] ? ` - ${r[3]}` : ''}`);
      push('neut', color.endsWith('7fffff') ? 'out' : 'in', Math.abs(+r[1]), tail.who, tail.weapon);
    } else if ((r = NOS.exec(text))) {
      const tail = splitTail(`${r[3]}${r[4] ? ` - ${r[4]}` : ''}`);
      push('nos', r[2] === 'from' ? 'out' : 'in', Math.abs(+r[1]), tail.who, tail.weapon);
    } else if ((r = REMOTE.exec(text))) {
      const tail = splitTail(`${r[4]}${r[5] ? ` - ${r[5]}` : ''}`);
      push('rep', r[3] === 'by' ? 'in' : 'out', +r[1], tail.who, tail.weapon, '', r[2] === 'structure' ? 'hull' : r[2]);
    } else if ((r = DAMAGE.exec(text))) {
      const tail = splitTail(r[3]);
      push('dmg', r[2] === 'to' ? 'out' : 'in', Math.max(0, +r[1]), tail.who, tail.weapon, tail.quality);
    } else if ((r = TACKLE.exec(text))) {
      const from = r[2].trim(), to = r[3].trim();
      if (isYou(to)) push('tackle', 'in', 0, splitTail(from).who, '', '', r[1]);
      else if (isYou(from)) push('tackle', 'out', 0, splitTail(to).who, '', '', r[1]);
    } else if ((r = MISS_OUT.exec(text))) {
      push('miss', 'out', 0, splitTail(r[2]).who, r[3] ?? r[1]);
    } else if ((r = MISS_IN.exec(text))) {
      push('miss', 'in', 0, splitTail(r[1]).who, r[2] ?? '');
    } else if ((r = JAM.exec(text))) {
      push('jam', 'in', 0, splitTail(r[1]).who, r[2] ?? '');
    }
  }
  out.events.sort((a, b) => a.t - b.t);
  return out;
}

const ACTIVE = new Set<EventKind>(['dmg', 'miss', 'neut', 'nos', 'tackle', 'jam', 'rep']);
const TAIL = new Set<EventKind>(['warp', 'warpBlocked', 'capEmpty']);

export function splitEncounters(logs: ParsedLog[]): Encounter[] {
  const list: Encounter[] = [];
  for (const log of logs) {
    let cur: CombatEvent[] = [];
    const flush = () => {
      const active = cur.filter((e) => ACTIVE.has(e.kind));
      if (!active.length) { cur = []; return; }
      const start = active[0].t, end = active[active.length - 1].t;
      const events = cur.filter((e) => e.t >= start && (e.t <= end || (e.t <= end + TAIL_MS && TAIL.has(e.kind))));
      const actors = new Map<string, Actor>();
      for (const e of events) if (e.who) actors.set(e.who, log.actors.get(e.who)!);
      const place = [...log.places].reverse().find((p) => p.t <= start);
      let dmgOut = 0, dmgIn = 0;
      for (const e of events) if (e.kind === 'dmg') { if (e.dir === 'out') dmgOut += e.amount; else dmgIn += e.amount; }
      list.push({ id: `${log.listener}|${start}`, listener: log.listener, start, end, system: place?.system ?? '', events, actors, dmgOut, dmgIn, pvp: [...actors.values()].some((a) => a.player) });
      cur = [];
    };
    let last = 0;
    for (const e of log.events) {
      if (ACTIVE.has(e.kind)) {
        if (cur.length && e.t - last > GAP_MS) flush();
        last = e.t;
      }
      cur.push(e);
    }
    flush();
  }
  const seen = new Set<string>();
  return list.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((a, b) => b.start - a.start);
}

export interface Bucket {
  t: number;
  dmgOut: number;
  dmgIn: number;
  neutIn: number;
  neutOut: number;
  nosIn: number;
  nosOut: number;
  repIn: number;
  hitsOut: number;
  hitsIn: number;
}

export interface ActorStats {
  actor: Actor;
  dmgTo: number;
  dmgFrom: number;
  hitsTo: number;
  missTo: number;
  hitsFrom: number;
  missFrom: number;
  maxFrom: number;
  neut: number;
  nos: number;
  reps: number;
  tackled: string;
  tackledBy: string;
  jams: number;
  first: number;
  last: number;
  lastHitTo: number;
  weapons: string[];
  marks: { t: number; kind: EventKind; dir: Dir }[];
}

export interface WeaponStats {
  weapon: string;
  source: string;
  hits: number;
  misses: number;
  total: number;
  max: number;
  quality: Record<string, number>;
}

export interface Moment {
  t: number;
  kind: 'start' | 'tackleIn' | 'tackleOut' | 'neutIn' | 'jam' | 'reload' | 'peakIn' | 'peakOut' | 'silent' | 'end' | 'arrive' | 'capEmpty' | 'warpBlocked' | 'warp';
  text: string;
  who?: string;
  value?: number;
}

export interface FightAnalysis {
  step: number;
  duration: number;
  buckets: Bucket[];
  actors: ActorStats[];
  weaponsOut: WeaponStats[];
  weaponsIn: WeaponStats[];
  qualityOut: Record<string, number>;
  qualityIn: Record<string, number>;
  missOut: number;
  missIn: number;
  hitsOut: number;
  hitsIn: number;
  peakOut: { t: number; dps: number };
  peakIn: { t: number; dps: number };
  capIn: number;
  capOut: number;
  repIn: number;
  moments: Moment[];
}

const STEPS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300];
const MAX_BUCKETS = 48;
const PEAK_WINDOW = 10;

function peak(events: CombatEvent[], dir: Dir, start: number, end: number) {
  const per = new Map<number, number>();
  for (const e of events) if (e.kind === 'dmg' && e.dir === dir) {
    const s = Math.floor((e.t - start) / 1000);
    per.set(s, (per.get(s) ?? 0) + e.amount);
  }
  const len = Math.floor((end - start) / 1000) + 1;
  const w = Math.min(PEAK_WINDOW, len);
  let sum = 0, best = 0, at = 0;
  for (let i = 0; i < len; i++) {
    sum += per.get(i) ?? 0;
    if (i >= w) sum -= per.get(i - w) ?? 0;
    if (i >= w - 1 && sum > best) { best = sum; at = i - w + 1; }
  }
  return { t: start + at * 1000, dps: best / w };
}

function weaponTable(map: Map<string, WeaponStats>) {
  return [...map.values()].sort((a, b) => b.total - a.total || b.hits + b.misses - (a.hits + a.misses));
}

export function analyzeFight(enc: Encounter): FightAnalysis {
  const start = enc.start;
  const duration = Math.max(1, Math.round((enc.end - enc.start) / 1000) + 1);
  const step = STEPS.find((s) => duration / s <= MAX_BUCKETS) ?? 600;
  const count = Math.max(1, Math.ceil(duration / step));
  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({ t: start + i * step * 1000, dmgOut: 0, dmgIn: 0, neutIn: 0, neutOut: 0, nosIn: 0, nosOut: 0, repIn: 0, hitsOut: 0, hitsIn: 0 }));
  const stats = new Map<string, ActorStats>();
  const statOf = (key: string, t: number) => {
    let s = stats.get(key);
    if (!s) {
      s = { actor: enc.actors.get(key)!, dmgTo: 0, dmgFrom: 0, hitsTo: 0, missTo: 0, hitsFrom: 0, missFrom: 0, maxFrom: 0, neut: 0, nos: 0, reps: 0, tackled: '', tackledBy: '', jams: 0, first: t, last: t, lastHitTo: 0, weapons: [], marks: [] };
      stats.set(key, s);
    }
    s.last = t;
    return s;
  };
  const wOut = new Map<string, WeaponStats>(), wIn = new Map<string, WeaponStats>();
  const wOf = (map: Map<string, WeaponStats>, weapon: string, source: string) => {
    const k = `${source}|${weapon}`;
    let w = map.get(k);
    if (!w) { w = { weapon, source, hits: 0, misses: 0, total: 0, max: 0, quality: {} }; map.set(k, w); }
    return w;
  };
  const qualityOut: Record<string, number> = {}, qualityIn: Record<string, number> = {};
  let missOut = 0, missIn = 0, hitsOut = 0, hitsIn = 0, capIn = 0, capOut = 0, repIn = 0;
  const moments: Moment[] = [];

  for (const e of enc.events) {
    const b = buckets[Math.min(count - 1, Math.floor((e.t - start) / 1000 / step))];
    const s = e.who ? statOf(e.who, e.t) : null;
    if (s && e.kind !== 'reload') s.marks.push({ t: e.t, kind: e.kind, dir: e.dir });
    if (s && e.weapon && e.dir === 'in' && !s.weapons.includes(e.weapon) && e.kind !== 'tackle') s.weapons.push(e.weapon);
    switch (e.kind) {
      case 'dmg':
        if (e.dir === 'out') {
          b.dmgOut += e.amount; b.hitsOut++; hitsOut++;
          if (s) { s.dmgTo += e.amount; s.hitsTo++; s.lastHitTo = e.t; }
          const w = wOf(wOut, e.weapon || '—', '');
          w.hits++; w.total += e.amount; w.max = Math.max(w.max, e.amount);
          if (e.quality) { w.quality[e.quality] = (w.quality[e.quality] ?? 0) + 1; qualityOut[e.quality] = (qualityOut[e.quality] ?? 0) + 1; }
        } else {
          b.dmgIn += e.amount; b.hitsIn++; hitsIn++;
          if (s) { s.dmgFrom += e.amount; s.hitsFrom++; s.maxFrom = Math.max(s.maxFrom, e.amount); }
          const w = wOf(wIn, e.weapon || '—', e.who);
          w.hits++; w.total += e.amount; w.max = Math.max(w.max, e.amount);
          if (e.quality) { w.quality[e.quality] = (w.quality[e.quality] ?? 0) + 1; qualityIn[e.quality] = (qualityIn[e.quality] ?? 0) + 1; }
        }
        break;
      case 'miss':
        if (e.dir === 'out') { missOut++; if (s) s.missTo++; wOf(wOut, e.weapon || '—', '').misses++; }
        else { missIn++; if (s) s.missFrom++; wOf(wIn, e.weapon || '—', e.who).misses++; }
        break;
      case 'neut':
        if (e.dir === 'in') { b.neutIn += e.amount; capIn += e.amount; if (s) s.neut += e.amount; }
        else { b.neutOut += e.amount; capOut += e.amount; }
        break;
      case 'nos':
        if (e.dir === 'in') { b.nosIn += e.amount; capIn += e.amount; if (s) s.nos += e.amount; }
        else { b.nosOut += e.amount; capOut += e.amount; }
        break;
      case 'rep':
        if (e.dir === 'in') { b.repIn += e.amount; repIn += e.amount; if (s) s.reps += e.amount; }
        break;
      case 'tackle':
        if (s) {
          if (e.dir === 'in' && !s.tackledBy.includes(e.sub)) s.tackledBy = s.tackledBy ? `${s.tackledBy}, ${e.sub}` : e.sub;
          if (e.dir === 'out' && !s.tackled.includes(e.sub)) s.tackled = s.tackled ? `${s.tackled}, ${e.sub}` : e.sub;
        }
        break;
      case 'jam':
        if (s) s.jams++;
        break;
    }
  }

  const actors = [...stats.values()].filter((s) => s.actor).sort((a, b) => b.dmgFrom + b.dmgTo + b.neut * 0.5 - (a.dmgFrom + a.dmgTo + a.neut * 0.5));
  const peakOut = peak(enc.events, 'out', start, enc.end);
  const peakIn = peak(enc.events, 'in', start, enc.end);

  moments.push({ t: start, kind: 'start', text: 'start' });
  const firstOf = (pred: (e: CombatEvent) => boolean) => enc.events.find(pred);
  const tIn = firstOf((e) => e.kind === 'tackle' && e.dir === 'in');
  if (tIn) moments.push({ t: tIn.t, kind: 'tackleIn', text: tIn.sub, who: tIn.who });
  const tOut = firstOf((e) => e.kind === 'tackle' && e.dir === 'out');
  if (tOut) moments.push({ t: tOut.t, kind: 'tackleOut', text: tOut.sub, who: tOut.who });
  const nIn = firstOf((e) => (e.kind === 'neut' || e.kind === 'nos') && e.dir === 'in');
  if (nIn) moments.push({ t: nIn.t, kind: 'neutIn', text: nIn.weapon, who: nIn.who });
  for (const s of actors) {
    if (s.first > start + 5000 && (s.dmgFrom > 0 || s.neut > 0 || s.tackledBy)) moments.push({ t: s.first, kind: 'arrive', text: '', who: s.actor.key });
    if (s.lastHitTo && s.dmgTo > 0 && enc.end - s.last > 8000 && s.last - s.lastHitTo < 6000) moments.push({ t: s.last, kind: 'silent', text: '', who: s.actor.key });
  }
  const lastOf: Partial<Record<EventKind, number>> = {};
  const spaced = (e: CombatEvent) => {
    const prev = lastOf[e.kind];
    lastOf[e.kind] = e.t;
    return prev == null || e.t - prev > 20000;
  };
  let warped = false;
  for (const e of enc.events) {
    if (e.kind === 'jam' && spaced(e)) moments.push({ t: e.t, kind: 'jam', text: e.weapon, who: e.who });
    if (e.kind === 'reload') moments.push({ t: e.t, kind: 'reload', text: e.weapon });
    if (e.kind === 'capEmpty' && spaced(e)) moments.push({ t: e.t, kind: 'capEmpty', text: e.weapon, value: e.amount });
    if (e.kind === 'warpBlocked' && spaced(e)) moments.push({ t: e.t, kind: 'warpBlocked', text: '' });
    if (e.kind === 'warp' && !warped) { warped = true; moments.push({ t: e.t, kind: 'warp', text: '' }); }
  }
  if (peakIn.dps > 0) moments.push({ t: peakIn.t, kind: 'peakIn', text: '', value: peakIn.dps });
  if (peakOut.dps > 0) moments.push({ t: peakOut.t, kind: 'peakOut', text: '', value: peakOut.dps });
  moments.push({ t: enc.end, kind: 'end', text: '' });
  moments.sort((a, b) => a.t - b.t || (a.kind === 'end' ? -1 : b.kind === 'end' ? 1 : 0));

  return {
    step, duration, buckets, actors,
    weaponsOut: weaponTable(wOut), weaponsIn: weaponTable(wIn),
    qualityOut, qualityIn, missOut, missIn, hitsOut, hitsIn,
    peakOut, peakIn, capIn, capOut, repIn, moments,
  };
}

export const logFileName = (name: string) => /^\d{8}_\d{6}(?:_\d+)?\.txt$/.test(name);
export const logFileDate = (name: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(name);
  return m ? stamp(m[1], m[2], m[3], m[4], m[5], m[6]) : 0;
};

const FOCUS_PAD_MS = 5000;
const TAIL_KINDS = new Set<EventKind>(['reload', 'capEmpty', 'warpBlocked', 'warp']);

export function playerFocus(enc: Encounter): Encounter | null {
  const players = new Set([...enc.actors.values()].filter((a) => a.player).map((a) => a.key));
  if (!players.size || players.size === enc.actors.size) return null;
  const own = enc.events.filter((e) => e.who && players.has(e.who));
  if (!own.length) return null;
  const start = own[0].t, end = own[own.length - 1].t;
  const events = enc.events.filter((e) => (e.who ? players.has(e.who) && e.t >= start && e.t <= end : TAIL_KINDS.has(e.kind) && e.t >= start - FOCUS_PAD_MS && e.t <= end + FOCUS_PAD_MS));
  const actors = new Map([...enc.actors].filter(([k]) => players.has(k)));
  let dmgOut = 0, dmgIn = 0;
  for (const e of events) if (e.kind === 'dmg') { if (e.dir === 'out') dmgOut += e.amount; else dmgIn += e.amount; }
  return { ...enc, start, end, events, actors, dmgOut, dmgIn, pvp: true };
}
