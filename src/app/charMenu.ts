import type { AppContext } from './context';
import { portrait } from './shell';
import { icon } from '../ui/icons';
import { formatInt, esc } from '../ui/components';
import { hasTokens } from '../character/sso';
import { loadStoredCharacters } from '../character/characters';
import { logoutCharacter } from '../character/logout';
import { tx } from '../i18n';
import { isDemo } from '../demo/demo';
import { DEMO_ID } from '../demo/identity';

export function createCharMenu(openLogin: (characterId?: number | null) => void) {
  const charSwitch = document.getElementById('charSwitch')!;
  const charMenu = document.getElementById('charMenu')!;
  function close() {
    charMenu.hidden = true;
    charSwitch.classList.remove('open');
  }
  document.addEventListener('click', (e) => {
    if (!charSwitch.contains(e.target as Node)) close();
  });

  function attach(ctx: AppContext) {
    const topCharacter = document.getElementById('topCharacter')!;
    const avatar = document.getElementById('charAvatar')!;
    const renderCharMenu = () => {
      const stored = loadStoredCharacters();
      const active = ctx.character;
      const anyLogged = stored.some((c) => c.characterId != null && hasTokens(c.characterId));
      charMenu.innerHTML = `${stored.map((c) => `<button class="char-menu-item ${c.id === active.id ? 'active' : ''}" data-switch="${esc(c.id)}">${portrait(c.characterId)}
        <span class="side-who"><span>${esc(c.name)}</span> <small>${c.totalSp ? formatInt(c.totalSp) + ' SP' : tx('{n} skill-uri', { n: Object.values(c.skills).filter((x) => x.level > 0).length })}</small></span></button>`).join('')}
      ${['all5', 'all0'].map((id) => `<button class="char-menu-item ${active.id === id ? 'active' : ''}" data-switch="${id}">${portrait()}<span class="side-who"><span>${id === 'all5' ? tx('Toate la V') : tx('Toate la 0')}</span> <small>${id === 'all5' ? tx('teoretic, toate skill-urile la nivel V') : tx('teoretic, fără niciun skill')}</small></span></button>`).join('')}
      <div class="char-menu-sep"></div>
      ${active.kind === 'esi' && !(isDemo() && active.characterId === DEMO_ID) ? `<button class="char-menu-item logout" data-char-logout="${esc(active.id)}">${icon('power')}<span>${tx('Delogare {name}', { name: esc(active.name) })}</span></button>` : ''}
      <button class="char-menu-item login" data-char-login>${icon('login')}<span>${isDemo() ? tx('Ieși din demo și fă login') : anyLogged ? tx('Adaugă caracter') : tx('Login cu EVE')}</span></button>
      ${isDemo() ? `<button class="char-menu-item login" data-demo-exit>${icon('close')}<span>${tx('Ieși din demo')}</span></button>` : anyLogged ? '' : `<button class="char-menu-item login" data-demo-start>${icon('play')}<span>${tx('Încearcă cu date demo')}</span></button>`}`;
    };
    const showCharacter = () => {
      topCharacter.textContent = ctx.character.name;
      avatar.innerHTML = portrait(ctx.character.characterId);
      document.getElementById('topCharacterLabel')!.textContent = ctx.character.kind === 'all5' || ctx.character.kind === 'all0' ? tx('Skill-uri') : tx('Caracter');
      document.getElementById('ssoBtn')!.style.display = loadStoredCharacters().some((c) => c.characterId != null && hasTokens(c.characterId)) ? '' : 'none';
      renderCharMenu();
    };
    ctx.onCharacterChange(showCharacter);
    showCharacter();
    document.getElementById('charSwitchBtn')!.addEventListener('click', () => {
      renderCharMenu();
      charMenu.hidden = !charMenu.hidden;
      charSwitch.classList.toggle('open', !charMenu.hidden);
    });
    charMenu.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const sw = t.closest<HTMLElement>('[data-switch]');
      if (sw) { close(); ctx.setCharacter(sw.dataset.switch!); return; }
      const out = t.closest<HTMLElement>('[data-char-logout]');
      if (out) { close(); logoutCharacter(out.dataset.charLogout!); return; }
      if (t.closest('[data-char-login]')) {
        close();
        openLogin();
      }
    });
    document.getElementById('ssoBtn')!.addEventListener('click', () => {
      close();
      const c = ctx.character;
      openLogin(c.kind === 'esi' && c.characterId && hasTokens(c.characterId) ? c.characterId : null);
    });
  }

  return { close, attach };
}
