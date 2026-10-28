import { universeNames, typeInfo, groupInfo } from '../character/esi';
import { loadJson, saveJson } from '../storage';
import { FACTIONS, type Faction } from './missions';

export interface NpcInfo { id: number; name: string; group: string; faction?: Faction }

const KEY = 'eve-tools:npc-info';

const KEYWORDS: [RegExp, string][] = [
  [/guristas/i, 'guristas'], [/angel/i, 'angel'], [/blood raider/i, 'blood'], [/sansha/i, 'sansha'], [/serpentis/i, 'serpentis'],
  [/rogue drone|\bdrone\b/i, 'drones'], [/mordu/i, 'mordu'], [/mercenar/i, 'mercs'], [/thukker/i, 'thukker'], [/khanid/i, 'khanid'],
  [/ammatar/i, 'ammatar'], [/amarr/i, 'amarr'], [/caldari/i, 'caldari'], [/gallente/i, 'gallente'], [/minmatar/i, 'minmatar'],
];

type Packed = [string, string, string];

const factionOf = (id: string) => FACTIONS.find((f) => f.id === id);

function unpack(id: number, [name, group, faction]: Packed): NpcInfo {
  return { id, name, group, faction: faction ? factionOf(faction) : undefined };
}

export async function npcInfo(ids: number[]): Promise<Map<number, NpcInfo>> {
  const cache = loadJson<Record<string, Packed>>(KEY, {});
  const missing = [...new Set(ids)].filter((id) => !cache[id]);
  if (missing.length) {
    const names = await universeNames(missing).catch(() => new Map<number, string>());
    await Promise.all(missing.map(async (id) => {
      const t = await typeInfo(id);
      const g = t ? await groupInfo(t.group_id) : null;
      const name = names.get(id) ?? t?.name ?? '';
      if (!name) return;
      const raw = g?.name ?? '';
      const faction = KEYWORDS.find(([re]) => re.test(raw) || re.test(name))?.[1] ?? '';
      cache[id] = [name, raw.replace(/^(Asteroid|Deadspace|Mission)\s+/i, ''), faction];
    }));
    saveJson(KEY, cache);
  }
  return new Map(ids.map((id) => [id, cache[id] ? unpack(id, cache[id]) : { id, name: `#${id}`, group: '' }]));
}
