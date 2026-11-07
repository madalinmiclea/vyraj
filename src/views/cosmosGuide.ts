import { tx } from '../i18n';
import { windowTitle, button } from '../ui/components';

const lesson = (n: number, title: string, body: string) => `
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`${n} · ${title}`)}</div>
      <div class="panel-body">${body}</div>
    </section>`;

const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const ol = (items: string[]) => `<ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
const p = (t: string) => `<p>${t}</p>`;

export function cosmosGuide(): string {
  return [
    lesson(1, tx('Ce e COSMOS'), p(tx('COSMOS e conținut PvE fix, așezat în câteva constelații din joc: una pentru fiecare imperiu (Amarr, Caldari, Gallente, Minmatar) și câte una pentru patru facțiuni pirat, în nullsec. Acolo găsești agenți speciali și site-uri de luptă care nu apar nicăieri altundeva.')) + ul([
      tx('Agenții COSMOS dau misiuni care se fac o singură dată în toată viața caracterului.'),
      tx('Misiunile formează lanțuri scurte, de 3–5 misiuni, care spun o poveste din lore.'),
      tx('Site-urile COSMOS sunt complexe fixe, care revin după un timp. Le poți face oricând, nu doar pentru misiuni.'),
    ])),
    lesson(2, tx('De ce merită'), ul([
      tx('Standing de facțiune: ultima misiune din fiecare lanț îți dă un bonus mare de standing la facțiune. E cel mai sigur drum spre agenți L4 și L5.'),
      tx('Blueprint-uri pentru module storyline: module apropiate de T2, dar mai ușor de pus pe navă.'),
      tx('Loot rar din site-uri: module faction, materiale pentru module storyline și, uneori, implanturi.'),
      tx('Cu standing 8.5+ la facțiune, câțiva agenți îți dau blueprint-uri de nave faction în schimbul tag-urilor de pirat.'),
    ])),
    lesson(3, tx('Regula de aur'), p(`<b>${tx('Nu vorbi cu un agent COSMOS dacă nu ești gata să faci misiunea.')}</b>`) + ul([
      tx('Când deschizi conversația, primești oferta. Ea expiră în 7 zile.'),
      tx('Dacă misiunea expiră sau o pierzi, nu o mai poți face niciodată, și nici restul lanțului.'),
      tx('Înainte de prima discuție: citește pe wiki ce cere misiunea, cumpără itemele și pregătește nava.'),
    ])),
    lesson(4, tx('Standing-ul de care ai nevoie'), p(tx('Agenții COSMOS se uită doar la standing-ul tău cu facțiunea (de exemplu Caldari State). Standing-ul cu o corporație nu ajunge, chiar dacă e mare.')) + ul([
      tx('L1: fără standing. Aici începi.'),
      tx('L2: 2.0 · L3: 4.0 · L4: 6.0. Pragurile sunt mai mari decât la agenții obișnuiți.'),
      tx('Skill-ul Connections îți crește standing-ul efectiv. Merită antrenat la 3–4 înainte.'),
      tx('Standing-ul de facțiune crește din misiunile obișnuite pentru corporațiile acelei facțiuni, din misiunile storyline și din finalul lanțurilor COSMOS.'),
      tx('În Vyraj, tab-ul COSMOS arată standingul tău lângă fiecare agent: verde înseamnă că ai acces.'),
    ])),
    lesson(5, tx('Alegi linia și primul agent'), ol([
      tx('Deschide tab-ul COSMOS și alege linia facțiunii cu care ai cel mai mare standing. Vyraj îți arată linia potrivită în cardul „Pasul următor”.'),
      tx('Începe cu un agent pe care îl ai deja deblocat și care nu cere nimic „înainte în lanț”.'),
      tx('Cardul „Pasul următor” alege singur agentul cel mai apropiat pe care îl poți lua și îți arată ce iteme îi trebuie.'),
      tx('Deschide numele agentului: te duce pe wiki, unde scrie exact ce cere fiecare misiune din lanț.'),
    ])),
    lesson(6, tx('Te pregătești'), ul([
      tx('Lista de cumpărături: unele iteme sunt pe piață, altele pe contracte, altele cad din NPC-urile din belt-uri sau din site-uri COSMOS.'),
      tx('Misiunile curier merg cu o fregată de transport (Probe, Magnate, Heron, Imicus) cu cargo mărit. Unele te trimit prin lowsec.'),
      tx('La misiunile de luptă L1–L3 ajunge un battlecruiser T1 sau un crucișător bun. La L4 vino cu un battleship sau cu o navă pe care o folosești deja la L4.'),
      tx('Site-urile cu poartă de accelerare au limită de mărime a navei, la fel ca un complex DED.'),
    ])),
    lesson(7, tx('Unde găsești agenții și site-urile'), ul([
      tx('Unii agenți stau într-o stație. Alții stau într-un site în spațiu: faci warp la beacon și vorbești cu ei de acolo.'),
      tx('Site-urile cu beacon apar pe hartă dacă o colorezi după „DED deadspace reports”, sau în lista de locații din sistem.'),
      tx('Site-urile marcate „Semnătură” trebuie scanate cu probe. Vezi ghidul „Scanare complex DED”.'),
      tx('Coloana „Salturi” din tab-ul COSMOS îți spune cât de departe e fiecare agent sau site față de tine.'),
    ])),
    lesson(8, tx('Cum ții evidența în Vyraj'), ol([
      tx('Bifezi agentul după ce i-ai terminat tot lanțul. Site-ul lui și itemele pentru misiunile lui se bifează singure.'),
      tx('Progresul se salvează separat pentru fiecare caracter.'),
      tx('„Ascunde terminate” îți lasă în listă doar ce mai ai de făcut.'),
      tx('Butonul „Prețuri Jita” din lista de cumpărături îți spune cât costă itemele de pe piață.'),
    ]) + `<p>${button(tx('Deschide COSMOS'), { cls: 'sm', attrs: 'data-open-tool="cosmos"' })}</p>`),
  ].join('');
}
