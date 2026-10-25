type Row = Record<string, any>;

const DECRYPTOR_GROUP = 1304;
const DEC_ATTRS = { prob: 1112, me: 1113, te: 1114, runs: 1124 };

const en = (v: any): string => (typeof v === 'string' ? v : v?.en ?? v?.['en-us'] ?? '');
const pairs = (list: Row[] | undefined, key: string) => (list ?? []).flatMap((x) => [Number(x.typeID), Number(x[key])]);

export function buildIndustry(read: (name: string) => Map<number, Row>) {
    const blueprints = read('blueprints');
    const types = read('types');
    const groups = read('groups');
    const categories = read('categories');
    const dogma = read('typeDogma');

    const live = (id: number) => {
        const t = types.get(id);
        return Boolean(t && t.published !== false && en(t.name ?? t.typeName));
    };
    const used = new Set<number>();
    const usedGroups = new Set<number>();
    const bps: (number | number[])[][] = [];
    const inv: (number | number[] | (number | number[])[])[][] = [];
    const encryption = (skills: number[]) => {
        for (let i = 0; i < skills.length; i += 2) if (/Encryption Methods$/i.test(en(types.get(skills[i])?.name))) return skills[i];
        return 0;
    };

    for (const [bpId, b] of blueprints) {
        if (!live(bpId)) continue;
        const acts = b.activities ?? {};
        for (const [kind, act] of [[0, acts.manufacturing], [1, acts.reaction]] as [number, Row | undefined][]) {
            const product = act?.products?.[0];
            if (!product || !live(Number(product.typeID)) || !act!.materials?.length) continue;
            const mats = pairs(act!.materials, 'quantity');
            const skills = pairs(act!.skills, 'level');
            const pid = Number(product.typeID);
            [bpId, pid, ...mats.filter((_, i) => i % 2 === 0), ...skills.filter((_, i) => i % 2 === 0)].forEach((id) => used.add(id));
            const gid = types.get(pid)!.groupID;
            usedGroups.add(gid);
            bps.push([bpId, pid, Number(product.quantity) || 1, Number(act!.time) || 0, Number(b.maxProductionLimit) || 0, kind, mats, skills]);
        }
        const iv = acts.invention;
        const outs = (iv?.products ?? []).filter((p: Row) => live(Number(p.typeID)));
        if (iv && outs.length) {
            const mats = pairs(iv.materials, 'quantity');
            const skills = pairs(iv.skills, 'level');
            [...mats.filter((_, i) => i % 2 === 0), ...skills.filter((_, i) => i % 2 === 0)].forEach((id) => used.add(id));
            inv.push([bpId, Number(iv.time) || 0, mats, skills, encryption(skills), outs.map((p: Row) => [Number(p.typeID), Number(p.probability) || 0, Number(p.quantity) || 1])]);
        }
    }

    const decryptors: [number, number, number, number, number][] = [];
    for (const [id, t] of types) {
        if (t.groupID !== DECRYPTOR_GROUP || !live(id)) continue;
        const a: Record<number, number> = {};
        for (const x of dogma.get(id)?.dogmaAttributes ?? []) a[x.attributeID] = x.value;
        if (a[DEC_ATTRS.prob] == null) continue;
        used.add(id);
        decryptors.push([id, a[DEC_ATTRS.prob], a[DEC_ATTRS.me] ?? 0, a[DEC_ATTRS.te] ?? 0, a[DEC_ATTRS.runs] ?? 0]);
    }

    const names: Record<number, string> = {};
    for (const id of used) names[id] = en(types.get(id)?.name ?? types.get(id)?.typeName);
    const productGroups: Record<number, [string, string]> = {};
    for (const gid of usedGroups) {
        const g = groups.get(gid);
        productGroups[gid] = [en(g?.name), en(categories.get(g?.categoryID)?.name)];
    }
    const groupOf: Record<number, number> = {};
    for (const b of bps) groupOf[b[1] as number] = types.get(b[1] as number)!.groupID;
    if (bps.length < 3000) throw new Error(`Blueprint-urile din SDE par incomplete: ${bps.length}`);
    return { generated: new Date().toISOString(), source: 'sde', bps, inv, decryptors, names, groups: productGroups, groupOf };
}
