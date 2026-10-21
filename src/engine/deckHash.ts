// A short fingerprint of what's physically in a deck, printed on its label and compared by eye (design doc §6.6).
// Two parts: three words for the card list (names and quantities, which Moxfield's history can replay) and one
// word for the printings (which it can't). This is scheme "mp1": labels are permanent, so changing anything that
// feeds a hash needs a new scheme, not an edit.

import { IN_DECK_BOARDS } from "./picklist";
import type { DeckEntry } from "./types";
import { WORDS } from "./wordlist";

export const SCHEME = "mp1";

/** Word indexes into {@link WORDS}: three for the card list, one for the printings. */
export interface DeckHash {
  cards: readonly [number, number, number];
  printings: number;
}

/** How a label's hash compares with the deck's current one. */
export type HashComparison = "match" | "printingsChanged" | "cardsChanged";

/**
 * Copies of each card name across the in-deck boards. Moving a card between those boards (main to commanders)
 * doesn't change what's in the box, so boards aren't part of the key.
 */
export function cardCounts(entries: readonly DeckEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (!IN_DECK_BOARDS.has(e.board) || e.quantity <= 0) continue;
    counts.set(e.card.name, (counts.get(e.card.name) ?? 0) + e.quantity);
  }
  return counts;
}

/** The card-list part of the hash, from name counts (which is also what a history replay produces). */
export async function cardListHash(counts: ReadonlyMap<string, number>): Promise<DeckHash["cards"]> {
  const lines = [...counts]
    .filter(([, n]) => n !== 0)
    .map(([name, n]) => [name.normalize("NFC"), n] as const)
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(([name, n]) => `${n} ${name}`);
  const [a, b, c] = wordIndexes(await sha256([`${SCHEME} cards`, ...lines].join("\n")), 3);
  return [a!, b!, c!];
}

export async function deckHash(entries: readonly DeckEntry[]): Promise<DeckHash> {
  const printings = new Map<string, number>();
  for (const e of entries) {
    if (!IN_DECK_BOARDS.has(e.board) || e.quantity <= 0) continue;
    const key = `${e.card.scryfall_id} ${e.finish}${e.isProxy ? " proxy" : ""}`;
    printings.set(key, (printings.get(key) ?? 0) + e.quantity);
  }
  const lines = [...printings].sort(([a], [b]) => byCodeUnit(a, b)).map(([key, n]) => `${n} ${key}`);
  const [printingWord] = wordIndexes(await sha256([`${SCHEME} printings`, ...lines].join("\n")), 1);
  return { cards: await cardListHash(cardCounts(entries)), printings: printingWord! };
}

export function hashWords(hash: DeckHash): string[] {
  return [...hash.cards, hash.printings].map((i) => WORDS[i]!);
}

/** The label's URL fragment, e.g. `mp1=timb-orbi-velv-luna`: each word cut to the 4 letters that identify it. */
export function hashFragment(hash: DeckHash): string {
  return `${SCHEME}=${hashWords(hash)
    .map((w) => w.slice(0, 4))
    .join("-")}`;
}

/**
 * Reads a hash from a label: a URL fragment (`#mp1=timb-orbi-velv-luna`) or typed words, whole or cut to 4
 * letters, separated by anything that isn't a letter. Undefined unless it's exactly four known words, or the
 * fragment names another scheme.
 */
export function parseHash(text: string): DeckHash | undefined {
  let words = text.trim().replace(/^#/, "");
  const eq = words.indexOf("=");
  if (eq >= 0) {
    if (words.slice(0, eq) !== SCHEME) return undefined;
    words = words.slice(eq + 1);
  }
  const indexes = words
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map(wordIndex);
  if (indexes.length !== 4 || indexes.some((i) => i === undefined)) return undefined;
  const [a, b, c, d] = indexes as number[];
  return { cards: [a!, b!, c!], printings: d! };
}

export function compareHashes(label: DeckHash, current: DeckHash): HashComparison {
  if (!sameCards(label.cards, current.cards)) return "cardsChanged";
  return label.printings === current.printings ? "match" : "printingsChanged";
}

export function sameCards(a: DeckHash["cards"], b: DeckHash["cards"]): boolean {
  return a.every((w, i) => w === b[i]);
}

const BY_PREFIX = new Map(WORDS.map((w, i) => [w.slice(0, 4), i]));

/** A word's index from the word or its first letters (at least 4, or the whole of a 3-letter word). */
function wordIndex(token: string): number | undefined {
  const i = BY_PREFIX.get(token.slice(0, 4));
  if (i === undefined) return undefined;
  const word = WORDS[i]!;
  return word === token || (token.length >= 4 && word.startsWith(token)) ? i : undefined;
}

/** Plain UTF-16 order, so the canonical text doesn't depend on the browser's locale. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** The first `count` 11-bit numbers of `bytes`, most significant bit first. */
function wordIndexes(bytes: Uint8Array, count: number): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    if (bits >= 11) {
      bits -= 11;
      out.push((acc >> bits) & 0x7ff);
      acc &= (1 << bits) - 1;
      if (out.length === count) break;
    }
  }
  return out;
}
