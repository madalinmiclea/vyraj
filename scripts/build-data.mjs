import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSkins } from './skin-data.mjs';
import { publishData, RAW_DIR } from './publish-data.mjs';

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

const BASE = 'https://raw.githubusercontent.com/pyfa-org/Pyfa/master/staticdata';

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

const TYPE_FIELD_ATTRS = { mass: 4, capacity: 38, volume: 161, radius: 162 };

class HttpError extends Error {
    constructor(status, url) {
        super(`${status} ${url}`);
        this.status = status;
    }
}

async function getJson(file) {
    const url = `${BASE}/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw new HttpError(res.status, url);
    return res.json();
}

async function getSplit(name) {
    const all = {};
    for (let i = 0; ; i++) {
        try {
            Object.assign(all, await getJson(`fsd_built/${name}.${i}.json`));
            console.log(`   ${name}.${i}.json`);
        } catch (e) {
            if (e.status === 404 && i > 0) break;
            throw e;
        }
    }
    return all;
}

const en = (v) => (typeof v === 'string' ? v : v?.['en-us'] ?? v?.en ?? '');

async function generate() {
    console.log('⏳ Descarcăm SDE-ul...');
    const [types, typeDogma, groups, categories, marketGroups, attributes, effects, cloneGrades, metadata, units, dynamic, buffs] = await Promise.all([
        getSplit('types'),
        getSplit('typedogma'),
        getJson('fsd_built/groups.0.json'),
        getJson('fsd_built/categories.0.json'),
        getJson('fsd_built/marketgroups.0.json'),
        getJson('fsd_built/dogmaattributes.0.json'),
        getJson('fsd_built/dogmaeffects.0.json'),
        getJson('fsd_lite/clonegrades.0.json'),
        getJson('phobos/metadata.0.json'),
        getJson('fsd_built/dogmaunits.0.json'),
        getJson('fsd_built/dynamicitemattributes.0.json'),
        getJson('fsd_lite/dbuffcollections.0.json'),
    ]);

    const rootCache = {};
    const rootName = (groupId) => {
        if (rootCache[groupId]) return rootCache[groupId];
        let id = groupId;
        while (marketGroups[id]?.parentGroupID) id = marketGroups[id].parentGroupID;
        return (rootCache[groupId] = en(marketGroups[id]?.name) || 'Other');
    };

    const items = [];
    for (const [typeId, t] of Object.entries(types)) {
        const name = en(t.typeName);
        if (!name || !t.published || !t.marketGroupID) continue;
        items.push({ n: name, c: rootName(t.marketGroupID), t: Number(typeId), m: t.marketGroupID });
    }
    items.sort((a, b) => a.n.localeCompare(b.n));
    const usedMarketGroups = {};
    for (const it of items) {
        for (let id = it.m; id && !usedMarketGroups[id] && marketGroups[id]; id = marketGroups[id].parentGroupID) {
            usedMarketGroups[id] = [en(marketGroups[id].name), marketGroups[id].parentGroupID ?? 0];
        }
    }
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(path.join(RAW_DIR, 'items.json'), JSON.stringify({ items, groups: usedMarketGroups }));
    console.log(`✅ data/items.json: ${items.length} iteme de market`);

    const outTypes = [];
    const usedEffects = new Set();
    const usedGroups = new Set();

    for (const [typeId, t] of Object.entries(types)) {
        const group = groups[t.groupID];
        if (!group || !FIT_CATEGORIES.has(group.categoryID)) continue;
        if (!t.published && t.groupID !== MODE_GROUP) continue;
        const dogma = typeDogma[typeId] || { dogmaAttributes: [], dogmaEffects: [] };

        const a = {};
        for (const { attributeID, value } of dogma.dogmaAttributes) a[attributeID] = value;
        for (const [field, attrId] of Object.entries(TYPE_FIELD_ATTRS)) {
            if (t[field] != null && a[attrId] == null) a[attrId] = t[field];
        }
        const e = dogma.dogmaEffects.map((x) => x.effectID);
        e.forEach((id) => usedEffects.add(id));
        usedGroups.add(t.groupID);

        outTypes.push({
            i: Number(typeId),
            n: en(t.typeName),
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

    const outEffects = [];
    for (const id of usedEffects) {
        const ef = effects[id];
        if (!ef) continue;
        const mods = (ef.modifierInfo || []).map((m) => ({
            f: m.func,
            d: m.domain,
            op: m.operation,
            to: m.modifiedAttributeID,
            from: m.modifyingAttributeID,
            g: m.groupID,
            s: m.skillTypeID,
        }));
        outEffects.push({
            i: ef.effectID,
            n: ef.effectName,
            cat: ef.effectCategory,
            mods,
            dur: ef.durationAttributeID ?? undefined,
            dis: ef.dischargeAttributeID ?? undefined,
            rng: ef.rangeAttributeID ?? undefined,
            fal: ef.falloffAttributeID ?? undefined,
            res: ef.resistanceAttributeID ?? undefined,
        });
    }

    const outAttrs = [];
    for (const id of Object.keys(attributes)) {
        const at = attributes[id];
        if (!at) continue;
        outAttrs.push({
            i: at.attributeID,
            n: at.name,
            dn: en(at.displayName) || undefined,
            pub: at.published ? 1 : undefined,
            z: at.displayWhenZero ? 1 : undefined,
            cat: at.categoryID ?? undefined,
            def: at.defaultValue ?? 0,
            st: at.stackable ? 1 : 0,
            hi: at.highIsGood ? 1 : 0,
            max: at.maxAttributeID ?? undefined,
            u: at.unitID ?? undefined,
        });
    }

    const outGroups = [...usedGroups].map((id) => ({ i: Number(id), n: en(groups[id].groupName ?? groups[id].name), c: groups[id].categoryID }));
    const outCategories = [...FIT_CATEGORIES].map((id) => ({ i: id, n: en(categories[id]?.categoryName ?? categories[id]?.name) }));
    const outClones = Object.entries(cloneGrades).map(([id, c]) => ({
        i: Number(id),
        n: c.internalDescription,
        skills: Object.fromEntries(c.skills.map((s) => [s.typeID, s.level])),
    }));

    const typeIds = new Set(outTypes.map((t) => t.i));
    const outMutaplasmids = Object.entries(dynamic)
        .filter(([id]) => types[id]?.published !== false && en(types[id]?.typeName))
        .map(([id, d]) => ({
            i: Number(id),
            n: en(types[id].typeName),
            a: Object.fromEntries(Object.entries(d.attributeIDs).map(([attr, r]) => [attr, [r.min, r.max]])),
            m: d.inputOutputMapping
                .map((x) => ({ from: x.applicableTypes.filter((t) => typeIds.has(t)), to: x.resultingType }))
                .filter((x) => x.from.length && typeIds.has(x.to)),
        }))
        .filter((x) => x.m.length);

    const outBuffs = Object.entries(buffs).map(([id, b]) => ({
        i: Number(id),
        n: en(b.displayName) || undefined,
        op: b.operationName,
        agg: b.aggregateMode,
        item: (b.itemModifiers ?? []).map((m) => m.dogmaAttributeID),
        loc: (b.locationModifiers ?? []).map((m) => m.dogmaAttributeID),
        locGroup: (b.locationGroupModifiers ?? []).map((m) => [m.dogmaAttributeID, m.groupID]),
        locSkill: (b.locationRequiredSkillModifiers ?? []).map((m) => [m.dogmaAttributeID, m.skillID]),
    }));

    const build = metadata.find?.((r) => r.field_name === 'client_build')?.field_value;
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
        units: Object.fromEntries(Object.entries(units).map(([id, u]) => [id, en(u.displayName)]).filter(([, n]) => n)),
    };

    const file = path.join(RAW_DIR, 'sde.json');
    fs.writeFileSync(file, JSON.stringify(sde));
    const mb = (fs.statSync(file).size / 1e6).toFixed(1);
    console.log(`✅ data/sde.json: ${outTypes.length} iteme, ${outAttrs.length} atribute, ${outEffects.length} efecte (${mb} MB, build ${build})`);
}

if (process.argv.includes('--if-missing') && fs.existsSync('public/data/manifest.json')) process.exit(0);

generate()
    .then(() => generateSkins())
    .then((d) => console.log(`✅ data/skins.json: ${d.lines.length} colecții SKIN`))
    .then(() => console.log('✅ public/data:', publishData()))
    .catch((e) => {
    console.error('Eroare:', e.message);
    process.exitCode = 1;
});
