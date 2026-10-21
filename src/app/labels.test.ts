import { describe, expect, it } from "vitest";
import { fakeMoxfield, rawCard, type RawDeck } from "../../tests/fakeMoxfield";
import { deckHash } from "../engine/deckHash";
import { MoxfieldClient } from "../moxfield/client";
import { getDeck } from "../moxfield/decks";
import { memoryStore } from "../util/store";
import { builtDeckHashes, checkLabel } from "./labels";

const ring = rawCard({ name: "Sol Ring", set: "c21", cn: "263" });
const ringCmr = rawCard({ name: "Sol Ring", set: "cmr", cn: "472" });
const zur = rawCard({ name: "Zur the Enchanter", set: "csp" });
const crypt = rawCard({ name: "Mana Crypt", set: "2xm" });

const deckWith = (mainboard: RawDeck["boards"]["mainboard"], history: RawDeck["history"] = []): RawDeck => ({
  publicId: "zurdeck000",
  name: "Zur",
  boards: { commanders: [{ quantity: 1, card: zur }], mainboard },
  history,
});

async function hashOf(deck: RawDeck) {
  return deckHash((await getDeck(new MoxfieldClient(fakeMoxfield({ decks: [deck] }).fetch), deck.publicId)).entries);
}

describe("checkLabel", () => {
  it("doesn't read history when only printings differ", async () => {
    const label = await hashOf(deckWith([{ quantity: 1, card: ring }]));
    const server = fakeMoxfield({ decks: [deckWith([{ quantity: 1, card: ringCmr }])] });
    const client = new MoxfieldClient(server.fetch);
    const deck = await getDeck(client, "zurdeck000");
    expect(await checkLabel(client, deck, label)).toEqual({ comparison: "printingsChanged" });
    expect(server.apiRequests().some((r) => r.url.pathname.endsWith("/history"))).toBe(false);
  });

  it("finds the label's revision in history", async () => {
    const label = await hashOf(deckWith([{ quantity: 1, card: ring }]));
    const history = [
      { boardType: "mainboard", quantityDelta: 1, updatedAtUtc: "2026-10-02T00:00:00Z", card: crypt },
      { boardType: "mainboard", quantityDelta: -1, updatedAtUtc: "2026-10-01T00:00:00Z", card: ring },
      { boardType: "mainboard", quantityDelta: 1, updatedAtUtc: "2026-09-01T00:00:00Z", card: ring },
      { boardType: "commanders", quantityDelta: 1, updatedAtUtc: "2026-09-01T00:00:00Z", card: zur },
    ];
    const client = new MoxfieldClient(fakeMoxfield({ decks: [deckWith([{ quantity: 1, card: crypt }], history)] }).fetch);
    const deck = await getDeck(client, "zurdeck000");
    expect(await checkLabel(client, deck, label)).toEqual({
      comparison: "cardsChanged",
      revision: {
        found: true,
        changedSince: "2026-10-01T00:00:00Z",
        changes: [
          { name: "Mana Crypt", quantity: 1 },
          { name: "Sol Ring", quantity: -1 },
        ],
      },
    });
  });
});

describe("builtDeckHashes", () => {
  it("hashes the built decks from the cache, refetching only changed decks", async () => {
    const built = { ...deckWith([{ quantity: 1, card: ring }]), folder: "3 - Built" };
    const idea = { ...deckWith([{ quantity: 1, card: crypt }]), publicId: "ideadeck00", folder: "0 - Ideas" };
    const server = fakeMoxfield({ decks: [built, idea] });
    const client = new MoxfieldClient(server.fetch);
    const store = memoryStore();
    const hashes = await builtDeckHashes(client, store);
    expect([...hashes.keys()]).toEqual(["zurdeck000"]);
    expect(hashes.get("zurdeck000")).toEqual(await hashOf(built));

    await builtDeckHashes(client, store);
    expect(server.apiRequests().filter((r) => r.url.pathname.startsWith("/v3/decks/all/"))).toHaveLength(1);
  });
});
