import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { card } from "../../tests/cards";
import { cardCounts, compareHashes, deckHash, hashFragment, hashWords, parseHash, type DeckHash } from "./deckHash";
import type { DeckEntry, Finish } from "./types";
import { WORDS } from "./wordlist";

const zur = card({ name: "Zur the Enchanter", set: "csp", scryfall_id: "zur-csp" });
const ring = card({ name: "Sol Ring", set: "c21", scryfall_id: "ring-c21" });
const ringCmr = card({ name: "Sol Ring", set: "cmr", scryfall_id: "ring-cmr" });
const path = card({ name: "Branchloft Pathway // Boulderloft Pathway", set: "znr", scryfall_id: "path-znr" });

const entry = (board: string, quantity: number, c = ring, finish: Finish = "nonFoil", isProxy?: boolean): DeckEntry => ({
  board,
  quantity,
  finish,
  card: c,
  ...(isProxy ? { isProxy } : {}),
});

const deck: DeckEntry[] = [entry("commanders", 1, zur), entry("mainboard", 1, ring), entry("mainboard", 1, path, "foil")];
const words = async (entries: DeckEntry[]) => hashWords(await deckHash(entries));

describe("deckHash", () => {
  it("is frozen for scheme mp1", async () => {
    // Printed labels depend on these exact words. If this fails, the hash changed: that needs a new scheme.
    // Checked independently: SHA-256 of "mp1 cards\n1 Branchloft Pathway // Boulderloft Pathway\n1 Sol Ring\n1 Zur
    // the Enchanter" and of "mp1 printings\n1 path-znr foil\n1 ring-c21 nonFoil\n1 zur-csp nonFoil", 11 bits a word.
    expect(await words(deck)).toEqual(["hundred", "spider", "fiction", "twist"]);
  });

  it("ignores entry order and how a printing is split across lines", async () => {
    const split = [entry("mainboard", 1, path, "foil"), entry("mainboard", 1, ring), entry("commanders", 1, zur)];
    expect(await words(split)).toEqual(await words(deck));
    const twoLines = [entry("mainboard", 1, ring), entry("mainboard", 1, ring)];
    expect(await words(twoLines)).toEqual(await words([entry("mainboard", 2, ring)]));
  });

  it("ignores moves between in-deck boards and anything on other boards", async () => {
    const moved = [entry("mainboard", 1, zur), entry("mainboard", 1, ring), entry("signatureSpells", 1, path, "foil")];
    expect(await words(moved)).toEqual(await words(deck));
    const extras = [...deck, entry("maybeboard", 3, ringCmr), entry("sideboard", 1, zur), entry("tokens", 1, ring)];
    expect(await words(extras)).toEqual(await words(deck));
  });

  it("changes the card words when cards or counts change, whatever the printing", async () => {
    const base = await deckHash(deck);
    const added = await deckHash([...deck, entry("mainboard", 1, ringCmr)]);
    expect(added.cards).not.toEqual(base.cards);
    const removed = await deckHash(deck.slice(0, 2));
    expect(removed.cards).not.toEqual(base.cards);
  });

  it("changes only the printing word for printing, finish, and proxy swaps", async () => {
    const base = await deckHash(deck);
    for (const swapped of [
      [deck[0]!, entry("mainboard", 1, ringCmr), deck[2]!],
      [deck[0]!, entry("mainboard", 1, ring, "etched"), deck[2]!],
      [deck[0]!, entry("mainboard", 1, ring, "nonFoil", true), deck[2]!],
    ]) {
      const hash = await deckHash(swapped);
      expect(hash.cards).toEqual(base.cards);
      expect(hash.printings).not.toBe(base.printings);
      expect(compareHashes(base, hash)).toBe("printingsChanged");
    }
  });

  it("counts cards by name across boards", () => {
    expect(cardCounts([entry("commanders", 1, ring), entry("mainboard", 2, ringCmr), entry("maybeboard", 1, ring)])).toEqual(
      new Map([["Sol Ring", 3]]),
    );
  });
});

describe("label text", () => {
  const hash: DeckHash = { cards: [WORDS.indexOf("timber"), WORDS.indexOf("orbit"), WORDS.indexOf("velvet")], printings: WORDS.indexOf("lunar") };

  it("makes a fragment of 4-letter prefixes and reads it back", () => {
    expect(hashFragment(hash)).toBe("mp1=timb-orbi-velv-luna");
    expect(parseHash(`#${hashFragment(hash)}`)).toEqual(hash);
  });

  it("reads typed words, whole or cut short, with any separators", () => {
    expect(parseHash("timber orbit velvet · lunar")).toEqual(hash);
    expect(parseHash("  TIMB, orbi.velve/luna ")).toEqual(hash);
  });

  it("rejects other schemes, unknown words, and the wrong number of words", () => {
    expect(parseHash("mp2=timb-orbi-velv-luna")).toBeUndefined();
    expect(parseHash("timber orbit velvet")).toBeUndefined();
    expect(parseHash("timber orbit velvet lunar lunar")).toBeUndefined();
    expect(parseHash("timber orbit velvet lunatic")).toBeUndefined();
    expect(parseHash("tim orbit velvet lunar")).toBeUndefined();
  });

  it("compares a label with the current hash", () => {
    expect(compareHashes(hash, hash)).toBe("match");
    expect(compareHashes(hash, { ...hash, printings: 0 })).toBe("printingsChanged");
    expect(compareHashes(hash, { ...hash, cards: [0, 0, 0] })).toBe("cardsChanged");
  });
});

describe("word list", () => {
  it("is the BIP39 English list", () => {
    const text = WORDS.join("\n") + "\n";
    expect(createHash("sha256").update(text).digest("hex")).toBe("2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda");
  });

  it("identifies every word by its first 4 letters", () => {
    expect(new Set(WORDS.map((w) => w.slice(0, 4))).size).toBe(2048);
  });
});
