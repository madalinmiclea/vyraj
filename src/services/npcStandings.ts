import type { Sde } from '../data/sde';
import type { Character } from '../character/characters';
import { hasScope } from '../character/sso';
import { npcStandings } from '../character/esi';
import { STANDING_NEEDED, type AgentData } from './agents';

export const STANDINGS_SCOPE = 'esi-characters.read_standings.v1';

export type StandingKind = 'agent' | 'npc_corp' | 'faction';
export type StandingSkill = 'connections' | 'diplomacy' | 'criminal' | '';

export interface NpcStandings { at: number; agent: Map<number, number>; corp: Map<number, number>; faction: Map<number, number> }

export interface SocialSkills { connections: number; diplomacy: number; criminal: number }

export const PIRATE_FACTIONS = new Set([500010, 500011, 500012, 500019, 500020]);

const cache = new Map<number, NpcStandings>();
const pending = new Map<number, Promise<NpcStandings>>();

export const canReadNpcStandings = (characterId: number) => hasScope(characterId, STANDINGS_SCOPE);

export function cachedNpcStandings(characterId: number): NpcStandings | null {
  return cache.get(characterId) ?? null;
}

export function loadNpcStandings(characterId: number, force = false): Promise<NpcStandings> {
  const hit = cache.get(characterId);
  if (!force && hit && Date.now() - hit.at < 15 * 60 * 1000) return Promise.resolve(hit);
  const run = pending.get(characterId);
  if (run) return run;
  const p = npcStandings(characterId)
    .then((list) => {
      const out: NpcStandings = { at: Date.now(), agent: new Map(), corp: new Map(), faction: new Map() };
      for (const s of list) {
        if (s.from_type === 'agent') out.agent.set(s.from_id, s.standing);
        else if (s.from_type === 'npc_corp') out.corp.set(s.from_id, s.standing);
        else if (s.from_type === 'faction') out.faction.set(s.from_id, s.standing);
      }
      cache.set(characterId, out);
      return out;
    })
    .finally(() => pending.delete(characterId));
  pending.set(characterId, p);
  return p;
}

export function socialSkills(sde: Sde, c: Character): SocialSkills {
  const lvl = (name: string) => {
    const id = sde.findType(name)?.id;
    return id ? c.skills.get(id) ?? 0 : 0;
  };
  return { connections: lvl('Connections'), diplomacy: lvl('Diplomacy'), criminal: lvl('Criminal Connections') };
}

export function skillFor(base: number, faction: number): StandingSkill {
  if (base < 0) return 'diplomacy';
  return PIRATE_FACTIONS.has(faction) ? 'criminal' : 'connections';
}

export function effective(base: number | undefined, faction: number, skills: SocialSkills): number {
  const b = base ?? 0;
  const sk = skillFor(b, faction);
  const level = sk ? skills[sk] : 0;
  return Math.min(10, b + (10 - b) * 0.04 * level);
}

export interface Access { level: number; blocked: boolean; best: number; corp: number; faction: number; agent: number | null }

export function corpAccess(st: NpcStandings, skills: SocialSkills, corpId: number, factionId: number, agentId?: number): Access {
  const corp = effective(st.corp.get(corpId), factionId, skills);
  const faction = effective(st.faction.get(factionId), factionId, skills);
  const agent = agentId != null ? effective(st.agent.get(agentId), factionId, skills) : null;
  const all = agent == null ? [corp, faction] : [corp, faction, agent];
  const best = Math.max(...all);
  const blocked = all.some((x) => x <= -2);
  let level = 0;
  if (!blocked) for (const l of [1, 2, 3, 4, 5]) if (l === 1 || best >= STANDING_NEEDED[l]) level = l;
  return { level, blocked, best, corp, faction, agent };
}

export function factionOfCorp(d: AgentData, corpId: number): number {
  return d.corps.get(corpId)?.faction ?? 0;
}
