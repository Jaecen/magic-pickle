# Magic Pickle: Design Doc

> A Magic: The Gathering picklist generator and validator for one personal collection tracked in Moxfield, built as a Firefox extension.

| | |
| --- | --- |
| **Status** | Design. Discovery done: the [probe spike](../spikes/moxfield-probe/README.md) proved the extension approach. Next: write down the sort system, then build the engine |
| **Owner** | Jason Addington |
| **Last updated** | 2026-10-16 |

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
6. Run the **engine** on (target deck, built-deck usage, binder decks, collection rows, set list, settings). It returns the picklist, the substitutions, and the problems.
7. Render the result. Pull progress is saved in `storage.local` under the deck's `publicId`.

Expected time: about 3 s when built decks are cached, more on the first run, depending on how many decks are in `3 - Built`.

### 5.3 State

All state lives in `storage.local`. Nothing has to persist reliably: everything can be re-derived from Moxfield.

| Data | Purpose | Lifetime |
| --- | --- | --- |
| Settings | Name of the built folder, sort rules (if configurable), printing preferences | Until changed |
| Built-deck cache | Reduced in-deck boards per `publicId` + `lastUpdatedAtUtc` | Replaced when a deck changes; dropped when it leaves the folder |
| Pull progress | Checked-off cards per target deck | Until cleared or the deck changes |
| Scryfall set list | Release dates, blocks, parent sets (§6.3.3) | Refreshed after 7 days |
| Token | JWT plus expiry | In memory / `storage.session` only |

No collection copy is kept (decision 2026-10-12). Every picklist searches live, so there's nothing to keep in sync.

### 5.4 UI

1. **Picklist:** the cards to pull, grouped by location (hotel → section, binder → page) in pull order. Each line has a checkbox, quantity, name, set and collector number, finish, and a reason it's there if it's a substitute. Checked items drop to the bottom or collapse. The layout works at phone width, since the likely device is a phone or tablet next to the card hotels. It's also printable.
2. **Problems:** cards with no free copy (each built deck holding one, per G3), substitutions made, and over-allocated printings (§6.2).
3. **Write-back checklist:** the printing edits to make in Moxfield after the pull (§6.5).
4. **Settings:** the built folder, printing preferences, and sort rules if they turn out to be configurable.

## 6. Core logic

The engine is pure TypeScript with no I/O, tested with Vitest against fixture JSON captured with the probe ("Download raw responses").

### 6.1 Data model

- **Printing key:** `(scryfall_id, finish)`, where finish is `nonFoil`, `foil`, or `etched`.
- **Card identity:** the exact card `name`, since lookups are by name. Moxfield's `uniqueCardId` may be a better key; to be checked against fixtures.
- **Language:** collection rows have `language.code` separate from `card.lang`, and decks don't record language. To be decided whether a non-English copy satisfies a deck entry (see Open questions).
- **Proxies:** collection rows and deck entries with `isProxy` are excluded from the counts.

### 6.2 Availability

```text
owned[p]     = Σ quantity of non-proxy collection rows with printing p (all conditions)
used[p]      = Σ quantity of p in the in-deck boards of built decks, excluding the target deck
available[p] = owned[p] − used[p]
```

For each card in the target deck's in-deck boards:

1. If `available[requested] ≥ qty`, pick the requested printing.
2. Otherwise, take the shortfall from other printings of the same card where `available > 0`, in order of preference (setting; default: same finish first, then whichever comes first in pull order).
3. If no printing has a free copy, mark the card **unavailable** and list each built deck holding a copy, with its printing (G3).
4. If `available[p] < 0` for any printing, flag it **over-allocated**: the Moxfield records have drifted from reality (§6.5).

Open edge cases: basic lands, double-faced cards (name matching on `A // B`), and tokens.

### 6.3 Sort order

The picklist visits the collection in the order it's stored. Each **collection row** (a printing in a finish and language) gets a sort key:

```text
(section, group, subgroup, color, name)
```

Items marked *(assumed)* weren't explicitly confirmed. Q13, Q17b, and Q18–Q19 are still open.

#### Sections, in physical order

Unless noted, a section sorts **set by set** using the general model (§6.3.1).

| # | Section | Where | Contents | Within the section |
| --- | --- | --- | --- | --- |
| 1 | Commander | Hotels | Commander sets through C21: CMD, CM1 *(assumed)*, C13–C21, CMA, CM2. Also KHC, ZNC, AFC, MIC, VOC, NEC, NCC, DMC | Set by set |
| 2 | Duel Decks | Hotels | Scryfall `set_type` `duel_deck`: DD1–DDU, the anthologies (DVD, EVG, GVL, JVC), GS1 | Set by set |
| 3 | Modern | Hotels | All core sets; all **promo** sets (Scryfall `set_type` `promo`); Conspiracy (CNS, CN2); reprint-based sets not listed elsewhere (Origins, most Masters sets, From the Vault, Premium Deck Series, Game Night, gift packs, Explorers of Ixalan, Challenger Decks, Commander Collection; all *(assumed)*) | **One merged set** |
| 4 | Main | Hotels | Everything else, including CLB, Battlebond, LTR, Assassin's Creed, the Eternal sets, Archenemy *(assumed)* | General model |
| 5 | Planeswalker symbol | Hotels | The List (PLST, ULST), Mystery Booster sets (MB2, MBC, CMB1, CMB2) *(assumed; Q18)* | **One merged set** |
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
| 16 | Un-sets | Separate box | UGL, UNH, UST, UND, UNF, SUNF *(assumed list; Q19: does this box come before or after Old cards?)* | Set by set |
| 17 | Yellow binder | Binder | Fixed copies of the cards in these `Collections` decks, in order: Showcase - Theros Gods; Showcase - KLD Viking Legends; Showcase - STX Mystical Archives; Showcase - SNC Gilded Foils; Language - Phyrexian; Showcase - WOE Enchanting Tales; Showcase - OTJ Breaking News; Showcase - BLB Courageous Critters | Like Main, with each **deck** as the "set": deck order, then color, then name |
| 18 | White binder | Binder | Showcase - LTR Panoramas | By the panorama **tag** on each card in the deck, in this order: March of the Ents, The Mines of Moria, Farewells, Battle of Pelennor Fields, Destruction of the Ring, The Scouring of the Shire, Aragorn at Helm's Deep, Flight of the Witch King, Gandalf in the Pelennor Fields, The Might of Galadriel, Bilbo's Birthday Bash. Then collector number within a panorama *(assumed; Q17b)* |
| 19 | Red binder | Binder | (empty) | — |

**Tokens** aren't cataloged and are out of scope: token cards and token sets are skipped everywhere.

**Which section wins** when several could apply, checked in this order:

1. **Binder copy** (§6.3.2): the row's copy is one of the fixed binder copies.
2. **Foreign language:** `language.code ≠ en`. Phyrexian copies in the *Language - Phyrexian* binder deck are caught by rule 1 first.
3. **Un-sets**, by set code. This comes before Old cards, so Unglued goes in the Un-sets box even though its frame is old.
4. **Old cards:** old frame and a pre-8th Edition set. This includes old promos.
5. **Named sections**, by set code or set type (Commander, Duel Decks, Modern, Planeswalker symbol, Planechase, Guild Kit, Jumpstart, Secret Lair, Signature Spellbook, Modern Horizons, Commander Legends, Universes Within). These override Scryfall's parent/child links: KHC (parent KHM), SLX (parent SLD), J25 (parent FDN), and promo sets (e.g. POTJ, parent OTJ) go to their named sections, not to their parent set.
6. **Main** for everything else.

New sets need a sensible default. A set not named in any list goes to **Modern** if it's a reprint product (Scryfall `set_type` is `core`, `masters`, `from_the_vault`, `premium_deck`, `promo`, or similar), to **Duel Decks** if it's a `duel_deck`, and to **Main** otherwise.

#### 6.3.1 The general model (inside a section)

- **Group** (set or block), ordered **chronologically** by the earliest release date among the group's sets *in that section*. Coldsnap shows why: Scryfall puts it in the Ice Age block, but Ice Age and Alliances are old cards, so Coldsnap sorts in Main at its own 2006 date.
  - **Blocks merge into one set.** Scryfall's `block_code` is used only for **expansion** blocks released through **GRN/RNA/WAR** (2019-05-03). Scryfall also assigns blocks to things that aren't blocks in this system: all Commander products are block `cmd`, all core sets are block `lea`, Modern Horizons is block `mh1`, and newer sets like OTJ have a block containing their siblings. Those are ignored.
  - **Sibling sets** are sets whose Scryfall `parent_set_code` points to the group's primary set, followed up the chain to the root, and that land in the same section. They sort **after** the primary set, ordered by set code. Example: OTJ, then BIG, OTC, OTP *(Q13: your example said "OTJ, BIG, OTB, OTC", but Breaking News is OTP, which is after OTC alphabetically)*.
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

- `binderQty[p] = min(owned[p], Σ quantity of p in binder decks)`. Binder decks are matched by exact deck name in the `Collections` folder; `sections.ts` maps each deck name to a binder and a position.
- Panorama membership comes from the Moxfield **tags** on the cards in *Showcase - LTR Panoramas* (`authorTags` in the deck JSON, keyed by card name).
- Moxfield can't tell which copy a built deck holds. So **built decks are assumed to hold non-binder copies first**, and picks come from the hotels and boxes first. Binder copies **can** be pulled: when no other copy is free, the picklist offers the binder copy at its binder location.

#### 6.3.3 Data sources

- **From Moxfield's card object:** `set`, `frame`, `colors` / `card_faces`, `type_line`, `name`; and from the collection row, `language.code` and `finish`.
- **From the Scryfall set list:** release dates, `block_code`, `parent_set_code`, and `set_type`. Fetched with one request to `https://api.scryfall.com/sets` (about 630 KB; Scryfall allows requests from browser pages) and cached in `storage.local` for 7 days.
- **Section lists** (set codes for each named section, binder deck names and order, panorama order) live in one hand-maintained file: `src/engine/sections.ts`.

### 6.4 Data drift

Availability is only as good as the printings recorded in Moxfield. If a built deck lists printing A but physically holds printing B, the math is wrong for both. Over-allocation (`available < 0`) is a sure sign of this, so the problems view shows it.

### 6.5 Write-back assistance

Moxfield can't be updated programmatically, so after a pull the extension lists the edits to make by hand. For example: "In deck X, change *Sol Ring* from CMR #472 to C21 #263". Following it keeps future availability checks accurate.

## 7. Build, test, and release

### 7.1 Stack

- TypeScript, bundled with Vite (one build for the picklist page, the content script, and the background script).
- UI: Preact. It's small and uses React's API, and the pages are simple.
- Tests: Vitest for the engine and the Moxfield client's parsing, using fixtures from the probe.
- `web-ext` for linting, running in a dev profile, and signing.

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

### 7.4 Proposed repo layout

```text
/src/content/        🥒 button on deck pages
/src/background/     tab opening, fallback token capture
/src/pages/pick/     picklist page (Preact)
/src/moxfield/       auth, decks, incremental collection search, schemas
/src/engine/         availability, sort, write-back (pure)
/tests/fixtures/     sanitized Moxfield responses from the probe
/spikes/             throwaway experiments (moxfield-probe)
/docs/DESIGN.md      this file
manifest.json, vite.config.ts, .github/workflows/
```

## 8. Plan

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| **0. Discovery** ✅ | Prove extension access, auth, the search protocol, and the data shape | Done: §4 |
| **0b. Sort system** | Write down the hotel and binder layout and order ✅; capture fixtures (target deck, 2–3 built decks, binder decks, collection search results) | §6.3 filled in ✅; fixtures in `tests/fixtures` |
| **1. Engine** | Availability, substitution, sort, write-back, with Vitest tests on the fixtures | Correct picklist for the fixtures |
| **2. Extension MVP** | Scaffold (Vite + TypeScript + Preact + `web-ext`), Moxfield client, 🥒 button, picklist page | A real deck pull done with it on desktop |
| **3. Ship** | CI, unlisted signing, Releases, auto-update; install on Android | Signed build installed on desktop and phone |
| **4. Polish** | Pull progress, write-back checklist, settings, printing view | Fewer manual steps per pull |

## Open questions

1. ~~The sort system.~~ Written down in §6.3 (2026-10-16). The remaining details are Q8–Q17.
2. **Printing preferences.** When substituting, what makes one printing better: same finish, same art, newest, cheapest, or easiest to reach?
3. **Basic lands.** Are basics in the collection cataloged and pulled like other cards, or kept in a separate land station that the picklist should just total up?
4. **Language.** Does a non-English copy satisfy a deck entry for the English printing, or should the two be kept apart?
5. **Collection quirks.** Are there cards Moxfield counts that aren't in the hotels or binders (a "to sort" pile, trade binders, a box of proxies)? Should the picklist handle them differently?
6. **Android install.** Can an unlisted, self-hosted signed `.xpi` be installed on your Firefox for Android? To be checked with the first signed build.
7. **Required headers.** Are `x-moxfield-version` and `X-Session-User` required? If so, where should the extension get `x-moxfield-version` from (captured traffic or Moxfield's JavaScript)? To be checked when building the Moxfield client.

8. ~~Merged or set-by-set?~~ Set by set (2026-10-16).
9. ~~Sets you didn't mention.~~ Secret Lair gets its own section between Jumpstart and Signature Spellbook. Promos → Modern. Duel Decks get their own section between Commander and Modern. Un-sets go in a separate box. Conspiracy → Modern. CLB → Main. Tokens are out of scope. The rest of the proposed list is recorded as *(assumed)* in §6.3 (2026-10-16).
10. ~~Guild Kit 2.~~ Not owned yet, but it belongs in the Guild Kit section (2026-10-16).
11. ~~Inside Old cards.~~ Exactly like Main, just stored separately (2026-10-16).
12. ~~Blocks.~~ GRN/RNA/WAR confirmed (2026-10-16). Coldsnap (Ice Age block) and TSB (Time Spiral block) follow Scryfall unless you say otherwise.
13. **Sibling order.** Strictly alphabetical by set code (OTJ, BIG, OTC, OTP)? Or should the Commander set always come last, as in your example?
14. ~~Color edge cases.~~ Use the front face's frame color, approximated from its mana cost; Dryad Arbor is a land (2026-10-16). See §6.3.1.
15. ~~Binder copies.~~ They can be pulled, after every other free copy (2026-10-16).
16. ~~Order inside the yellow binder.~~ Deck, then color, then name (2026-10-16).
17. ~~Panoramas.~~ Card tags in the deck (2026-10-16). **17b:** what's the order of cards *within* one panorama? Collector number is assumed.
18. **Mystery Booster playtest cards** (CMB1, CMB2): with The List in the Planeswalker symbol section, or with the Un-sets?
19. **Un-sets box:** before or after the Old cards boxes in the pull order?

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
| 2026-10-16 | Scryfall blocks count only for expansion blocks through GRN/RNA/WAR; siblings come from `parent_set_code`; named sections override both | Scryfall also labels all Commander products, all core sets, and newer set families (e.g. OTJ) as blocks, which don't match your system |
| 2026-10-14 | Stack: TypeScript, Vite, Preact, Vitest, `web-ext`; unlisted AMO signing; releases on GitHub | Small, standard extension toolchain; signing is required for release Firefox |

## Appendix: Alternatives considered

**Web app with a .NET backend (original plan, 2026-10-11).** An ASP.NET Core backend and a TypeScript single-page app in one Docker container on the Tailnet. The collection came from Moxfield CSV exports, and card data from Scryfall bulk downloads. Dropped because Cloudflare blocks server-side access to Moxfield, which meant manual CSV exports or a fragile proxy. It also needed hosting, deployment, and access control that the extension doesn't.

**Downloading the whole collection on each run.** Possible (29 × 1,000-row pages, about 110 MB) and kept as the fallback if search breaks (§4.6). Not the default, because searches by name are about 50× less data.

**Modifying Moxfield's Temporary Checklist.** Rejected in favor of our own page (decision 2026-10-12).
