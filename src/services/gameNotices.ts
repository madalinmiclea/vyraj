import { accessToken, hasScope } from '../character/sso';
import { rosterCharacters } from '../character/roster';
import { ESI, esiFetch } from './esiClient';
import { loadJson, saveJson } from '../storage';
import { tx } from '../i18n';
import { deliver, kindOn, type NoticeKind } from './notices';

export const GAME_SCOPE = 'esi-characters.read_notifications.v1';
const SEEN_KEY = 'eve-notify:game-seen';
const FETCH_MS = 10 * 60_000;

export interface GameNotice { notification_id: number; sender_id: number; sender_type: string; text?: string; timestamp: string; type: string; is_read?: boolean }

const cache = new Map<number, { at: number; list: GameNotice[] }>();

export const gameCharacters = () => rosterCharacters().filter((c) => c.characterId != null && hasScope(c.characterId, GAME_SCOPE));

export async function gameNotices(characterId: number, force = false): Promise<GameNotice[]> {
  const hit = cache.get(characterId);
  if (!force && hit && Date.now() - hit.at < FETCH_MS) return hit.list;
  const token = await accessToken(characterId);
  const res = await esiFetch(`${ESI}/characters/${characterId}/notifications/`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`ESI notifications: ${res.status}`);
  const list = ((await res.json()) as GameNotice[]).sort((a, b) => b.notification_id - a.notification_id);
  cache.set(characterId, { at: Date.now(), list });
  return list;
}

export function gameKind(type: string): NoticeKind {
  if (/^(KillReport|Insurance|Bounty|CloneActivation|JumpClone|Kill)/.test(type)) return 'gKill';
  if (/War|Ally|Mutual|Surrender|Aggressor|Declare|^FW|Faction|Retract/.test(type)) return 'gWar';
  if (/Structure|Tower|Orbital|Moon|Skyhook|Station|Sov|Entosis|Infrastructure|Mercenary|Citadel|Fuel|Reinforce|Ess|Customs|Pos/.test(type)) return 'gStructure';
  if (/Corp|Char|Member|Application|Vote|Ceo|Alliance|Role|Medal|Tax|Bill|Contact|Locator/.test(type)) return 'gCorp';
  return 'gOther';
}

const NAMES: Record<string, string> = {
  StructureUnderAttack: tx('Structură atacată'),
  StructureLostShields: tx('Structura a pierdut scutul'),
  StructureLostArmor: tx('Structura a pierdut armura'),
  StructureDestroyed: tx('Structură distrusă'),
  StructureFuelAlert: tx('Combustibil pe terminate la structură'),
  StructureLowReagentsAlert: tx('Reactivi pe terminate la structură'),
  StructureServicesOffline: tx('Servicii oprite la structură'),
  StructureWentLowPower: tx('Structura a intrat în Low Power'),
  StructureAnchoring: tx('Structură în ancorare'),
  StructureUnanchoring: tx('Structură în dezancorare'),
  TowerAlertMsg: tx('POS atacat'),
  TowerResourceAlertMsg: tx('Combustibil pe terminate la POS'),
  OrbitalAttacked: tx('Customs Office atacat'),
  OrbitalReinforced: tx('Customs Office în reinforce'),
  SkyhookUnderAttack: tx('Skyhook atacat'),
  SkyhookLostShields: tx('Skyhook-ul a pierdut scutul'),
  SkyhookDeployed: tx('Skyhook instalat'),
  EntosisCaptureStarted: tx('Captură entosis începută'),
  SovStructureReinforced: tx('Structură de suveranitate în reinforce'),
  SovCommandNodeEventStarted: tx('Command node-uri active'),
  WarDeclared: tx('Război declarat'),
  WarAdopted: tx('Război preluat'),
  WarInherited: tx('Război moștenit'),
  WarInvalid: tx('Război anulat'),
  WarRetractedByConcord: tx('Război retras de CONCORD'),
  WarSurrenderOfferMsg: tx('Ofertă de capitulare'),
  WarEndedHqSecurityDrop: tx('Război încheiat'),
  AllyJoinedWarAllyMsg: tx('Aliat intrat în război'),
  MutualWarExpired: tx('Război reciproc expirat'),
  CorpAppNewMsg: tx('Cerere nouă de intrare în corporație'),
  CorpAppAcceptMsg: tx('Cerere de intrare acceptată'),
  CorpAppRejectMsg: tx('Cerere de intrare respinsă'),
  CharLeftCorpMsg: tx('Un membru a plecat din corporație'),
  CharAppAcceptMsg: tx('Ai fost acceptat în corporație'),
  CorpNewCEOMsg: tx('CEO nou în corporație'),
  CorpVoteMsg: tx('Vot nou în corporație'),
  CorpTaxChangeMsg: tx('Taxa corporației s-a schimbat'),
  CorpAllBillMsg: tx('Factură nouă'),
  BillOutOfMoneyMsg: tx('Fonduri insuficiente pentru factură'),
  BillPaidCorpAllMsg: tx('Factură plătită'),
  KillReportVictim: tx('Ai pierdut o navă'),
  KillReportFinalBlow: tx('Kill: ai dat lovitura finală'),
  KillRightAvailable: tx('Kill right disponibil'),
  InsurancePayoutMsg: tx('Asigurare plătită'),
  InsuranceIssuedMsg: tx('Asigurare încheiată'),
  InsuranceExpirationMsg: tx('Asigurare expirată'),
  BountyClaimMsg: tx('Recompensă încasată'),
  BountyPlacedChar: tx('Ți s-a pus un bounty'),
  BountyYourBountyClaimed: tx('Bounty-ul tău a fost încasat'),
  CloneActivationMsg: tx('Clonă activată'),
  JumpCloneDeletedMsg1: tx('Jump clone șters'),
  LocateCharMsg: tx('Rezultat de la agentul locator'),
  ContactAdd: tx('Ai fost adăugat la contacte'),
};

export const humanType = (type: string) => type.replace(/Msg\d*$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

export const gameTitle = (type: string) => NAMES[type] ?? humanType(type);

export async function pollGame(): Promise<void> {
  const on = (['gStructure', 'gWar', 'gCorp', 'gKill', 'gOther'] as NoticeKind[]).some((k) => kindOn(k));
  if (!on) return;
  const seen = loadJson<Record<string, number>>(SEEN_KEY, {});
  for (const c of gameCharacters()) {
    const id = c.characterId!;
    let list: GameNotice[];
    try { list = await gameNotices(id); } catch { continue; }
    const max = list.reduce((m, n) => Math.max(m, n.notification_id), 0);
    const last = seen[id];
    seen[id] = Math.max(last ?? 0, max);
    if (last == null) continue;
    const fresh = list.filter((n) => n.notification_id > last && !n.is_read).slice(0, 8).reverse();
    for (const n of fresh) deliver(gameKind(n.type), { title: `${gameTitle(n.type)} · ${c.name}`, body: humanType(n.type), url: '#/notifications', charId: id, tag: `vyraj-game-${n.notification_id}`, at: Date.parse(n.timestamp) || Date.now() });
  }
  saveJson(SEEN_KEY, seen);
}
