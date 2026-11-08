import fs from 'fs';
import path from 'path';

type Row = Record<string, any>;

export const AGENT_FILES = ['npcCharacters', 'npcStations', 'npcCorporations', 'factions', 'mapPlanets', 'mapMoons', 'mapSolarSystems'];

const DIVISIONS: Record<number, number> = { 22: 0, 23: 1, 24: 2 };
const KINDS: Record<number, number> = { 2: 0, 6: 1, 7: 1, 9: 2, 5: 3, 8: 4 };
const RESEARCH_TYPE = 4;
const RESEARCH_DIVISION = 18;
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

const en = (v: any): string => (typeof v === 'string' ? v : v?.en ?? '');

function rows(dir: string, name: string): Row[] {
    const file = fs.readdirSync(dir).find((f) => f.toLowerCase() === `${name.toLowerCase()}.jsonl`);
    if (!file) throw new Error(`Lipsește ${name}.jsonl din SDE`);
    return fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export function buildAgents(dir: string) {
    const planets = new Map<number, Row>(rows(dir, 'mapPlanets').map((r) => [r._key, r]));
    const moons = new Map<number, Row>(rows(dir, 'mapMoons').map((r) => [r._key, r]));
    const systems = new Set<number>(rows(dir, 'mapSolarSystems').map((r) => r._key));
    const corpRows = new Map<number, Row>(rows(dir, 'npcCorporations').map((r) => [r._key, r]));
    const factionRows = new Map<number, Row>(rows(dir, 'factions').map((r) => [r._key, r]));
    const stationRows = new Map<number, Row>(rows(dir, 'npcStations').map((r) => [r._key, r]));
    const where = (s: Row) => {
        const moon = moons.get(s.orbitID);
        const planet = planets.get(moon ? moon.orbitID : s.orbitID);
        const p = planet ? ROMAN[planet.celestialIndex] ?? String(planet.celestialIndex) : '';
        return moon ? `${p} - Moon ${moon.orbitIndex}` : p;
    };
    const agents: (string | number)[][] = [];
    const corps: Record<number, [string, number]> = {};
    const factions: Record<number, string> = {};
    const stations: Record<number, [number, string]> = {};
    const rd: (string | number | number[])[][] = [];
    for (const c of rows(dir, 'npcCharacters')) {
        const a = c.agent;
        const research = !!a && a.agentTypeID === RESEARCH_TYPE && a.divisionID === RESEARCH_DIVISION;
        if (!a || (!research && (!(a.divisionID in DIVISIONS) || !(a.agentTypeID in KINDS)))) continue;
        const corp = corpRows.get(c.corporationID);
        if (!corp) continue;
        let system = 0;
        let place = 0;
        if (systems.has(c.locationID)) system = c.locationID;
        else {
            const s = stationRows.get(c.locationID);
            if (!s) continue;
            system = s.solarSystemID;
            place = c.locationID;
            stations[place] ??= [system, where(s)];
        }
        corps[c.corporationID] ??= [en(corp.name), corp.factionID ?? 0];
        if (corp.factionID && !factions[corp.factionID]) factions[corp.factionID] = en(factionRows.get(corp.factionID)?.name);
        if (research) rd.push([c._key, en(c.name), c.corporationID, a.level, system, place, (c.skills ?? []).map((k: Row) => k.typeID)]);
        else agents.push([c._key, en(c.name), c.corporationID, DIVISIONS[a.divisionID], a.level, system, place, KINDS[a.agentTypeID], a.isLocator ? 1 : 0]);
    }
    agents.sort((x, y) => Number(x[0]) - Number(y[0]));
    rd.sort((x, y) => Number(x[0]) - Number(y[0]));
    return { corps, factions, stations, agents, rd };
}
