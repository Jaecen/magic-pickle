import { describe, expect, it } from "vitest";
import setsFixture from "../../tests/fixtures/scryfall-sets.json";
import { card } from "../../tests/cards";
import { SetCatalog } from "./sets";
import { CollectionSorter, compareKeys } from "./sort";
import type { Card } from "./types";

const sorter = new CollectionSorter(new SetCatalog(setsFixture.data));

function sectionOf(c: Card, lang = "en") {
  return sorter.place(c, lang).section;
}

/** Sorts cards into pull order and returns `set:name` labels. */
function pullOrder(cards: Card[]): string[] {
  return cards
    .map((c) => ({ c, key: sorter.place(c, "en").key }))
    .sort((a, b) => compareKeys(a.key, b.key))
    .map(({ c }) => `${c.set}:${c.name}`);
}

describe("sections", () => {
  it.each([
    ["c16", "commander"],
    ["cma", "commander"],
    ["khc", "commander"], // parent KHM is in Main; the named section wins
    ["ncc", "commander"],
    ["dd1", "duelDecks"],
    ["evg", "duelDecks"],
    ["8ed", "modern"],
    ["ori", "modern"],
    ["m19", "modern"],
    ["fdn", "modern"],
    ["2xm", "modern"],
    ["cns", "modern"],
    ["potj", "modern"], // promos go to Modern, not with their parent
    ["gnt", "modern"],
    ["otj", "main"],
    ["otc", "main"], // later Commander products stay with their parent set
    ["clb", "main"],
    ["ltr", "main"],
    ["plst", "planeswalkerSymbol"],
    ["mb2", "planeswalkerSymbol"],
    ["hop", "planechase"],
    ["pca", "planechase"],
    ["gk1", "guildKit"],
    ["gk2", "guildKit"],
    ["jmp", "jumpstart"],
    ["j25", "jumpstart"], // parent FDN is in Modern
    ["sld", "secretLair"],
    ["ss2", "signatureSpellbook"],
    ["mh2", "modernHorizons"],
    ["h1r", "modernHorizons"],
    ["cmr", "commanderLegends"],
    ["slx", "universesWithin"], // parent SLD is in Secret Lair
    ["unf", "unSets"],
    ["cmb1", "playtest"],
  ])("%s → %s", (set, section) => {
    expect(sectionOf(card({ name: "X", set }))).toBe(section);
  });

  it("sends old-frame cards from pre-8th Edition sets to Old cards", () => {
    expect(sectionOf(card({ name: "Lightning Bolt", set: "lea", frame: "1993" }))).toBe("oldCards");
    expect(sectionOf(card({ name: "Swords to Plowshares", set: "ice", frame: "1997" }))).toBe("oldCards");
    expect(sectionOf(card({ name: "Lightning Bolt", set: "chr", frame: "1997" }))).toBe("oldCards");
  });

  it("keeps old-frame cards from newer sets in their normal section", () => {
    expect(sectionOf(card({ name: "Akroma, Angel of Wrath", set: "tsb", frame: "1997" }))).toBe("main");
    expect(sectionOf(card({ name: "Lightning Bolt", set: "dmr", frame: "1997" }))).toBe("modern");
  });

  it("puts Un-sets in their box even with an old frame", () => {
    expect(sectionOf(card({ name: "Chicken à la King", set: "ugl", frame: "1997" }))).toBe("unSets");
  });

  it("sends any non-English copy to Foreign language", () => {
    expect(sectionOf(card({ name: "Sol Ring", set: "c21" }), "ja")).toBe("foreign");
    expect(sectionOf(card({ name: "Lightning Bolt", set: "lea", frame: "1993" }), "de")).toBe("foreign");
  });

  it("puts unknown sets in Main", () => {
    expect(sectionOf(card({ name: "X", set: "zzz" }))).toBe("main");
  });
});

describe("pull order", () => {
  it("visits sections in shelf order", () => {
    const cards = [
      card({ name: "Old", set: "lea", frame: "1993" }),
      card({ name: "Main", set: "otj" }),
      card({ name: "Commander", set: "c16" }),
      card({ name: "Duel", set: "dd1" }),
      card({ name: "Modern", set: "m19" }),
      card({ name: "Lair", set: "sld" }),
      card({ name: "Unset", set: "unf" }),
      card({ name: "Jump", set: "jmp" }),
    ];
    expect(pullOrder(cards)).toEqual([
      "c16:Commander",
      "dd1:Duel",
      "m19:Modern",
      "otj:Main",
      "jmp:Jump",
      "sld:Lair",
      "lea:Old",
      "unf:Unset",
    ]);
  });

  it("merges a classic block into one set: color, then name, across CHK/BOK/SOK", () => {
    const cards = [
      card({ name: "Zebra Unicorn", set: "chk" }),
      card({ name: "Moss Kami", set: "sok", mana_cost: "{U}" }),
      card({ name: "Apple Samurai", set: "bok" }),
      card({ name: "Kami of Waves", set: "chk", mana_cost: "{U}" }),
    ];
    expect(pullOrder(cards)).toEqual([
      "bok:Apple Samurai",
      "chk:Zebra Unicorn",
      "chk:Kami of Waves",
      "sok:Moss Kami",
    ]);
  });

  it("treats GRN/RNA/WAR as the last block", () => {
    const cards = [
      card({ name: "Zed", set: "grn" }),
      card({ name: "Abe", set: "war" }),
      card({ name: "Eld", set: "eld" }),
      card({ name: "Mia", set: "rna" }),
    ];
    expect(pullOrder(cards)).toEqual(["war:Abe", "rna:Mia", "grn:Zed", "eld:Eld"]);
  });

  it("orders sets chronologically", () => {
    const cards = [
      card({ name: "A", set: "dmu" }),
      card({ name: "B", set: "neo" }),
      card({ name: "C", set: "eld" }),
    ];
    expect(pullOrder(cards)).toEqual(["eld:C", "neo:B", "dmu:A"]);
  });

  it("files sibling sets after their primary set, alphabetically by code", () => {
    const cards = [
      card({ name: "News", set: "otp" }),
      card({ name: "Cmdr", set: "otc" }),
      card({ name: "Score", set: "big" }),
      card({ name: "Zz Outlaw", set: "otj", mana_cost: "{G}" }),
      card({ name: "Aa Outlaw", set: "otj" }),
    ];
    expect(pullOrder(cards)).toEqual(["otj:Aa Outlaw", "otj:Zz Outlaw", "big:Score", "otc:Cmdr", "otp:News"]);
  });

  it("dates Coldsnap by its own release in Main, not by the Ice Age block", () => {
    const cards = [
      card({ name: "T", set: "tsp" }),
      card({ name: "C", set: "csp", frame: "2003" }),
      card({ name: "R", set: "rav", frame: "2003" }),
    ];
    expect(pullOrder(cards)).toEqual(["rav:R", "csp:C", "tsp:T"]);
  });

  it("merges the whole Modern section: color, then name, across sets", () => {
    const cards = [
      card({ name: "Blue Thing", set: "8ed", mana_cost: "{U}", frame: "2003" }),
      card({ name: "Zz White", set: "m19" }),
      card({ name: "Aa White", set: "ori" }),
    ];
    expect(pullOrder(cards)).toEqual(["ori:Aa White", "m19:Zz White", "8ed:Blue Thing"]);
  });

  it("keeps the Commander section set by set in release order", () => {
    const cards = [
      card({ name: "A White", set: "c21" }),
      card({ name: "Z Blue", set: "c13", mana_cost: "{U}" }),
      card({ name: "Anthology", set: "cma" }),
      card({ name: "Sixteen", set: "c16" }),
      card({ name: "Seventeen", set: "c17" }),
    ];
    expect(pullOrder(cards)).toEqual(["c13:Z Blue", "c16:Sixteen", "cma:Anthology", "c17:Seventeen", "c21:A White"]);
  });

  it("sorts colors W, U, B, R, G, multi, colorless, land", () => {
    const cards = [
      card({ name: "Land", set: "otj", type_line: "Land", mana_cost: "" }),
      card({ name: "Rock", set: "otj", type_line: "Artifact", mana_cost: "{2}", colors: [] }),
      card({ name: "Gold", set: "otj", mana_cost: "{W}{U}" }),
      card({ name: "Green", set: "otj", mana_cost: "{G}" }),
      card({ name: "Red", set: "otj", mana_cost: "{R}" }),
      card({ name: "Black", set: "otj", mana_cost: "{B}" }),
      card({ name: "Blue", set: "otj", mana_cost: "{U}" }),
      card({ name: "White", set: "otj", mana_cost: "{W}" }),
    ];
    expect(pullOrder(cards).map((l) => l.split(":")[1])).toEqual([
      "White", "Blue", "Black", "Red", "Green", "Gold", "Rock", "Land",
    ]);
  });
});

describe("drawer labels", () => {
  const group = (set: string, frame = "2015") => sorter.place(card({ name: "X", set, frame }), "en").group;

  it("lead with the set code, as the drawers are labeled", () => {
    expect(group("c13")).toBe("C13 - Commander 2013");
    expect(group("otj")).toBe("OTJ - Outlaws of Thunder Junction");
  });

  it("list every block set in the section, in release order; a lone block set is just a set", () => {
    expect(group("bok")).toBe("CHK/BOK/SOK - Champions of Kamigawa block");
    expect(group("csp", "2003")).toBe("CSP - Coldsnap");
  });

  it("give sibling sets their own label", () => {
    expect(group("big")).toBe("BIG - The Big Score");
    expect(group("otc")).toBe("OTC - Outlaws of Thunder Junction Commander");
  });

  it("are empty in merged sections", () => {
    expect(group("m19")).toBe("");
  });
});

describe("names", () => {
  const order = (names: string[]) => pullOrder(names.map((name) => card({ name, set: "otj" }))).map((l) => l.slice(4));

  it("files names as printed: 'The' under T, word by word, ignoring accents and punctuation", () => {
    expect(order(["The Mindskinner", "Zur the Enchanter", "Andúril, Flame of the West", "Thassa, God of the Sea"])).toEqual(
      ["Andúril, Flame of the West", "Thassa, God of the Sea", "The Mindskinner", "Zur the Enchanter"],
    );
    expect(order(["Solar Flare", "Sol Ring"])).toEqual(["Sol Ring", "Solar Flare"]);
    expect(order(["Andromeda", "Andúril"])).toEqual(["Andromeda", "Andúril"]);
  });

  it("uses the front face name of double-faced cards", () => {
    expect(order(["Brazen Borrower // Petty Theft", "Bloodline Keeper // Lord of Lineage"])).toEqual([
      "Bloodline Keeper // Lord of Lineage",
      "Brazen Borrower // Petty Theft",
    ]);
  });

  it("orders printings of the same card by collector number", () => {
    const cards = [card({ name: "Sol Ring", set: "otj", cn: "100" }), card({ name: "Sol Ring", set: "otj", cn: "9" })];
    expect(cards.map((c) => sorter.place(c, "en").key).sort(compareKeys).map((k) => k[6])).toEqual(["9", "100"]);
  });
});
