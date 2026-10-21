// Deck hashes and label checks (design doc §6.6), shared by the background script and the extension pages.

import { cardCounts, compareHashes, deckHash, type DeckHash } from "../engine/deckHash";
import { findLabelRevision, type RevisionSearch } from "../engine/revisions";
import type { MoxfieldClient } from "../moxfield/client";
import type { FetchedDeck } from "../moxfield/decks";
import { deckHistory } from "../moxfield/history";

export type LabelCheck =
  | { comparison: "match" | "printingsChanged" }
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
