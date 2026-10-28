import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { publishData, RAW_DIR } from './publish-data.ts';
import { writeMining } from './mining-data.ts';
import { buildIndustry } from './industry-data.ts';
import { ACTIVITY_FILES, buildActivities } from './activity-data.ts';

type Row = Record<string, any>;

const OUT = path.join(RAW_DIR, 'skins.json');
const MASTERY_OUT = path.join(RAW_DIR, 'masteries.json');
const MAP_OUT = path.join(RAW_DIR, 'map.json');
const INDUSTRY_OUT = path.join(RAW_DIR, 'industry.json');
const PI_OUT = path.join(RAW_DIR, 'pi.json');
const ACTIVITIES_OUT = path.join(RAW_DIR, 'activities.json');
const ZIP_URL = 'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip';
const FILES = ['skins', 'skinMaterials', 'skinLicenses', 'graphicMaterialSets', 'types', 'groups', 'masteries', 'certificates', 'mapRegions', 'mapConstellations', 'mapSolarSystems', 'mapStargates', 'planetSchematics', 'typeDogma', 'blueprints', 'categories', 'typeMaterials', ...ACTIVITY_FILES];
const SHIP_CATEGORY = 6;

const en = (v: any): string => (typeof v === 'string' ? v : v?.en ?? v?.['en-us'] ?? '');
const hex = (c: Row | undefined): string | null => (c ? '#' + [c.r, c.g, c.b].map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('') : null);

function readJsonl(dir: string, name: string): Map<number, Row> {
    const file = fs.readdirSync(dir).find((f) => f.toLowerCase() === `${name.toLowerCase()}.jsonl`);
    if (!file) throw new Error(`Lipsește ${name}.jsonl din SDE`);
    const map = new Map<number, Row>();
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        map.set(Number(row._key), row);
    }
    return map;
}

async function download(dir: string) {
    const zip = path.join(dir, 'sde.zip');
    const res = await fetch(ZIP_URL);
    if (!res.ok) throw new Error(`SDE: ${res.status}`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const patterns = FILES.flatMap((f) => [`${f}.jsonl`, `*/${f}.jsonl`]);
    try {
        execFileSync('unzip', ['-o', '-j', '-qq', zip, ...patterns, '-d', dir], { stdio: 'ignore' });
    } catch (e) {
        if ((e as { status?: number }).status !== 11) throw e;
    }
}

export function buildSkins(dir: string) {
    const skins = readJsonl(dir, 'skins');
    const materials = readJsonl(dir, 'skinMaterials');
    const licenses = readJsonl(dir, 'skinLicenses');
    const sets = readJsonl(dir, 'graphicMaterialSets');
    const types = readJsonl(dir, 'types');
    const groups = readJsonl(dir, 'groups');

    const isShip = (id: number) => {
        const t = types.get(id);
        return t && t.published && groups.get(t.groupID)?.categoryID === SHIP_CATEGORY;
    };
    const licBySkin = new Map<number, { id: number; permanent: boolean }[]>();
    for (const l of licenses.values()) {
        const list = licBySkin.get(l.skinID) ?? [];
        list.push({ id: l.licenseTypeID, permanent: l.duration === -1 || l.duration == null });
        licBySkin.set(l.skinID, list);
    }

    const lines = new Map<string, { n: string; m: number; ships: Map<number, number[]> }>();
    for (const [skinId, s] of skins) {
        if (!s.visibleTranquility || s.isStructureSkin || /serenity/i.test(s.internalName ?? '')) continue;
        const lic = (licBySkin.get(skinId) ?? []).sort((a, b) => Number(b.permanent) - Number(a.permanent) || a.id - b.id).map((l) => (l.permanent ? l.id : -l.id));
        const mat = materials.get(s.skinMaterialID);
        const name = en(mat?.displayName).trim();
        if (!name) continue;
        const line = lines.get(name) ?? { n: name, m: mat!.materialSetID, ships: new Map<number, number[]>() };
        for (const shipId of s.types ?? []) {
            if (!isShip(shipId)) continue;
            const prev = line.ships.get(shipId) ?? [];
            line.ships.set(shipId, [...new Set([...prev, ...lic])]);
        }
        lines.set(name, line);
    }

    const usedShips = new Set<number>();
    const outLines = [...lines.values()]
        .filter((l) => l.ships.size)
        .map((l) => {
            const set = sets.get(l.m);
            const c = set ? [set.colorHull, set.colorPrimary, set.colorSecondary, set.colorWindow].map(hex) : [];
            const s = [...l.ships.entries()].map(([shipId, lic]) => {
                usedShips.add(shipId);
                return [shipId, ...lic];
            });
            const first = s.flatMap((x) => x.slice(1)).filter((x) => x > 0);
            return { n: l.n, i: first.length ? Math.min(...first) : 0, c: c.some(Boolean) ? c : undefined, s };
        })
        .sort((a, b) => a.n.localeCompare(b.n));

    const outShips: Record<number, [string, string]> = {};
    for (const id of usedShips) {
        const t = types.get(id)!;
        outShips[id] = [en(t.name), en(groups.get(t.groupID)?.name)];
    }
    return { generated: new Date().toISOString(), source: 'sde', lines: outLines, ships: outShips };
}

export function buildMasteries(dir: string) {
    const masteries = readJsonl(dir, 'masteries');
    const certificates = readJsonl(dir, 'certificates');
    const grades = ['basic', 'standard', 'improved', 'advanced', 'elite'];
    const certs: Record<number, [string, number[][]]> = {};
    for (const [id, c] of certificates) {
        certs[id] = [en(c.name).trim(), (c.skillTypes ?? []).map((s: Row) => [Number(s._key), ...grades.map((g) => s[g] ?? 0)])];
    }
    const ships: Record<number, number[][]> = {};
    for (const [shipId, row] of masteries) {
        const levels: number[][] = [[], [], [], [], []];
        for (const l of (row._value ?? []) as Row[]) if (l._key >= 0 && l._key < 5) levels[l._key] = (l._value ?? []).map(Number);
        ships[shipId] = levels;
    }
    return { generated: new Date().toISOString(), source: 'sde', certs, ships };
}

const LY = 9460730472580800;
const KSPACE_MAX_REGION = 11000000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function buildMap(dir: string) {
    const regions = readJsonl(dir, 'mapRegions');
    const constellations = readJsonl(dir, 'mapConstellations');
    const systems = readJsonl(dir, 'mapSolarSystems');
    const gates = readJsonl(dir, 'mapStargates');
    const outRegions: Record<number, string> = {};
    for (const [id, r] of regions) if (id < KSPACE_MAX_REGION) outRegions[id] = en(r.name);
    const outConst: Record<number, string> = {};
    for (const [id, c] of constellations) if (outRegions[c.regionID]) outConst[id] = en(c.name);
    const outSystems: [number, string, number, number, number, number, number, number][] = [];
    for (const [id, s] of systems) {
        if (!outRegions[s.regionID]) continue;
        const p = s.position ?? s.center ?? {};
        const [x, y, z] = Array.isArray(p) ? p : [p.x, p.y, p.z];
        outSystems.push([id, en(s.name), s.constellationID, s.regionID, r4(s.securityStatus ?? s.security ?? 0), r4(x / LY), r4(y / LY), r4(z / LY)]);
    }
    outSystems.sort((a, b) => a[0] - b[0]);
    const known = new Set(outSystems.map((s) => s[0]));
    const pairs = new Set<string>();
    for (const g of gates.values()) {
        const a = g.solarSystemID;
        const b = g.destination?.solarSystemID ?? gates.get(g.destination?.stargateID ?? g.destination)?.solarSystemID;
        if (!known.has(a) || !known.has(b) || a === b) continue;
        pairs.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
    const outGates = [...pairs].sort().flatMap((k) => k.split(':').map(Number));
    if (outSystems.length < 5000 || outGates.length < 10000) throw new Error(`Harta din SDE pare incompletă: ${outSystems.length} sisteme, ${outGates.length / 2} porți`);
    return { generated: new Date().toISOString(), source: 'sde', regions: outRegions, constellations: outConst, systems: outSystems, gates: outGates };
}

const PI_PIN_KINDS: Record<number, string> = { 1026: 'ext', 1027: 'cc', 1028: 'fac', 1029: 'store', 1030: 'pad', 1063: 'ecu' };
const PI_RAW_CATEGORY = 42;
const HARVESTED_TYPE = 709;
const EXTRACTOR_PLANET = 1632;

const keyed = (v: any): [number, Row][] => (Array.isArray(v) ? v.map((x: Row) => [Number(x._key ?? x.typeID), x._value ?? x] as [number, Row]) : Object.entries(v ?? {}).map(([k, x]) => [Number(k), x as Row]));

export function buildPi(dir: string) {
    const schematics = readJsonl(dir, 'planetSchematics');
    const types = readJsonl(dir, 'types');
    const groups = readJsonl(dir, 'groups');
    const dogma = readJsonl(dir, 'typeDogma');
    const attr = (id: number, a: number): number | undefined => (dogma.get(id)?.dogmaAttributes ?? []).find((x: Row) => x.attributeID === a)?.value;
    const tier = new Map<number, number>();
    for (const [id, t] of types) if (t.published && groups.get(t.groupID)?.categoryID === PI_RAW_CATEGORY) tier.set(id, 0);
    const rows = [...schematics].map(([id, s]) => {
        const io = keyed(s.types);
        const out = io.find(([, x]) => !x.isInput);
        return { id, name: en(s.name ?? s.nameID), cycle: Number(s.cycleTime), out, ins: io.filter(([, x]) => x.isInput).map(([t, x]) => [t, Number(x.quantity)]) };
    }).filter((r) => r.out && r.ins.length);
    for (let pass = 0; pass < 6; pass++) {
        for (const r of rows) {
            const ts = r.ins.map(([t]) => tier.get(t));
            if (ts.every((x) => x != null)) tier.set(r.out![0], Math.max(...(ts as number[])) + 1);
        }
    }
    const outTypes: Record<number, [string, number, number]> = {};
    for (const [id, t] of tier) outTypes[id] = [en(types.get(id)?.name), t, Number(types.get(id)?.volume ?? 0)];
    const outSchematics = rows
        .filter((r) => tier.has(r.out![0]))
        .map((r) => [r.id, r.name, r.cycle, r.out![0], Number(r.out![1].quantity), r.ins])
        .sort((a, b) => (a[0] as number) - (b[0] as number));
    const planets: Record<number, [string, number[]]> = {};
    const pins: Record<number, [string, string, number]> = {};
    for (const [id, t] of types) {
        const kind = PI_PIN_KINDS[t.groupID];
        if (!kind) continue;
        pins[id] = [en(t.name), kind, Number(t.capacity ?? 0)];
        if (kind !== 'ext') continue;
        const planet = attr(id, EXTRACTOR_PLANET);
        const raw = attr(id, HARVESTED_TYPE);
        if (!planet || !raw || !tier.has(raw)) continue;
        const name = en(types.get(planet)?.name).replace(/^Planet \((.*)\)$/, '$1');
        const entry = planets[planet] ?? (planets[planet] = [name, []]);
        if (!entry[1].includes(raw)) entry[1].push(raw);
    }
    const counts = [0, 1, 2, 3, 4].map((n) => [...tier.values()].filter((x) => x === n).length);
    if (counts[0] < 10 || counts[4] < 5 || Object.keys(planets).length < 8) throw new Error(`Datele PI din SDE par incomplete: ${counts.join('/')}`);
    return { generated: new Date().toISOString(), source: 'sde', types: outTypes, schematics: outSchematics, planets, pins };
}

export async function generateSkins() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eve-sde-'));
    try {
        await download(dir);
        const data = buildSkins(dir);
        fs.mkdirSync(path.dirname(OUT), { recursive: true });
        fs.writeFileSync(OUT, JSON.stringify(data));
        fs.writeFileSync(MASTERY_OUT, JSON.stringify(buildMasteries(dir)));
        fs.writeFileSync(MAP_OUT, JSON.stringify(buildMap(dir)));
        writeMining(dir);
        fs.writeFileSync(ACTIVITIES_OUT, JSON.stringify(buildActivities(dir)));
        fs.writeFileSync(INDUSTRY_OUT, JSON.stringify(buildIndustry((name) => readJsonl(dir, name))));
        fs.writeFileSync(PI_OUT, JSON.stringify(buildPi(dir)));
        return data;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

export function skinsAge() {
    try {
        const data = JSON.parse(fs.readFileSync(OUT, 'utf8'));
        const mastery = JSON.parse(fs.readFileSync(MASTERY_OUT, 'utf8'));
        if (data.source !== 'sde' || mastery.source !== 'sde') return Infinity;
        return Date.now() - new Date(data.generated).getTime();
    } catch {
        return Infinity;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log('⏳ Descarc SDE-ul oficial pentru SKIN-uri, mastery și hartă...');
    generateSkins()
        .then((d) => console.log(`✅ data/skins.json: ${d.lines.length} colecții, ${d.lines.reduce((a, l) => a + l.s.length, 0)} SKIN-uri, data/masteries.json, data/map.json, data/pi.json`))
        .then(() => console.log('✅ public/data:', publishData()))
        .catch((e: Error) => { console.error('Eroare:', e.message); process.exitCode = 1; });
}
