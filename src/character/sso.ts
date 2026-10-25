import { loadJson, saveJson, removeKey } from '../storage';
import { tx } from '../i18n';

export const SCOPES = [
  'esi-skills.read_skills.v1',
  'esi-skills.read_skillqueue.v1',
  'esi-clones.read_implants.v1',
  'esi-fittings.read_fittings.v1',
  'esi-fittings.write_fittings.v1',
  'esi-assets.read_assets.v1',
  'esi-location.read_ship_type.v1',
  'esi-location.read_location.v1',
  'esi-location.read_online.v1',
  'esi-universe.read_structures.v1',
  'esi-wallet.read_character_wallet.v1',
  'esi-characters.read_loyalty.v1',
  'esi-markets.read_character_orders.v1',
  'esi-planets.manage_planets.v1',
  'esi-characters.read_blueprints.v1',
  'esi-industry.read_character_jobs.v1',
];

const AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize';
const TOKEN_URL = import.meta.env.VITE_EVE_TOKEN_URL || 'https://login.eveonline.com/v2/oauth/token';
const SETTINGS_KEY = 'eve-fit:sso-settings';
const PENDING_KEY = 'eve-fit:sso-pending';
const TOKENS_KEY = 'eve-fit:sso-tokens';

export interface SsoSettings {
  clientId: string;
}

export interface TokenSet {
  characterId: number;
  characterName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export const callbackUrl = () => import.meta.env.VITE_EVE_CALLBACK_URL || `${location.origin}${import.meta.env.BASE_URL}callback`;

export const BUILT_IN_CLIENT_ID = import.meta.env.VITE_EVE_CLIENT_ID || '';

export function getSettings(): SsoSettings {
  const s = loadJson<SsoSettings>(SETTINGS_KEY, { clientId: '' });
  return { clientId: s.clientId || BUILT_IN_CLIENT_ID };
}

export function saveSettings(s: SsoSettings) {
  saveJson(SETTINGS_KEY, s);
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(len)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export async function startLogin(): Promise<void> {
  const { clientId } = getSettings();
  if (!clientId) throw new Error(tx('Lipsește Client ID-ul aplicației EVE. Îl pui în secțiunea Setări login.'));
  const verifier = randomString(48);
  const state = randomString(16);
  saveJson(PENDING_KEY, { verifier, state });
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: callbackUrl(),
    client_id: clientId,
    scope: SCOPES.join(' '),
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    state,
  });
  location.assign(`${AUTHORIZE_URL}?${params}`);
}

export function decodeJwt(token: string): { characterId: number; characterName: string; scopes: string[] } {
  const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  const characterId = Number(String(payload.sub).split(':').pop());
  const scopes = Array.isArray(payload.scp) ? payload.scp : payload.scp ? [payload.scp] : [];
  return { characterId, characterName: payload.name, scopes };
}

export class SessionExpiredError extends Error {}

export const SESSION_EXPIRED_EVENT = 'vyraj-session-expired';

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (body.grant_type === 'refresh_token' && (res.status === 400 || res.status === 401)) throw new SessionExpiredError(tx('Sesiunea EVE a acestui caracter a expirat sau a fost revocată. Fă din nou login.'));
    throw new Error(tx('Login EVE eșuat ({status}): {text}', { status: res.status, text }));
  }
  const json = await res.json();
  const { characterId, characterName } = decodeJwt(json.access_token);
  return {
    characterId,
    characterName,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || body.refresh_token,
    expiresAt: Date.now() + (json.expires_in - 30) * 1000,
  };
}

export async function handleCallback(): Promise<TokenSet | null> {
  if (location.pathname !== new URL(callbackUrl(), location.href).pathname) return null;
  const params = new URLSearchParams(location.search);
  history.replaceState(null, '', import.meta.env.BASE_URL);
  const code = params.get('code');
  const pending = loadJson<{ verifier: string; state: string } | null>(PENDING_KEY, null);
  removeKey(PENDING_KEY);
  if (!code || !pending) return null;
  if (params.get('state') !== pending.state) throw new Error(tx('Login EVE: răspuns invalid (state diferit). Încearcă din nou.'));
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: getSettings().clientId,
    code_verifier: pending.verifier,
  });
  storeTokens(tokens);
  return tokens;
}

function allTokens(): Record<string, TokenSet> {
  return loadJson<Record<string, TokenSet>>(TOKENS_KEY, {});
}

export function storeTokens(t: TokenSet) {
  const all = allTokens();
  all[t.characterId] = t;
  saveJson(TOKENS_KEY, all);
}

export function forgetTokens(characterId: number) {
  const all = allTokens();
  delete all[characterId];
  saveJson(TOKENS_KEY, all);
}

export function hasScope(characterId: number, scope: string): boolean {
  const t = allTokens()[characterId];
  return t ? decodeJwt(t.accessToken).scopes.includes(scope) : false;
}

export function hasTokens(characterId: number): boolean {
  return Boolean(allTokens()[characterId]);
}

export function loginProblem(c: { kind: string; characterId?: number; name: string }): string | null {
  if (c.kind !== 'esi' || !c.characterId) return tx('Selectează un caracter importat din EVE (ecranul Caracter).');
  if (!hasTokens(c.characterId)) return tx('{name} nu mai e logat în EVE (sesiunea a expirat sau a fost revocată). Fă din nou login din ecranul Caracter.', { name: c.name });
  return null;
}

const refreshing = new Map<number, Promise<string>>();

async function refresh(characterId: number): Promise<string> {
  const t = allTokens()[characterId];
  if (!t) throw new Error(tx('Caracterul nu e logat. Apasă „Login cu EVE”.'));
  if (Date.now() < t.expiresAt) return t.accessToken;
  try {
    const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: getSettings().clientId });
    storeTokens(fresh);
    return fresh.accessToken;
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      forgetTokens(characterId);
      window.dispatchEvent(new CustomEvent<number>(SESSION_EXPIRED_EVENT, { detail: characterId }));
    }
    throw e;
  }
}

export async function accessToken(characterId: number): Promise<string> {
  const t = allTokens()[characterId];
  if (!t) throw new Error(tx('Caracterul nu e logat. Apasă „Login cu EVE”.'));
  if (Date.now() < t.expiresAt) return t.accessToken;
  let pending = refreshing.get(characterId);
  if (!pending) {
    const run = () => refresh(characterId);
    pending = (navigator.locks ? navigator.locks.request(`vyraj-token-${characterId}`, run) : run()).finally(() => refreshing.delete(characterId));
    refreshing.set(characterId, pending);
  }
  return pending;
}
