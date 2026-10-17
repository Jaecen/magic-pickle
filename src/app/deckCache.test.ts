import { describe, expect, it } from "vitest";
import { fakeMoxfield, rawCard, type RawDeck } from "../../tests/fakeMoxfield";
import { MoxfieldClient } from "../moxfield/client";
import { listDecks } from "../moxfield/decks";
import { memoryStore } from "../util/store";
import { loadDecksCached } from "./deckCache";

const deck = (publicId: string, updated: string): RawDeck => ({
  publicId,
  name: publicId,
  folder: "3 - Built",
  lastUpdatedAtUtc: updated,
  boards: { mainboard: [{ quantity: 1, card: rawCard({ name: `Card of ${publicId}`, set: "otj" }) }] },
});

describe("loadDecksCached", () => {
  it("fetches only decks whose lastUpdatedAtUtc changed, and forgets decks no longer asked for", async () => {
    const store = memoryStore();
    const first = fakeMoxfield({ decks: [deck("deckone000", "t1"), deck("decktwo000", "t1")] });
    const client1 = new MoxfieldClient(first.fetch);
    expect((await loadDecksCached(client1, store, await listDecks(client1))).fetched).toBe(2);

    const second = fakeMoxfield({ decks: [deck("deckone000", "t1"), deck("decktwo000", "t2")] });
    const client2 = new MoxfieldClient(second.fetch);
    const result = await loadDecksCached(client2, store, await listDecks(client2));
    expect(result.fetched).toBe(1);
    expect(result.decks.map((d) => `${d.publicId}@${d.lastUpdatedAtUtc}`)).toEqual(["deckone000@t1", "decktwo000@t2"]);

    const onlyOne = (await listDecks(client2)).slice(0, 1);
    await loadDecksCached(client2, store, onlyOne);
    expect(Object.keys(store.data.get("deckCache") as object)).toEqual(["deckone000"]);
  });
});
