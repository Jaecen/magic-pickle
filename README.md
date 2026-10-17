# Magic Pickle

A Firefox extension that turns a Moxfield deck into a picklist in the order your collection is stored, and
checks which printings are actually free given the decks you've already built. Design and rationale:
[docs/DESIGN.md](docs/DESIGN.md).

## Development

All Node tooling runs in a container (Docker / OrbStack); nothing is installed on the host. `scripts/dev`
runs a command in it:

```sh
scripts/dev npm install         # once, and after dependency changes
scripts/dev npm run check       # typecheck, lint, tests, build, web-ext lint
scripts/dev npm test            # tests only
scripts/dev npm run dev         # rebuild dist/ on every change
```

VS Code users can instead open the folder in the container with the Dev Containers extension
(`.devcontainer/devcontainer.json`).

### Running it in Firefox

1. `scripts/dev npm run build` (or keep `npm run dev` running).
2. In Firefox, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and pick
   `dist/manifest.json`.
3. Open a deck on moxfield.com while logged in and click the **🥒 Picklist** button (or the toolbar button).

After a rebuild, click **Reload** for the extension on `about:debugging`. Temporary add-ons are removed when
Firefox restarts.

## Layout

| Path | What |
| --- | --- |
| `src/engine/` | Pure picklist logic: sections and sort (`sections.ts` is the hand-edited config), availability, binders |
| `src/moxfield/` | Moxfield API client: auth, decks, incremental collection search, response schemas |
| `src/scryfall/` | Scryfall set list (cached 7 days) |
| `src/app/` | Generating a picklist end to end; deck cache |
| `src/pages/pick/` | The picklist page (Preact) |
| `src/content/`, `src/background/` | The 🥒 button on deck pages; tab opening and header learning |
| `public/` | `manifest.json` and icon |
| `tests/` | Fake Moxfield server, fixtures, test helpers |
| `spikes/moxfield-probe/` | The throwaway probe extension that worked out the Moxfield API |
