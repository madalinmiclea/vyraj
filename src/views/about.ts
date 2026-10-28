import { pageHead, panel, esc } from '../ui/components';
import { icon } from '../ui/icons';
import { tx } from '../i18n';
import { openChangelog } from '../ui/changelog';

interface Source { name: string; url: string; host: string; who?: string; role: string; ico?: string }
interface Group { id: string; title: string; items: Source[] }

export const ISSUES_URL = 'https://github.com/madalinmiclea/vyraj/issues';
const LINKEDIN = 'https://www.linkedin.com/in/madalin-miclea-45573290/';
const AUTHOR = 'Madalin Miclea';
const PILOT = { name: 'moonKL', id: 109537098, race: 'Caldari', bloodline: 'Civire', corp: 'State War Academy', ticker: 'SWA', since: 2010, ship: 'Golem', shipId: 28710, shipGroup: 'Marauder' };
const IMG = 'https://images.evetech.net';

function pilot() {
  return `<div class="about-pilot">
      <img class="about-portrait" src="${IMG}/characters/${PILOT.id}/portrait?size=256" alt="${PILOT.name}" loading="lazy">
      <div class="about-pilot-info">
        <div class="about-pilot-label">${tx('În New Eden')}</div>
        <div class="about-pilot-name">${PILOT.name}</div>
        <dl class="about-pilot-dl">
          <dt>${tx('Rasă')}</dt><dd>${PILOT.race} · ${PILOT.bloodline}</dd>
          <dt>${tx('Corporație')}</dt><dd>${PILOT.corp} <span class="about-host">[${PILOT.ticker}]</span></dd>
          <dt>${tx('Pilot din')}</dt><dd class="mono">${PILOT.since}</dd>
          <dt>${tx('Zboară cu')}</dt><dd>${PILOT.ship} <span class="about-host">${PILOT.shipGroup}</span></dd>
        </dl>
      </div>
      <img class="about-ship" src="${IMG}/types/${PILOT.shipId}/render?size=512" alt="${PILOT.ship}" loading="lazy">
    </div>`;
}

const GROUPS: Group[] = [
  { id: 'data', title: tx('Date și servicii'), items: [
    { name: 'CCP Games', ico: 'ccp', url: 'https://www.ccpgames.com/', host: 'esi.evetech.net', role: tx('EVE Online, API-ul ESI, login-ul EVE SSO, Static Data Export și serverul de imagini. Fără ei nu ar exista nimic de aici.') },
    { name: 'Pyfa', ico: 'pyfa', url: 'https://github.com/pyfa-org/Pyfa', host: 'github.com/pyfa-org', role: tx('Referința după care verificăm fiecare cifră din Fitting, plus datele statice și bonusurile navelor.') },
    { name: 'Fuzzwork', ico: 'fuzzwork', url: 'https://www.fuzzwork.co.uk/', host: 'market.fuzzwork.co.uk', who: 'Steve Ronuken', role: tx('Prețurile agregate din Jita și din celelalte hub-uri.') },
    { name: 'zKillboard', ico: 'zkillboard', url: 'https://zkillboard.com/', host: 'zkillboard.com', who: 'Squizz Caphinator', role: tx('Kill-urile din Intel PvP: gatecamp-uri pe rută și istoricul piloților din Local.') },
    { name: 'EVE-Scout', ico: 'evescout', url: 'https://www.eve-scout.com/', host: 'api.eve-scout.com', role: tx('Conexiunile publice spre Thera și Turnur din Navigație.') },
    { name: 'DOTLAN EveMaps', ico: 'dotlan', url: 'https://evemaps.dotlan.net/', host: 'evemaps.dotlan.net', who: 'Wollari', role: tx('Hărțile de sisteme deschise din Navigație.') },
    { name: 'EVE Ref', ico: 'everef', url: 'https://everef.net/', host: 'everef.net', role: tx('Paginile de referință ale itemelor, legate din Piață.') },
  ] },
  { id: 'guides', title: tx('Ghiduri și fituri'), items: [
    { name: 'EVE Survival', ico: 'evesurvival', url: 'https://eve-survival.org/', host: 'eve-survival.org', role: tx('Sursa principală a ghidurilor de misiuni și complexe DED: camere, valuri, triggere și blitz.') },
    { name: 'EVE University', ico: 'eveuni', url: 'https://wiki.eveuniversity.org/', host: 'wiki.eveuniversity.org', role: tx('Wiki-ul cu rapoarte de misiuni, situri DED și mecanicile jocului, explicate pentru oricine.') },
    { name: 'EVE Workbench', ico: 'eveworkbench', url: 'https://eveworkbench.com/', host: 'eveworkbench.com', role: tx('Fiturile PvE și PvP publicate de piloți, din care pornesc butoanele de fit. Fiecare fit trimite înapoi la pagina lui.') },
  ] },
  { id: 'community', title: tx('Comunitate'), items: [
    { name: tx('Forumurile EVE Online'), ico: 'forums', url: 'https://forums.eveonline.com/', host: 'forums.eveonline.com', role: tx('Ani de discuții despre fitting, piață, industrie și mecanici, din care am învățat cum gândesc piloții.') },
    { name: 'r/Eve', ico: 'reddit', url: 'https://www.reddit.com/r/Eve/', host: 'reddit.com/r/Eve', role: tx('Ghiduri, întrebări și răspunsuri scrise de jucători pentru jucători.') },
    { name: tx('Piloții care publică'), url: 'https://eveworkbench.com/', host: tx('peste tot în New Eden'), role: tx('Fiecare pilot care a scris un ghid, a publicat un fit sau a răspuns la o întrebare. Vyraj e construit pe munca voastră.') },
  ] },
  { id: 'tools', title: tx('Fonturi și unelte'), items: [
    { name: 'Inter', ico: 'inter', url: 'https://rsms.me/inter/', host: 'SIL OFL 1.1', who: 'Rasmus Andersson', role: tx('Fontul textului din toată aplicația.') },
    { name: 'Sora', ico: 'sora', url: 'https://fonts.google.com/specimen/Sora', host: 'SIL OFL 1.1', who: 'Jonathan Barnbrook, Julián Moncada', role: tx('Fontul titlurilor.') },
    { name: 'TypeScript', ico: 'typescript', url: 'https://www.typescriptlang.org/', host: 'typescriptlang.org', role: tx('Limbajul în care e scris Vyraj.') },
    { name: 'Vite', ico: 'vite', url: 'https://vite.dev/', host: 'vite.dev', role: tx('Build-ul și serverul de dezvoltare.') },
    { name: 'GitHub Pages', ico: 'ghpages', url: 'https://pages.github.com/', host: 'pages.github.com', role: tx('Găzduirea gratuită a site-ului.') },
  ] },
];

const THANKS = tx('Vyraj nu ar exista fără oamenii care construiesc, documentează și împart EVE de peste douăzeci de ani. Fiecare preț, fiecare fit, fiecare ghid și fiecare hartă de aici vine din munca lor, oferită gratuit comunității. Vă mulțumim tuturor. o7');

const CCP_NOTICE = 'EVE Online and the EVE logo are the registered trademarks of CCP hf. All rights are reserved worldwide. All other trademarks are the property of their respective owners. EVE Online, the EVE logo, EVE and all associated logos and designs are the intellectual property of CCP hf. All artwork, screenshots, characters, vehicles, storylines, world facts or other recognizable features of the intellectual property relating to these trademarks are likewise the intellectual property of CCP hf. CCP hf. has granted permission to Vyraj to use EVE Online and all associated logos and designs for promotional and information purposes on its website but does not endorse, and is not in any way affiliated with, Vyraj. CCP is in no way responsible for the content on or functioning of this website, nor can it be liable for any damage arising from the use of this website.';

const ext = (url: string, html: string, cls = '') => `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
const linkedin = (cls = 'btn') => ext(LINKEDIN, `${icon('external')}<span>${tx('Profil LinkedIn')}</span>`, cls);
const logo = (s: Source) => (s.ico ? `<img src="${import.meta.env.BASE_URL}credits/${s.ico}.png" alt="" loading="lazy">` : icon('credits'));
const notice = () => panel({ title: tx('Notă de copyright CCP'), cls: 'about-notice', body: `<p lang="en">${CCP_NOTICE}</p>` });

function body() {
  const card = (s: Source) => ext(s.url, `<span class="about-mono">${logo(s)}</span>
      <span class="about-card-text"><span class="about-name">${esc(s.name)}${icon('external')}</span><span class="about-c-role">${esc(s.role)}</span>${s.who ? `<span class="about-who">${esc(s.who)}</span>` : ''}</span>`, 'about-tile');
  return `<div class="about-c">
    <section class="about-hero" id="about-thanks">
      <div class="about-hero-kicker">o7</div>
      <h2>${tx('Mulțumim, New Eden.')}</h2>
      <p>${esc(THANKS)}</p>
    </section>
    ${GROUPS.map((g) => `<section class="about-c-group" id="about-${g.id}"><div class="section-title">${esc(g.title)}</div><div class="about-tiles">${g.items.map(card).join('')}</div></section>`).join('')}
    <section class="about-sign" id="about-author">
      <div class="about-sign-text">
        <div class="about-author-role">${tx('Construit de')}</div>
        <div class="about-author-name">${AUTHOR}</div>
        <p class="dim">${tx('Vyraj e un proiect personal, gratuit, făcut din pasiune pentru EVE. Ideile și feedback-ul sunt binevenite.')}</p>
        <div class="about-sign-actions">
          ${ext(`${ISSUES_URL}/new`, `${icon('external')}<span>${tx('Raportează pe GitHub')}</span>`, 'btn')}
          <button class="btn ghost" data-changelog>${icon('skills')}<span>${tx('Jurnal de schimbări')}</span></button>
          ${linkedin('btn ghost')}
        </div>
      </div>
      ${pilot()}
    </section>
    <div id="about-notice">${notice()}</div>
  </div>`;
}

export function createAboutView(el: HTMLElement) {
  el.innerHTML = `${pageHead(tx('Credite și mulțumiri'), tx('Sursele, uneltele și oamenii pe care se sprijină Vyraj'), 'Letopis')}
    ${body()}`;
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-changelog]')) openChangelog();
  });
}
