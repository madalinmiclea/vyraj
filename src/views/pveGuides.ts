import { tx } from '../i18n';
import { esc, windowTitle } from '../ui/components';
import { faction, FACTIONS, CLASS_LABEL, EWAR_LABEL, type Dmg } from '../services/missions';

const DMG: Record<Dmg, [string, string]> = { em: ['EM', 'em'], th: [tx('Termic'), 'thermal'], kin: [tx('Cinetic'), 'kinetic'], exp: [tx('Exploziv'), 'explosive'] };
const dmg = (list: Dmg[]) => list.map((d) => `<span class="badge mis-dmg ${DMG[d][1]}">${DMG[d][0]}</span>`).join(' ');

const LOOK: Record<string, string> = {
  angel: tx('Corpuri Minmatar ruginii, asimetrice, cu marcaje roșu-închis. Rapide, țin distanță.'),
  blood: tx('Corpuri Amarr cu nuanțe de roșu sângeriu. Cultul lor golește capacitorul.'),
  guristas: tx('Corpuri Caldari, unghiulare, gri cu galben. Rachete și ECM.'),
  sansha: tx('Amestec de corpuri Amarr și Caldari, cu tentă verde. Echipaje de sclavi cu implanturi.'),
  serpentis: tx('Corpuri Gallente, rotunjite, verde închis cu violet. Blastere, drone și dampenere.'),
};

const EMPIRE_ROWS: { id: string; prefix: string; ex: string; look: string }[] = [
  { id: 'amarr', prefix: "Imperial, Imperial Navy, Imperial Templar", ex: "Imperial Templar Martyr, Imperial Navy Apocalypse", look: tx('Corpuri aurii, ca niște catedrale. Armură groasă și lasere.') },
  { id: 'caldari', prefix: "State, State Shukuro, Caldari Navy", ex: "State Shukuro Shogun, Caldari Navy Moa", look: tx('Corpuri gri-albăstrui, unghiulare, ca niște blocuri. Scut și rachete.') },
  { id: 'gallente', prefix: "Federation, Federation Navy", ex: "Federation Navy Thorax, Federation Navy Megathron", look: tx('Corpuri verzi, rotunjite, organice. Blastere și drone.') },
  { id: 'minmatar', prefix: "Republic, Republic Fleet, Republic Tribal", ex: "Republic Fleet Rupture, Republic Tribal Jarl", look: tx('Corpuri ruginii, asimetrice, ca sudate din fier vechi. Proiectile și viteză.') },
  { id: 'ammatar', prefix: "Ammatar Navy", ex: "Ammatar Navy Executioner", look: tx('Aliații Amarr: corpuri Amarr și aceleași daune.') },
  { id: 'khanid', prefix: "Khanid", ex: "Khanid Officer", look: tx('Regat aliat cu Amarr: corpuri Amarr, neut-uri.') },
];

const PIRATE_ROWS: { id: string; names: string[]; mission: string; spawn: string }[] = [
  { id: 'angel', names: ["Gistii", "Gistior", "Gistum", "Gistatis", "Gist"], mission: "Arch Gistii", spawn: "Domination" },
  { id: 'blood', names: ["Corpii", "Corpior", "Corpum", "Corpatis", "Corpus"], mission: "Elder Corpii", spawn: "Dark Blood" },
  { id: 'guristas', names: ["Pithi", "Pithior", "Pithum", "Pithatis", "Pith"], mission: "Dire Pithi", spawn: "Dread Guristas" },
  { id: 'sansha', names: ["Centii", "Centior", "Centum", "Centatis", "Centus"], mission: "—", spawn: "True Sansha" },
  { id: 'serpentis', names: ["Coreli", "Corelior", "Corelum", "Corelatis", "Core"], mission: "—", spawn: "Shadow Serpentis" },
  { id: 'drones', names: ["Alvi", "Alvior", "Alvum", "Alvatis", "Alvus"], mission: "Strain … Alvi", spawn: "—" },
];

function pirateTable() {
  const sizes = (['F', 'D', 'C', 'BC', 'BS'] as const).map((k) => CLASS_LABEL[k]);
  return `<div class="table-scroll"><table class="table compact mis-names">
    <thead><tr><th>${tx('Facțiune')}</th>${sizes.map((s) => `<th>${esc(s)}</th>`).join('')}<th>${tx('Variantă de misiune')}</th><th>${tx('Faction spawn (rar)')}</th></tr></thead>
    <tbody>${PIRATE_ROWS.map((r) => `<tr><td>${esc(faction(r.id).name)}</td>${r.names.map((n) => `<td class="mono">${esc(n)}</td>`).join('')}<td>${esc(r.mission)}</td><td>${esc(r.spawn)}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function card(name: string, look: string, id: string, extra = '') {
  const f = FACTIONS.find((x) => x.id === id);
  if (!f) return '';
  return `<div class="mis-fcard">
    <div class="mis-fcard-name">${esc(name)}</div>
    ${extra}
    <div class="mis-line"><span class="label">${tx('Cum arată')}</span><span>${esc(look)}</span></div>
    <div class="mis-line"><span class="label">${tx('Trage')}</span><span>${dmg(f.shoot)}</span></div>
    <div class="mis-line"><span class="label">${tx('Slab la')}</span><span>${dmg(f.weak)}</span></div>
    ${f.ewar.length ? `<div class="mis-line"><span class="label">EWAR</span><span>${f.ewar.map((e) => esc(EWAR_LABEL[e])).join(', ')}</span></div>` : ''}
  </div>`;
}

function pirateCards() {
  return `<div class="mis-fcards">${Object.entries(LOOK).map(([id, look]) => card(faction(id).name, look, id)).join('')}</div>`;
}

function empireCards() {
  return `<div class="mis-fcards">${EMPIRE_ROWS.map((r) => card(faction(r.id).name, r.look, r.id, `<div class="mis-line"><span class="label">${tx('Prefix')}</span><span class="mono">${esc(r.prefix)}</span></div><div class="mis-line"><span class="label">${tx('Exemple')}</span><span>${esc(r.ex)}</span></div>`)).join('')}</div>`;
}

export function enemyGuide(): string {
  return `
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`1 · ${tx('Ce înseamnă „contra cui”')}`)}</div>
      <div class="panel-body"><p>${tx('Fiecare misiune de luptă te trimite contra unei facțiuni NPC. Facțiunea îți spune trei lucruri înainte să tragi primul foc: ce daune primești, ce daune trebuie să tragi și dacă pierzi standing.')}</p><ul><li>${tx('Pirații: Angel Cartel, Blood Raiders, Guristas, Sansha\'s Nation, Serpentis. Îi poți omorî fără nicio grijă, nu pierzi standing la nimeni care contează.')}</li><li>${tx('Imperiile: Amarr, Caldari, Gallente, Minmatar și aliații lor (Khanid, Ammatar). O misiune contra lor îți scade standing-ul la imperiul respectiv.')}</li><li>${tx('Alte facțiuni: Rogue Drones, Mercenaries, Mordu\'s Legion, Thukker Tribe și câteva grupuri din storyline. De obicei nu costă standing, dar au obiceiuri proprii.')}</li></ul></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`2 · ${tx('Înainte să accepți misiunea')}`)}</div>
      <div class="panel-body"><ol><li>${tx('Deschizi oferta de la agent. Dacă misiunea te poate costa standing la o facțiune, fereastra afișează un avertisment roșu. Fără avertisment, inamicul e de obicei pirat sau o facțiune fără importanță pentru standing.')}</li><li>${tx('Poți refuza o misiune fără penalizare o dată la 4 ore pentru fiecare agent. Al doilea refuz în același interval îți scade puțin standing-ul cu agentul.')}</li><li>${tx('În Vyraj, adaugă în căutare filtrul „Agentul tău”: variantele contra facțiunii agentului dispar, iar celelalte imperii apar marcate cu „scade standing”.')}</li></ol></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`3 · ${tx('Briefing-ul și jurnalul')}`)}</div>
      <div class="panel-body"><ol><li>${tx('Citește briefing-ul până la capăt. De cele mai multe ori numește direct inamicul sau îl descrie (de exemplu „o bandă de pirați Guristas”).')}</li><li>${tx('În fereastra misiunii, la obiective, apare facțiunea cu care te bați și, uneori, tipul de daune recomandat.')}</li><li>${tx('Caută numele misiunii aici, în Vyraj. Multe misiuni au mai multe variante, câte una pe facțiune. Cardul arată fiecare variantă, cu daunele primite și muniția potrivită pentru fit-ul tău.')}</li></ol></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`4 · ${tx('Pe grid: cum recunoști inamicul')}`)}</div>
      <div class="panel-body"><p>${tx('Când ajungi în misiune, uită-te în Overview la numele navelor roșii. Numele NPC-urilor urmează un tipar fix, iar după câteva misiuni le recunoști dintr-o privire.')}</p><ul><li>${tx('Click dreapta pe o navă NPC și alegi Show Info: vezi grupul ei (de exemplu „Asteroid Guristas Frigate” sau „Mission Amarr Empire Battleship”), deci și facțiunea.')}</li><li>${tx('Iconița din Overview îți arată mărimea: fregată, distrugător, crucișător, battlecruiser sau battleship.')}</li><li>${tx('Navele NPC pirat folosesc corpurile imperiului din care se trag, vopsite în culorile facțiunii. O navă care arată Minmatar dar are nume de pirat e aproape sigur Angel Cartel.')}</li></ul></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`5 · ${tx('Cum citești numele unui pirat')}`)}</div>
      <div class="panel-body"><p>${tx('Fiecare facțiune pirat are o rădăcină de nume, iar terminația îți spune mărimea navei. Rădăcina vine din latină și rămâne aceeași la toate navele facțiunii.')}</p><ul><li>${tx('Terminația -ii sau -i înseamnă fregată, -ior distrugător, -um crucișător, -atis battlecruiser, iar rădăcina scurtă sau terminația -us înseamnă battleship.')}</li><li>${tx('Al doilea cuvânt e doar un „rang” (Hijacker, Centurion, Bishop, Admiral). Îți dă o idee de cât de puternică e nava, dar facțiunea și mărimea vin din primul cuvânt.')}</li><li>${tx('În misiuni apar și variante mai tari, cu un cuvânt în față: Dire Pithi (Guristas), Arch Gistii (Angel), Elder Corpii (Blood). Rădăcina rămâne aceeași.')}</li></ul>${pirateTable()}<p>${tx('Navele „faction” (Domination, Dark Blood, Dread Guristas, Shadow Serpentis, True Sansha) sunt rare, mult mai puternice și pot lăsa module faction care valorează mult. Dacă vezi una, merită s-o omori și să verifici epava.')}</p></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`6 · ${tx('Facțiunile pirat pe scurt')}`)}</div>
      <div class="panel-body"><p>${tx('Pentru fiecare facțiune ai mai jos cum arată navele, ce daune trag, unde sunt slabe și ce îți fac (EWAR). Tragi în slăbiciunea lor și îți pui rezistențe pe daunele pe care le primești.')}</p>${pirateCards()}</div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`7 · ${tx('Imperiile: cum arată navele lor')}`)}</div>
      <div class="panel-body"><p>${tx('Navele NPC ale imperiilor sunt chiar navele pe care le zbori și tu, cu nume de flotă în față. Le recunoști ușor după formă și după prefix.')}</p>${empireCards()}<p>${tx('Misiunile contra imperiilor scad standing-ul și la imperiul atacat. Dacă vrei să rămâi bine cu toate imperiile, refuză-le sau alege agenți la care varianta respectivă nu apare.')}</p></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`8 · ${tx('Alte facțiuni')}`)}</div>
      <div class="panel-body"><ul><li>${tx('Rogue Drones: drone scăpate de sub control, fără pilot. Numele urmează același tipar (Alvi, Alvior, Alvum, Alvatis, Alvus), iar în misiuni apar cu nume ca Strain Infester Alvi sau Render Alvi. Nu au bounty mare și lasă materiale de drone în loc de module.')}</li><li>${tx('Mercenaries: nume simple, ca Mercenary Fighter, Mercenary Wingman sau Mercenary Commander. Au des web și scram, așa că nu te lasă să fugi ușor.')}</li><li>${tx('Mordu\'s Legion: prefixul Mordus, urmat de numele navei (Mordus Katana, Mordus Gladius, Mordus Mammoth). Țin de departe, cu rachete, și te pot scrambla.')}</li><li>${tx('Thukker Tribe: un trib Minmatar, cu nume ca Thukker Mercenary Fighter. Nave Minmatar, daune explozive și cinetice.')}</li><li>${tx('CONCORD și Equilibrium of Mankind apar doar în câteva misiuni speciale. Citește cardul misiunii înainte să tragi în ele.')}</li></ul></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`9 · ${tx('Ce faci cu informația')}`)}</div>
      <div class="panel-body"><ol><li>${tx('Fit-ul: rezistențele pe daunele pe care le primești, muniția pe slăbiciunea lor. Butonul „Verifică tank-ul în Fitting” de pe card face calculul pentru tine.')}</li><li>${tx('Ordinea țintelor: întâi navele care te scramblează, te webează sau îți golesc capacitorul, apoi fregatele elite, apoi restul.')}</li><li>${tx('Trigger-ele: unele nave cheamă următorul val când mor. Cardul misiunii le marchează. Nu trage în trigger până nu ești gata de următorul val.')}</li><li>${tx('Aggro: când intri în cameră, NPC-urile aleg pe cine să atace. Dronele tale pot lua aggro, așa că lansează-le după ce primul val s-a fixat pe navă.')}</li></ol></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`10 · ${tx('Mic dicționar')}`)}</div>
      <div class="panel-body"><ul><li>${tx('Rat: orice navă NPC ostilă. Ratting înseamnă vânătoare de NPC-uri pentru bounty.')}</li><li>${tx('Spawn sau val: un grup de NPC-uri care apare deodată.')}</li><li>${tx('Trigger: nava care, distrusă, aduce valul următor.')}</li><li>${tx('Scram și web: scram îți oprește MWD-ul și warp-ul, web te încetinește.')}</li><li>${tx('Bounty: ISK-ul primit automat pentru fiecare NPC distrus.')}</li><li>${tx('Faction spawn: un NPC rar și puternic al unei facțiuni pirat, cu loot valoros.')}</li></ul></div>
    </section>`;
}

export function dedGuide(): string {
  return `
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`1 · ${tx('Ce e un complex DED')}`)}</div>
      <div class="panel-body"><p>${tx('Un complex DED e un site de luptă ascuns, cu mai multe camere legate prin porți de accelerare. DED vine de la departamentul CONCORD care le clasifică, iar ratingul (1/10 până la 10/10) arată cât de greu e complexul.')}</p><ul><li>${tx('Nu apare în lista de anomalii. E o semnătură de tip Combat, pe care trebuie s-o găsești cu probe.')}</li><li>${tx('În ultima cameră te așteaptă un boss, numit des Overseer. Din epava lui pică Overseer\'s Personal Effects (se vinde pe piață) și, cu noroc, module faction sau blueprint-uri.')}</li><li>${tx('Complexele mici (1/10 până la 4/10) se găsesc și în highsec. Cele mari sunt în lowsec și nullsec, unde poți întâlni alți jucători.')}</li></ul></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`2 · ${tx('Ce îți trebuie')}`)}</div>
      <div class="panel-body"><ul><li>${tx('Un Core Probe Launcher pe un slot high liber și 8 Core Scanner Probes în cargo. Probele obișnuite găsesc fără probleme site-uri de luptă.')}</li><li>${tx('Skill-ul Astrometrics, apoi Astrometric Rangefinding, Astrometric Pinpointing și Astrometric Acquisition. Fiecare nivel face scanarea mai rapidă și mai sigură.')}</li><li>${tx('O navă potrivită pentru scanare: fregatele de explorare (Heron, Imicus, Magnate, Probe) sau Covert Ops au bonus mare la probe. Mulți scanează cu o fregată și vin apoi cu nava de luptă.')}</li><li>${tx('O navă de luptă care are voie pe poartă. Fiecare complex are o limită de nave, scrisă pe cardul lui.')}</li></ul></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`3 · ${tx('Scannerul pe scurt')}`)}</div>
      <div class="panel-body"><ul><li>${tx('Deschizi Probe Scanner cu Alt + P. Lista de jos arată toate semnăturile din sistem, fiecare cu un cod de forma ABC-123 și un procent.')}</li><li>${tx('Anomaliile apar deja la 100% și nu au nevoie de probe. Semnăturile încep de la 0% și trebuie scanate.')}</li><li>${tx('Tipurile de semnături sunt Combat, Relic, Data, Gas, Wormhole și Ore. Pentru DED te interesează doar Combat. După primul Analyze vezi și tipul fiecăreia.')}</li></ul></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`4 · ${tx('Prima scanare')}`)}</div>
      <div class="panel-body"><ol><li>${tx('Apeși Launch și lansezi 8 probe. În scanner alegi formația largă, care acoperă tot sistemul sau o bună parte din el.')}</li><li>${tx('Apeși Analyze și aștepți câteva secunde. Semnăturile primesc un procent și, de la vreo 25%, vezi și tipul lor.')}</li><li>${tx('Alegi o semnătură de tip Combat. Pe hartă apare ca o sferă, un arc sau un punct, în funcție de cât de aproape ești de ea.')}</li></ol></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`5 · ${tx('Strângi cercul')}`)}</div>
      <div class="panel-body"><ol><li>${tx('Muți probele peste semnătură. Cu Shift apăsat le tragi pe toate deodată.')}</li><li>${tx('Înjumătățești raza probelor. Cu Alt apăsat schimbi raza tuturor deodată.')}</li><li>${tx('Apeși din nou Analyze. Procentul crește, iar punctul de pe hartă trece din roșu în galben și apoi în verde.')}</li><li>${tx('Repeți până la 100%. Atunci vezi numele complexului și poți face warp direct la el.')}</li><li>${tx('Apeși Recall ca probele să se întoarcă în cargo. Le poți folosi din nou la următoarea scanare.')}</li></ol></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`6 · ${tx('La poartă și înăuntru')}`)}</div>
      <div class="panel-body"><ol><li>${tx('Ajungi la o poartă de accelerare. Click dreapta, Show Info, îți arată ce nave au voie. Dacă nava ta nu are voie, poarta nu te lasă să treci.')}</li><li>${tx('Fiecare cameră are NPC-uri și, des, alt trigger pentru poarta următoare. Cardul complexului din Vyraj arată camerele, NPC-urile și ce daune trag.')}</li><li>${tx('În ultima cameră omori bossul și verifici epava lui, plus containerele de loot dacă există.')}</li><li>${tx('Oricine poate scana același complex. În lowsec și nullsec urmărește Local și D-scan, iar dacă apar probe de luptă sau nave necunoscute, pleacă la timp.')}</li></ol></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`7 · ${tx('Escaladări')}`)}</div>
      <div class="panel-body"><p>${tx('Unele complexe nu se scanează, ci vin ca escaladare. Când termini anumite anomalii de luptă (de exemplu Hideaway, Refuge sau Den), primești uneori o expediție cu locația unui complex DED. O găsești în jurnal, la expediții.')}</p><p>${tx('Cardul fiecărui complex scrie dacă poate veni ca escaladare și din ce anomalie. Vezi și secțiunea Escaladări din Unelte PvE.')}</p></div>
    </section>
    <section class="panel mis-lesson">
      <div class="panel-head">${windowTitle(`8 · ${tx('Semnătura și skill-urile')}`)}</div>
      <div class="panel-body"><p>${tx('Semnătura (20%, 10%, 5% sau 2.5%) arată cât de greu e de scanat. La 2.5% îți trebuie skill-urile de scanare cât mai sus: Astrometrics, Astrometric Rangefinding, Astrometric Pinpointing și Astrometric Acquisition.')}</p><p>${tx('Dacă procentul nu mai crește, apropie probele, micșorează raza sau folosește o navă cu bonus la scanare.')}</p></div>
    </section>`;
}
