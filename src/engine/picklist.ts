// Turns a target deck, the built decks, the binder decks, and the collection rows for the target deck's
// cards into a picklist in pull order plus notices (design doc §6.2, §6.3.2).

import { matchBinderDecks, placeInBinder, type BinderDeck } from "./binders";
import { compareText } from "./names";
import { compareKeys, type CollectionSorter, type Placement } from "./sort";
import type { Card, CollectionRow, Deck, DeckEntry, Finish } from "./types";

/** The boards physically in a deck; sideboard and Considering never count (§4.4). */
export const IN_DECK_BOARDS: ReadonlySet<string> = new Set(["mainboard", "commanders", "companions"]);

export interface PicklistInput {
  target: Deck;
  /** Decks in the built folder. The target deck is skipped if it's among them. */
  builtDecks: readonly Deck[];
  /** Decks in the `Collections` folder; only those configured in `BINDER_DECKS` are used. */
  binderDecks: readonly Deck[];
  /** Collection rows for (at least) every card name in the target deck. */
  collection: readonly CollectionRow[];
  sorter: CollectionSorter;
}

export interface Pick {
  card: Card;
  finish: Finish;
  languageCode: string;
  quantity: number;
  placement: Placement;
  fromBinder: boolean;
}

/** Copies of a printing in a built deck. */
export interface Holding {
  deck: string;
  publicId: string;
  card: Card;
  finish: Finish;
  quantity: number;
}

export interface Alternative {
  card: Card;
  finish: Finish;
  languageCode: string;
  free: number;
  /** Where to take it from: a non-binder copy if one is free, otherwise the binder. */
  placement: Placement;
  fromBinder: boolean;
}

interface ShortfallBase {
  card: Card;
  finish: Finish;
  languageCode: string;
  wanted: number;
  /** Copies of the requested printing that did make the picklist. */
  picked: number;
  /** Copies of the requested printing owned. */
  owned: number;
}

export type Notice =
  /** The requested printing is short, but other printings of the card have free copies. */
  | (ShortfallBase & { kind: "printingNotFree"; heldBy: Holding[]; alternatives: Alternative[] })
  /** No printing of the card has a free copy. `heldBy` lists every built deck holding any printing. */
  | (ShortfallBase & { kind: "unavailable"; heldBy: Holding[] })
  /** Built decks use more copies of a printing than the collection holds: Moxfield has drifted (§6.4). */
  | { kind: "overAllocated"; card: Card; finish: Finish; languageCode: string; owned: number; used: number; heldBy: Holding[] };

export interface Skipped {
  reason: "basic" | "token" | "proxy";
  name: string;
  quantity: number;
}

export interface Picklist {
  /** In pull order. */
  picks: Pick[];
  notices: Notice[];
  /** Target deck lines left off the picklist on purpose, by name. */
  skipped: Skipped[];
}

/** Everything known about one printing: Scryfall id × finish × language (§6.1). */
interface Printing {
  card: Card;
  finish: Finish;
  languageCode: string;
  owned: number;
  used: number;
  heldBy: Holding[];
  binderWanted: number;
  binderDeck?: BinderDeck;
  freeLoose: number;
  freeBinder: number;
}

const printingKey = (card: Card, finish: Finish, languageCode: string) =>
  `${card.scryfall_id}|${finish}|${languageCode}`;

function skipReason(entry: DeckEntry): Skipped["reason"] | undefined {
  if (entry.card.isToken) return "token";
  const frontType = entry.card.card_faces?.[0]?.type_line ?? entry.card.type_line.split(" // ")[0] ?? "";
  if (/\bBasic\b/.test(frontType)) return "basic";
  if (entry.isProxy) return "proxy";
  return undefined;
}

/** In-deck entries that represent real, cataloged cards. */
function countedEntries(deck: Deck): DeckEntry[] {
  return deck.entries.filter((e) => IN_DECK_BOARDS.has(e.board) && !skipReason(e));
}

export function buildPicklist(input: PicklistInput): Picklist {
  const { target, sorter } = input;
  const printings = new Map<string, Printing>();
  const printing = (card: Card, finish: Finish, languageCode: string): Printing => {
    const key = printingKey(card, finish, languageCode);
    let p = printings.get(key);
    if (!p) {
      p = { card, finish, languageCode, owned: 0, used: 0, heldBy: [], binderWanted: 0, freeLoose: 0, freeBinder: 0 };
      printings.set(key, p);
    }
    return p;
  };

  // Split the target deck into lines to pull and lines skipped on purpose.
  const wanted: DeckEntry[] = [];
  const skipped = new Map<string, Skipped>();
  for (const entry of target.entries.filter((e) => IN_DECK_BOARDS.has(e.board))) {
    const reason = skipReason(entry);
    if (!reason) {
      wanted.push(entry);
      continue;
    }
    const key = `${reason}|${entry.card.name}`;
    const s = skipped.get(key) ?? { reason, name: entry.card.name, quantity: 0 };
    s.quantity += entry.quantity;
    skipped.set(key, s);
  }
  const names = new Set(wanted.map((e) => e.card.name));

  // Owned: non-proxy collection rows, matched on the copy's own language.
  for (const row of input.collection) {
    if (row.isProxy || row.card.isToken || !names.has(row.card.name)) continue;
    printing(row.card, row.finish, row.languageCode).owned += row.quantity;
  }

  // Used: in-deck boards of the other built decks. Deck entries don't record language, so they use the card's.
  for (const deck of input.builtDecks) {
    if (deck.publicId === target.publicId) continue;
    for (const e of countedEntries(deck)) {
      if (!names.has(e.card.name)) continue;
      const p = printing(e.card, e.finish, e.card.lang);
      p.used += e.quantity;
      p.heldBy.push({ deck: deck.name, publicId: deck.publicId, card: e.card, finish: e.finish, quantity: e.quantity });
    }
  }

  // Fixed binder copies.
  for (const binderDeck of matchBinderDecks(input.binderDecks)) {
    for (const e of countedEntries(binderDeck.deck)) {
      if (!names.has(e.card.name)) continue;
      const p = printing(e.card, e.finish, e.card.lang);
      p.binderWanted += e.quantity;
      p.binderDeck ??= binderDeck;
    }
  }

  // Free copies. Built decks are assumed to hold non-binder copies first (§6.3.2).
  for (const p of printings.values()) {
    const binderCopies = Math.min(p.owned, p.binderWanted);
    const looseCopies = p.owned - binderCopies;
    const usedLoose = Math.min(p.used, looseCopies);
    p.freeLoose = looseCopies - usedLoose;
    p.freeBinder = Math.max(0, binderCopies - (p.used - usedLoose));
  }

  // Allocate: loose copies first, then binder copies.
  const picks: Pick[] = [];
  const shortfalls: { entry: DeckEntry; p: Printing; picked: number }[] = [];
  for (const entry of wanted) {
    const p = printing(entry.card, entry.finish, entry.card.lang);
    let remaining = entry.quantity;
    const fromLoose = Math.min(remaining, p.freeLoose);
    if (fromLoose > 0) {
      p.freeLoose -= fromLoose;
      remaining -= fromLoose;
      picks.push(pick(p, fromLoose, sorter.place(p.card, p.languageCode), false));
    }
    const fromBinder = Math.min(remaining, p.freeBinder);
    if (fromBinder > 0 && p.binderDeck) {
      p.freeBinder -= fromBinder;
      remaining -= fromBinder;
      picks.push(pick(p, fromBinder, placeInBinder(p.binderDeck, p.card), true));
    }
    if (remaining > 0) shortfalls.push({ entry, p, picked: entry.quantity - remaining });
  }

  const notices: Notice[] = [];
  for (const { entry, p, picked } of shortfalls) {
    const base = { card: p.card, finish: p.finish, languageCode: p.languageCode, wanted: entry.quantity, picked, owned: p.owned };
    const samePrintings = [...printings.values()].filter(
      (o) => o.card.name === p.card.name && o.languageCode === p.languageCode,
    );
    const alternatives = samePrintings
      .filter((o) => o !== p && o.freeLoose + o.freeBinder > 0)
      .map((o) => alternative(o, sorter))
      .sort((a, b) => compareKeys(a.placement.key, b.placement.key));
    notices.push(
      alternatives.length > 0
        ? { ...base, kind: "printingNotFree", heldBy: p.heldBy, alternatives }
        : { ...base, kind: "unavailable", heldBy: samePrintings.flatMap((o) => o.heldBy) },
    );
  }
  for (const p of printings.values()) {
    if (p.used > p.owned) {
      notices.push({
        kind: "overAllocated",
        card: p.card,
        finish: p.finish,
        languageCode: p.languageCode,
        owned: p.owned,
        used: p.used,
        heldBy: p.heldBy,
      });
    }
  }
  notices.sort((a, b) => compareText(a.card.name, b.card.name));

  return {
    picks: picks.sort((a, b) => compareKeys(a.placement.key, b.placement.key)),
    notices,
    skipped: [...skipped.values()].sort((a, b) => compareText(a.name, b.name)),
  };
}

function pick(p: Printing, quantity: number, placement: Placement, fromBinder: boolean): Pick {
  return { card: p.card, finish: p.finish, languageCode: p.languageCode, quantity, placement, fromBinder };
}

function alternative(p: Printing, sorter: CollectionSorter): Alternative {
  const loose = p.freeLoose > 0 || !p.binderDeck;
  return {
    card: p.card,
    finish: p.finish,
    languageCode: p.languageCode,
    free: p.freeLoose + p.freeBinder,
    placement: loose ? sorter.place(p.card, p.languageCode) : placeInBinder(p.binderDeck!, p.card),
    fromBinder: !loose,
  };
}
