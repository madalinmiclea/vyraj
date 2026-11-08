# Vyraj

*o7, capsuleer. May your flow stay unbroken and every Proving end in your favour.*

Vyraj is a free web toolkit for EVE Online pilots: Jita market prices, a Pyfa-style fitting simulator, doctrines, character and skill planning, wallet, market orders and contracts, mail and notifications, industry, planetary interaction, mining, market and PvP intel, navigation, and mission, COSMOS and PvE guides, all in one place.

**Live:** [madalinmiclea.github.io/vyraj](https://madalinmiclea.github.io/vyraj/)

**Found a bug or have an idea?** [Open an issue](https://github.com/madalinmiclea/vyraj/issues). The Start screen and the Credits page also link there, next to the changelog.

It is a static site and runs in your browser. Your characters, login tokens, fits, doctrines, SKIN collection, journals, mail cache and settings are stored only in your browser. Vyraj talks to these services:

- **CCP** (ESI and EVE SSO): your character data, only with the permissions you give.
- **Fuzzwork**: Jita prices. **zKillboard** and **EVE-Scout**: public kills and wormhole connections. **EVE Workbench**: published fits for the PvE and PvP fit buttons.
- **The Vyraj worker** (a small Cloudflare Worker): collects the public zKillboard kill feed once for everyone and keeps the last hour, and stores a fit only when you create a short share link. A short link keeps the fit, its name and its notes, and is removed after a year without use.

## User guide

### Getting around

- **Start**: the first screen. It explains what Vyraj does, lists every tool by group, shows your active pilot and saved fits once you log in, and the latest entries from the changelog.
- **Demo mode**: the Start screen has a "Try with demo data" button. It loads a fictional pilot with skills, wallet, assets, industry, colonies and logs, so you can see every screen without logging in. Demo data never appears outside demo mode.
- **Neocom** (the left rail, bottom bar on phones): switches between modules. The modules are grouped in clades, in this order:
  - **Veles**: Market, Intel Jita, Wallet, Market orders
  - **Svarog**: Fitting, Doctrines, SKINs
  - **Perun**: Character, Mail, Notifications, Intel PvP, Navigation
  - **Mokosh**: Mining, Industry, Planetary Interaction
  - **Morana**: Missions, COSMOS, PvE
  - **Rod**: Credits
- **Links per screen**: every screen has its own address (for example `/vyraj/fitting` or `/vyraj/doctrines`), so you can bookmark or share it, and the browser back button works.
- **Install**: Vyraj can be installed as an app from the browser menu (Add to Home Screen on phones, Install on desktop).
- **Backup**: the Start and Character screens can download all your local data (fits, doctrines, skill plans, custom characters, logs and settings) as one file and restore it on another computer. EVE logins are never written to the file.
- **Left panel**: the item browser or the screen's own menu. On phones it opens from the ☰ button at the top left, and the screen's sections also show as tabs at the top.
- **Top right**: your characters, the **SSO** button with all EVE permissions, the theme switch and the language switch (RO / EN).
- **Right-click** any item in the browser to open its full info: description, attributes, variations and skill requirements.
- **Logo**: clicking the Vyraj logo reloads the latest published version.

### Characters

Use **Add character** in the top right and log in with your EVE account. You can add as many characters as you like and switch between them from the same menu. Until you log in, Vyraj uses a theoretical character with all skills at level V, so every screen still works. Logging a character out revokes its login and deletes all its local data.

The **Character** screen shows your skills by group, your skill queue, a skill plan you can build from any item's requirements, and the time each step takes with your attributes and implants. The plan also suggests the optimal attribute remap and the implants and boosters that save the most time. **Copy skills** at the bottom of the skill list copies all trained skills as text. With several characters, the **All characters** panel shows every character at once: what is training, when queues end, where they are, Alpha or Omega, wallet and total SP.

### Veles

#### Market

Search any item or pick it from the browser to see live Jita 4-4 buy and sell orders, the spread, price history and the same item in the other trade hubs (you can add your own hubs). The order book lists orders from every region, with filters and the jumps from a starting system. Items with no orders in Jita right now are greyed out in the browser. PLEX uses the global PLEX market.

#### Intel Jita

Scans the Jita market for opportunities: trading ideas, the most traded items, station trading margins after tax and broker fees, price trends and hauling routes between hubs. Margins are always calculated as buy in one place, sell in another, and are shown net of sales tax and broker fees based on your Accounting and Broker Relations skills.

#### Wallet

Balance, journal and transactions, totals per period (24 h, 7, 30 and 90 days or all time), income and spending per category, bounties and ticks, where you ratted, ISK locked in buy order escrow and CSV export. ESI only keeps 30 days, so Vyraj keeps the older history locally. With the right corporation roles it also shows the corporation wallets, divisions and member taxes.

#### Market orders

- **Orders:** the active orders of all your characters in one list, with the order history of the last 90 days. Vyraj checks every few minutes, while it is open, whether someone outbid or undercut you and can send a browser notification. For every beaten order it shows the new price that puts you first again, respecting EVE's price tick.
- **Contracts:** your contracts and your corporation's, valued at Jita prices, with expiry.
- **What's missing:** paste a list (inventory, contract, EFT or Multibuy) and see what your characters already own and what you still need to buy.
- **Appraisal:** paste items from your inventory, a contract or an EFT fit and get their Jita value.
- **Price alerts:** get a browser notification when an item crosses a price you set, while Vyraj is open.
- **Assets:** everything you own, valued at Jita prices.

### Svarog

#### Fitting

A fitting simulator with its own engine built on the SDE modifiers, checked against Pyfa:

- Open several fits at once in tabs, like in Pyfa. Under the fit, the Drones, Fighters, Cargo, Implants, Boosters, Projected, Command and Notes tabs hold everything that is not fitted in a slot.
- Pick a ship, then click a slot. The browser narrows down to modules for that slot only.
- Fits always stay valid. Any change that would break CPU, powergrid, calibration, hardpoints, slots or drone bandwidth is blocked and the reason is shown.
- Stats include DPS and volley, EHP and resists against damage profiles, capacitor, speed, targeting and the fit's cost at Jita sell prices (hull, fitted modules and drones). Hover a stat to see where every bonus comes from.
- **Improvement skills:** the skills that raise DPS, tank and other stats the most for this fit, and the ship's Mastery levels.
- **Applied DPS:** pick a target (signature, speed, distance) and see the DPS curve by distance, and compare up to four other ammo types on the same chart.
- **PvE tank:** pick a mission or anomaly and the NPC faction. Vyraj shows the damage you receive, EHP against that profile, whether your tank is sustainable or the time until you die, the damage type to shoot back with and what their electronic warfare does to your fit.
- **PvE fit / PvP fit:** load a published fit for the current ship.
- Import and export EFT, DNA and Multibuy, save fits, compare saved fits side by side, load fits saved in the game, send a fit to the game, and rebuild fits from the ships you own.
- **Share:** copy a link that opens the fit directly in Vyraj, or send it to Discord, Reddit, messengers or email. Short links are stored by the Vyraj worker.
- Scripts and charges per module, T3 destroyer modes, overheating, fleet boosts, projected effects, fighters, abyssal (mutated) modules and mutated drones with a mutaplasmid roll simulator.

#### Doctrines

Fleet doctrines for your corporation. A doctrine is a named set of fits, each with a role (DPS, Logistics, Tackle, EWAR, Boosts, Scout, Support), a requested count and a main or alternative flag.

- **Who can fly:** for every character you logged in (or created as custom), see which fits they can fly now and how much training each one still needs. Click a training time to add the missing skills to that character's skill plan.
- **Cost:** the Jita sell price of the whole doctrine, per role, with a combined Multibuy list.
- **Sharing:** copy a link that opens the doctrine in Vyraj for anyone, or copy it as EFT text grouped by role for Discord. Pasting that text (or any set of EFT fits, with role lines such as `## logi`) imports it back.
- Add fits from your saved fits, from the fit open in Fitting, or by pasting EFT. Each fit opens in Fitting with one click.

#### SKINs

Your SKIN collection per ship and per line, what you still miss, and the cheapest way to complete a collection, plus your SKINR licenses, components and Paragon Hub listings. Each ship also shows its Mastery levels. ESI cannot read activated SKINs, so the collection is synced from your assets while Vyraj is open.

### Perun

#### Mail

The in-game mail of the selected character: labels, mailing lists, reading, organizing and sending. Mail is cached in the browser, so it opens fast.

#### Notifications

Vyraj alerts for the market (order filled, expired or beaten, price alerts, expiring contracts and courier deadlines), your pilot (finished skills, empty queue, new mail), production (finished industry jobs, stopped PI extractors), PvP kills near you and your in-game notifications. It keeps a history, shows what is coming next and lets you choose what to be told about.

#### Intel PvP

- **Live map:** New Eden drawn like the in-game 2D map, with every kill from the last hour in the zKillboard feed, kills per hour, possible gate camps and battles marked, sound and desktop alarms for kills and chat intel a few jumps from you, your characters followed on the map and Thera and Turnur connections. In Chrome and Edge it can read your intel channels straight from the EVE chat logs.
- **Route:** checks a route between two systems (shortest, safest or through low and null) for recent kills, ship and pod losses per system, so you can spot gatecamps before you undock.
- **Local and D-Scan:** paste the Local member list or a D-Scan result from the game. Vyraj shows the corporations and alliances present, the ships on scan, an estimated threat and the PvP history of the pilots.
- **Fight analysis:** drop your Gamelogs files to see each fight: damage and DPS dealt and received, hits and misses with their quality, what hit you and the key moments, with charts.

#### Navigation

A jump planner for capital ships with fatigue, your visited systems drawn on the map with exploration routes and a travel fit suggestion, the current state of Pochven, the latest Thera and Turnur wormhole connections, a sovereignty map with alliance territory, NPC null-sec and live campaigns, and an Ansiblex fee calculator.

### Mokosh

#### Mining

ISK per hour for every type of ore, ice, moon ore and gas, computed from your mining fit and skills, plus raw, compressed and reprocessed value per m³ at Jita prices. It also has a reprocessing calculator for pasted items, a compressed ore calculator for a mineral target, your mining ledger and your corporation's moon extractions.

#### Industry

- **Calculator:** manufacturing and invention cost of any item, with ME and TE, structure and rigs, the system cost index and your skills, compared with the Jita sell price after taxes. Profit per unit and ISK per hour, plus invention chance and a comparison of all decryptors.
- **My blueprints:** your BPOs and BPCs, each opens straight in the calculator.
- **Active jobs** and **Corporation jobs:** the industry jobs of all your characters and of your corporation, and when they finish.
- **R&D agents:** your research points per agent and how many datacores you can collect.

#### Planetary Interaction

- **Colonies and timers:** the colonies of all your characters with exact extractor expiry, storage and factories.
- **Chain profit:** profit per cycle and per hour for every P0 to P4 product at Jita prices, after POCO taxes, and at which tier it is worth stopping.
- **Chain planner:** the full production chain of a product, the P0 it needs and the minimum combination of planet types.
- **Find planets:** the closest planets of the types you pick, wormholes included, and what you can build from one system.
- **Schematics:** every P0 to P4 schematic and its inputs.

### Morana

#### Missions

A guide for every L1 to L5 and storyline mission and DED site: rooms, waves, triggers, the damage to tank and to deal, ships allowed and the short blitz version. Search by name from two letters. The side menu also has **Agents**, **NPC standings** (your effective standing with social skills and the agent level each corporation unlocks), the **LP Store** (best ISK per LP for the points you have) and the blitz guides.

#### COSMOS

Every COSMOS line, step by step: agents, the standing each one needs against yours, jumps, the items to bring at Jita prices and progress per character.

#### PvE

- **Your activity:** PvE income from the wallet journal (ratting by NPC class, officers, LP) and the Abyssal journal.
- **Ratting and exploration:** where to rat, the anomaly guide, escalations and DED complexes.
- **Abyssal:** the Abyssal guide.
- **Fleet:** incursions, military campaigns and Faction Warfare.
- **From ESI:** freelance jobs, Mercenary Dens and raidable skyhooks.

### Rod

#### Credits

Everyone whose data, guides and tools Vyraj builds on, with the license and a link to report issues.

## Why Vyraj asks for each permission

Login asks only for the first three permissions below: skills, skill queue and implants. Every other permission is asked separately, the first time you open the screen that needs it, with an Allow button that explains what it is for. You can also see and grant them all from the **SSO** button in the top bar, which has an Accept all option. Each one is used only for the feature listed, only for the character you logged in with, and only from your own browser.

| Permission | What Vyraj does with it |
| --- | --- |
| `esi-skills.read_skills.v1` | Reads your trained skills, so fitting stats, requirements and training times match your character instead of an all-V character. |
| `esi-skills.read_skillqueue.v1` | Shows your skill queue and when it ends, in the Character screen and the character overview. |
| `esi-clones.read_implants.v1` | Reads your active implants, so their bonuses are applied to your fits and to training speed. |
| `esi-fittings.read_fittings.v1` | Loads the fits you saved in the game, so you can open them in the simulator. |
| `esi-fittings.write_fittings.v1` | Sends a fit from Vyraj to your in-game saved fittings, only when you press the button. It can add or remove saved fits and nothing else. |
| `esi-assets.read_assets.v1` | Reads your items: to rebuild fits from ships you own, value your assets and sync your SKIN collection. |
| `esi-location.read_ship_type.v1` | Shows which ship each character is currently flying. |
| `esi-location.read_location.v1` | Shows the system and station each character is in, in the character overview. |
| `esi-location.read_online.v1` | Shows whether a character is online and when it last logged in. |
| `esi-universe.read_structures.v1` | Turns player structure IDs into names, so locations read "station name" instead of a number. |
| `esi-wallet.read_character_wallet.v1` | Shows your ISK balance, wallet journal and transactions in Wallet, and your PvE income in PvE. |
| `esi-characters.read_loyalty.v1` | Reads your loyalty points, so the LP Store in Missions shows the best offers for the LP you actually have. |
| `esi-markets.read_character_orders.v1` | Reads your active and past market orders, for the Market orders screen and the outbid and undercut alerts. It cannot place, change or cancel orders. |
| `esi-planets.manage_planets.v1` | Reads your planetary colonies, extractor timers, storage and factories for the Planetary Interaction screen. Vyraj only reads them and never changes a colony. |
| `esi-characters.read_blueprints.v1` | Reads your blueprints, so the Industry screen can list them and calculate with their real ME, TE and runs. |
| `esi-industry.read_character_jobs.v1` | Shows your running industry jobs and when they finish. |
| `esi-industry.read_corporation_jobs.v1` | Shows your corporation's industry jobs, who started them and when they finish. Needs Factory Manager or Director. |
| `esi-characters.read_agents_research.v1` | Reads your R&D agent research (field, RP per day, RP collected), in Industry. |
| `esi-characters.read_freelance_jobs.v1` | Shows the freelance jobs you accepted, in PvE. |
| `esi.activity.char:read` | Reads the military campaign objectives you take part in and your contribution, in PvE. |
| `esi-structures.read_character.v1` | Reads your Mercenary Dens (development, anarchy, infomorphs), in PvE. |
| `esi-activities.read_character.v1` | Reads the tactical operations available at your Mercenary Dens, in PvE. |
| `esi.cosmetic.char:read` | Reads your SKINR licenses, components and Paragon Hub listings. |
| `esi-mail.read_mail.v1` | Shows your EVE mail in the Mail screen. |
| `esi-mail.organize_mail.v1` | Marks mail as read, moves or deletes it, only when you press the button. |
| `esi-mail.send_mail.v1` | Sends a mail you wrote in Vyraj, only when you press Send. |
| `esi-contracts.read_character_contracts.v1` | Shows your contracts in Market orders > Contracts. |
| `esi-contracts.read_corporation_contracts.v1` | Shows your corporation's contracts, if your roles allow it. |
| `esi-characters.read_corporation_roles.v1` | Checks your corporation roles, so corporation screens only ask for what you can see. |
| `esi-wallet.read_corporation_wallets.v1` | Shows corporation wallet divisions and taxes, if your roles allow it. |
| `esi-corporations.read_divisions.v1` | Shows the names of the corporation wallet divisions. |
| `esi-characters.read_notifications.v1` | Shows your in-game notifications in the Notifications screen. |
| `esi-industry.read_character_mining.v1` | Reads your mining ledger, for the Mining screen. |
| `esi-industry.read_corporation_mining.v1` | Reads your corporation's moon extractions (chunk arrival and auto fracture). Needs Station Manager or Director. |
| `esi-characters.read_contacts.v1` | Reads your contacts, so the sovereignty map and intel can show standings. |
| `esi-corporations.read_contacts.v1` | Reads your corporation's contacts, for the same standings. |
| `esi-alliances.read_contacts.v1` | Reads your alliance's contacts, for the same standings. |
| `esi-characters.read_standings.v1` | Reads your NPC standings, for NPC standings and agent access in Missions. |

When a screen needs a permission you have not given yet, it shows what the permission is for and an Allow button. Pressing it sends you to the EVE login page, keeps the permissions you already gave and adds the new one.

Vyraj never sees your password. Login uses EVE's official SSO with PKCE, there is no client secret, and you can revoke access at any time from [community.eveonline.com/support/third-party-applications](https://community.eveonline.com/support/third-party-applications/).

## Running it yourself

```bash
npm install
npm run dev    # http://localhost:5173
```

The first `npm run dev` downloads the game data (SDE) into `data/` and publishes hashed copies to `public/data/`. Run `npm run data` again after an EVE patch, so items, industry, PI and mining data match the current game.

For EVE login during development, create `.env.local`:

```
VITE_EVE_CLIENT_ID=<client id of an EVE application with callback http://localhost:5173/callback>
```

| Command | What it does |
| --- | --- |
| `npm run dev` | runs the app with live reload |
| `npm run typecheck` | TypeScript check |
| `npm run build` | production build into `dist/` |
| `npm run data` | downloads the current SDE and regenerates the game data |

| Build variable | What it does |
| --- | --- |
| `VITE_EVE_CLIENT_ID` | Client ID of the EVE application. Without it, users enter their own Client ID in the Character screen. |
| `VITE_EVE_CALLBACK_URL` | Callback URL registered with EVE. Defaults to `<origin><base>callback`. |
| `VITE_EVE_TOKEN_URL` | SSO token endpoint. Defaults to `https://login.eveonline.com/v2/oauth/token`. |
| `VITE_R2Z2_URL` | Address of the R2Z2 proxy in `proxy/r2z2`, for example `https://vyraj-r2z2.<account>.workers.dev`. zKillboard's R2Z2 feed does not send CORS headers, so the proxy collects the feed once for everyone and the live map gets the last hour in a single request, then only new kills. Defaults to `https://vyraj-r2z2.vyraj.workers.dev`. |
| `BASE_PATH` | Base path when the site is not served from the domain root, for example `/vyraj/`. |

## Credits

Vyraj stands on the work of the EVE community and of CCP. Thank you to everyone below.

### Game data and services

- **[CCP Games](https://www.ccpgames.com/)** for EVE Online, the [ESI API](https://esi.evetech.net/), [EVE SSO](https://developers.eveonline.com/), the [Static Data Export](https://developers.eveonline.com/static-data) and the [image server](https://images.evetech.net/) for item, ship and character images.
- **[Pyfa](https://github.com/pyfa-org/Pyfa)** as the reference for fitting formulas. All game data, fitting included, is built from CCP's Static Data Export. Vyraj follows Pyfa's results as a specification and does not reuse its GPL-3.0 code.
- **[Fuzzwork](https://www.fuzzwork.co.uk/)** (Steve Ronuken) for aggregated market prices across the trade hubs.
- **[zKillboard](https://zkillboard.com/)** for kill data used in the live map, route checks and pilot threat in Intel PvP.
- **[EVE-Scout](https://www.eve-scout.com/)** for the public Thera and Turnur wormhole connections in Navigation and on the live map.
- **[DOTLAN EveMaps](https://evemaps.dotlan.net/)** for the system pages linked from Navigation and the live map.
- **[EVE Ref](https://everef.net/)** for the item reference pages linked from Market.

### Guides and fits

- **[EVE Survival](https://eve-survival.org/)**, the main source for the mission and DED site guides.
- **[EVE University Wiki](https://wiki.eveuniversity.org/)** for mission reports, DED sites and general game mechanics.
- **[EVE Workbench](https://eveworkbench.com/)** and the pilots who publish fits there, the source of the PvE and PvP starter fits. Each fit links back to its original page.
- **[Warp To Me Incursions](https://wtmincursions.com/doctrines)** for the HQ and Vanguard incursion doctrines shown in demo mode.
- The EVE Online forums and the r/Eve community, for years of shared knowledge on fitting, missions and the market.

### Fonts

- **[Inter](https://rsms.me/inter/)** by Rasmus Andersson and **[Sora](https://fonts.google.com/specimen/Sora)**, both under the SIL Open Font License 1.1. License files are in `public/fonts/`.

### Tools

Built with [TypeScript](https://www.typescriptlang.org/) and [Vite](https://vite.dev/), hosted on [GitHub Pages](https://pages.github.com/).

## License

© 2026 Vyraj. The Vyraj code and design are source-available under the [PolyForm Strict License 1.0.0](LICENSE). You may read the code and use Vyraj for noncommercial purposes, but you may not copy, modify, redistribute or build new works based on it. Versions published before this change remain under the license they were released with.

EVE Online data, names and artwork are not covered by this license; they belong to CCP hf. (see the notice below).

## CCP copyright notice

EVE Online and the EVE logo are the registered trademarks of CCP hf. All rights are reserved worldwide. All other trademarks are the property of their respective owners. EVE Online, the EVE logo, EVE and all associated logos and designs are the intellectual property of CCP hf. All artwork, screenshots, characters, vehicles, storylines, world facts or other recognizable features of the intellectual property relating to these trademarks are likewise the intellectual property of CCP hf. CCP hf. has granted permission to Vyraj to use EVE Online and all associated logos and designs for promotional and information purposes on its website but does not endorse, and is not in any way affiliated with, Vyraj. CCP is in no way responsible for the content on or functioning of this website, nor can it be liable for any damage arising from the use of this website.
