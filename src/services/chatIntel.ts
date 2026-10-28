import { fold } from '../ui/fold';
import type { NavMap } from './navigation';

export interface IntelReport {
  id: string;
  time: number;
  channel: string;
  speaker: string;
  text: string;
  systems: number[];
  clear: boolean;
}

interface FileLike { kind: 'file'; name: string; getFile(): Promise<File> }
interface DirLike {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileLike | DirLike>;
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>;
}

const DB = 'vyraj-chat';
const STORE = 'handles';
const LINE = /^\s*\[\s*(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s*\]\s*(.+?)\s+>\s?(.*)$/;
const FILE = /^(.+)_(\d{8})_(\d{6})(?:_(\d+))?\.txt$/;
const CLEAR = /\b(clr|clear|cleared|clean|curat|liber)\b/i;
const SKIP_SPEAKERS = new Set(['EVE System', 'Sistemul EVE']);
const POLL_MS = 2000;
const LIST_MS = 30_000;

export const chatFolderSupported = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}

async function idbSet(key: string, value: unknown) {
  const db = await idb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export class SystemMatcher {
  private readonly exact = new Map<string, number>();
  private readonly names: [string, number][];

  constructor(map: NavMap) {
    for (const s of map.systems.values()) this.exact.set(fold(s.name), s.id);
    this.names = [...this.exact.entries()].filter(([n]) => /[\d-]/.test(n));
  }

  find(text: string): number[] {
    const found: number[] = [];
    const words = text.split(/[\s,;!?()[\]{}"'*]+/).map((w) => w.replace(/^[.:]+|[.:]+$/g, '')).filter((w) => w.length >= 3);
    for (let i = 0; i < words.length; i++) {
      for (const span of [3, 2, 1]) {
        if (i + span > words.length) continue;
        const key = fold(words.slice(i, i + span).join(' '));
        const id = this.exact.get(key);
        const casual = span === 1 && /^[a-z]{3,5}$/.test(key) && words[i][0] === words[i][0].toLowerCase();
        if (id && !casual) { if (!found.includes(id)) found.push(id); i += span - 1; break; }
        if (span === 1 && /[\d-]/.test(key) && (key.length >= 4 || (key.length === 3 && words[i] === words[i].toUpperCase()))) {
          const hits = this.names.filter(([n]) => n.startsWith(key));
          if (hits.length === 1 && !found.includes(hits[0][1])) { found.push(hits[0][1]); break; }
        }
      }
    }
    return found;
  }
}

export function parseIntel(text: string, channel: string, matcher: SystemMatcher, fallbackTime = Date.now()): IntelReport[] {
  const out: IntelReport[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line) return;
    const m = line.match(LINE);
    const speaker = m ? m[7].trim() : '';
    if (SKIP_SPEAKERS.has(speaker)) return;
    const body = m ? m[8] : line;
    const systems = matcher.find(body);
    if (!systems.length) return;
    const time = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : fallbackTime;
    out.push({ id: `${channel}:${time}:${i}:${body.length}`, time, channel, speaker, text: body, systems, clear: CLEAR.test(body) });
  });
  return out;
}

export interface ChannelInfo { name: string; file: string; modified: number }

type ReportListener = (reports: IntelReport[], live: boolean) => void;

export class ChatWatcher {
  private dir: DirLike | null = null;
  private files = new Map<string, FileLike>();
  private offsets = new Map<string, number>();
  private timer = 0;
  private listedAt = 0;
  channels: ChannelInfo[] = [];
  watched = new Set<string>();
  error = '';

  constructor(private readonly matcher: () => SystemMatcher | null, private readonly emit: ReportListener, private readonly changed: () => void) {}

  get connected() {
    return !!this.dir && !this.error;
  }

  get folderName() {
    return this.dir?.name ?? '';
  }

  async restore(): Promise<'none' | 'ready' | 'prompt'> {
    if (!chatFolderSupported()) return 'none';
    const dir = await idbGet<DirLike>('chatlogs').catch(() => undefined);
    const watched = await idbGet<string[]>('channels').catch(() => undefined);
    if (watched) this.watched = new Set(watched);
    if (!dir) return 'none';
    this.dir = dir;
    const state = await dir.queryPermission?.({ mode: 'read' }).catch(() => 'prompt' as PermissionState);
    if (state === 'granted') { await this.begin(); return 'ready'; }
    return 'prompt';
  }

  async reconnect() {
    if (!this.dir) return this.pick();
    const state = await this.dir.requestPermission?.({ mode: 'read' });
    if (state === 'granted') await this.begin();
  }

  async pick() {
    const picker = (window as unknown as { showDirectoryPicker: (o: { id: string; mode: 'read' }) => Promise<DirLike> }).showDirectoryPicker;
    const dir = await picker({ id: 'eve-chatlogs', mode: 'read' });
    this.dir = dir;
    await idbSet('chatlogs', dir).catch(() => undefined);
    await this.begin();
  }

  async setWatched(names: string[]) {
    this.watched = new Set(names);
    await idbSet('channels', names).catch(() => undefined);
    for (const name of names) {
      const ch = this.channels.find((c) => c.name === name);
      if (ch && !this.offsets.has(ch.file)) await this.prime(ch.file);
    }
    this.changed();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = 0;
  }

  private async begin() {
    this.error = '';
    await this.list();
    for (const name of this.watched) {
      const ch = this.channels.find((c) => c.name === name);
      if (ch) await this.prime(ch.file);
    }
    this.changed();
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.tick(), POLL_MS);
  }

  private async list() {
    if (!this.dir) return;
    const latest = new Map<string, ChannelInfo>();
    const week = Date.now() - 7 * 86400_000;
    for await (const entry of this.dir.values()) {
      if (entry.kind !== 'file') continue;
      const m = entry.name.match(FILE);
      if (!m) continue;
      const d = m[2], t = m[3];
      const modified = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
      if (modified < week) continue;
      this.files.set(entry.name, entry);
      const prev = latest.get(m[1]);
      if (!prev || modified > prev.modified) latest.set(m[1], { name: m[1], file: entry.name, modified });
    }
    this.channels = [...latest.values()].sort((a, b) => b.modified - a.modified);
    this.listedAt = Date.now();
  }

  private async read(file: string, from: number): Promise<{ text: string; size: number }> {
    const handle = this.files.get(file);
    if (!handle) return { text: '', size: from };
    const f = await handle.getFile();
    const start = from - (from % 2);
    if (f.size <= start) return { text: '', size: f.size };
    const buf = await f.slice(start).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const utf16 = start > 0 || (bytes[0] === 0xff && bytes[1] === 0xfe);
    const usable = utf16 ? bytes.length - (bytes.length % 2) : bytes.length;
    const text = new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(bytes.subarray(0, usable));
    return { text, size: start + usable };
  }

  private async prime(file: string) {
    const { text, size } = await this.read(file, 0);
    this.offsets.set(file, size);
    const m = this.matcher();
    const ch = this.channels.find((c) => c.file === file);
    if (!m || !ch) return;
    const cut = Date.now() - 30 * 60_000;
    const recent = parseIntel(text, ch.name, m).filter((r) => r.time >= cut);
    if (recent.length) this.emit(recent, false);
  }

  private async tick() {
    try {
      if (Date.now() - this.listedAt > LIST_MS) {
        const before = new Map(this.channels.map((c) => [c.name, c.file]));
        await this.list();
        for (const c of this.channels) if (this.watched.has(c.name) && before.get(c.name) !== c.file) this.offsets.set(c.file, 0);
      }
      const m = this.matcher();
      for (const c of this.channels) {
        if (!this.watched.has(c.name)) continue;
        const from = this.offsets.get(c.file) ?? 0;
        const { text, size } = await this.read(c.file, from);
        this.offsets.set(c.file, size);
        if (text && m) {
          const found = parseIntel(text, c.name, m);
          if (found.length) this.emit(found, true);
        }
      }
    } catch (err) {
      this.error = (err as Error).message || 'error';
      this.changed();
      return;
    }
    this.schedule();
  }
}
