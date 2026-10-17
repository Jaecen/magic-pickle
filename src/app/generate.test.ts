import { describe, expect, it } from "vitest";
import { fakeMoxfield, rawCard } from "../../tests/fakeMoxfield";
import { MoxfieldClient } from "../moxfield/client";
import { memoryStore } from "../util/store";
import { generatePicklist } from "./generate";

const solRing = rawCard({ name: "Sol Ring", set: "c21", cn: "263", type_line: "Artifact", mana_cost: "{1}", colors: [] });
const solRingCmr = rawCard({ name: "Sol Ring", set: "cmr", cn: "472", type_line: "Artifact", mana_cost: "{1}", colors: [] });
const zur = rawCard({ name: "Zur the Enchanter", set: "csp", mana_cost: "{1}{W}{U}{B}", frame: "2003" });
const heliod = rawCard({ name: "Heliod, God of the Sun", set: "ths", cn: "250", mana_cost: "{3}{W}" });
const island = rawCard({ name: "Island", set: "c16", type_line: "Basic Land — Island", mana_cost: "", colors: [] });

function server() {
  return fakeMoxfield({
    decks: [
      {
        publicId: "targetdeck",
        name: "Zur, New",
        folder: "1 - Building",
        boards: {
          commanders: [{ quantity: 1, card: zur }],
          mainboard: [
            { quantity: 1, card: solRing },
            { quantity: 1, card: heliod },
            { quantity: 8, card: island },
          ],
          maybeboard: [{ quantity: 1, card: rawCard({ name: "Wishlist Card", set: "otj" }) }],
        },
      },
      { publicId: "builtdeck1", name: "Built One", folder: "3 - Built", boards: { mainboard: [{ quantity: 1, card: solRing }] } },
      { publicId: "notbuilt01", name: "Idea", folder: "0 - Ideas", boards: { mainboard: [{ quantity: 1, card: heliod }] } },
      {
        publicId: "binderdeck",
        name: "Showcase - Theros Gods ✅ 15/15",
        folder: "Collections",
        boards: { mainboard: [{ quantity: 1, card: heliod }] },
      },
    ],
    collection: [
      { id: "r1", quantity: 1, card: solRing },
      { id: "r2", quantity: 2, card: solRingCmr },
      { id: "r3", quantity: 1, card: zur },
      { id: "r4", quantity: 1, card: heliod },
      { id: "r5", quantity: 3, card: rawCard({ name: "Filler", set: "otj" }) },
    ],
  });
}

describe("generatePicklist", () => {
  it("produces a pull-ordered picklist and notices from Moxfield data", async () => {
    const steps: string[] = [];
    const s = server();
    const result = await generatePicklist("targetdeck", {
      client: new MoxfieldClient(s.fetch),
      store: memoryStore(),
      fetchFn: s.fetch,
      onStep: (step) => steps.push(step),
    });

    expect(result.deck.name).toBe("Zur, New");
    expect(result.picklist.picks.map((p) => `${p.placement.section}:${p.card.name}${p.fromBinder ? " (binder)" : ""}`)).toEqual([
      "main:Zur the Enchanter",
      "yellowBinder:Heliod, God of the Sun (binder)",
    ]);
    expect(result.picklist.notices).toMatchObject([{ kind: "printingNotFree", card: { name: "Sol Ring", set: "c21" } }]);
    expect(result.picklist.skipped).toEqual([{ reason: "basic", name: "Island", quantity: 8 }]);
    expect(result.stats).toMatchObject({ builtDecks: 1, binderDecks: 1, decksFetched: 2, cardsSearched: 3 });
    expect(steps.at(-1)).toBe("Searching your collection for 3 cards…");
  });

  it("reuses cached built decks on the next run", async () => {
    const s = server();
    const store = memoryStore();
    await generatePicklist("targetdeck", { client: new MoxfieldClient(s.fetch), store, fetchFn: s.fetch });
    const again = await generatePicklist("targetdeck", { client: new MoxfieldClient(s.fetch), store, fetchFn: s.fetch });
    expect(again.stats.decksFetched).toBe(0);
  });
});
