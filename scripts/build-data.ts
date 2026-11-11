import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { downloadSde, generateSkins, readJsonl } from './skin-data.ts';
import { publishData, RAW_DIR } from './publish-data.ts';
import { buildDescriptions } from './description-data.ts';

type Row = Record<string, any>;

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

const FIT_CATEGORIES = new Set([
    6,
    7,
    8,
    16,
    18,
    20,
    32,
    87,
]);

const MODE_GROUP = 1306;

const WEATHER_ENVIRONMENTS: Record<string, [string, number]> = {
    electric_storm: ['electrical', 47865],
    darkness: ['dark', 47863],
    caustic_toxin: ['exotic', 47862],
    infernal: ['firestorm', 47864],
    xenon_gas: ['gamma', 47866],
};

const TYPE_FIELD_ATTRS: Record<string, [number, number]> = { mass: [4, 0], capacity: [38, 0], volume: [161, 0], radius: [162, 1] };

const en = (v: any): string => (typeof v === 'string' ? v : v?.en ?? v?.['en-us'] ?? '');

const table = (dir: string, name: string): Row => Object.fromEntries(readJsonl(dir, name));

function sdeBuild(dir: string): number | undefined {
    const file = fs.readdirSync(dir).find((f) => f.toLowerCase() === '_sde.jsonl');
    if (!file) return undefined;
    return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').split('\n')[0]).buildNumber;
}

const plainText = (v: any): string => en(v).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function bonusLines(list: Row[] | undefined, units: Row): [string, string][] {
    return [...(list ?? [])]
        .sort((a, b) => (a.importance ?? 0) - (b.importance ?? 0))
        .map((b) => {
            const text = plainText(b.bonusText);
            if (b.bonus == null) return ['', `·${text}`];
            const value = Number.isInteger(b.bonus) ? String(b.bonus) : String(Number(b.bonus.toFixed(4)));
            return [`${value}${b.unitID ? en(units[b.unitID]?.displayName) : ''}`, text];
        });
}

function buildTraits(typeBonus: Row, types: Row, units: Row): Record<string, [string, [string, string][]][]> {
    const out: Record<string, [string, [string, string][]][]> = {};
    for (const [id, tb] of Object.entries(typeBonus)) {
        const groups: [string, [string, string][]][] = [];
        for (const s of tb.types ?? []) groups.push([`${en(types[s._key]?.name)} bonuses (per skill level):`, bonusLines(s._value, units)]);
        if (tb.roleBonuses?.length) groups.push(['Role Bonus:', bonusLines(tb.roleBonuses, units)]);
        if (tb.miscBonuses?.length) groups.push(['Misc bonus:', bonusLines(tb.miscBonuses, units)]);
        if (groups.length) out[id] = groups;
    }
    return out;
}

async function generate(dir: string) {
    console.log('⏳ Citesc SDE-ul oficial...');
    const types = table(dir, 'types');
    const typeDogma = table(dir, 'typeDogma');
    const groups = table(dir, 'groups');
    const categories = table(dir, 'categories');
    const marketGroups = table(dir, 'marketGroups');
    const attributes = table(dir, 'dogmaAttributes');
    const effects = table(dir, 'dogmaEffects');
    const cloneGrades = table(dir, 'cloneGrades');
    const units = table(dir, 'dogmaUnits');
    const dynamic = table(dir, 'dynamicItemAttributes');
    const buffs = table(dir, 'dbuffCollections');
    const typeBonus = table(dir, 'typeBonus');

    const rootCache: Record<number, string> = {};
    const rootName = (groupId: number): string => {
        if (rootCache[groupId]) return rootCache[groupId];
        let id = groupId;
        while (marketGroups[id]?.parentGroupID) id = marketGroups[id].parentGroupID;
        return (rootCache[groupId] = en(marketGroups[id]?.name) || 'Other');
    };

    const items: { n: string; c: string; t: number; m: number }[] = [];
    for (const [typeId, t] of Object.entries(types)) {
        const name = en(t.name);
        if (!name || !t.published || !t.marketGroupID) continue;
        items.push({ n: name, c: rootName(t.marketGroupID), t: Number(typeId), m: t.marketGroupID });
    }
    items.sort((a, b) => a.n.localeCompare(b.n));
    const usedMarketGroups: Record<number, [string, number]> = {};
    for (const it of items) {
        for (let id = it.m; id && !usedMarketGroups[id] && marketGroups[id]; id = marketGroups[id].parentGroupID) {
            usedMarketGroups[id] = [en(marketGroups[id].name), marketGroups[id].parentGroupID ?? 0];
        }
    }
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(path.join(RAW_DIR, 'items.json'), JSON.stringify({ items, groups: usedMarketGroups }));
    console.log(`✅ data/items.json: ${items.length} iteme de market`);

    const traits = buildTraits(typeBonus, types, units);
    fs.writeFileSync(path.join(RAW_DIR, 'traits.json'), JSON.stringify(traits));
    console.log(`✅ data/traits.json: ${Object.keys(traits).length} nave`);

    const descriptions = buildDescriptions(types, groups, FIT_CATEGORIES, en);
    fs.writeFileSync(path.join(RAW_DIR, 'descriptions.json'), JSON.stringify(descriptions));
    console.log(`✅ data/descriptions.json: ${Object.keys(descriptions).length} descrieri`);

    const outTypes: Row[] = [];
    const usedEffects = new Set<number>();
    const usedGroups = new Set<number>();

    for (const [typeId, t] of Object.entries(types)) {
        const group = groups[t.groupID];
        if (!group || !FIT_CATEGORIES.has(group.categoryID)) continue;
        if (!t.published && t.groupID !== MODE_GROUP) continue;
        const dogma = typeDogma[typeId] || { dogmaAttributes: [], dogmaEffects: [] };

        const a: Record<number, number> = {};
        for (const { attributeID, value } of dogma.dogmaAttributes ?? []) a[attributeID] = value;
        for (const [field, [attrId, fallback]] of Object.entries(TYPE_FIELD_ATTRS)) {
            if (a[attrId] == null) a[attrId] = t[field] ?? fallback;
        }
        const e: number[] = (dogma.dogmaEffects ?? []).map((x: Row) => x.effectID);
        e.forEach((id) => usedEffects.add(id));
        usedGroups.add(t.groupID);

        outTypes.push({
            i: Number(typeId),
            n: en(t.name),
            g: t.groupID,
            mg: t.marketGroupID ?? undefined,
            mt: t.metaGroupID ?? undefined,
            ml: t.metaLevel ?? undefined,
            vp: t.variationParentTypeID ?? undefined,
            r: t.raceID ?? undefined,
            f: t.factionID ?? undefined,
            a,
            e,
        });
    }

    const outEffects: Row[] = [];
    for (const id of usedEffects) {
        const ef = effects[id];
        if (!ef) continue;
        const mods = (ef.modifierInfo || []).map((m: Row) => ({
            f: m.func,
            d: m.domain,
            op: m.operation,
            to: m.modifiedAttributeID,
            from: m.modifyingAttributeID,
            g: m.groupID,
            s: m.skillTypeID,
        }));
        outEffects.push({
            i: Number(id),
            n: ef.name,
            cat: ef.effectCategoryID,
            mods,
            dur: ef.durationAttributeID ?? undefined,
            dis: ef.dischargeAttributeID ?? undefined,
            rng: ef.rangeAttributeID ?? undefined,
            fal: ef.falloffAttributeID ?? undefined,
            res: ef.resistanceAttributeID ?? undefined,
        });
    }

    const outAttrs: Row[] = [];
    for (const id of Object.keys(attributes)) {
        const at = attributes[id];
        if (!at) continue;
        outAttrs.push({
            i: Number(id),
            n: at.name,
            dn: en(at.displayName) || undefined,
            pub: at.published ? 1 : undefined,
            z: at.displayWhenZero ? 1 : undefined,
            cat: at.attributeCategoryID ?? undefined,
            def: at.defaultValue ?? 0,
            st: at.stackable ? 1 : 0,
            hi: at.highIsGood ? 1 : 0,
            max: at.maxAttributeID ?? undefined,
            u: at.unitID ?? undefined,
        });
    }

    const outGroups = [...usedGroups].map((id) => ({ i: Number(id), n: en(groups[id].name), c: groups[id].categoryID }));
    const outCategories = [...FIT_CATEGORIES].map((id) => ({ i: id, n: en(categories[id]?.name) }));
    const outClones = Object.entries(cloneGrades as Row).map(([id, c]) => ({
        i: Number(id),
        n: c.name,
        skills: Object.fromEntries(c.skills.map((s: Row) => [s.typeID, s.level])),
    }));

    const typeIds = new Set(outTypes.map((t) => t.i));
    const outMutaplasmids = Object.entries(dynamic as Row)
        .filter(([id]) => types[id]?.published !== false && en(types[id]?.name))
        .map(([id, d]) => ({
            i: Number(id),
            n: en(types[id].name),
            a: Object.fromEntries((d.attributeIDs as Row[]).map((r) => [r._key, [r.min, r.max]])),
            m: d.inputOutputMapping
                .map((x: Row) => ({ from: (x.applicableTypes as number[]).filter((t) => typeIds.has(t)), to: x.resultingType as number }))
                .filter((x: { from: number[]; to: number }) => x.from.length && typeIds.has(x.to)),
        }))
        .filter((x) => x.m.length);

    const outBuffs = Object.entries(buffs as Row).map(([id, b]) => ({
        i: Number(id),
        n: en(b.displayName) || undefined,
        op: b.operationName,
        agg: b.aggregateMode,
        item: (b.itemModifiers ?? []).map((m: Row) => m.dogmaAttributeID),
        loc: (b.locationModifiers ?? []).map((m: Row) => m.dogmaAttributeID),
        locGroup: (b.locationGroupModifiers ?? []).map((m: Row) => [m.dogmaAttributeID, m.groupID]),
        locSkill: (b.locationRequiredSkillModifiers ?? []).map((m: Row) => [m.dogmaAttributeID, m.skillID]),
    }));

    const attrIdByName = new Map(Object.entries(attributes as Row).map(([id, at]) => [at.name, Number(id)]));
    const outWeathers = Object.entries(types as Row).flatMap(([id, t]) => {
        const m = /^([a-z_]+)_weather_(\d)$/.exec(en(t.name));
        const env = m ? WEATHER_ENVIRONMENTS[m[1]] : undefined;
        if (!m || !env) return [];
        const a: Record<number, number> = {};
        for (const { attributeID, value } of typeDogma[id]?.dogmaAttributes ?? []) a[attributeID] = value;
        const b: [number, number][] = [];
        for (let n = 1; n <= 4; n++) {
            const buff = a[attrIdByName.get(`warfareBuff${n}ID`) ?? -1];
            const value = a[attrIdByName.get(`warfareBuff${n}Value`) ?? -1];
            if (buff > 0 && value) b.push([buff, value]);
        }
        return b.length ? [{ k: env[0], i: Number(id), n: en(types[env[1]]?.name) || env[0], lvl: Number(m[2]), b }] : [];
    }).sort((x, y) => x.k.localeCompare(y.k) || x.lvl - y.lvl);

    const build = sdeBuild(dir);
    const sde = {
        version: { build, generated: new Date().toISOString() },
        categories: outCategories,
        groups: outGroups,
        attributes: outAttrs,
        effects: outEffects,
        types: outTypes,
        cloneGrades: outClones,
        mutaplasmids: outMutaplasmids,
        buffs: outBuffs,
        weathers: outWeathers,
        units: Object.fromEntries(Object.entries(units as Row).map(([id, u]) => [id, en(u.displayName)]).filter(([, n]) => n)),
    };

    const low = ([
        ['iteme de market', items.length, 15000],
        ['iteme de fitting', outTypes.length, 6000],
        ['iteme de fitting cu nume', outTypes.filter((t) => t.n).length, 6000],
        ['iteme de fitting cu efecte', outTypes.filter((t) => t.e.length).length, 6000],
        ['atribute', outAttrs.length, 2300],
        ['efecte', outEffects.length, 2200],
        ['efecte cu modificatori', outEffects.filter((e) => e.mods.length).length, 2000],
    ] as [string, number, number][]).filter(([, n, min]) => n < min);
    if (low.length) throw new Error(`SDE incomplet, nu public nimic: ${low.map(([what, n, min]) => `${what} ${n} (minim ${min})`).join(', ')}`);

    const file = path.join(RAW_DIR, 'sde.json');
    fs.writeFileSync(file, JSON.stringify(sde));
    const mb = (fs.statSync(file).size / 1e6).toFixed(1);
    console.log(`✅ data/sde.json: ${outTypes.length} iteme, ${outAttrs.length} atribute, ${outEffects.length} efecte (${mb} MB, build ${build})`);
}

if (process.argv.includes('--if-missing') && fs.existsSync('public/data/manifest.json')) process.exit(0);

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eve-sde-'));
    try {
        console.log('⏳ Descarc SDE-ul oficial...');
        await downloadSde(dir);
        await generate(dir);
        const d = await generateSkins(dir);
        console.log(`✅ data/skins.json: ${d.lines.length} colecții SKIN`);
        console.log('✅ public/data:', publishData());
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

main().catch((e: Error) => {
    console.error('Eroare:', e.message);
    process.exitCode = 1;
});
