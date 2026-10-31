import type { AppContext } from '../app/context';
import type { Fit } from '../engine/fit';
import { loadStoredCharacters, storedActiveCharacter } from '../character/characters';
import { hasTokens } from '../character/sso';
import { portraitUrl } from '../character/esi';
import { formatDuration } from '../character/training';
import { loadFits } from '../fitting/savedFits';
import { typeIconUrl } from '../services/market';
import { CHANGELOG } from '../data/changelog';
import { openChangelog, release } from '../ui/changelog';
import { button, esc, formatInt, lore, pageHead } from '../ui/components';
import { icon } from '../ui/icons';
import { tx } from '../i18n';
import { ISSUES_URL } from './about';
import { backupPanel } from '../io/backup';

export interface HomeView { render(): void; setContext(ctx: AppContext): void }

interface Tile { id: string; label: string; icon: string }

const GROUPS: { title: string; vy: string; ids: string[] }[] = [
  { title: tx('Nave'), vy: 'Svarog', ids: ['fitting', 'doctrines', 'skins'] },
  { title: tx('Pilot'), vy: 'Perun', ids: ['character', 'mail', 'notifications'] },
  { title: tx('PvE'), vy: 'Morana', ids: ['missions', 'operations'] },
  { title: tx('Piață și comerț'), vy: 'Veles', ids: ['market', 'intel', 'orders', 'wallet'] },
  { title: tx('Producție'), vy: 'Mokosh', ids: ['industry', 'pi', 'mining'] },
  { title: tx('Spațiu'), vy: 'Perun', ids: ['navigation', 'recon'] },
];

const ABOUT: Record<string, string> = {
  market: tx('Prețuri live din Jita 4-4, istoric și comparație cu celelalte hub-uri.'),
  intel: tx('Idei de trading, marje după taxe, tendințe și rute de transport.'),
  orders: tx('Ordinele tuturor caracterelor cu alertă la outbid, evaluare de iteme, alerte de preț și bunuri.'),
  wallet: tx('Sold, jurnal, ce ai cumpărat și vândut, tick-uri de bounty și unde ai vânat.'),
  fitting: tx('Simulator cu formulele Pyfa: DPS aplicat, tank pe misiuni și cost în Jita.'),
  doctrines: tx('Fituri de flotă pentru corporație: cine le poate zbura și cât costă tot.'),
  skins: tx('Colecția de SKIN-uri și cel mai ieftin drum spre o colecție completă.'),
  character: tx('Skill-uri, coada de antrenament, plan de skill-uri și toate caracterele.'),
  notifications: tx('Alegi ce te anunță: ordine vândute, outbid, skill-uri, industrie, kill-uri PvP lângă tine și notificările din joc.'),
  mail: tx('Mailurile din joc: etichete, liste de mail, citire, răspuns și trimitere.'),
  missions: tx('Misiuni L1–L5 și complexe DED, magazin LP și jurnal abisal.'),
  operations: tx('Joburi freelance, campanii militare, Mercenary Dens și skyhook-uri de jefuit, citite direct din ESI.'),
  industry: tx('Cost de fabricație și invenție față de prețul din Jita.'),
  pi: tx('Colonii, timere de extractoare și profitul fiecărui lanț.'),
  mining: tx('ISK pe oră pe fiecare minereu și calculator de reprocesare.'),
  navigation: tx('Salturi pentru capitale, Pochven, conexiuni Thera și Turnur și harta de suveranitate.'),
  recon: tx('Hartă live cu kill-uri, gatecamp-uri și alarme lângă tine, pericol pe rută și analiza Local și D-Scan.'),
};

export function createHomeView(el: HTMLElement, opts: { tiles: Tile[]; go: (id: string) => void; openFit: (fit: Fit) => void; login: () => void }): HomeView {
  let ctx: AppContext | null = null;
  const tile = (id: string) => {
    const t = opts.tiles.find((x) => x.id === id);
    return t ? `<button class="home-tile" data-go="${id}"><span class="home-tile-ico">${icon(t.icon)}</span><span class="home-tile-text"><b>${esc(t.label)}</b><span>${esc(ABOUT[id] ?? '')}</span></span></button>` : '';
  };

  function hero() {
    const logged = loadStoredCharacters().some((c) => c.kind === 'esi' && c.characterId && hasTokens(c.characterId));
    const c = ctx ? ctx.character : storedActiveCharacter();
    if (logged && c && c.kind === 'esi' && c.characterId) {
      const last = c.queue.at(-1)?.finish;
      const left = last ? (new Date(last).getTime() - Date.now()) / 1000 : 0;
      const queue = !c.queue.length
        ? `<span class="home-warn">${icon('alert')}${tx('Coada de skill-uri e goală')}</span>`
        : last ? `<span>${tx('Coada se termină în {time}', { time: formatDuration(left) })}</span>` : `<span>${tx('Coada e pe pauză')}</span>`;
      return `<section class="panel home-pilot">
        <img src="${portraitUrl(c.characterId, 128)}" alt="" />
        <div class="home-pilot-text">
          <div class="home-kicker">${lore(tx('Pilot activ'), 'Narodnya')}</div>
          <h2>${esc(c.name)}</h2>
          <div class="home-pilot-meta">${c.totalSp ? `<span class="num">${formatInt(c.totalSp)} SP</span>` : ''}${queue}</div>
        </div>
        ${button(tx('Caracter'), { iconName: 'character', cls: 'ghost sm', attrs: 'data-go="character"' })}
      </section>`;
    }
    return `<section class="panel home-hero">
      <div class="home-hero-text">
        <div class="home-kicker">o7, capsuleer</div>
        <h2>${lore(tx('Toate uneltele tale de EVE, într-un singur loc'), 'Every path of the Flow, woven into one')}</h2>
        <p>${tx('Fitting cu formulele Pyfa, prețuri live din Jita, plan de skill-uri, intel pe rută, industrie și ghid de misiuni. Gratuit, fără cont și fără server: totul rulează în browserul tău.')}</p>
        <div class="home-actions">
          ${button(tx('Login cu EVE'), { iconName: 'login', attrs: 'data-home-login' })}
          ${button(tx('Încearcă cu date demo'), { iconName: 'play', cls: 'ghost', attrs: 'data-demo-start' })}
          ${button(tx('Deschide Fitting'), { iconName: 'fitting', cls: 'ghost', attrs: 'data-go="fitting"' })}
        </div>
        <p class="dim small home-demo-note">${tx('Demo-ul încarcă un pilot fictiv cu skill-uri, portofel, bunuri, industrie și colonii, ca să vezi fiecare ecran fără login.')}</p>
      </div>
      <ul class="home-trust">
        <li>${icon('shield')}<span><b>${tx('Datele rămân la tine')}</b>${tx('Fiturile, setările și jurnalele stau doar în browserul tău.')}</span></li>
        <li>${icon('login')}<span><b>${tx('Login oficial EVE')}</b>${tx('Te loghezi pe pagina CCP. Vyraj nu vede niciodată parola.')}</span></li>
        <li>${icon('check')}<span><b>${tx('Permisiuni pe rând')}</b>${tx('La început doar skill-urile. Portofelul, bunurile și restul le aprobi când ai nevoie.')}</span></li>
      </ul>
    </section>`;
  }

  function recentFits() {
    const fits = loadFits().slice(0, 6);
    if (!fits.length) return '';
    return `<section class="panel">
      <div class="panel-head"><div class="window-title">${tx('Fit-uri salvate')}<span class="count">${loadFits().length}</span></div></div>
      <div class="panel-body"><div class="home-fits">${fits.map((f) => `<button class="item-tile" data-home-fit="${esc(f.id)}"><img src="${typeIconUrl(f.shipId, 32)}" alt="" loading="lazy" /><span class="tile-text"><span>${esc(f.name)}</span><small>${esc(ctx?.sde.types.get(f.shipId)?.name ?? '')}</small></span></button>`).join('')}</div></div>
    </section>`;
  }

  function render() {
    el.innerHTML = `${pageHead(tx('Start'), tx('Vyraj · unelte gratuite pentru piloții EVE Online'), 'Prag')}
      ${hero()}
      <div class="home-grid">
        ${GROUPS.map((g) => `<section class="home-group">
          <div class="section-title">${lore(esc(g.title), `${g.vy} Clade`)}</div>
          <div class="home-tiles">${g.ids.map(tile).join('')}</div>
        </section>`).join('')}
      </div>
      <div class="home-cols">
        <section class="panel home-news">
          <div class="panel-head"><div class="window-title">${tx('Ce e nou')}</div><div class="panel-actions">${button(tx('Tot jurnalul'), { cls: 'ghost sm', attrs: 'data-changelog' })}</div></div>
          <div class="panel-body changelog">${CHANGELOG.slice(0, 2).map((r) => release(r, false)).join('')}</div>
        </section>
        <div class="stack">
          ${recentFits()}
          <section class="panel home-feedback">
            <div class="panel-body">
              <h3>${tx('Ai găsit o problemă sau ai o idee?')}</h3>
              <p class="dim">${tx('Vyraj crește din ce cer piloții. Scrie pe GitHub ce nu merge sau ce ți-ar trebui, cu un screenshot dacă poți.')}</p>
              <div class="home-actions">
                <a class="btn sm" href="${ISSUES_URL}/new" target="_blank" rel="noopener">${icon('external')}${tx('Raportează pe GitHub')}</a>
                <a class="btn ghost sm" href="${ISSUES_URL}" target="_blank" rel="noopener">${tx('Vezi ce s-a cerut deja')}</a>
              </div>
            </div>
          </section>
          ${backupPanel()}
        </div>
      </div>`;
  }

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const go = t.closest<HTMLElement>('[data-go]');
    if (go) { opts.go(go.dataset.go!); return; }
    if (t.closest('[data-home-login]')) { opts.login(); return; }
    if (t.closest('[data-changelog]')) { openChangelog(); return; }
    const fit = t.closest<HTMLElement>('[data-home-fit]');
    if (fit) { const f = loadFits().find((x) => x.id === fit.dataset.homeFit); if (f) opts.openFit(f); }
  });

  render();
  return {
    render,
    setContext(c: AppContext) { ctx = c; c.onCharacterChange(render); render(); },
  };
}
