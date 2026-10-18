import { describe, expect, it } from "vitest";
import setsFixture from "../../tests/fixtures/scryfall-sets.json";
import { card } from "../../tests/cards";
import { buildPicklist, type Notice, type PicklistInput } from "./picklist";
import { SetCatalog } from "./sets";
import { CollectionSorter } from "./sort";
import type { Card, CollectionRow, Deck, DeckEntry, Finish } from "./types";

const sorter = new CollectionSorter(new SetCatalog(setsFixture.data));

const solRingC21 = card({ name: "Sol Ring", set: "c21", cn: "263", type_line: "Artifact", mana_cost: "{1}", colors: [] });
const solRingCmr = card({ name: "Sol Ring", set: "cmr", cn: "472", type_line: "Artifact", mana_cost: "{1}", colors: [] });
const bolt = card({ name: "Lightning Bolt", set: "m11", cn: "149", mana_cost: "{R}", colors: ["R"] });
const island = card({ name: "Island", set: "c16", cn: "340", type_line: "Basic Land — Island", mana_cost: "", colors: [] });

let rowId = 0;
function row(c: Card, quantity: number, opts: { finish?: Finish; lang?: string; isProxy?: boolean } = {}): CollectionRow {
  return { id: `row${rowId++}`, quantity, finish: opts.finish ?? "nonFoil", languageCode: opts.lang ?? "en", isProxy: opts.isProxy, card: c };
}

function entry(c: Card, quantity = 1, opts: Partial<Omit<DeckEntry, "card" | "quantity">> = {}): DeckEntry {
  return { board: "mainboard", finish: "nonFoil", ...opts, quantity, card: c };
}

function deck(name: string, entries: DeckEntry[], tags?: Deck["tags"]): Deck {
  return { publicId: `id-${name}`, name, entries, tags };
}

function run(input: Partial<PicklistInput> & Pick<PicklistInput, "target">) {
  return buildPicklist({ builtDecks: [], binderDecks: [], collection: [], sorter, ...input });
}

const kinds = (notices: Notice[]) => notices.map((n) => `${n.kind}:${n.card.name}`);

describe("availability", () => {
  it("picks the requested printing when a copy is free", () => {
    const result = run({
      target: deck("New", [entry(solRingC21)]),
      builtDecks: [deck("Built A", [entry(solRingC21)])],
      collection: [row(solRingC21, 2)],
    });
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0]).toMatchObject({ quantity: 1, fromBinder: false, placement: { section: "commander" } });
    expect(result.notices).toEqual([]);
  });

  it("flags a requested printing that isn't free and lists the free printings, without substituting", () => {
    const result = run({
      target: deck("New", [entry(solRingC21)]),
      builtDecks: [deck("Built A", [entry(solRingC21)])],
      collection: [row(solRingC21, 1), row(solRingCmr, 3)],
    });
    expect(result.picks).toEqual([]);
    expect(result.notices).toHaveLength(1);
    const notice = result.notices[0]!;
    expect(notice).toMatchObject({ kind: "printingNotFree", wanted: 1, picked: 0, owned: 1 });
    if (notice.kind !== "printingNotFree") throw new Error();
    expect(notice.heldBy.map((h) => h.deck)).toEqual(["Built A"]);
    expect(notice.alternatives).toHaveLength(1);
    expect(notice.alternatives[0]).toMatchObject({ card: { set: "cmr" }, free: 3, placement: { section: "commanderLegends" } });
  });

  it("puts free copies on the picklist and flags the rest of a partial shortfall", () => {
    const rats = card({ name: "Relentless Rats", set: "m11", cn: "111", mana_cost: "{1}{B}{B}" });
    const result = run({
      target: deck("New", [entry(rats, 3)]),
      builtDecks: [deck("Rat deck", [entry(rats, 2)])],
      collection: [row(rats, 4)],
    });
    expect(result.picks.map((p) => p.quantity)).toEqual([2]);
    expect(result.notices[0]).toMatchObject({ kind: "unavailable", wanted: 3, picked: 2, owned: 4 });
  });

  it("reports a card with no free copy of any printing as unavailable, naming every deck that holds one", () => {
    const result = run({
      target: deck("New", [entry(solRingC21)]),
      builtDecks: [deck("Built A", [entry(solRingC21)]), deck("Built B", [entry(solRingCmr)])],
      collection: [row(solRingC21, 1), row(solRingCmr, 1)],
    });
    expect(kinds(result.notices)).toEqual(["unavailable:Sol Ring"]);
    const notice = result.notices[0]!;
    if (notice.kind !== "unavailable") throw new Error();
    expect(notice.heldBy.map((h) => `${h.deck}:${h.card.set}`).sort()).toEqual(["Built A:c21", "Built B:cmr"]);
  });

  it("reports an unowned card as unavailable with no holders", () => {
    const result = run({ target: deck("New", [entry(bolt)]) });
    expect(result.notices[0]).toMatchObject({ kind: "unavailable", owned: 0, heldBy: [] });
  });

  it("matches finish: a foil copy doesn't satisfy a non-foil line but is listed as an alternative", () => {
    const result = run({ target: deck("New", [entry(bolt)]), collection: [row(bolt, 1, { finish: "foil" })] });
    expect(result.picks).toEqual([]);
    const notice = result.notices[0]!;
    if (notice.kind !== "printingNotFree") throw new Error(notice.kind);
    expect(notice.alternatives.map((a) => a.finish)).toEqual(["foil"]);
  });

  it("matches language: a Japanese copy never satisfies or is offered for an English line", () => {
    const result = run({ target: deck("New", [entry(solRingC21)]), collection: [row(solRingC21, 2, { lang: "ja" })] });
    expect(result.picks).toEqual([]);
    expect(result.notices[0]).toMatchObject({ kind: "unavailable", owned: 0 });
  });

  describe("Phyrexian and English stand in for each other", () => {
    const norn = card({ name: "Elesh Norn, Mother of Machines", set: "one", cn: "10", mana_cost: "{4}{W}" });
    const nornPh = { ...norn, scryfall_id: "one-norn-ph", lang: "ph" };

    it("pulls a Phyrexian line from a Phyrexian copy", () => {
      const result = run({ target: deck("New", [entry(nornPh)]), collection: [row(nornPh, 1, { lang: "ph" })] });
      expect(result.picks).toMatchObject([{ languageCode: "ph", placement: { section: "foreign" } }]);
    });

    it("offers free English printings when the Phyrexian one is in use", () => {
      const result = run({
        target: deck("New", [entry(nornPh)]),
        builtDecks: [deck("Built A", [entry(nornPh)])],
        collection: [row(nornPh, 1, { lang: "ph" }), row(norn, 2)],
      });
      const notice = result.notices[0]!;
      if (notice.kind !== "printingNotFree") throw new Error(notice.kind);
      expect(notice.alternatives).toMatchObject([{ languageCode: "en", free: 2 }]);
    });

    it("offers free Phyrexian printings when the English one is in use, and lists holders of both", () => {
      const result = run({
        target: deck("New", [entry(norn)]),
        builtDecks: [deck("Built A", [entry(norn)])],
        collection: [row(norn, 1), row(nornPh, 1, { lang: "ph" })],
      });
      const notice = result.notices[0]!;
      if (notice.kind !== "printingNotFree") throw new Error(notice.kind);
      expect(notice.alternatives).toMatchObject([{ languageCode: "ph", free: 1 }]);

      const none = run({
        target: deck("New", [entry(norn)]),
        builtDecks: [deck("Built A", [entry(norn)]), deck("Built B", [entry(nornPh)])],
        collection: [row(norn, 1), row(nornPh, 1, { lang: "ph" })],
      });
      const unavailable = none.notices.find((n) => n.kind === "unavailable")!;
      if (unavailable.kind !== "unavailable") throw new Error();
      expect(unavailable.heldBy.map((h) => h.deck).sort()).toEqual(["Built A", "Built B"]);
    });

    it("still never offers other foreign-language copies", () => {
      const result = run({ target: deck("New", [entry(nornPh)]), collection: [row(norn, 1, { lang: "ja" })] });
      expect(result.notices[0]).toMatchObject({ kind: "unavailable" });
    });
  });

  it("ignores proxies in the collection and in built decks, and skips proxy lines in the target", () => {
    const result = run({
      target: deck("New", [entry(bolt), entry(solRingC21, 1, { isProxy: true })]),
      builtDecks: [deck("Built A", [entry(bolt, 1, { isProxy: true })])],
      collection: [row(bolt, 1), row(bolt, 5, { isProxy: true })],
    });
    expect(result.picks.map((p) => p.card.name)).toEqual(["Lightning Bolt"]);
    expect(result.skipped).toEqual([{ reason: "proxy", name: "Sol Ring", quantity: 1 }]);
  });

  it("counts only the main board, commanders, companions, and signature spells", () => {
    const zur = card({ name: "Zur the Enchanter", set: "csp", mana_cost: "{1}{W}{U}{B}", frame: "2003" });
    const result = run({
      target: deck("New", [
        entry(zur, 1, { board: "commanders" }),
        entry(bolt, 1, { board: "signatureSpells" }),
        entry(solRingC21, 1, { board: "maybeboard" }),
        entry(solRingC21, 1, { board: "sideboard" }),
      ]),
      builtDecks: [deck("Built A", [entry(zur, 1, { board: "maybeboard" })])],
      collection: [row(zur, 1), row(bolt, 1)],
    });
    expect(result.picks.map((p) => p.card.name).sort()).toEqual(["Lightning Bolt", "Zur the Enchanter"]);
    expect(result.notices).toEqual([]);
  });

  it("doesn't count the target deck against itself when it's already in the built folder", () => {
    const target = deck("Rebuild", [entry(solRingC21)]);
    const result = run({ target, builtDecks: [target], collection: [row(solRingC21, 1)] });
    expect(result.picks).toHaveLength(1);
  });

  it("skips basic lands and tokens, summarizing them by name", () => {
    const snowIsland = card({ name: "Snow-Covered Island", set: "khm", type_line: "Basic Snow Land — Island", mana_cost: "" });
    const token = card({ name: "Treasure", set: "tc21", type_line: "Token Artifact — Treasure", isToken: true });
    const result = run({
      target: deck("New", [entry(island, 8), entry(snowIsland, 2), entry(token, 1), entry(island, 1, { board: "commanders" })]),
    });
    expect(result.picks).toEqual([]);
    expect(result.notices).toEqual([]);
    expect(result.skipped).toEqual([
      { reason: "basic", name: "Island", quantity: 9 },
      { reason: "basic", name: "Snow-Covered Island", quantity: 2 },
      { reason: "token", name: "Treasure", quantity: 1 },
    ]);
  });

  it("flags printings that built decks use more of than the collection holds", () => {
    const result = run({
      target: deck("New", [entry(solRingCmr)]),
      builtDecks: [deck("Built A", [entry(solRingC21)]), deck("Built B", [entry(solRingC21)])],
      collection: [row(solRingC21, 1), row(solRingCmr, 1)],
    });
    expect(kinds(result.notices)).toEqual(["overAllocated:Sol Ring"]);
    expect(result.notices[0]).toMatchObject({ owned: 1, used: 2, card: { set: "c21" } });
    expect(result.picks).toHaveLength(1);
  });

  it("returns picks in pull order", () => {
    const result = run({
      target: deck("New", [entry(bolt), entry(solRingC21)]),
      collection: [row(bolt, 1), row(solRingC21, 1)],
    });
    expect(result.picks.map((p) => p.placement.section)).toEqual(["commander", "modern"]);
  });
});

describe("binder copies", () => {
  const god = card({ name: "Heliod, God of the Sun", set: "ths", cn: "250", mana_cost: "{3}{W}" });
  const theros = deck("Showcase - Theros Gods", [entry(god)]);

  it("pulls loose copies before the fixed binder copy", () => {
    const result = run({ target: deck("New", [entry(god)]), binderDecks: [theros], collection: [row(god, 2)] });
    expect(result.picks).toMatchObject([{ quantity: 1, fromBinder: false, placement: { section: "main" } }]);
  });

  it("assumes built decks hold loose copies, so the binder copy is what's left", () => {
    const result = run({
      target: deck("New", [entry(god)]),
      builtDecks: [deck("Built A", [entry(god)])],
      binderDecks: [theros],
      collection: [row(god, 2)],
    });
    expect(result.picks).toMatchObject([
      { quantity: 1, fromBinder: true, placement: { section: "yellowBinder", group: "Showcase - Theros Gods" } },
    ]);
  });

  it("caps binder copies at what's owned, since Collections decks are aspirational", () => {
    const wishlist = deck("Showcase - Theros Gods", [entry(god, 1), entry(bolt, 1)]);
    const result = run({ target: deck("New", [entry(bolt)]), binderDecks: [wishlist], collection: [row(bolt, 1)] });
    expect(result.picks).toMatchObject([{ fromBinder: true, placement: { section: "yellowBinder" } }]);
  });

  it("matches binder decks by the start of their name, ignoring completion markers", () => {
    const result = run({
      target: deck("New", [entry(god)]),
      builtDecks: [deck("Built A", [entry(god)])],
      binderDecks: [deck("Showcase - Theros Gods ✅ (15/15)", [entry(god)])],
      collection: [row(god, 2)],
    });
    expect(result.picks).toMatchObject([{ fromBinder: true, placement: { group: "Showcase - Theros Gods" } }]);
  });

  it("ignores Collections decks that aren't configured as binders", () => {
    const result = run({
      target: deck("New", [entry(god)]),
      binderDecks: [deck("Someday - Fancy Lands", [entry(god)])],
      collection: [row(god, 1)],
    });
    expect(result.picks).toMatchObject([{ fromBinder: false }]);
  });

  it("orders the yellow binder by deck, then color, then name", () => {
    const archive = card({ name: "Brainstorm", set: "sta", cn: "13", mana_cost: "{U}" });
    const archiveW = card({ name: "Swords to Plowshares", set: "sta", cn: "10", mana_cost: "{W}" });
    const result = run({
      target: deck("New", [entry(archive), entry(god), entry(archiveW)]),
      binderDecks: [deck("Showcase - STX Mystical Archives", [entry(archive), entry(archiveW)]), theros],
      collection: [row(archive, 1), row(god, 1), row(archiveW, 1)],
    });
    expect(result.picks.map((p) => p.card.name)).toEqual(["Heliod, God of the Sun", "Swords to Plowshares", "Brainstorm"]);
  });

  it("orders the panorama binder by tag order, then collector number", () => {
    const ents = card({ name: "Ent A", set: "ltr", cn: "720" });
    const ents2 = card({ name: "Ent B", set: "ltr", cn: "719" });
    const moria = card({ name: "Moria A", set: "ltr", cn: "700" });
    const panoramas = deck("Showcase - LTR Panoramas", [entry(moria), entry(ents), entry(ents2)], {
      "Ent A": ["March of the Ents"],
      "Ent B": ["March of the Ents"],
      "Moria A": ["The Mines of Moria"],
    });
    const result = run({
      target: deck("New", [entry(moria), entry(ents), entry(ents2)]),
      binderDecks: [panoramas],
      collection: [row(moria, 1), row(ents, 1), row(ents2, 1)],
    });
    expect(result.picks.map((p) => `${p.placement.group}:${p.card.name}`)).toEqual([
      "March of the Ents:Ent B",
      "March of the Ents:Ent A",
      "The Mines of Moria:Moria A",
    ]);
  });
});
