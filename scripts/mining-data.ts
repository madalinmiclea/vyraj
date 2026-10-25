import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RAW_DIR, publishData } from './publish-data.ts';

type Row = Record<string, any>;

const OUT = path.join(RAW_DIR, 'mining.json');
const ASTEROID_CATEGORY = 25;
const GAS_GROUP = 711;
const SKILL_GROUP = 1218;
const IMPLANT_GROUP = 1229;
const REFINERY_GROUP = 1406;
const RIG_GROUPS = [1941, 1942, 1943];
const BASE_SKILLS = [3385, 3389];
const A = { skill: 790, base: 2711, mutator: 379, rigYield: 717, hi: 2355, low: 2356, nul: 2357, structure: 2722 };

const en = (v: any): string => (typeof v === 'string' ? v : v?.en ?? v?.['en-us'] ?? '');

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

export function buildMining(dir: string) {
    const types = readJsonl(dir, 'types');
    const groups = readJsonl(dir, 'groups');
    const dogma = readJsonl(dir, 'typeDogma');
    const materials = readJsonl(dir, 'typeMaterials');

    const attrs = (id: number): Map<number, number> => new Map((dogma.get(id)?.dogmaAttributes ?? []).map((a: Row) => [a.attributeID, a.value]));
    const groupName = (id: number) => en(groups.get(id)?.name);
    const mats = (id: number): [number, number][] => (materials.get(id)?.materials ?? []).map((m: Row) => [m.materialTypeID, m.quantity]);
    const published = (t: Row | undefined) => !!t && t.published && t.marketGroupID != null;

    const byName = new Map<string, number>();
    for (const [id, t] of types) if (published(t)) byName.set(en(t.name), id);

    const skills: Record<number, [string, number]> = {};
    const addSkill = (id: number) => {
        const t = types.get(id);
        if (!t || skills[id]) return;
        skills[id] = [en(t.name), attrs(id).get(A.mutator) ?? 0];
    };
    BASE_SKILLS.forEach(addSkill);

    const ores: Row[] = [];
    const minerals: Record<number, string> = {};
    for (const [id, t] of types) {
        if (!published(t)) continue;
        const g = groups.get(t.groupID);
        const gas = t.groupID === GAS_GROUP;
        if (!g || (!gas && g.categoryID !== ASTEROID_CATEGORY)) continue;
        const name = en(t.name);
        if (/^(Batch )?Compressed /.test(name)) continue;
        const m = mats(id);
        if (!gas && !m.length) continue;
        const gName = groupName(t.groupID);
        const kind = gas ? 'gas' : /ice/i.test(gName) ? 'ice' : /moon/i.test(gName) ? 'moon' : 'ore';
        const a = attrs(id);
        const skill = a.get(A.skill) ?? 0;
        if (skill) addSkill(skill);
        const cId = byName.get(`Compressed ${name}`) ?? 0;
        const c = types.get(cId);
        for (const [mat] of m) minerals[mat] ??= en(types.get(mat)?.name);
        ores.push({
            i: id,
            n: name,
            k: kind,
            g: gName,
            v: t.volume ?? 0,
            p: t.portionSize ?? 1,
            c: cId || undefined,
            cv: c ? c.volume : undefined,
            cm: c && !gas && JSON.stringify(mats(cId)) !== JSON.stringify(m) ? mats(cId) : undefined,
            s: skill || undefined,
            f: skill ? en(types.get(skill)?.name).split(' ')[0] : undefined,
            b: a.get(A.base) && a.get(A.base) !== id ? a.get(A.base) : undefined,
            m,
        });
    }
    ores.sort((x, y) => x.g.localeCompare(y.g) || x.n.localeCompare(y.n));

    const implants: [number, string, number][] = [];
    const structures: [number, string, number][] = [];
    const rigs: Row[] = [];
    for (const [id, t] of types) {
        if (!published(t)) continue;
        const a = attrs(id);
        if (t.groupID === IMPLANT_GROUP && a.get(A.mutator)) implants.push([id, en(t.name), a.get(A.mutator)!]);
        if (t.groupID === REFINERY_GROUP) structures.push([id, en(t.name), a.get(A.structure) ?? 0]);
        if (RIG_GROUPS.includes(t.groupID) && a.get(A.rigYield)) {
            const gName = groupName(t.groupID) + ' ' + en(t.name);
            rigs.push({
                i: id,
                n: en(t.name),
                k: /moon/i.test(gName) ? 'moon' : /ice/i.test(gName) ? 'ice' : 'ore',
                y: a.get(A.rigYield),
                sec: [a.get(A.hi) ?? 1, a.get(A.low) ?? 1, a.get(A.nul) ?? 1],
            });
        }
    }
    implants.sort((x, y) => x[2] - y[2]);
    structures.sort((x, y) => x[2] - y[2] || x[1].localeCompare(y[1]));
    rigs.sort((x, y) => x.k.localeCompare(y.k) || x.y - y.y);
    for (const id of Object.keys(skills)) if (types.get(Number(id))?.groupID !== SKILL_GROUP) delete skills[Number(id)];

    if (ores.length < 100) throw new Error(`Datele de mining din SDE par incomplete: ${ores.length} tipuri de ore`);
    return { generated: new Date().toISOString(), source: 'sde', ores, minerals, skills, implants, structures, rigs };
}

export function writeMining(dir: string) {
    const data = buildMining(dir);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(data));
    return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const dir = process.argv[2];
    if (!dir) {
        console.error('Folosire: node scripts/mining-data.ts <folder cu SDE JSONL>');
        process.exitCode = 1;
    } else {
        const d = writeMining(dir);
        console.log(`✅ data/mining.json: ${d.ores.length} tipuri de ore, gaz și gheață`);
        console.log('✅ public/data:', publishData());
    }
}
