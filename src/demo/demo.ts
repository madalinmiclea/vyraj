import { setDemo } from '../storage';
import { storeTokens, SCOPES } from '../character/sso';
import { importCharacter } from '../character/esi';
import { upsertStoredCharacter, setActiveCharacterId } from '../character/characters';
import { DEMO_ID, demoToken } from './identity';
import { tx } from '../i18n';

export { isDemo } from '../storage';

export async function startDemo(): Promise<void> {
  setDemo(true);
  const name = tx('Pilot demo');
  storeTokens({ characterId: DEMO_ID, characterName: name, accessToken: demoToken(name, SCOPES), refreshToken: '', expiresAt: Date.now() + 3650 * 86400000 });
  try {
    const c = await importCharacter(DEMO_ID, name);
    upsertStoredCharacter(c);
    setActiveCharacterId(c.id);
  } catch (e) {
    setDemo(false);
    throw e;
  }
}

export function exitDemo(): void {
  setDemo(false);
}
