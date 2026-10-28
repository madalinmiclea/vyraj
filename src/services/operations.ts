import { accessToken } from '../character/sso';
import { dataMissing, fetchData } from '../data/manifest';
import { ESI, esiFetch } from './esiClient';

export const FREELANCE_SCOPE = 'esi-characters.read_freelance_jobs.v1';
export const CAMPAIGN_SCOPE = 'esi.activity.char:read';
export const DENS_SCOPE = 'esi-structures.read_character.v1';
export const MTO_SCOPE = 'esi-activities.read_character.v1';
export const SKINR_SCOPE = 'esi.cosmetic.char:read';

export interface CampaignInfo { title: string; subtitle: string; goal: string; success: string; faction: number; target: number }
export interface ObjectiveInfo { campaign: string; title: string; subtitle: string; career: string; target: number; perPilot: number; isk: number; lp: number; lpCorp: number }
export interface OperationInfo { name: string; description: string; anarchy: number; development: number; infomorphs: number }
export interface ComponentInfo { name: string; category: string; rarity: string; finish: string }
export interface Activities {
  campaigns: Record<string, CampaignInfo>;
  objectives: Record<string, ObjectiveInfo>;
  titles: Record<string, string>;
  operations: Record<string, OperationInfo>;
  components: Record<string, ComponentInfo>;
}

let activities: Promise<Activities> | null = null;

export function loadActivities(): Promise<Activities> {
  activities ??= fetchData('activities').then((res) => {
    if (!res.ok) throw dataMissing(res.url);
    return res.json() as Promise<Activities>;
  });
  activities.catch(() => { activities = null; });
  return activities;
}

async function publicJson<T>(path: string): Promise<T> {
  const res = await esiFetch(`${ESI}${path}`);
  if (!res.ok) throw new Error(`ESI ${path.split('?')[0]}: ${res.status}`);
  return (await res.json()) as T;
}

async function authed<T>(characterId: number, path: string): Promise<T> {
  const token = await accessToken(characterId);
  const res = await esiFetch(`${ESI}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`ESI ${path.split('?')[0]}: ${res.status}`);
  return (await res.json()) as T;
}

async function walk<T>(get: (cursor: string) => Promise<{ cursor?: { before?: string }; rows: T[] }>, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  let cursor = '0';
  for (let i = 0; i < maxPages; i++) {
    const page = await get(cursor);
    if (!page.rows.length) break;
    out.push(...page.rows);
    if (!page.cursor?.before) break;
    cursor = page.cursor.before;
  }
  const seen = new Map<string, T>();
  for (const r of out) seen.set((r as { id: string }).id, r);
  return [...seen.values()];
}

export type JobState = 'Unspecified' | 'Active' | 'Closed' | 'Completed' | 'Expired' | 'Deleted';

export interface FreelanceJob {
  id: string;
  name: string;
  state: JobState;
  last_modified: string;
  progress: { current: number; desired: number };
  reward?: { initial: number; remaining: number };
}

export interface FreelanceDetail extends FreelanceJob {
  details: { career: string; created: string; description: string; expires?: string; finished?: string; creator: { character: { id: number; name: string }; corporation: { id: number; name: string } } };
  contribution?: { reward_per_contribution?: number; max_committed_participants: number; contribution_per_participant_limit?: number };
  access_and_visibility: { acl_protected: boolean; broadcast_locations?: { id: number; name: string }[]; restrictions?: { minimum_age?: number; maximum_age?: number } };
  configuration: { method: string };
}

let jobs: { at: number; list: FreelanceJob[] } | null = null;

export async function freelanceJobs(force = false): Promise<{ at: number; list: FreelanceJob[] }> {
  if (!force && jobs && Date.now() - jobs.at < 10 * 60 * 1000) return jobs;
  const list = await walk<FreelanceJob>(async (cursor) => {
    const r = await publicJson<{ cursor?: { before?: string }; freelance_jobs: FreelanceJob[] }>(`/freelance-jobs?limit=100&before=${encodeURIComponent(cursor)}`);
    return { cursor: r.cursor, rows: r.freelance_jobs };
  }, 30);
  jobs = { at: Date.now(), list };
  return jobs;
}

const jobDetails = new Map<string, Promise<FreelanceDetail>>();

export function freelanceJob(id: string, characterId?: number | null): Promise<FreelanceDetail> {
  let hit = jobDetails.get(id);
  if (!hit) {
    hit = characterId ? authed<FreelanceDetail>(characterId, `/freelance-jobs/${id}`) : publicJson<FreelanceDetail>(`/freelance-jobs/${id}`);
    hit.catch(() => jobDetails.delete(id));
    jobDetails.set(id, hit);
  }
  return hit;
}

export interface MyJob extends FreelanceJob { participation?: { contributed: number; state: string } }

export async function myFreelanceJobs(characterId: number): Promise<MyJob[]> {
  const r = await authed<{ freelance_jobs: FreelanceJob[] }>(characterId, `/characters/${characterId}/freelance-jobs`);
  return Promise.all((r.freelance_jobs ?? []).map(async (j) => ({
    ...j,
    participation: await authed<{ contributed: number; state: string }>(characterId, `/characters/${characterId}/freelance-jobs/${j.id}/participation`).catch(() => undefined),
  })));
}

export interface Campaign { id: string; state: string; progress: number; started?: string; finished?: string }
export interface Objective { id: string; state: string; progress: number; started?: string; finished?: string; participants: { committed: number; contributors: number; total: number } }
export interface MyObjective { id: string; campaign_id: string; contributed: number; is_committed: boolean }

let campaigns: { at: number; list: Campaign[] } | null = null;

export async function militaryCampaigns(force = false): Promise<{ at: number; list: Campaign[] }> {
  if (!force && campaigns && Date.now() - campaigns.at < 5 * 60 * 1000) return campaigns;
  const r = await publicJson<{ campaigns: Campaign[] }>('/military-campaigns');
  campaigns = { at: Date.now(), list: r.campaigns ?? [] };
  return campaigns;
}

const objectiveCache = new Map<string, { at: number; list: Objective[] }>();

export async function campaignObjectives(campaignId: string): Promise<Objective[]> {
  const hit = objectiveCache.get(campaignId);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.list;
  const list = await walk<Objective>(async (cursor) => {
    const r = await publicJson<{ cursor?: { before?: string }; objectives: Objective[] }>(`/military-campaigns/${campaignId}/objectives?limit=100&before=${encodeURIComponent(cursor)}`);
    return { cursor: r.cursor, rows: r.objectives ?? [] };
  }, 10);
  objectiveCache.set(campaignId, { at: Date.now(), list });
  return list;
}

export function myObjectives(characterId: number): Promise<MyObjective[]> {
  return walk<MyObjective>(async (cursor) => {
    const r = await authed<{ cursor?: { before?: string }; objectives: MyObjective[] }>(characterId, `/characters/${characterId}/military-campaigns/objectives?limit=100&before=${encodeURIComponent(cursor)}`);
    return { cursor: r.cursor, rows: r.objectives ?? [] };
  }, 10);
}

export type EvolutionLevel = 'Unspecified' | 'Level0' | 'Level1' | 'Level2' | 'Level3' | 'Level4';

export interface MercenaryDen {
  id: number;
  type_id: number;
  state: string;
  evolution: { anarchy: { amount: number; level: EvolutionLevel }; development: { amount: number; level: EvolutionLevel } };
  infomorphs: { amount: number };
  reinforcement_timer?: { end: string };
  skyhook: { corporation_id: number; id: number; planet_id: number };
}

export interface TacticalOperation { id: string; dungeon_type_id: number; expires: string; mercenary_den_id: number; state: string }

export async function mercenaryDens(characterId: number): Promise<MercenaryDen[]> {
  const r = await authed<{ mercenary_dens: { id: number }[] }>(characterId, `/characters/${characterId}/structures/mercenary-dens`);
  return Promise.all((r.mercenary_dens ?? []).map((d) => authed<MercenaryDen>(characterId, `/characters/${characterId}/structures/mercenary-dens/${d.id}`)));
}

export async function tacticalOperations(characterId: number): Promise<TacticalOperation[]> {
  const r = await authed<{ operations: { id: string }[] }>(characterId, `/characters/${characterId}/mercenary-tactical-operations`);
  return Promise.all((r.operations ?? []).map((o) => authed<TacticalOperation>(characterId, `/characters/${characterId}/mercenary-tactical-operations/${o.id}`)));
}

export interface SkinrLicense { skinr_id: string; activated: boolean; unactivated: number }
export interface SkinrComponentLicense { component_id: number; type: 'nanocoating' | 'pattern'; runs: { remaining?: number; unlimited?: boolean } }
export interface SkinrDesign { id: string; name: string; ship_type_id: number; creator_id: number; line?: string; tier: { level: number } }
export interface ParagonListing { id: string; skinr_id: string; seller_id: number; state: string; quantity: number; created: string; expires: string; price: { isk?: number; plex?: number } }

export async function skinrLicenses(characterId: number): Promise<SkinrLicense[]> {
  return (await authed<{ licenses: SkinrLicense[] }>(characterId, `/characters/${characterId}/cosmetics/skinr`)).licenses ?? [];
}

export async function skinrComponents(characterId: number): Promise<SkinrComponentLicense[]> {
  return (await authed<{ licenses: SkinrComponentLicense[] }>(characterId, `/characters/${characterId}/cosmetics/skinr/components`)).licenses ?? [];
}

const designs = new Map<string, Promise<SkinrDesign | null>>();

export function skinrDesign(id: string): Promise<SkinrDesign | null> {
  let hit = designs.get(id);
  if (!hit) {
    hit = publicJson<SkinrDesign>(`/cosmetics/skinr/${id}`).catch(() => null);
    designs.set(id, hit);
  }
  return hit;
}

let listings: { at: number; list: ParagonListing[] } | null = null;

export async function paragonListings(force = false): Promise<{ at: number; list: ParagonListing[] }> {
  if (!force && listings && Date.now() - listings.at < 10 * 60 * 1000) return listings;
  const r = await publicJson<{ listings: ParagonListing[] }>('/paragon-hub/skinr?limit=100&before=0');
  listings = { at: Date.now(), list: (r.listings ?? []).filter((l) => l.state === 'listed') };
  return listings;
}

export async function mySellerListings(characterId: number): Promise<ParagonListing[]> {
  return (await authed<{ listings: ParagonListing[] }>(characterId, `/characters/${characterId}/paragon-hub/skinr?limit=100&before=0`)).listings ?? [];
}

export interface CharacterPublic { name: string; corporation_id: number; alliance_id?: number; birthday: string; security_status?: number; achievement_score?: number; character_title_id?: string; corporation_title?: string }

const publicInfo = new Map<number, Promise<CharacterPublic | null>>();

export function characterPublic(characterId: number): Promise<CharacterPublic | null> {
  let hit = publicInfo.get(characterId);
  if (!hit) {
    hit = publicJson<CharacterPublic>(`/characters/${characterId}`).catch(() => null);
    publicInfo.set(characterId, hit);
  }
  return hit;
}

export type RouteHealth = 'Unknown' | 'OK' | 'Degraded' | 'Down' | 'Recovering';

export async function esiHealth(): Promise<{ method: string; path: string; status: RouteHealth }[]> {
  return (await publicJson<{ routes: { method: string; path: string; status: RouteHealth }[] }>('/meta/status')).routes;
}
