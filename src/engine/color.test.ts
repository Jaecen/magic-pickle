import { describe, expect, it } from "vitest";
import { card } from "../../tests/cards";
import { colorBucket, costColors } from "./color";

describe("costColors", () => {
  it("reads plain, hybrid, Phyrexian, and generic symbols", () => {
    expect([...costColors("{2}{W}{W}")]).toEqual(["W"]);
    expect([...costColors("{W/U}{W/U}")]).toEqual(["W", "U"]);
    expect([...costColors("{2/B}")]).toEqual(["B"]);
    expect([...costColors("{G/P}")]).toEqual(["G"]);
    expect([...costColors("{X}{C}{S}{4}")]).toEqual([]);
    expect([...costColors(undefined)]).toEqual([]);
  });
});

describe("colorBucket", () => {
  it("files mono-colored cards by color", () => {
    expect(colorBucket(card({ name: "Savannah Lions", mana_cost: "{W}" }))).toBe("W");
    expect(colorBucket(card({ name: "Shock", mana_cost: "{R}", colors: ["R"] }))).toBe("R");
  });

  it("files gold and hybrid cards as multi", () => {
    expect(colorBucket(card({ name: "Electrolyze", mana_cost: "{1}{U}{R}", colors: ["U", "R"] }))).toBe("multi");
    expect(colorBucket(card({ name: "Kitchen Finks", mana_cost: "{1}{G/W}{G/W}", colors: ["G", "W"] }))).toBe(
      "multi",
    );
  });

  it("files devoid cards by their mana cost (frame color), not their colorless color", () => {
    expect(colorBucket(card({ name: "Blinding Drone", mana_cost: "{1}{U}", colors: [] }))).toBe("U");
  });

  it("files colorless cards as colorless", () => {
    expect(colorBucket(card({ name: "Sol Ring", type_line: "Artifact", mana_cost: "{1}", colors: [] }))).toBe(
      "colorless",
    );
  });

  it("falls back to colors when the cost has no colored symbols", () => {
    const vision = card({ name: "Ancestral Vision", type_line: "Sorcery", mana_cost: "", colors: ["U"] });
    expect(colorBucket(vision)).toBe("U");
  });

  it("files lands as land, including Dryad Arbor and artifact lands", () => {
    expect(colorBucket(card({ name: "Command Tower", type_line: "Land", mana_cost: "", colors: [] }))).toBe("land");
    const arbor = card({ name: "Dryad Arbor", type_line: "Land Creature — Forest Dryad", mana_cost: "", colors: ["G"] });
    expect(colorBucket(arbor)).toBe("land");
    expect(colorBucket(card({ name: "Seat of the Synod", type_line: "Artifact Land", mana_cost: "" }))).toBe("land");
  });

  it("uses the front face of double-faced cards", () => {
    const mdfc = card({
      name: "Emeria's Call // Emeria, Shattered Skyclave",
      type_line: "Sorcery // Land",
      mana_cost: "{4}{W}{W}{W} // ",
      card_faces: [
        { name: "Emeria's Call", type_line: "Sorcery", mana_cost: "{4}{W}{W}{W}" },
        { name: "Emeria, Shattered Skyclave", type_line: "Land", mana_cost: "" },
      ],
    });
    expect(colorBucket(mdfc)).toBe("W");
    expect(colorBucket({ ...mdfc, card_faces: [] })).toBe("W");

    const flipLand = card({
      name: "Westvale Abbey // Ormendahl, Profane Prince",
      type_line: "Land // Legendary Creature — Demon",
      mana_cost: "",
      colors: ["B"],
    });
    expect(colorBucket(flipLand)).toBe("land");
  });

  it("applies overrides by card name or front-face name", () => {
    const courier = card({ name: "Transguild Courier", type_line: "Artifact Creature — Golem", mana_cost: "{4}" });
    expect(colorBucket(courier, new Map([["Transguild Courier", "colorless"]]))).toBe("colorless");
  });
});
