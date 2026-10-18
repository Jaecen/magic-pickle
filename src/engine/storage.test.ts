import { describe, expect, it } from "vitest";
import { card } from "../../tests/cards";
import { priceOf, sleevingFor } from "./storage";

describe("sleevingFor", () => {
  it("leaves cheap commons and uncommons loose", () => {
    expect(sleevingFor(card({ name: "A", rarity: "common", prices: { usd: 0.99 } }), "nonFoil")).toBeUndefined();
    expect(sleevingFor(card({ name: "A", rarity: "uncommon" }), "nonFoil")).toBeUndefined();
  });

  it("sleeves rares and mythics whatever their price", () => {
    expect(sleevingFor(card({ name: "A", rarity: "rare", prices: { usd: 0.1 } }), "nonFoil")).toBe("sleeve");
    expect(sleevingFor(card({ name: "A", rarity: "mythic" }), "nonFoil")).toBe("sleeve");
  });

  it("sleeves anything worth $1 or more, and double-sleeves anything over $10", () => {
    expect(sleevingFor(card({ name: "A", rarity: "common", prices: { usd: 1 } }), "nonFoil")).toBe("sleeve");
    expect(sleevingFor(card({ name: "A", rarity: "common", prices: { usd: 10 } }), "nonFoil")).toBe("sleeve");
    expect(sleevingFor(card({ name: "A", rarity: "common", prices: { usd: 10.01 } }), "nonFoil")).toBe("doubleSleeve");
    expect(sleevingFor(card({ name: "A", rarity: "rare", prices: { usd: 40 } }), "nonFoil")).toBe("doubleSleeve");
  });

  it("prices the copy's own finish", () => {
    const c = card({ name: "A", rarity: "uncommon", prices: { usd: 0.3, usd_foil: 12, usd_etched: 2 } });
    expect(sleevingFor(c, "nonFoil")).toBeUndefined();
    expect(sleevingFor(c, "foil")).toBe("doubleSleeve");
    expect(sleevingFor(c, "etched")).toBe("sleeve");
  });
});

describe("priceOf", () => {
  it("falls back to the nonfoil price when the finish has none", () => {
    expect(priceOf(card({ name: "A", prices: { usd: 3 } }), "foil")).toBe(3);
    expect(priceOf(card({ name: "A" }), "foil")).toBeUndefined();
  });
});
