// Deck hashes and label checks (design doc §6.6), shared by the background script and the extension pages.

import { cardCounts, compareHashes, deckHash, type DeckHash } from "../engine/deckHash";
import { findLabelRevision, type RevisionSearch } from "../engine/revisions";
import type { MoxfieldClient } from "../moxfield/client";
import { listDecks, type FetchedDeck } from "../moxfield/decks";
import { deckHistory } from "../moxfield/history";
import type { Store } from "../util/store";
import { loadDecksCached } from "./deckCache";
import { cachedDeckSummaries } from "./generate";

export type LabelCheck =
  | { comparison: "match" }
  | { comparison: "printingsChanged" }
  | {
      comparison: "cardsChanged";
      /** Which revision the label is from and what changed since, from the deck's history. */
      revision: RevisionSearch;
    };

/**
 * Compares a label's hash with the deck. When the cards differ, the deck's history is searched for the label's
 * revision: one request per 100 history entries, stopping as soon as it's found.
 */
export async function checkLabel(client: MoxfieldClient, deck: FetchedDeck, label: DeckHash): Promise<LabelCheck> {
  const comparison = compareHashes(label, await deckHash(deck.entries));
  if (comparison !== "cardsChanged") return { comparison };
  const revision = await findLabelRevision(cardCounts(deck.entries), deckHistory(client, deck.publicId), label.cards);
  return { comparison, revision };
}

/**
 * The hash of every built deck, for Moxfield's deck list. Built decks come from the deck cache, so only decks that
 * changed are fetched. The binder decks are loaded too, only so they stay in the cache the picklist shares.
 */
export async function builtDeckHashes(client: MoxfieldClient, store: Store): Promise<Map<string, DeckHash>> {
  const { built, binders } = cachedDeckSummaries(await listDecks(client));
  const { decks } = await loadDecksCached(client, store, [...built, ...binders]);
  const builtIds = new Set(built.map((s) => s.publicId));
  const hashes = new Map<string, DeckHash>();
  for (const deck of decks) if (builtIds.has(deck.publicId)) hashes.set(deck.publicId, await deckHash(deck.entries));
  return hashes;
}
