// Dev-only harness, never part of the extension. WebDriver BiDi can't inspect moz-extension:// pages, so for
// automated testing this bundle is loaded into a logged-in moxfield.com tab. It runs the real picklist code
// against the real Moxfield API (from the page instead of the extension) and renders the real UI in an iframe
// that browser automation can see. Built with `npm run build:harness`; served by scripts/serve-harness.

import { render } from "preact";
import { generatePicklist } from "../app/generate";
import { MoxfieldClient, type FetchFn } from "../moxfield/client";
import { LabelApp } from "../pages/label/App";
import { App } from "../pages/pick/App";
import { memoryStore } from "../util/store";
import "../pages/pick/styles.css";
import "../pages/label/styles.css";

const fetchFn: FetchFn = (input, init) => fetch(input, init);
const store = memoryStore();

const harness = {
  /** Generates a picklist and returns a JSON-friendly summary plus the request log. */
  async data(publicId: string) {
    const client = new MoxfieldClient(fetchFn);
    try {
      const { deck, picklist, stats } = await generatePicklist(publicId, { client, store, fetchFn });
      return {
        deck: deck.name,
        stats,
        picks: picklist.picks.map((p) => ({
          section: p.placement.section,
          group: p.placement.group,
          color: p.placement.color,
          qty: p.quantity,
          name: p.card.name,
          printing: `${p.card.set} #${p.card.cn} ${p.finish} ${p.languageCode}`,
          binder: p.fromBinder || undefined,
        })),
        notices: picklist.notices,
        skipped: picklist.skipped,
        log: client.log,
      };
    } catch (e) {
      return { error: String(e), log: client.log };
    }
  },

  /** Renders the picklist UI for `publicId` in a full-window iframe over the Moxfield page. */
  async render(publicId: string, cssUrl: string) {
    const root = await frame(cssUrl);
    render(<App client={new MoxfieldClient(fetchFn)} store={store} fetchFn={fetchFn} deck={publicId} />, root);
  },

  /** Renders the label page for `publicId` the same way. */
  async renderLabel(publicId: string, cssUrl: string) {
    const root = await frame(cssUrl);
    render(<LabelApp client={new MoxfieldClient(fetchFn)} store={store} deck={publicId} />, root);
  },
};

/** A full-window iframe over the Moxfield page, with the harness CSS, and the element to render into. */
async function frame(cssUrl: string): Promise<HTMLElement> {
  document.getElementById("magic-pickle-harness")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "magic-pickle-harness";
  Object.assign(frame.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", border: "0", zIndex: "2147483647", background: "#fff" });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div></body></html>`);
  doc.close();
  // Inline the CSS: a <link> in a document.write()'d iframe doesn't reliably apply.
  const style = doc.createElement("style");
  style.textContent = await (await fetch(cssUrl)).text();
  doc.head.appendChild(style);
  return doc.getElementById("app")!;
}

(globalThis as { magicPickleHarness?: typeof harness }).magicPickleHarness = harness;
