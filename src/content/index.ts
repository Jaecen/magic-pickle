// Adds the 🥒 button and the deck hash to Moxfield deck pages, and hashes to the deck list. Moxfield is a single-page app, so both are kept in
// sync with the URL rather than added once.
//
// This runs at document_start: when Moxfield's app starts it rewrites the URL (to /decks/{id}/preview) and drops
// the fragment, which may hold a label's hash from its QR code (`#mp1=…`). So the fragment is read first.

import type { OpenPicklistMessage } from "../messages";
import { isMessage } from "../messages";
import { deckIdFromPath } from "../moxfield/urls";
import { refreshDeckList, syncDeckList } from "./deckList";
import { HashChip } from "./hashChip";

const BUTTON_ID = "magic-pickle-button";
const HASH_ROW_ID = "magic-pickle-hash-row";

/** The label to check on each deck: from the URL this page was opened with, or typed in the hash dialog. */
const labels = new Map<string, string>();
const openedDeck = deckIdFromPath(location.pathname);
if (openedDeck && /^#mp\d+=/.test(location.hash)) labels.set(openedDeck, location.hash);

let chip: HashChip | undefined;

function createButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  // Just the emoji, so it doesn't cover the deck stats along the bottom of the page.
  button.textContent = "🥒";
  button.title = "Magic Pickle: open a picklist for this deck";
  button.setAttribute("aria-label", "Open a Magic Pickle picklist for this deck");
  Object.assign(button.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    width: "44px",
    height: "44px",
    padding: "0",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    background: "#3a7d44",
    color: "#fff",
    font: "22px/1 system-ui, sans-serif",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,.3)",
  });
  button.addEventListener("click", () => {
    const message: OpenPicklistMessage = { type: "openPicklist", publicId: deckIdFromPath(location.pathname) };
    void browser.runtime.sendMessage(message);
  });
  return button;
}

/**
 * Where the hash goes: after the deck's format pills (the row after the title), before the description. Moxfield's
 * container classes are generated, so the title's `h1` is the anchor.
 */
function hashRowAnchor(): Element | null {
  const title = document.querySelector("main h1, h1");
  return title?.nextElementSibling ?? title;
}

function syncHash(publicId: string | undefined): void {
  if (chip && chip.publicId !== publicId) {
    document.getElementById(HASH_ROW_ID)?.remove();
    chip = undefined;
  }
  if (!publicId) return;
  const anchor = hashRowAnchor();
  if (!anchor) return;
  chip ??= new HashChip(publicId, labels);
  let row = document.getElementById(HASH_ROW_ID);
  if (!row) {
    row = document.createElement("div");
    row.id = HASH_ROW_ID;
    Object.assign(row.style, { margin: "-0.5rem 0 1.25rem" });
  }
  if (row.firstChild !== chip.host) row.replaceChildren(chip.host);
  // Moxfield re-renders the header, which can drop the row or move things around it.
  if (anchor.nextElementSibling !== row) anchor.after(row);
}

function sync(): void {
  const publicId = deckIdFromPath(location.pathname);
  const existing = document.getElementById(BUTTON_ID);
  if (publicId && !existing) document.body.appendChild(createButton());
  else if (!publicId && existing) existing.remove();
  syncHash(publicId);
  syncDeckList();
}

function start(): void {
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sync();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  sync();
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (isMessage(message, "moxfieldChanged")) {
    chip?.refreshSoon();
    refreshDeckList();
  }
  return undefined;
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
