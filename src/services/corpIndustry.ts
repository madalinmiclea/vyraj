import { hasScope } from '../character/sso';
import { authedPages, corporationOf, corporationRoles, isPlayerCorp, CORP_SCOPES } from './corporation';
import type { IndustryJob } from './industry';

export const CORP_JOBS_SCOPE = 'esi-industry.read_corporation_jobs.v1';
export const JOB_ROLES = ['Director', 'Factory_Manager'];

export interface CorpJob extends IndustryJob {
  installer_id: number;
  location_id: number;
  output_location_id?: number;
  completed_date?: string;
  completed_character_id?: number;
  successful_runs?: number;
}

export type CorpJobsAccess =
  | { state: 'scope' }
  | { state: 'npc' }
  | { state: 'role'; roles: string[] }
  | { state: 'ok'; corporationId: number };

export async function corpJobsAccess(characterId: number): Promise<CorpJobsAccess> {
  if (!hasScope(characterId, CORP_JOBS_SCOPE) || !hasScope(characterId, CORP_SCOPES.roles)) return { state: 'scope' };
  const corporationId = await corporationOf(characterId);
  if (!isPlayerCorp(corporationId)) return { state: 'npc' };
  const roles = await corporationRoles(characterId);
  return roles.some((r) => JOB_ROLES.includes(r)) ? { state: 'ok', corporationId: corporationId! } : { state: 'role', roles };
}

const cache = new Map<string, { at: number; jobs: Promise<CorpJob[]> }>();

export function corpJobs(characterId: number, corporationId: number, completed: boolean, fresh = false): { at: number; jobs: Promise<CorpJob[]> } {
  const key = `${characterId}:${corporationId}:${completed}`;
  let hit = cache.get(key);
  if (!hit || fresh) {
    const jobs = authedPages<CorpJob>(characterId, `/corporations/${corporationId}/industry/jobs/?include_completed=${completed}`, 10);
    hit = { at: Date.now(), jobs };
    cache.set(key, hit);
    jobs.catch(() => cache.delete(key));
  }
  return hit;
}
