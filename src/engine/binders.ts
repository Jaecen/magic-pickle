// Placement of fixed binder copies (design doc §6.3.2).

import { COLOR_ORDER, colorBucket } from "./color";
import { nameSortKey } from "./names";
import { BINDER_DECKS, COLOR_OVERRIDES, SECTION_INDEX, type BinderDeckDef } from "./sections";
import type { Placement } from "./sort";
import type { Card, Deck } from "./types";

const UNKNOWN_TAG = 999;

/** A binder deck matched to its configuration, with its position within its binder. */
export interface BinderDeck {
  def: BinderDeckDef;
  position: number;
  deck: Deck;
}

/** Matches `Collections` decks to the configured binder decks, in pull order. Unconfigured decks are ignored. */
export function matchBinderDecks(decks: readonly Deck[]): BinderDeck[] {
  const byName = new Map(decks.map((d) => [d.name, d]));
  const positions = new Map<string, number>();
  const matched: BinderDeck[] = [];
  for (const def of BINDER_DECKS) {
    const position = positions.get(def.binder) ?? 0;
    positions.set(def.binder, position + 1);
    const deck = byName.get(def.deck);
    if (deck) matched.push({ def, position, deck });
  }
  return matched;
}

/**
 * Where a binder copy of `card` sits: by deck, then color and name, like Main with each deck as the "set";
 * or, for decks arranged by tag (the LTR panoramas), by tag order and then collector number.
 */
export function placeInBinder(binderDeck: BinderDeck, card: Card): Placement {
  const { def, position, deck } = binderDeck;
  const color = colorBucket(card, COLOR_OVERRIDES);
  const section = SECTION_INDEX.get(def.binder)!;
  if (def.tagOrder) {
    const tags = deck.tags?.[card.name] ?? [];
    const tag = tags.find((t) => def.tagOrder!.includes(t));
    const tagIndex = tag ? def.tagOrder.indexOf(tag) : UNKNOWN_TAG;
    return {
      section: def.binder,
      group: tag ?? def.deck,
      color,
      key: [section, position, tagIndex, card.cn, nameSortKey(card), card.set],
    };
  }
  return {
    section: def.binder,
    group: def.deck,
    color,
    key: [section, position, COLOR_ORDER.indexOf(color), nameSortKey(card), card.cn, card.set],
  };
}
