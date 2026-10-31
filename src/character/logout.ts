import { loadJson, saveJson, removeKey, isDemo } from '../storage';
import { tx } from '../i18n';
import { confirmDialog, toast } from '../ui/components';
import { loadStoredCharacters, removeStoredCharacter, getActiveCharacterId, setActiveCharacterId, type StoredCharacter } from './characters';
import { forgetPlan } from './skillPlan';
import { forgetRoster } from './roster';
import { forgetTokens, revokeTokens } from './sso';
import { forgetSkins } from '../services/skins';
import { forgetWallet } from '../services/wallet';
import { loadColonies, saveColonies } from '../services/pi';
import { clearVisits } from '../services/visited';
import { forgetCharacterNotices } from '../services/notices';

const FLASH_KEY = 'vyraj:flash';

function forgetCharacterData(c: StoredCharacter, lastOfId: boolean) {
  const before = loadJson<{ chars: Record<string, string>; omega: Record<string, string> }>('eve-fit:roster-accounts', { chars: {}, omega: {} });
  const account = before.chars[c.id] || c.id;
  forgetPlan(c.id);
  forgetSkins(c.id);
  forgetRoster(c.id);
  if (!c.characterId || !lastOfId) return;
  const id = c.characterId;
  forgetWallet(id);
  removeKey(`eve-mail:cache:${id}`);
  const colonies = loadColonies();
  if (colonies[id]) { delete colonies[id]; saveColonies(colonies); }
  clearVisits(c.name);
  const accounts = loadJson<{ chars: Record<string, string>; omega: Record<string, string> }>('eve-fit:roster-accounts', { chars: {}, omega: {} });
  if (accounts.omega[account] && !Object.values(accounts.chars).includes(account)) { delete accounts.omega[account]; saveJson('eve-fit:roster-accounts', accounts); }
  const live = loadJson<Record<string, unknown>>('eve-live:settings', {});
  if (live.follow === String(id)) saveJson('eve-live:settings', { ...live, follow: '' });
  const visitedUi = loadJson<Record<string, unknown>>('eve-nav:visited-ui', {});
  if (visitedUi.who === c.name) saveJson('eve-nav:visited-ui', { ...visitedUi, who: '' });
  const orders = loadJson<Record<string, unknown>>('eve-orders:ui', {});
  if (orders.character === id) saveJson('eve-orders:ui', { ...orders, character: 0 });
  forgetCharacterNotices(id);
  const fired = loadJson<Record<string, number>>('eve-notify:fired', {});
  const marker = `:${id}:`;
  if (Object.keys(fired).some((k) => k.includes(marker))) saveJson('eve-notify:fired', Object.fromEntries(Object.entries(fired).filter(([k]) => !k.includes(marker))));
}

export async function logoutCharacter(id: string): Promise<boolean> {
  const stored = loadStoredCharacters();
  const c = stored.find((x) => x.id === id);
  if (!c) return false;
  const esi = c.kind === 'esi' && c.characterId != null;
  const ok = await confirmDialog(
    esi
      ? tx('Delogezi {name}? Sesiunea EVE e revocată, iar din browser se șterg tokenurile și toate datele caracterului: istoric portofel, assets, mail, colonii PI, sisteme vizitate, plan de skill-uri, SKIN-uri și urmărirea pe harta live. Caracterul dispare complet din aplicație; îl poți adăuga oricând din nou cu login.', { name: c.name })
      : tx('Ștergi caracterul din aplicație, împreună cu datele lui salvate în browser (plan de skill-uri, SKIN-uri)?'),
    { title: esi ? tx('Delogare caracter') : tx('Confirmare'), ok: esi ? tx('Delogare') : tx('Șterge'), danger: true },
  );
  if (!ok) return false;
  const lastOfId = !stored.some((x) => x.id !== c.id && x.characterId === c.characterId);
  if (esi && lastOfId) { if (isDemo()) forgetTokens(c.characterId!); else await revokeTokens(c.characterId!); }
  forgetCharacterData(c, lastOfId);
  removeStoredCharacter(c.id);
  const wasActive = getActiveCharacterId() === c.id;
  if (wasActive) {
    setActiveCharacterId('all5');
    saveJson('eve-fit:ui:view', 'home');
  }
  try { sessionStorage.setItem(FLASH_KEY, esi ? tx('{name} a fost delogat', { name: c.name }) : tx('{name} a fost șters', { name: c.name })); } catch { void 0; }
  if (wasActive) history.replaceState(null, '', `${location.pathname}${location.search}#/home`);
  location.reload();
  return true;
}

export function showLogoutFlash() {
  try {
    const msg = sessionStorage.getItem(FLASH_KEY);
    if (!msg) return;
    sessionStorage.removeItem(FLASH_KEY);
    toast(msg);
  } catch {
    return;
  }
}
