import type { Card } from "./types";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Compares sort strings: case- and accent-insensitive, numbers by value. */
export const compareText = collator.compare;

/** The name printed on the front of the card. */
export function frontName(card: Card): string {
  return card.card_faces?.[0]?.name ?? card.name.split(" // ")[0] ?? card.name;
}

/**
 * The front name as filed: accents and punctuation dropped, word by word (so "Sol Ring" comes before
 * "Solar Flare"), and no special handling of "The".
 */
export function nameSortKey(card: Card): string {
  return frontName(card)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
