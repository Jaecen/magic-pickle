// The hash words next to each built deck on Moxfield's deck list (/decks/personal), so a label can be checked
// without opening the deck. The background loads them from the deck cache once per page visit.

import type { BuiltDeckHashesMessage, BuiltDeckHashesReply } from "../messages";
import { deckIdFromPath } from "../moxfield/urls";
import { words } from "./dom";

const WORDS_CLASS = "magic-pickle-words";

let hashes: Record<string, string[]> | undefined;
let loading = false;

export function onDeckList(): boolean {
  return location.pathname.startsWith("/decks/personal");
}

/** Adds the words under each built deck's name in the list, loading them first if needed. */
export function syncDeckList(): void {
  if (!onDeckList()) return;
  if (!hashes) {
    void load();
    return;
  }
  for (const a of document.querySelectorAll<HTMLAnchorElement>('tr a[href^="/decks/"]')) {
    const list = hashes[deckIdFromPath(a.getAttribute("href") ?? "") ?? ""];
    if (!list || a.nextElementSibling?.classList.contains(WORDS_CLASS)) continue;
    const span = words(list);
    span.className = WORDS_CLASS;
    span.title = "Magic Pickle deck hash";
    Object.assign(span.style, { display: "block", fontSize: "0.85em", opacity: "0.75", whiteSpace: "nowrap" });
    a.after(span);
  }
}

/** Reloads the words, e.g. after Moxfield saved a change. */
export function refreshDeckList(): void {
  if (!onDeckList()) return;
  hashes = undefined;
  for (const span of document.querySelectorAll(`.${WORDS_CLASS}`)) span.remove();
  syncDeckList();
}

async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  const message: BuiltDeckHashesMessage = { type: "builtDeckHashes" };
  try {
    const reply = (await browser.runtime.sendMessage(message)) as BuiltDeckHashesReply;
    if (!reply.ok) console.warn("Magic Pickle: no deck hashes:", reply.error);
    hashes = reply.ok ? reply.words : {};
  } catch (e) {
    console.warn("Magic Pickle: no deck hashes:", e);
    hashes = {};
  } finally {
    loading = false;
  }
  syncDeckList();
}
