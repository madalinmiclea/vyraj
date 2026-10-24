# Vyraj

Prețuri Jita, fitting în stilul Pyfa, import de caracter din EVE, requirements pentru orice item, SKIN-uri și unelte de ISK. Aplicație statică: rulează complet în browser, fără server. Toate datele utilizatorului (caractere, token-uri, fit-uri, SKIN-uri, setări) stau doar în localStorage-ul browserului.

## Local

```bash
npm install
npm run dev    # http://localhost:5173
```

La primul `npm run dev` se generează automat datele din SDE: fișierele brute în `data/`, iar copiile publicate, cu hash în nume, în `public/data/` (plus `manifest.json`). `npm run data` le regenerează oricând (după un patch EVE).

Pentru login EVE local, pune în `.env.local`:

```
VITE_EVE_CLIENT_ID=<client id-ul aplicației EVE cu callback http://localhost:5173/callback>
```

## Comenzi

| Comandă | Ce face |
| --- | --- |
| `npm run dev` | aplicația, cu reîncărcare la salvare |
| `npm run typecheck` | verificare TypeScript |
| `npm run build` | build de producție în `dist/` |
| `npm run data` | regenerează datele din SDE |

## Variabile de build

| Variabilă | Ce face |
| --- | --- |
| `VITE_EVE_CLIENT_ID` | Client ID-ul aplicației EVE. Dacă lipsește, utilizatorul își pune propriul Client ID în ecranul Caracter. |
| `VITE_EVE_CALLBACK_URL` | Callback URL-ul înregistrat la EVE. Implicit `<origin>/callback`. |
| `VITE_EVE_TOKEN_URL` | Endpoint-ul de token SSO. Implicit `https://login.eveonline.com/v2/oauth/token`. |
| `BASE_PATH` | Calea de bază, dacă site-ul nu e servit din rădăcină (ex: `/vyraj/`). |

## Hosting (Cloudflare Pages)

Workflow-ul `.github/workflows/deploy.yml` rulează la fiecare push pe `main`, săptămânal (miercuri, după patch-urile de marți) și manual. Descarcă SDE-ul, construiește aplicația și o publică pe Cloudflare Pages.

În GitHub, la Settings → Secrets and variables → Actions:

- Secrets: `CLOUDFLARE_API_TOKEN` (permisiune Cloudflare Pages: Edit), `CLOUDFLARE_ACCOUNT_ID`
- Variables: `EVE_CLIENT_ID`, `EVE_CALLBACK_URL` (ex: `https://vyraj.pages.dev/callback`), opțional `CF_PAGES_PROJECT`

## Aplicația EVE

Pe [developers.eveonline.com/applications](https://developers.eveonline.com/applications): **Authentication & API Access**, callback-ul site-ului și scope-urile `esi-skills.read_skills.v1`, `esi-skills.read_skillqueue.v1`, `esi-clones.read_implants.v1`, `esi-fittings.read_fittings.v1`, `esi-fittings.write_fittings.v1`, `esi-assets.read_assets.v1`, `esi-location.read_ship_type.v1`, `esi-wallet.read_character_wallet.v1`, `esi-characters.read_loyalty.v1`. Login-ul folosește PKCE, deci nu există Secret Key în aplicație.

## Structură

```
src/data/        SDE: încărcare și căutare atribute/efecte
src/engine/      motorul de fitting: dogma, statistici, capacitor, profile de damage
src/character/   login SSO, ESI, caractere, requirements, timp de antrenament
src/io/          EFT, DNA, Multibuy, fit-uri ESI
src/services/    market, intel, SKIN-uri, wallet, alerte
src/views/       ecranele aplicației
src/ui/          componente comune
scripts/         generarea datelor din SDE
```

Formulele urmează Pyfa (GPL-3.0), folosit doar ca referință, fără cod copiat.
