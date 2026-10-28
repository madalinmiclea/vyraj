import { tx } from '../i18n';

export interface Release { date: string; title: string; lead: string; items: string[] }

export const CHANGELOG: Release[] = [
  {
    date: '2026-10-28',
    title: tx('Druzhina, flota prinde formă'),
    lead: tx('Corporațiile își pun doctrinele pe masă.'),
    items: [
      tx('Doctrine de flotă: fituri pe roluri, cine din corporație le poate zbura acum și cât mai are de antrenat, plus costul întregii flote în Jita.'),
      tx('O doctrină pleacă pe Discord ca link sau ca text EFT și se întoarce la fel, cu toate fiturile la locul lor.'),
      tx('Fiecare ecran are adresa lui, iar meniul din stânga își spune numele sub fiecare iconiță.'),
      tx('Un backup într-un singur fișier mută fiturile, doctrinele și jurnalele pe alt calculator.'),
      tx('Graficul DPS pe distanță pune față în față până la cinci muniții pe aceeași țintă.'),
      tx('Vyraj pornește cu o treime mai ușor și se instalează ca aplicație pe telefon sau desktop.'),
    ],
  },
  {
    date: '2026-10-28',
    title: tx('Un prag pentru fiecare pilot'),
    lead: tx('Vyraj își deschide porțile spre comunitate.'),
    items: [
      tx('Ecranul Start arată ce poate Vyraj dintr-o privire și drumul cel mai scurt spre fiecare unealtă.'),
      tx('Permisiunile se cer pe rând: login-ul vrea doar skill-urile, restul le aprobi abia când ai nevoie de ele.'),
      tx('Ghidul de misiuni L1–L5 și complexele DED: cine te atacă, cu ce damage și ce tank îți trebuie, cameră cu cameră.'),
      tx('Fereastra Informații începe cu o descriere limpede a ce face fiecare item.'),
      tx('Româna ajunge până la ultima etichetă, iar Creditele mulțumesc comunității pe care se sprijină Vyraj.'),
    ],
  },
  {
    date: '2026-10-27',
    title: tx('Fituri gata de zbor'),
    lead: tx('Nu mai pornești niciodată de la un hull gol.'),
    items: [
      tx('PvE fit și PvP fit încarcă fituri publicate de piloți pentru fiecare navă, aduse la module T2 și gata de ajustat.'),
      tx('Fiecare modul își poartă propriul script.'),
      tx('Hardpoint-urile libere se văd direct în sloturi.'),
    ],
  },
  {
    date: '2026-10-26',
    title: tx('Abisul are vreme'),
    lead: tx('Cifrele se apropie și mai mult de ce simți în cockpit.'),
    items: [
      tx('Vremea abisală intră în calcul și schimbă statisticile navei la fel ca filamentul.'),
      tx('Implanturile refăcute și dronele împărțite între spațiu și bay.'),
      tx('Skill-urile care îți cresc DPS-ul și tank-ul, plus Mastery I–V, chiar sub fit.'),
      tx('Prețurile grele rămân în memorie până le ceri din nou, cu ora la care au fost citite.'),
    ],
  },
  {
    date: '2026-10-25',
    title: tx('Hangarul cu tab-uri'),
    lead: tx('Mai multe nave pe rampă deodată și o nouă cladă pentru industriași.'),
    items: [
      tx('Mai multe fituri deschise în tab-uri, ca în Pyfa, cu drone, fighteri, cargo, implanturi și note sub fiecare.'),
      tx('Un link de share deschide fitul tău oriunde, pentru oricine.'),
      tx('Industrie, Interacțiune planetară și Minerit, adunate sub Mokosh.'),
      tx('Portofelul ține minte mai mult decât cele 30 de zile pe care le păstrează ESI.'),
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
      tx('Prețuri live din Jita, login EVE, skill-uri și navele tale refăcute din hangar.'),
    ],
  },
];
