import { describe, expect, it } from "vitest";
import { fakeMoxfield, rawCard } from "../../tests/fakeMoxfield";
import { MoxfieldChangedError, MoxfieldClient } from "./client";
import { getDeck, listDecks } from "./decks";

const zur = rawCard({ name: "Zur the Enchanter", set: "csp", mana_cost: "{1}{W}{U}{B}" });
const ring = rawCard({ name: "Sol Ring", set: "c21", cn: "263", type_line: "Artifact", mana_cost: "{1}", colors: [] });

describe("decks", () => {
  it("lists decks with their folder names", async () => {
    const server = fakeMoxfield({
      decks: [
        { publicId: "aaaaaaaaaa", name: "[1DH] Zur", folder: "3 - Built", boards: {} },
        { publicId: "bbbbbbbbbb", name: "Loose", boards: {} },
      ],
    });
    expect(await listDecks(new MoxfieldClient(server.fetch))).toEqual([
      { publicId: "aaaaaaaaaa", name: "[1DH] Zur", lastUpdatedAtUtc: "2026-01-01T00:00:00Z", folder: "3 - Built" },
      { publicId: "bbbbbbbbbb", name: "Loose", lastUpdatedAtUtc: "2026-01-01T00:00:00Z" },
    ]);
  });

  it("keeps only the in-deck boards, trims cards, and keeps tags", async () => {
    const server = fakeMoxfield({
      decks: [
        {
          publicId: "zurdeck000",
          name: "Zur",
          boards: {
            commanders: [{ quantity: 1, card: zur }],
            mainboard: [{ quantity: 1, finish: "foil", card: ring }],
            // Considering may hold odd entries; it's never validated.
            maybeboard: [{ quantity: 1, card: { name: "Wishlist thing" } as never }],
          },
          authorTags: { "Sol Ring": ["Ramp"] },
        },
      ],
    });
    const deck = await getDeck(new MoxfieldClient(server.fetch), "zurdeck000");
    expect(deck.entries.map((e) => `${e.board}:${e.card.name}:${e.finish}`)).toEqual([
      "commanders:Zur the Enchanter:nonFoil",
      "mainboard:Sol Ring:foil",
    ]);
    expect(deck.entries[1]!.card).not.toHaveProperty("prices");
    expect(deck.tags).toEqual({ "Sol Ring": ["Ramp"] });
  });

  it("names the offending field when an in-deck card has changed shape", async () => {
    const server = fakeMoxfield({
      decks: [{ publicId: "brokendeck", name: "Broken", boards: { mainboard: [{ quantity: 1, card: { ...ring, cn: 263 } as never }] } }],
    });
    const error = await getDeck(new MoxfieldClient(server.fetch), "brokendeck").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MoxfieldChangedError);
    expect((error as Error).message).toContain("boards.mainboard.cards.mainboard0.card.cn");
  });
});
