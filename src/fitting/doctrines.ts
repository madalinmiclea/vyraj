import type { Sde } from '../data/sde';
import { cloneFit, newFitId, type Fit } from '../engine/fit';
import { loadJson, saveJson } from '../storage';
import { appUrl, compactFit, decodeCode, encodeCode, expandFit } from '../io/shareLink';
import { exportEft, parseEft } from '../io/eft';
import { tx } from '../i18n';

export type Role = 'dps' | 'logi' | 'tackle' | 'ewar' | 'boost' | 'scout' | 'support';

export const ROLES: { id: Role; label: string }[] = [
  { id: 'dps', label: tx('DPS') },
  { id: 'logi', label: tx('Logistică') },
  { id: 'tackle', label: tx('Tackle') },
  { id: 'ewar', label: tx('EWAR') },
  { id: 'boost', label: tx('Boost-uri') },
  { id: 'scout', label: tx('Scout') },
  { id: 'support', label: tx('Suport') },
];

export const roleLabel = (r: Role) => ROLES.find((x) => x.id === r)?.label ?? r;

export interface DoctrineFit {
  id: string;
  role: Role;
  qty: number;
  alt: boolean;
  fit: Fit;
}

export interface Doctrine {
  id: string;
  name: string;
  notes: string;
  updated: number;
  fits: DoctrineFit[];
}

const KEY = 'eve-fit:doctrines';
const PREFIX = '#doctrine=';
const MAX_FITS = 40;

export const loadDoctrines = (): Doctrine[] => loadJson<Doctrine[]>(KEY, []);

export function saveDoctrines(list: Doctrine[]) {
  saveJson(KEY, list);
}

export function upsertDoctrine(d: Doctrine) {
  d.updated = Date.now();
  const list = loadDoctrines();
  const at = list.findIndex((x) => x.id === d.id);
  if (at >= 0) list[at] = d; else list.unshift(d);
  saveDoctrines(list);
}

export function deleteDoctrine(id: string) {
  saveDoctrines(loadDoctrines().filter((d) => d.id !== id));
}

export function newDoctrine(name = tx('Doctrină nouă')): Doctrine {
  return { id: 'doc-' + newFitId(), name, notes: '', updated: Date.now(), fits: [] };
}

const ROLE_BY_GROUP: [RegExp, Role][] = [
  [/logistics|force auxiliary/i, 'logi'],
  [/interceptor|interdictor|heavy interdiction/i, 'tackle'],
  [/electronic attack|recon ship/i, 'ewar'],
  [/command ship|command destroyer/i, 'boost'],
  [/covert ops|expedition/i, 'scout'],
  [/industrial|freighter|hauler|transport|carrier|titan/i, 'support'],
];

export function guessRole(sde: Sde, fit: Fit): Role {
  const group = sde.types.get(fit.shipId)?.groupName ?? '';
  return ROLE_BY_GROUP.find(([re]) => re.test(group))?.[1] ?? 'dps';
}

export function doctrineFit(sde: Sde, fit: Fit, role?: Role): DoctrineFit {
  const copy = cloneFit(fit);
  copy.id = newFitId();
  return { id: newFitId(), role: role ?? guessRole(sde, copy), qty: 1, alt: false, fit: copy };
}

const ROLE_LINE = new RegExp(`^(?:#+|==+|--+|\\*\\*)?\\s*(${ROLES.map((r) => r.id).join('|')}|logi|logistics|logistică|logistica|boosts?|boost-uri|support|suport)\\s*(?:==+|--+|\\*\\*)?:?$`, 'i');

function roleFrom(text: string): Role | null {
  const m = text.match(ROLE_LINE);
  if (!m) return null;
  const k = m[1].toLowerCase();
  if (k.startsWith('logi')) return 'logi';
  if (k.startsWith('boost')) return 'boost';
  if (k === 'support' || k === 'suport') return 'support';
  return (ROLES.find((r) => r.id === k)?.id ?? null);
}

const HEADER = /^\[(?!empty\s)[^\]\d][^\]]*\]$/i;

export interface MultiImport {
  name: string;
  fits: DoctrineFit[];
  unknown: string[];
  failed: string[];
}

export function parseDoctrineText(sde: Sde, text: string): MultiImport {
  const lines = text.replace(/\r/g, '').split('\n');
  const chunks: { role: Role | null; lines: string[] }[] = [];
  let role: Role | null = null;
  let name = '';
  for (const raw of lines) {
    const line = raw.trim();
    const r = roleFrom(line.replace(/[*_`]/g, ''));
    if (r) { role = r; continue; }
    if (HEADER.test(line)) { chunks.push({ role, lines: [line] }); continue; }
    if (!chunks.length) {
      const title = line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
      if (title && !name) name = title.slice(0, 80);
      continue;
    }
    if (/^#+\s/.test(line)) continue;
    chunks.at(-1)!.lines.push(line);
  }
  const out: MultiImport = { name, fits: [], unknown: [], failed: [] };
  for (const c of chunks.slice(0, MAX_FITS)) {
    try {
      const { fit, unknown } = parseEft(sde, c.lines.join('\n'));
      out.unknown.push(...unknown);
      out.fits.push(doctrineFit(sde, fit, c.role ?? undefined));
    } catch {
      out.failed.push(c.lines[0]);
    }
  }
  return out;
}

export function doctrineText(sde: Sde, d: Doctrine): string {
  const out: string[] = [`# ${d.name}`];
  if (d.notes.trim()) out.push('', d.notes.trim());
  for (const r of ROLES) {
    const fits = d.fits.filter((f) => f.role === r.id);
    if (!fits.length) continue;
    out.push('', `## ${r.id}`);
    for (const f of fits) out.push('', exportEft(sde, f.fit).trim());
  }
  return out.join('\n') + '\n';
}

export async function doctrineUrl(d: Doctrine): Promise<string> {
  const raw = { v: 1, n: d.name, o: d.notes, f: d.fits.map((f) => [f.role, f.qty, f.alt ? 1 : 0, compactFit(f.fit)]) };
  return appUrl(PREFIX + await encodeCode(raw, 600_000));
}

export const hasSharedDoctrine = () => location.hash.startsWith(PREFIX);

export async function readSharedDoctrine(sde: Sde): Promise<Doctrine | null> {
  if (!hasSharedDoctrine()) return null;
  const code = location.hash.slice(PREFIX.length);
  history.replaceState(null, '', location.pathname + location.search);
  const raw = await decodeCode(code, 120_000, 600_000) as { n?: unknown; o?: unknown; f?: unknown };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.f)) throw new Error('invalid');
  const d = newDoctrine(typeof raw.n === 'string' && raw.n.trim() ? raw.n.slice(0, 80) : tx('Doctrină importată'));
  d.notes = typeof raw.o === 'string' ? raw.o.slice(0, 4000) : '';
  for (const entry of raw.f.slice(0, MAX_FITS)) {
    if (!Array.isArray(entry)) continue;
    const fit = expandFit(sde, entry[3]);
    if (!fit) continue;
    const role = ROLES.some((r) => r.id === entry[0]) ? (entry[0] as Role) : guessRole(sde, fit);
    const qty = typeof entry[1] === 'number' && Number.isInteger(entry[1]) ? Math.min(999, Math.max(1, entry[1])) : 1;
    d.fits.push({ id: newFitId(), role, qty, alt: entry[2] === 1, fit });
  }
  if (!d.fits.length) throw new Error('invalid');
  return d;
}
