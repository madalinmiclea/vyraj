import { tx } from '../i18n';

export interface Release { date: string; title: string; lead: string; items: string[] }

export const CHANGELOG: Release[] = [
  {
    date: '2026-10-28',
    title: tx('Un prag pentru fiecare pilot'),
    lead: tx('Vyraj își deschide porțile spre comunitate.'),
    items: [
      tx('Harta live arată New Eden ca în joc, cu fiecare kill de pe zKillboard la câteva secunde, gatecamp-urile marcate și alarme sonore când moare cineva la câteva sărituri de tine; caracterul tău e urmărit pe hartă, iar canalele de intel din chat se citesc singure.'),
      tx('Harta de suveranitate colorează spațiul nul pe alianțe, cu capitalele și campaniile de suveranitate la vedere.'),
      tx('Ecranul Start arată ce poate Vyraj dintr-o privire și drumul cel mai scurt spre fiecare unealtă, iar problemele se raportează direct pe GitHub.'),
      tx('Permisiunile se cer pe rând: login-ul vrea doar skill-urile, restul le aprobi abia când ai nevoie de ele, fiecare cu scope-urile ei la vedere.'),
      tx('Modul demo te pune la comanda unui pilot fictiv în toate ecranele, fără login și fără să atingă EVE.'),
      tx('Doctrine de flotă: fituri pe roluri, cine din corporație le poate zbura acum și cât mai are de antrenat, plus costul întregii flote în Jita.'),
      tx('Fiecare ecran are adresa lui, iar un link trimis pe Discord vine cu previzualizare.'),
      tx('Un backup într-un singur fișier mută fiturile, doctrinele și jurnalele pe alt calculator, iar Vyraj se instalează ca aplicație pe telefon sau desktop.'),
      tx('Graficul DPS pe distanță pune față în față până la cinci muniții pe aceeași țintă.'),
      tx('Aliniat la noul ESI: ecranul Operațiuni, rute prin sau pe lângă Thera și Turnur, SKINR și starea serverelor ESI la vedere.'),
      tx('Portofelul desface fiecare tick de bounty: ISK pe tick, cel mai bun tick, sistemele de ratting și navele NPC distruse, pe nume.'),
      tx('Bunurile se grupează pe locații, iar fiecare item își deschide fereastra Informații.'),
    ],
  },
  {
    date: '2026-10-27',
    title: tx('Fituri gata de zbor'),
    lead: tx('Nu mai pornești niciodată de la un hull gol.'),
    items: [
      tx('PvE fit și PvP fit încarcă fituri publicate de piloți pentru fiecare navă, aduse la module T2 și gata de ajustat.'),
      tx('Ghidul de misiuni L1–L5 și complexele DED: cine te atacă, cu ce damage și ce tank îți trebuie, cameră cu cameră.'),
      tx('Facțiunile pe care le vânezi vin cu damage-ul pe care îl trag și cel la care sunt slabe, legate de ghidul de misiuni.'),
      tx('Fereastra Informații începe cu o descriere limpede a ce face fiecare item.'),
      tx('Fiecare modul își poartă propriul script, iar hardpoint-urile libere se văd direct în sloturi.'),
    ],
  },
  {
    date: '2026-10-26',
    title: tx('Abisul are vreme'),
    lead: tx('Cifrele se apropie și mai mult de ce simți în cockpit.'),
    items: [
      tx('Vremea abisală intră în calcul și schimbă statisticile navei la fel ca filamentul.'),
      tx('Skill-urile care îți cresc DPS-ul și tank-ul, plus Mastery I–V, chiar sub fit.'),
      tx('Implanturile refăcute și dronele împărțite între spațiu și bay.'),
      tx('Prețurile grele rămân în memorie până le ceri din nou, cu ora la care au fost citite.'),
      tx('Vyraj pornește cu o treime mai ușor, iar meniul din stânga își spune numele sub fiecare iconiță.'),
    ],
  },
  {
    date: '2026-10-25',
    title: tx('Hangarul cu tab-uri'),
    lead: tx('Mai multe nave pe rampă deodată și o nouă cladă pentru industriași.'),
    items: [
      tx('Mai multe fituri deschise în tab-uri, ca în Pyfa, cu drone, fighteri, cargo, implanturi și note sub fiecare.'),
      tx('Un link de share deschide fitul tău oriunde, pentru oricine.'),
      tx('Industrie, Interacțiune planetară și Minerit, adunate sub Mokosh, cu lista de materiale gata de Multibuy.'),
      tx('Portofelul ține minte mai mult decât cele 30 de zile pe care le păstrează ESI, cu o hartă a activității pe 90 de zile.'),
    ],
  },
  {
    date: '2026-10-24',
    title: tx('Vyraj iese în New Eden'),
    lead: tx('Prima zi publică, deschisă oricărui capsuleer.'),
    items: [
      tx('Site public, pe desktop și pe telefon, în română și în engleză.'),
      tx('Trei teme, între care Vyraj, cu graiul triglavian al cladelor.'),
      tx('Intel PvP pe rută, Navigație cu salturi și Pochven, colecția de SKIN-uri și toate caracterele într-un singur panou.'),
      tx('Fitting-ul învață moduri T3D, fleet boosts, efecte proiectate, fighteri și supraîncălzire.'),
    ],
  },
  {
    date: '2026-10-23',
    title: tx('Pilotul din spatele fitului'),
    lead: tx('Vyraj află cine stă în capsulă.'),
    items: [
      tx('Login EVE cu skill-urile tale reale, iar fiecare fit îți spune ce mai ai de antrenat și cât durează.'),
      tx('Planuri de skill-uri și navele tale refăcute direct din hangar.'),
      tx('Fereastra Informații cu atribute, cerințe și variante, plus module abisale cu statistici proprii.'),
    ],
  },
  {
    date: '2026-10-22',
    title: tx('Piața prinde glas'),
    lead: tx('ISK-ul primește uneltele lui.'),
    items: [
      tx('Intel Jita: idei de trading, marje după taxe și rute între hub-uri.'),
      tx('Unelte ISK: evaluare, portofel, bunuri, magazin LP, jurnal abisal și alerte de preț.'),
    ],
  },
  {
    date: '2026-10-21',
    title: tx('Prima lumină'),
    lead: tx('Totul a pornit de la un fit.'),
    items: [
      tx('Motorul de fitting, verificat cifră cu cifră față de Pyfa.'),
      tx('Prețuri live din Jita pentru fiecare fit, cu import și export EFT.'),
    ],
  },
];
