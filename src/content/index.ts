// Adds the 🥒 button to Moxfield deck pages. Moxfield is a single-page app, so the button is kept in sync
// with the URL rather than added once.

import type { OpenPicklistMessage } from "../messages";
import { deckIdFromPath } from "../moxfield/urls";

const BUTTON_ID = "magic-pickle-button";

function createButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "🥒 Picklist";
  button.title = "Magic Pickle: open a picklist for this deck";
  Object.assign(button.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    padding: "8px 14px",
    borderRadius: "999px",
    border: "none",
    background: "#3a7d44",
    color: "#fff",
    font: "600 14px system-ui, sans-serif",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,.3)",
  });
  button.addEventListener("click", () => {
    const message: OpenPicklistMessage = { type: "openPicklist", publicId: deckIdFromPath(location.pathname) };
    void browser.runtime.sendMessage(message);
  });
  return button;
}

function sync(): void {
  const onDeck = deckIdFromPath(location.pathname) !== undefined;
  const existing = document.getElementById(BUTTON_ID);
  if (onDeck && !existing) document.body.appendChild(createButton());
  else if (!onDeck && existing) existing.remove();
}

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
