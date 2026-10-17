# Magic Pickle: Design Doc

> A Magic: The Gathering picklist generator and validator for one personal collection tracked in Moxfield, built as a Firefox extension.

| | |
| --- | --- |
| **Status** | Phase 2: the engine and extension MVP are built and tested against a fake Moxfield; next is a real deck pull in Firefox |
| **Owner** | Jason Addington |
| **Last updated** | 2026-10-17 |

This is a living document. Update it when a decision is made, an assumption turns out wrong, or an open question is answered. The [Decision log](#decision-log) records the reasons behind each change.

---

## 1. Problem

The collection has over 50,000 cards, cataloged in Moxfield down to the printing. The cards are stored in four card hotels and two binders. New decks get designed in Moxfield, but pulling a Commander deck from the collection takes two hours or more. Because of that, few new decks get built and played.

Two causes:

1. **The pull order doesn't follow the storage order.** The collection uses a custom sort system that Moxfield and other tools don't know. Their card lists jump back and forth between drawers.
2. **Nothing shows which copies are free.** Moxfield tracks the printings in the collection, but not which copies are already sleeved in built decks. So a printing chosen in the deck builder may already be in use, and finding a free one means searching several printings, then other piles, then other decks, just to confirm every copy is accounted for. This is the bigger time cost.

## 2. Goals

- **G1: Collection-order picklist.** Turn a Moxfield decklist into a picklist sorted the way the collection is stored, so pulling is a single pass through the storage with no jumping around.
- **G2: Availability check.** For each card, decide from the Moxfield collection and the built decks whether the requested printing has a free copy. If it doesn't, list the free printings of the same card, or say clearly that no copy is free.
- **G3: Trustworthy "none free" answers.** When the extension says every copy is in use, it names the built decks holding them, so there's no need to go and check.
- **G4: One click.** A 🥒 button on the Moxfield deck page opens the picklist. No exports, uploads, or manual data entry.
- **G5: Automated build, test, and release** with GitHub Actions.

### Non-goals (for now)

- Multiple users or accounts.
- Replacing Moxfield as the source of truth for the collection or the decks.
- Writing changes back to Moxfield. The extension shows which edits to make by hand instead (§6.5).
- Pricing, trading, or deck-building features.
- Other browsers. Firefox desktop and Firefox for Android only.

## 3. Constraints and preferences

- **Single user, no backend.** Everything runs in the browser extension, with no server, hosting, database, or app login. Supabase was the fallback for state and isn't needed (§5.3).
- **Language:** TypeScript.
- **Platforms:** Firefox desktop (macOS) and Firefox for Android. Assume Android behaves like desktop until something says otherwise.
- **CI/CD:** GitHub Actions.

## 4. Moxfield integration

Moxfield has **no official API**. The extension uses the same undocumented `api2.moxfield.com` endpoints Moxfield's own site uses (the API root says *"not intended for public use"*). Everything in this section was verified with the [probe spike](../spikes/moxfield-probe/README.md) on 2026-10-13 and 2026-10-14, in Firefox 157 on macOS. Treat it as the reference for the Moxfield client.

### 4.1 Access

- **Only real browser requests get through.** Cloudflare returns 403 to `curl`, even from a home IP. A `fetch` from an extension page (with host permission for `api2.moxfield.com`) returns 200 and isn't challenged. Requests from a content script also work. Making requests as if by the page (`content.fetch`) isn't available to Manifest V3 content scripts, and isn't needed.
- **A bearer token is required.** Cookies alone get 401 (404 for a private deck). The site sends `Authorization: Bearer <JWT>`, `x-moxfield-version`, and `X-Session-User` with every API call. Whether the last two are required hasn't been tested.

### 4.2 Auth

- The access token is a JWT with a **15-minute lifetime**. Scripts can't read it from storage or cookies.
- **The extension gets its own token** by calling `POST /v1/startup/authenticated` with body `{"isAppLogin":false}`. Moxfield authenticates the call with your login cookie, which page scripts can't read but Firefox still sends. The response includes the JWT (top-level keys `refresh`, `wishList`, `allLists`, `muted`, `follows`). This is the same call a fresh moxfield.com page load makes.
- A long-lived Moxfield tab renews its token with `POST /v1/account/token/refresh` (body `{userId, isAppLogin:false}`). The extension doesn't need this.
- Fallback: capture the token from Moxfield's own requests with `webRequest.onBeforeSendHeaders`. Opening the picklist from the deck page means a fresh one is always available.
- If you're logged out, everything returns 401. The extension should say "log in to Moxfield" and link there.

### 4.3 Endpoints

| Purpose | Request | Notes |
| --- | --- | --- |
| Token | `POST /v1/startup/authenticated` | Body `{"isAppLogin":false}`; authenticated by the login cookie |
| Decks list | `GET /v3/decks` | Every deck in one response (172 decks): `publicId`, `name`, `visibility`, `lastUpdatedAtUtc`, `folder {id, name}`, commanders |
| Folders | `GET /v1/deck-folders?pageSize=1000` | 8 folders, named like `0 - Ideas`, `2 - Refining`, `3 - Built` |
| Deck | `GET /v3/decks/all/{publicId}` | Works for private decks. `boards.<board>.cards.<id>` = `{quantity, finish, isProxy, card{…}}` |
| Collection search | `GET /v1/collections/search?q=…&pageSize=…&pageNumber=…[&searchSessionId=…]` | Incremental; see §4.5. Also has `setId`, `finish`, `isProxy`, `tradeBinderId`, and `deckId` filters (`deckId` does nothing useful) |

### 4.4 Data

- **Deck card entries** carry full printing data on 100% of cards: `scryfall_id`, `set`, `cn`, `finish`, `lang`. They also carry most of the card data the sort needs: `type_line`, `colors`, `frame`, `card_faces`, `set`, `released_at`, and Moxfield's `uniqueCardId`. Set-level data (blocks, parent sets, set release dates) comes from Scryfall's set list (§6.3.3).
- **Collection rows** are one row per printing × finish × condition × language: `{id, quantity, condition, finish, language{code}, isProxy, card{…same card object…}}`. They don't record which decks use a copy, or where a card is stored.
- **Collection size:** 50,694 cards across 28,361 rows. Cards in built decks *are* counted in the collection.
- **Boards:** a deck's `boards` include `mainboard`, `sideboard`, `maybeboard` ("Considering"), `commanders`, `companions`, and others. Only **`mainboard` + `commanders` + `companions`** are physically in a deck (Moxfield keeps the commander in its own board). Sideboard and Considering are ignored everywhere: they aren't pulled, they don't use up copies, and they may not be in the collection at all, since Considering is sometimes a wish list.
- **Built decks:** a deck is built if and only if it's in the **`3 - Built`** folder (`folder.name` in the decks list). Name prefixes like `[1DH]` are personal format labels and are ignored.

### 4.5 Collection search protocol

Collection search uses Scryfall syntax (`!"Exact Name"`, `or`, parentheses). It is **incremental**, which is easy to get wrong:

1. The first request goes out **without** `searchSessionId`.
2. The server scans part of the collection and returns what it has so far, plus `hasMore` and a **server-created** `searchSessionId`. The first response is often empty.
3. Repeat the request with that `searchSessionId` while `hasMore` is true. Stay on the same page while it isn't full, and go to the next page once it is. The scan takes about 5 stages (about 5 sequential requests, roughly 2 s), whatever the query.
4. Collect rows by `id`. Responses are cumulative for a page.

Gotchas found the hard way:

- **One request is not a search.** A single request only sees the first stage of the scan. The probe's early "misses" (13 of 79 names found) all came from this.
- **A `searchSessionId` is tied to its original query.** Sending a session id with a different `q` returns the *old* query's results. Random ids the client makes up behave like no id.
- **The query length is capped at about 1,000 characters.** One 79-name OR query (about 1,800 characters) silently matched only the first 46 names. **Split queries into groups of names of at most about 900 characters.** Groups of 40 names (850–960 characters) found 79 of 79.
- **No rate limiting seen.** 30 sequential searches and 4 searches running at once (about 20 requests in flight) all returned 200.

Measured on the Zur deck (79 names): 2 groups of 40 or 4 groups of 20, run at the same time, found **all 79 names in about 2 s**.

### 4.6 Fragility

The API is undocumented and can change without notice. To contain the damage:

- All Moxfield calls live in one module (`src/moxfield/`). It validates responses with runtime schemas, so a change shows up as a clear "Moxfield changed X" error, not as wrong availability numbers.
- Request volume stays close to what a person browsing Moxfield would generate: one deck, one decks list, built decks only when they've changed, and a handful of searches.
- If search breaks, the fallback is a full collection download: an empty query returns all 28,361 rows in 29 pages of 1,000 (about 3.8 MB each), and the extension matches cards itself.

## 5. Architecture

### 5.1 Overview

```text
moxfield.com/decks/{publicId}                  Firefox extension
┌──────────────────────────┐   click   ┌────────────────────────────────────────────┐
│ content script:          │ ────────► │ picklist page (moz-extension://…/pick.html)│
│  injects 🥒 button        │           │  ├─ moxfield/  auth, decks, collection     │
└──────────────────────────┘           │  ├─ engine/    availability, sort (pure)   │
                                       │  └─ ui/        picklist, problems, settings │
                                       │ storage.local: settings, built-deck cache, │
                                       │                pull progress               │
                                       └──────────────────┬─────────────────────────┘
                                                          │ fetch + Bearer JWT
                                                          ▼
                                                  api2.moxfield.com
```

- **Content script** (`moxfield.com/*`): adds a 🥒 button on deck pages, keeps it there through Moxfield's in-site navigation, and opens the picklist page for that deck. The probe proved this works.
- **Picklist page**: an extension page that does all the work. It's also reachable from the toolbar button, by entering a deck URL.
- **Background script**: minimal. It opens tabs and holds the fallback token captured through `webRequest`.
- No modifications to Moxfield's own pages beyond the button.

### 5.2 Generating a picklist

1. Get a token (§4.2) and cache it until about a minute before it expires.
2. Fetch the **target deck** and the **decks list** at the same time.
3. **Built decks:** filter the decks list to `folder.name == "3 - Built"` (a setting), excluding the target deck itself. For each one, reuse the cached copy if `lastUpdatedAtUtc` is unchanged; otherwise fetch it, a few at a time. Keep only the in-deck boards, reduced to `(name, scryfall_id, finish, quantity, isProxy)`.
4. **Collection lookup:** take the target deck's distinct card names, split them into OR groups of at most about 900 characters, and run the incremental search for 4 groups at a time (§4.5).
5. Load the **Scryfall set list** from cache, refreshing it if it's more than 7 days old, and fetch the **`Collections` binder decks** (cached the same way as built decks).
6. Run the **engine** on (target deck, built-deck usage, binder decks, collection rows, set list, settings). It returns the picklist and the problems (printings not free, unavailable cards, over-allocations).
7. Render the result. Pull progress is saved in `storage.local` under the deck's `publicId`.

Expected time: about 3 s when built decks are cached, more on the first run, depending on how many decks are in `3 - Built`.

### 5.3 State

All state lives in `storage.local`. Nothing has to persist reliably: everything can be re-derived from Moxfield.

| Data | Purpose | Lifetime |
| --- | --- | --- |
| Settings | Name of the built folder, binder decks, section lists (if editable in the UI) | Until changed |
| Built-deck cache | Reduced in-deck boards per `publicId` + `lastUpdatedAtUtc` | Replaced when a deck changes; dropped when it leaves the folder |
| Pull progress | Checked-off cards per target deck | Until cleared or the deck changes |
| Scryfall set list | Release dates, blocks, parent sets (§6.3.3) | Refreshed after 7 days |
| Token | JWT plus expiry | In memory / `storage.session` only |

No collection copy is kept (decision 2026-10-12). Every picklist searches live, so there's nothing to keep in sync.

### 5.4 UI

1. **Picklist:** the cards to pull, grouped by location (hotel → section, binder → page) in pull order. Each line has a checkbox, quantity, name, set and collector number, and finish. Checked items drop to the bottom or collapse. The layout works at phone width, since the likely device is a phone or tablet next to the card hotels. It's also printable.
2. **Problems** (shown first if there are any): cards whose requested printing isn't free, with the free alternatives and a link to the deck (§6.5); unavailable cards with the built decks holding them (G3); over-allocated printings (§6.4).
3. **Settings:** the built folder, the binder decks, and the section lists, if those turn out to be worth editing in the UI rather than in `sections.ts`.

## 6. Core logic

The engine is pure TypeScript with no I/O, tested with Vitest against fixture JSON captured with the probe ("Download raw responses").

### 6.1 Data model

- **Printing key:** `(scryfall_id, finish)`, where finish is `nonFoil`, `foil`, or `etched`.
- **Card identity:** the exact card `name`, since lookups are by name. Moxfield's `uniqueCardId` may be a better key; to be checked against fixtures.
- **Language:** collection rows have `language.code` separate from `card.lang`, and decks don't record language. A collection copy **fills** a deck line, and counts as used by a built deck, only if its `language.code` equals the deck card's `lang`. So a Japanese copy of C21 Sol Ring never fills an English C21 Sol Ring line. **English and Phyrexian are interchangeable for alternatives**, since Phyrexian cards are played: when an English printing isn't free, free Phyrexian printings are listed, and the reverse; "unavailable" lists the built decks holding either. Other foreign-language copies are never offered (`PLAYABLE_LANGUAGES` in `sections.ts`).
- **Proxies:** collection rows and deck entries with `isProxy` are excluded from the counts.

### 6.2 Availability

```text
owned[p]     = Σ quantity of non-proxy collection rows with printing p (all conditions)
used[p]      = Σ quantity of p in the in-deck boards of built decks, excluding the target deck
available[p] = owned[p] − used[p]
```

For each card in the target deck's in-deck boards (excluding tokens and basic lands):

1. If `available[requested] ≥ qty`, the card goes on the picklist at the requested printing's location.
2. Otherwise, **the extension doesn't substitute.** Which printing to use can't be decided ahead of time, so the card is flagged **"requested printing not free"**. The notice shows:
   - how many copies of the requested printing are owned, and which built decks hold them (G3)
   - **every other printing of the card that has free copies**, with set, collector number, finish, free count, and location
   You then change the printing in the Moxfield deck and regenerate the picklist. Any free copies of the requested printing still go on the picklist, so a partial shortfall is visible.
3. If no printing has a free copy at all, the card is flagged **unavailable**, with each built deck holding a copy and its printing (G3).
4. If `available[p] < 0` for any printing, flag it **over-allocated**: the Moxfield records have drifted from reality (§6.4). This is only checked for the target deck's cards, because collection lookups only fetch those names.

Implemented in `src/engine/picklist.ts`. A notice of kind `unavailable` also covers a partial shortfall: some copies were picked, and no other printing has a free copy for the rest.

Open edge case: double-faced cards (name matching on `A // B`).

### 6.3 Sort order

The picklist visits the collection in the order it's stored. Each **collection row** (a printing in a finish and language) gets a sort key:

```text
(section, group, subgroup, color, name)
```

Items marked *(assumed)* weren't explicitly confirmed.

#### Sections, in physical order

Unless noted, a section sorts **set by set** using the general model (§6.3.1).

| # | Section | Where | Contents | Within the section |
| --- | --- | --- | --- | --- |
| 1 | Commander | Hotels | Commander sets through C21: CMD, CM1 *(assumed)*, C13–C21, CMA, CM2. Also KHC, ZNC, AFC, MIC, VOC, NEC, NCC, DMC | Set by set |
| 2 | Duel Decks | Hotels | Scryfall `set_type` `duel_deck`: DD1–DDU, the anthologies (DVD, EVG, GVL, JVC), GS1 | Set by set |
| 3 | Modern | Hotels | All core sets; all **promo** sets (Scryfall `set_type` `promo`); Conspiracy (CNS, CN2); reprint-based sets not listed elsewhere (Origins, most Masters sets, From the Vault, Premium Deck Series, Game Night, gift packs, Explorers of Ixalan, Challenger Decks, Commander Collection; all *(assumed)*) | **One merged set** |
| 4 | Main | Hotels | Everything else, including CLB, Battlebond, LTR, Assassin's Creed, the Eternal sets, Archenemy *(assumed)* | General model |
| 5 | Planeswalker symbol | Hotels | The List (PLST, ULST), Mystery Booster sets (MB2, MBC) *(assumed)* | **One merged set** |
| 6 | Planechase | Hotels | HOP, PC2, PCA, and later Planechase sets | Set by set |
| 7 | Guild Kit | Hotels | GK1, GK2 | Set by set |
| 8 | Foreign language | Hotels | Every row whose `language.code` isn't `en`, whatever the set | **One merged set** (order unimportant) |
| 9 | Jumpstart | Hotels | JMP, J22, J25 | Set by set |
| 10 | Secret Lair | Hotels | SLD, SLU, SLC *(assumed: the whole Secret Lair family except SLX)* | Set by set |
| 11 | Signature Spellbook | Hotels | SS1, SS2, SS3 | Set by set |
| 12 | Modern Horizons | Hotels | MH1, MH2, MH3, H1R, H2R | Set by set (H1R follows MH2 and H2R follows MH3 as siblings) |
| 13 | Commander Legends | Hotels | CMR | One set |
| 14 | Universes Within | Hotels | SLX | One set |
| 15 | Old cards | Separate boxes | True pre-modern frames: card `frame` is `1993` or `1997` **and** the set was released before 8th Edition (2003-07-28). Old-frame cards in newer sets (e.g. TSB, retro frames) stay in their normal section | **Exactly like Main** (core sets, Portal, Starter, and Chronicles are just sets in release order) |
| 16 | Un-sets | Separate box | UGL, UNH, UST, UND, UNF, SUNF *(assumed list)* | Set by set |
| 17 | Playtest cards | Separate box | Mystery Booster playtest cards (CMB1, CMB2) | Set by set |
| 18 | Yellow binder | Binder | Fixed copies of the cards in these `Collections` decks, in order: Showcase - Theros Gods; Showcase - KLD Viking Legends; Showcase - STX Mystical Archives; Showcase - SNC Gilded Foils; Language - Phyrexian; Showcase - WOE Enchanting Tales; Showcase - OTJ Breaking News; Showcase - BLB Courageous Critters | Like Main, with each **deck** as the "set": deck order, then color, then name |
| 19 | White binder | Binder | Showcase - LTR Panoramas | By the panorama **tag** on each card in the deck, in this order: March of the Ents, The Mines of Moria, Farewells, Battle of Pelennor Fields, Destruction of the Ring, The Scouring of the Shire, Aragorn at Helm's Deep, Flight of the Witch King, Gandalf in the Pelennor Fields, The Might of Galadriel, Bilbo's Birthday Bash. Then collector number within a panorama |
| 20 | Red binder | Binder | (empty) | — |

The boxes (Old cards, Un-sets, Playtest cards) have no physical order relative to each other. The picklist always visits them in the order shown, so it's consistent.

**Tokens and basic lands** aren't cataloged and are out of scope. Token cards, token sets, and basic lands (type line has the `Basic` supertype, including snow-covered basics and Wastes) are left off the picklist and out of the lookups. The picklist shows a one-line summary of the basics the deck needs (e.g. "Basics, not included: 8 Island, 8 Plains, 8 Swamp").

**Which section wins** when several could apply, checked in this order:

1. **Binder copy** (§6.3.2): the row's copy is one of the fixed binder copies.
2. **Foreign language:** `language.code ≠ en`. Phyrexian copies in the *Language - Phyrexian* binder deck are caught by rule 1 first.
3. **Un-sets and Playtest cards**, by set code. These come before Old cards, so Unglued goes in the Un-sets box even though its frame is old.
4. **Old cards:** old frame and a pre-8th Edition set. This includes old promos.
5. **Named sections**, by set code or set type (Commander, Duel Decks, Modern, Planeswalker symbol, Planechase, Guild Kit, Jumpstart, Secret Lair, Signature Spellbook, Modern Horizons, Commander Legends, Universes Within). These override Scryfall's parent/child links: KHC (parent KHM), SLX (parent SLD), J25 (parent FDN), and promo sets (e.g. POTJ, parent OTJ) go to their named sections, not to their parent set.
6. **Main** for everything else.

New sets need a sensible default. A set not named in any list goes to **Modern** if it's a reprint product (Scryfall `set_type` is `core`, `masters`, `from_the_vault`, `premium_deck`, `promo`, or similar), to **Duel Decks** if it's a `duel_deck`, and to **Main** otherwise.

#### 6.3.1 The general model (inside a section)

- **Group** (set or block), ordered **chronologically** by the earliest release date among the group's sets *in that section*. Coldsnap shows why: Scryfall puts it in the Ice Age block, but Ice Age and Alliances are old cards, so Coldsnap sorts in Main at its own 2006 date.
  - **Blocks merge into one set.** Scryfall's `block_code` is used only for **expansion** blocks released through **GRN/RNA/WAR** (2019-05-03). Scryfall also assigns blocks to things that aren't blocks in this system: all Commander products are block `cmd`, all core sets are block `lea`, Modern Horizons is block `mh1`, and newer sets like OTJ have a block containing their siblings. Those are ignored.
  - **Sibling sets** are sets whose Scryfall `parent_set_code` points to the group's primary set, followed up the chain to the root, and that land in the same section. They sort **after** the primary set, ordered **strictly alphabetically by set code**. Example: OTJ, then BIG, OTC, OTP.
- **Subgroup:** 0 for the primary set (or all of a block's sets, merged), then 1, 2, … for each sibling set in set-code order.
- **Color**, in this order: **W, U, B, R, G, multi, colorless, land**. All multicolor cards (gold, hybrid, and so on) are one bucket. The real rule is **the front face's frame color**. The data doesn't include frame color, so it's approximated:
  1. **Land** if the front face's type line includes Land. Dryad Arbor is ruled a land.
  2. Otherwise, the colors of the **front face's mana cost**: hybrid symbols count both colors, and Phyrexian symbols count their color. Devoid follows its cost, so Blinding Drone ({1}{U}) is blue.
  3. If the cost has no colored symbols, fall back to the card's colors (color indicator, e.g. Ancestral Vision). If there are none, it's **colorless**.
  4. One color means that color; two or more means **multi**.
  5. A small override list in `sections.ts` handles cards where this approximation misses the frame (e.g. Transguild Courier).
- **Name** as printed (front face for double-faced cards), alphabetical, ignoring case and punctuation. "The …" files under T.

#### 6.3.2 Binder copies

Binders hold a **fixed quantity** of each card in their `Collections` decks (usually one). Extra copies live in the hotels with their set. `Collections` decks are aspirational, so they may list cards that aren't owned yet.

- `binderQty[p] = min(owned[p], Σ quantity of p in binder decks)`. Binder decks in the `Collections` folder are matched by the **start of their name**: the rest of the name (completion emoji, card counts) is ignored. `sections.ts` maps each name prefix to a binder and a position.
- Panorama membership comes from the Moxfield **tags** on the cards in *Showcase - LTR Panoramas* (`authorTags` in the deck JSON, keyed by card name).
- Moxfield can't tell which copy a built deck holds. So **built decks are assumed to hold non-binder copies first**, and picks come from the hotels and boxes first. Binder copies **can** be pulled: when no other copy is free, the picklist offers the binder copy at its binder location.

#### 6.3.3 Data sources

- **From Moxfield's card object:** `set`, `frame`, `colors` / `card_faces`, `type_line`, `name`; and from the collection row, `language.code` and `finish`.
- **From the Scryfall set list:** release dates, `block_code`, `parent_set_code`, and `set_type`. Fetched with one request to `https://api.scryfall.com/sets` (about 630 KB; Scryfall allows requests from browser pages) and cached in `storage.local` for 7 days.
- **Section lists** (set codes for each named section, binder deck names and order, panorama order) live in one hand-maintained file: `src/engine/sections.ts`.

### 6.4 Data drift

Availability is only as good as the printings recorded in Moxfield. If a built deck lists printing A but physically holds printing B, the math is wrong for both. Over-allocation (`available < 0`) is a sure sign of this, so the problems view shows it.

### 6.5 Fixing the deck

Moxfield can't be updated programmatically, and the extension doesn't pick substitutes (§6.2). Each "requested printing not free" notice therefore links to the deck in Moxfield and lists the free printings to choose from. After you change the printing there, regenerating the picklist picks up the change. This also keeps the deck's recorded printings accurate for future availability checks once it's built.

## 7. Build, test, and release

### 7.1 Stack

- TypeScript, bundled with Vite 8 in two builds: the picklist page and background script as ES modules, and the content script on its own as one classic script (content scripts can't be modules).
- UI: Preact 10 (10.29.x). Preact 11 shipped two weeks before this was set up and the Vite plugin predates it, so 11 can wait.
- Response validation: zod 4, in `jitless` mode because extension pages forbid `eval`.
- Firefox API types: `@types/webextension-polyfill`, for types only; Firefox's native `browser` global is used directly.
- Tests: Vitest. Engine tests use synthetic cards plus a trimmed copy of Scryfall's set list. Client and app tests run against a fake Moxfield server (`tests/fakeMoxfield.ts`) that reproduces the behavior measured in the spike: tokens, incremental search with server-issued session ids, and the query-length cap.
- `web-ext` for linting and signing. Its Android-debugging dependency (`node-forge`) has a high-severity advisory that npm can only "fix" by downgrading web-ext to 5.x. It's a dev-only tool that never ships in the extension, so the advisory is accepted.
- **Dev environment:** all Node tooling runs in a `node:24` container (OrbStack) via `scripts/dev`; nothing is installed on the host. See the README.

### 7.2 Distribution

Release Firefox only runs extensions signed by Mozilla. The extension is signed as **unlisted** (self-distributed) through AMO's API: an automated review, with no public listing.

- Each release attaches a signed `.xpi` to a GitHub Release.
- A self-hosted update manifest (`browser_specific_settings.gecko.update_url`, served from GitHub Pages or the Releases page) lets desktop Firefox update automatically.
- **Android:** whether an unlisted, self-hosted `.xpi` can be installed on Firefox for Android needs checking (Open question 6). If it can't, the options are a listed (public but unadvertised) AMO entry, or a custom add-on collection.

### 7.3 GitHub Actions

| Workflow | Trigger | Steps |
| --- | --- | --- |
| `ci.yml` | PRs, pushes to `main` | `npm ci`, typecheck, lint, `vitest`, `vite build`, `web-ext lint` |
| `release.yml` | tag `v*` | Build, `web-ext sign --channel=unlisted` (AMO API key and secret in repo secrets), create a GitHub Release with the `.xpi`, update the update manifest |

### 7.4 Repo layout

See the README's layout table. In short: `src/engine/` (pure logic; `sections.ts` is the hand-edited config), `src/moxfield/`, `src/scryfall/`, `src/app/`, `src/pages/pick/`, `src/content/`, `src/background/`, `public/manifest.json`, and `tests/`.

**Manifest:** permissions `storage` and `webRequest`; host permissions for `api2.moxfield.com`, `api.scryfall.com`, and `moxfield.com`. `webRequest` is only used to learn the `x-moxfield-version` and `X-Session-User` values Moxfield's own pages send (Q7). The add-on id `magic-pickle@picklist.local` is a placeholder: **choose the final id before the first signed release**, because changing it later breaks updates. The minimum versions are Firefox 140 and Firefox for Android 142, the first to support `data_collection_permissions`, which AMO now requires (declared as `none`).

## 8. Plan

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| **0. Discovery** ✅ | Prove extension access, auth, the search protocol, and the data shape | Done: §4 |
| **0b. Sort system** | Write down the hotel and binder layout and order ✅; capture fixtures (target deck, 2–3 built decks, binder decks, collection search results) | §6.3 filled in ✅; fixtures in `tests/fixtures` |
| **1. Engine** | Sort keys and sections ✅, availability ✅, printing notices ✅, binder copies ✅, with Vitest tests ✅ | Correct picklist for the fixtures. Synthetic fixtures pass; real Moxfield fixtures come with phase 2 |
| **2. Extension MVP** | Scaffold ✅, Moxfield client ✅, 🥒 button ✅, picklist page ✅, all tested against a fake Moxfield. **Test:** whether `x-moxfield-version` and `X-Session-User` are required (Q7; there's a button for it under Diagnostics) | A real deck pull done with it on desktop |
| **3. Ship** | CI, unlisted signing, Releases, auto-update. **Research and test:** installing on Firefox for Android (Q6) | Signed build installed on desktop and phone |
| **4. Polish** | Pull progress, settings, printing details | Fewer manual steps per pull |

## Open questions

Resolved questions are struck through; their answers are in the decision log.

1. ~~The sort system.~~ §6.3.
2. ~~Printing preferences.~~ No automatic substitution: flag the card and list the free printings (§6.2).
3. ~~Basic lands.~~ Not cataloged; out of scope.
4. ~~Language.~~ A copy counts toward a deck entry only if its language matches the deck card's language (§6.1).
5. ~~Collection quirks.~~ None; Moxfield tracks nothing outside the hotels, boxes, and binders.
6. **Android install.** Can an unlisted, self-hosted signed `.xpi` be installed on Firefox for Android? To research and test in phase 3.
7. **Required headers.** Are `x-moxfield-version` and `X-Session-User` required? The extension learns both from Moxfield's own traffic and sends them when known. The picklist page's Diagnostics has a button that compares a request with and without them. To check on the first real run.
8. ~~Merged or set-by-set?~~ Set by set.
9. ~~Sets you didn't mention.~~ §6.3 table.
10. ~~Guild Kit 2.~~ Guild Kit section.
11. ~~Inside Old cards.~~ Exactly like Main.
12. ~~Blocks.~~ GRN/RNA/WAR. Coldsnap (Ice Age block) and TSB (Time Spiral block) follow Scryfall.
13. ~~Sibling order.~~ Strictly alphabetical by set code.
14. ~~Color edge cases.~~ §6.3.1.
15. ~~Binder copies.~~ Can be pulled, after every other free copy.
16. ~~Order inside the yellow binder.~~ Deck, then color, then name.
17. ~~Panoramas.~~ Card tags, then collector number.
18. ~~Playtest cards.~~ Their own box.
19. ~~Box order.~~ Arbitrary but fixed: Old cards, Un-sets, Playtest cards.

## Decision log

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-11 | ~~Proposed a .NET backend + TypeScript SPA in one container, with no database~~ (replaced 2026-10-12) | Moxfield isn't reachable from the browser; the engine fits C#; all state is config or cache |
| 2026-10-11 | ~~MVP reads the collection from CSV; automated Moxfield fetching is optional~~ (replaced 2026-10-12) | No official API; the private endpoints are unreliable behind Cloudflare |
| 2026-10-11 | ~~Recommend Tailnet-only hosting with no app auth~~ (replaced 2026-10-12: no hosting) | Single user; Tailnet membership is enough access control |
| 2026-10-12 | **Build a Firefox extension** (desktop and Android) with its own picklist page, opened from the Moxfield deck editor | It runs in the logged-in browser, so it gets past Cloudflare and auth without a backend, hosting, or login. Card-finder ([issue #2](https://github.com/Kyle-Bolin/card-finder/issues/2)) showed requests from a real browser work where datacenter requests get 403s. The C# preference only applied if a backend was needed |
| 2026-10-12 | Confirmed `curl` from a home IP also gets a Cloudflare 403 from `api2.moxfield.com` and `moxfield.com` | Cloudflare fingerprints non-browser clients, so all access must come from a real browser |
| 2026-10-12 | Don't modify Moxfield's Temporary Checklist; render our own extension page | Moxfield's markup can change at any time, so changing its pages is fragile. An extension page is fully under our control |
| 2026-10-12 | Delegate card lookups to Moxfield's collection search (Scryfall syntax); don't mirror the 50K-card collection locally | Avoids keeping a local copy in sync |
| 2026-10-12 | Assume Firefox for Android behaves like desktop for extensions | Your experience running extensions on Android; revisit only if something breaks |
| 2026-10-13 | Built = in the `3 - Built` folder | Your folder pipeline (`0 - Ideas` … `3 - Built`) already records this |
| 2026-10-14 | Only `mainboard` + `commanders` + `companions` count as "in the deck"; sideboard and Considering are ignored | Your rule (main board only). Commanders and companions are included because Moxfield stores them in their own boards, and companions live in the deck box |
| 2026-10-14 | The extension gets its own token from `startup/authenticated` | Validated in the spike; no dependency on an open Moxfield tab |
| 2026-10-14 | Look up a deck's cards with incremental, OR-grouped exact-name searches: groups of at most about 900 characters, run 4 at a time, following `hasMore` | Validated in the spike: 79 of 79 names in about 2 s. A single request, or a query over about 1,000 characters, silently returns partial results |
| 2026-10-14 | ~~No Scryfall dependency~~ (replaced 2026-10-16) | Moxfield's card objects carry every field the engine needs |
| 2026-10-16 | Sort system written down (§6.3); use the Scryfall set list (cached for 7 days) for set release dates, blocks, and parent sets | Moxfield's card objects have no block or parent-set data, and your system is defined in Scryfall's terms. One cached request; Scryfall allows requests from browser pages |
| 2026-10-16 | Sort details confirmed: sections are set by set (except Modern, Planeswalker symbol, and Foreign); new Duel Decks, Secret Lair, and Un-sets sections; promos and Conspiracy → Modern; CLB → Main; color by the front face's frame color (approximated from its mana cost); binder copies can be pulled, after all other free copies | Your answers to Q8–Q17 |
| 2026-10-16 | Tokens are out of scope | Not cataloged; a separate future project |
| 2026-10-16 | Basic lands are out of scope; the picklist only summarizes the basics a deck needs | Not cataloged |
| 2026-10-16 | **No automatic printing substitution.** When the requested printing isn't free, flag it and list every printing with free copies; you edit the deck and regenerate | Which printing to use can't be decided ahead of time. Replaces the earlier substitution and write-back design |
| 2026-10-16 | A copy counts for a deck entry only if its language matches the deck card's `lang` | Foreign copies aren't played and live in their own section; Phyrexian still works because those printings have their own Scryfall ids |
| 2026-10-17 | English and Phyrexian printings are offered as alternatives for each other; other languages still never are | Phyrexian cards are played, and there are few copies, so a busy Phyrexian printing should point to free English ones and vice versa |
| 2026-10-17 | Binder decks match by name prefix | Deck names carry completion emoji and card counts after the configured name |
| 2026-10-17 | Dev tooling runs in a `node:24` container via OrbStack (`scripts/dev`) | Your preference: no Node or dev dependencies installed on the host |
| 2026-10-17 | Preact 10.29 rather than 11; zod in `jitless` mode; two Vite builds | Preact 11 is two weeks old and its Vite plugin predates it; extension pages forbid eval; content scripts can't be ES modules |
| 2026-10-17 | Learn `x-moxfield-version` and `X-Session-User` from Moxfield's own requests (`webRequest`) and send them when known | Cheap insurance until Q7 is answered; the values aren't secret |
| 2026-10-16 | Siblings strictly alphabetical by set code; panorama cards by collector number; playtest cards in their own box; box order arbitrary but fixed | Your answers to Q13, Q17b, Q18, and Q19 |
| 2026-10-16 | Scryfall blocks count only for expansion blocks through GRN/RNA/WAR; siblings come from `parent_set_code`; named sections override both | Scryfall also labels all Commander products, all core sets, and newer set families (e.g. OTJ) as blocks, which don't match your system |
| 2026-10-14 | Stack: TypeScript, Vite, Preact, Vitest, `web-ext`; unlisted AMO signing; releases on GitHub | Small, standard extension toolchain; signing is required for release Firefox |

## Appendix: Alternatives considered

**Web app with a .NET backend (original plan, 2026-10-11).** An ASP.NET Core backend and a TypeScript single-page app in one Docker container on the Tailnet. The collection came from Moxfield CSV exports, and card data from Scryfall bulk downloads. Dropped because Cloudflare blocks server-side access to Moxfield, which meant manual CSV exports or a fragile proxy. It also needed hosting, deployment, and access control that the extension doesn't.

**Downloading the whole collection on each run.** Possible (29 × 1,000-row pages, about 110 MB) and kept as the fallback if search breaks (§4.6). Not the default, because searches by name are about 50× less data.

**Modifying Moxfield's Temporary Checklist.** Rejected in favor of our own page (decision 2026-10-12).
