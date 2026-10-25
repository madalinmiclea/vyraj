# Vyraj

*o7, capsuleer. May your flow stay unbroken and every Proving end in your favour.*

Vyraj is a free web toolkit for EVE Online pilots: Jita market prices, a Pyfa-style fitting simulator, character and skill planning, market orders, industry, planetary interaction, mining, market intel, PvP intel, navigation and ISK tools, all in one place.

It is a fully static site. Everything runs in your browser and there is no Vyraj server. Your characters, login tokens, fits, SKIN collection, journals and settings are stored only in your browser's local storage and are never sent anywhere except directly to CCP's own services.

## User guide

### Getting around

- **Left rail** (bottom bar on phones): switches between the main screens.
- **Left panel**: the item browser or the screen's own menu. On phones it opens from the ☰ button at the top left.
- **Top right**: your characters, the theme switch (Light, Dark, Vyraj) and the language switch (RO / EN).
- **Right-click** any item in the browser to open its full info: attributes, variations and skill requirements.

### Characters

Use **Add character** in the top right and log in with your EVE account. You can add as many characters as you like and switch between them from the same menu. Until you log in, Vyraj uses a theoretical character with all skills at level V, so every screen still works.

The **Character** screen shows your skills by group, your skill queue, a skill plan you can build from any item's requirements, and the time each step takes with your attributes and implants. With several characters, an overview panel shows every character at once: what is training, when queues end, where they are, wallet and total SP.

### Market

Search any item or pick it from the browser to see live Jita 4-4 buy and sell orders, the spread, price history and the same item in the other trade hubs. Items with no orders in Jita right now are greyed out in the browser.

### Intel Jita

Scans the Jita market for opportunities: trading ideas, the most traded items, station trading margins after tax and broker fees, price trends and hauling routes between hubs. Margins are always calculated as buy in one place, sell in another, and are shown net of sales tax and broker fees based on your Accounting and Broker Relations skills.

### Market orders

The active orders of all your characters in one list, with the order history of the last 90 days. Vyraj checks every few minutes, while it is open, whether someone outbid or undercut you and can send a browser notification. For every beaten order it shows the new price that puts you first again, respecting EVE's price tick, so you only copy it, press Modify Order in the game and paste.

### Industry

- **Calculator:** manufacturing and invention cost of any item, with ME and TE, structure and rigs, the system cost index and your skills, compared with the Jita sell price after taxes. Profit per unit and ISK per hour.
- **Invention:** chance from your skills and a comparison of all decryptors, so you can pick the most profitable one.
- **My blueprints:** your BPOs and BPCs, each opens straight in the calculator.
- **Active jobs:** the industry jobs of all your characters and when they finish.

### Planetary Interaction

- **Colonies and timers:** the colonies of all your characters with exact extractor expiry, storage and factories.
- **Chain profit:** profit per cycle and per hour for every P0 to P4 product at Jita prices, after POCO taxes, and at which tier it is worth stopping.
- **Chain planner:** the full production chain of a product, the P0 it needs and the minimum combination of planet types.

### Mining and reprocessing

ISK per hour for every type of ore, ice, moon ore and gas, computed from your mining fit and skills, plus raw, compressed and reprocessed value per m³ at Jita prices. The reprocessing calculator takes items pasted from your inventory and shows the minerals you get, with your skills, implants, structure and rigs.

### Intel PvP

- **Route:** checks a route between two systems for recent kills, ship and pod losses per system in the last hour, with details from zKillboard, so you can spot gatecamps before you undock.
- **Local and D-Scan:** paste the Local member list or a D-Scan result from the game. Vyraj shows the corporations and alliances present, the ships on scan, an estimated threat and the PvP history of the pilots.

### Navigation

A jump planner for capital ships with fatigue, the current state of Pochven, and the latest Thera and Turnur wormhole connections.

### Fitting

A fitting simulator that follows Pyfa's formulas:

- Open several fits at once in tabs, like in Pyfa. Under the fit, the Drones, Fighters, Cargo, Implants, Boosters, Projected, Command and Notes tabs hold everything that is not fitted in a slot.
- Pick a ship, then click a slot. The browser narrows down to modules for that slot only.
- Fits always stay valid. Any change that would break CPU, powergrid, calibration, hardpoints, slots or drone bandwidth is blocked and the reason is shown.
- Stats include DPS and volley, EHP and resists against damage profiles, capacitor, speed, targeting and the fit's cost at Jita sell prices. Hover a stat to see where every bonus comes from.
- **PvE tank:** pick a mission or anomaly and the NPC faction. Vyraj shows the damage you receive, EHP against that profile, whether your tank is sustainable or the time until you die, the damage type to shoot back with and what their electronic warfare does to your fit.
- Import and export EFT, DNA and Multibuy, save fits, compare saved fits side by side, load fits saved in the game, send a fit to the game, and rebuild fits from the ships you own.
- **Share link:** copy a link that opens the fit directly in Vyraj, in a new tab, for anyone who opens it.
- Fleet boosts, projected effects and abyssal (mutated) modules are supported.

### ISK tools

- **Appraisal:** paste items from your inventory, a contract or an EFT fit and get their Jita value.
- **Abyssal journal:** log Abyssal runs and track profit, ISK per hour and losses.
- **Wallet:** balance, journal and transactions, totals per period (24 h, 7, 30 and 90 days or all time), income and spending per category, PvE ISK per hour and CSV export. ESI only keeps 30 days, so Vyraj keeps the older history locally.
- **Assets:** everything you own, valued at Jita prices.
- **LP Store:** the best ISK per LP offers for the loyalty points you have.
- **Price alerts:** get a browser notification when an item crosses a price you set, while Vyraj is open.

### SKINs

Your SKIN collection per ship and per line, what you still miss, and the cheapest way to complete a collection. Each ship also shows its Mastery levels.

## Why Vyraj asks for each permission

When you log in, EVE asks you to approve the permissions below. Each one is used only for the feature listed, only for the character you logged in with, and only from your own browser.

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
| `esi-wallet.read_character_wallet.v1` | Shows your ISK balance, wallet journal and transactions in ISK tools. |
| `esi-characters.read_loyalty.v1` | Reads your loyalty points, so the LP Store shows the best offers for the LP you actually have. |
| `esi-markets.read_character_orders.v1` | Reads your active and past market orders, for the Market orders screen and the outbid and undercut alerts. It cannot place, change or cancel orders. |
| `esi-planets.manage_planets.v1` | Reads your planetary colonies, extractor timers, storage and factories for the Planetary Interaction screen. Vyraj only reads them and never changes a colony. |
| `esi-characters.read_blueprints.v1` | Reads your blueprints, so the Industry screen can list them and calculate with their real ME, TE and runs. |
| `esi-industry.read_character_jobs.v1` | Shows your running industry jobs and when they finish. |

If you logged in before a feature was added, its screen tells you which permission is missing. Log in again with that character to approve it.

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
| `BASE_PATH` | Base path when the site is not served from the domain root, for example `/vyraj/`. |

## Credits

Fitting formulas follow [Pyfa](https://github.com/pyfa-org/Pyfa), used as a reference only. Game data and images © CCP Games. EVE Online is a trademark of CCP hf. Vyraj is not affiliated with or endorsed by CCP.
