import fs from 'fs';
import path from 'path';

type Row = Record<string, any>;

export const ACTIVITY_FILES = ['militaryCampaigns', 'militaryCampaignObjectives', 'characterTitles', 'mercenaryTacticalOperations', 'skinrComponents', 'skinrComponentCategories', 'skinrComponentRarities'];

const en = (v: any): string => (typeof v === 'string' ? v : v?.en ?? '');
const plain = (v: any): string => en(v).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function rows(dir: string, name: string): Row[] {
    const file = fs.readdirSync(dir).find((f) => f.toLowerCase() === `${name.toLowerCase()}.jsonl`);
    if (!file) throw new Error(`Lipsește ${name}.jsonl din SDE`);
    return fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export function buildActivities(dir: string) {
    const campaigns: Record<string, Row> = {};
    for (const c of rows(dir, 'militaryCampaigns')) {
        campaigns[c._key] = {
            title: plain(c.title),
            subtitle: plain(c.subtitle),
            goal: plain(c.annotations?.briefingGoalDescription),
            success: plain(c.annotations?.briefingSuccessDescription),
            faction: c.issuer?.factionID ?? 0,
            target: c.targetProgress ?? 0,
        };
    }
    const objectives: Record<string, Row> = {};
    for (const o of rows(dir, 'militaryCampaignObjectives')) {
        const r = o.rewards ?? {};
        objectives[o._key] = {
            campaign: o.campaignID,
            title: plain(o.title),
            subtitle: plain(o.subtitle),
            career: o.careerPath ?? '',
            target: o.targetProgress ?? 0,
            perPilot: o.maxProgressPerParticipant ?? 0,
            isk: r.isk ? r.isk.amountPerInterval / (r.isk.progressInterval || 1) : 0,
            lp: r.lp ? r.lp.amountPerInterval / (r.lp.progressInterval || 1) : 0,
            lpCorp: r.lp?.issuer?.corporationID ?? 0,
        };
    }
    const titles: Record<string, string> = {};
    for (const t of rows(dir, 'characterTitles')) titles[t._key] = en(t.name);
    const operations: Record<string, Row> = {};
    for (const m of rows(dir, 'mercenaryTacticalOperations')) {
        operations[m._key] = { name: en(m.name), description: plain(m.description), anarchy: m.anarchyImpact ?? 0, development: m.developmentImpact ?? 0, infomorphs: m.infomorphBonus ?? 0 };
    }
    const categories = new Map(rows(dir, 'skinrComponentCategories').map((c) => [Number(c._key), en(c.name)]));
    const rarities = new Map(rows(dir, 'skinrComponentRarities').map((c) => [Number(c._key), en(c.name)]));
    const components: Record<string, Row> = {};
    for (const s of rows(dir, 'skinrComponents')) {
        if (s.published === false) continue;
        components[s._key] = { name: en(s.name), category: categories.get(s.category) ?? '', rarity: rarities.get(s.rarity) ?? '', finish: s.finish ?? '' };
    }
    return { campaigns, objectives, titles, operations, components };
}
