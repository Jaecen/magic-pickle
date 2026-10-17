# Spike: Moxfield probe extension

A throwaway Firefox extension to check whether a browser extension can do everything Magic Pickle needs with your logged-in Moxfield session. It has no build step and no dependencies.

## What it checks

| # | Question | Where |
| --- | --- | --- |
| Q1 | Which `api2.moxfield.com` endpoints does Moxfield use for collection search, the decks list, folders, and private decks? | §1, recorded from Moxfield's own traffic |
| Q2 | Where does the login token live, and can the extension reuse it? | §0 captured headers, §2 storage inspection |
| Q3 | Which request context gets past Cloudflare and auth: an extension page, a content script, or a request made as if by the page? Are cookies enough, or is the bearer token required? | §3 replay matrix |
| Q4 | Does the deck JSON (including private decks) carry exact printing data: set, collector number, finish, Scryfall ID? | §4 |
| Q5 | Can a whole deck's cards be looked up in the collection with a few OR'd Scryfall-syntax searches, and what are the limits? | §5 batch |
| Q6 | Is there rate limiting at picklist scale? | §5 rate test |
| Q7 | Can a button injected on the deck page open the extension's own page, and does it survive Moxfield's in-site navigation? | 🥒 button on deck pages |

Later rounds added buttons to the "★ Automated run" section: lookup strategies, a search-mismatch diagnosis, search sessions, reading Moxfield's own scripts, incremental ("continuation") search, and chunked search. Together they found how collection search actually works. The results are in [docs/DESIGN.md §4](../../docs/DESIGN.md#4-moxfield-integration).

The spike is finished. Keep it as a reference, and as a way to capture fixtures ("Download raw responses"). For discovery it requests `<all_urls>` host permission, which the real extension must not do.

## Run it

1. In Firefox, go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and select this folder's `manifest.json`. The extension stays loaded until Firefox restarts.
2. If you already have Moxfield tabs open, reload them.
3. Click the extension's toolbar button (it may be under the puzzle-piece menu) to open the probe page. Keep it open.
4. Work through sections 0–5 on the probe page. Each section has instructions.
   - For §5, load the collection search request into §3, then replace the search text in the URL or body with `{{Q}}`. If there's a page-size parameter, set it to 100 or more.
5. Click **Copy report** and paste the report back to Claude. The report contains endpoint shapes, statuses, and response schemas. Header values and tokens are never included. "Download raw responses" saves full JSON for use as test data; it contains your real data, so review it first.

## Notes

- The probe keeps the captured Moxfield request headers, including the bearer token, in `storage.session`. That storage is in memory and cleared when the browser closes. The token is never written to the report.
- The probe only sends read requests, and only the ones you trigger.
