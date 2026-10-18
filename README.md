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
3. Open a deck on moxfield.com while logged in and click the round **🥒** button in the bottom-right corner (or the toolbar button).

After a rebuild, click **Reload** for the extension on `about:debugging`. Temporary add-ons are removed when
Firefox restarts.

### Releasing

Releases are signed by Mozilla as an **unlisted** (self-distributed) add-on and published on GitHub. Installed
copies update themselves from [`updates.json`](updates.json).

1. Bump `version` in both `public/manifest.json` and `package.json` (it must increase every release).
2. Commit to `main`, then tag and push: `git tag v1.2.3 && git push origin main v1.2.3`.
3. The **Release** workflow checks the tag against the manifest, runs `npm run check`, signs with Mozilla, attaches
   `magic-pickle-<version>.xpi` to a GitHub release, and adds the version (with its SHA-256) to `updates.json` on
   `main`.

Signing needs the repo secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` (addons.mozilla.org → Developer Hub →
Manage API Keys).

**First install:** open the `.xpi` from the latest release in Firefox and accept the prompt. After that, Firefox
checks for updates about once a day (or use "Check for Updates" in `about:addons`).

### Automated end-to-end checks

Browser automation (WebDriver BiDi, e.g. the Firefox DevTools MCP server) can't inspect `moz-extension://`
pages. For automated checks, the same app code runs in a logged-in moxfield.com tab instead:

```sh
scripts/dev npm run build:harness
scripts/serve-harness            # serves dist-harness/ on http://127.0.0.1:8765 with CORS
```

Then, in the moxfield.com tab, load `http://127.0.0.1:8765/harness.js` with a `<script>` tag and call
`magicPickleHarness.data(publicId)` (a JSON summary) or `magicPickleHarness.render(publicId, cssUrl)` (the real UI
in an iframe). Keep runs spaced out: each costs 18–52 Moxfield requests, and bursts get rate-limited.

## Layout

| Path | What |
| --- | --- |
| `src/engine/` | Pure picklist logic: sections and sort (`sections.ts` is the hand-edited config), availability, binders |
| `src/moxfield/` | Moxfield API client: auth, decks, incremental collection search, response schemas |
| `src/scryfall/` | Scryfall set list (cached 7 days) |
| `src/app/` | Generating a picklist end to end; deck cache |
| `src/pages/pick/` | The picklist page (Preact) |
| `src/content/`, `src/background/` | The 🥒 button on deck pages; tab opening and header learning |
| `src/devtools/` | Dev-only harness for automated end-to-end checks (not shipped) |
| `public/` | `manifest.json` and icon |
| `tests/` | Fake Moxfield server, fixtures, test helpers |
| `spikes/moxfield-probe/` | The throwaway probe extension that worked out the Moxfield API |
