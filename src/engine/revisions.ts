// Finds which revision of a deck a label was made from, by undoing Moxfield's history step by step until the card
// list hashes to the label's words (design doc §6.6). History records card adds, removes, and board moves, but not
// printing or finish swaps, so only the card list can be replayed. A match also proves the replay: if history is
// missing something, nothing matches and no changes are claimed.

import { cardListHash, sameCards, type DeckHash } from "./deckHash";
import { IN_DECK_BOARDS } from "./picklist";

/** One history entry: a card's quantity on a board changed by `quantityDelta` at `at` (UTC ISO time). */
export interface HistoryEntry {
  board: string;
  name: string;
  quantityDelta: number;
  at: string;
}

/** A card whose count changed since the label: positive if the deck gained copies, negative if it lost them. */
export interface CardChange {
  name: string;
  quantity: number;
}

export type RevisionSearch =
  | {
      found: true;
      /** The time of the first change after the label's revision. */
      changedSince: string;
      changes: CardChange[];
    }
  | {
      found: false;
      /** Whether all of the deck's history was searched (otherwise the search stopped at `maxEntries`). */
      complete: boolean;
    };

/**
 * Undoes `history` (newest first) from the deck's current card counts until the card list matches `label`.
 * Entries with the same timestamp are one edit (a board move is a remove and an add), so they're undone together.
 */
export async function findLabelRevision(
  current: ReadonlyMap<string, number>,
  history: AsyncIterable<HistoryEntry>,
  label: DeckHash["cards"],
  maxEntries = 1000,
): Promise<RevisionSearch> {
  const state = new Map(current);
  let group: HistoryEntry[] = [];
  let seen = 0;

  const undoGroup = async (): Promise<RevisionSearch | undefined> => {
    for (const e of group) {
      if (!IN_DECK_BOARDS.has(e.board)) continue;
      const n = (state.get(e.name) ?? 0) - e.quantityDelta;
      if (n === 0) state.delete(e.name);
      else state.set(e.name, n);
    }
    const changedSince = group[0]!.at;
    group = [];
    if (!sameCards(await cardListHash(state), label)) return undefined;
    return { found: true, changedSince, changes: diff(state, current) };
  };

  for await (const entry of history) {
    if (group.length > 0 && entry.at !== group[0]!.at) {
      const result = await undoGroup();
      if (result) return result;
    }
    if (seen++ >= maxEntries) return { found: false, complete: false };
    group.push(entry);
  }
  if (group.length > 0) {
    const result = await undoGroup();
    if (result) return result;
  }
  return { found: false, complete: true };
}

function diff(before: ReadonlyMap<string, number>, after: ReadonlyMap<string, number>): CardChange[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  return [...names]
    .map((name) => ({ name, quantity: (after.get(name) ?? 0) - (before.get(name) ?? 0) }))
    .filter((c) => c.quantity !== 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
