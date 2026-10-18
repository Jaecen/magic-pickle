import { describe, expect, it } from "vitest";
import setsFixture from "../../../tests/fixtures/scryfall-sets.json";
import { SetCatalog } from "../../engine/sets";
import { KEYRUNE_GLYPHS, setGlyph } from "./symbols";

const glyph = (name: string) => {
  const g = KEYRUNE_GLYPHS.get(name);
  if (!g) throw new Error(`Keyrune has no ${name}`);
  return g;
};
const sets = new SetCatalog(setsFixture.data.map((s) => ({ ...s, icon: /\/([^/?#]+)\.svg/.exec(s.icon_svg_uri)?.[1] })));

describe("setGlyph", () => {
  it("has Keyrune's set list", () => {
    expect(KEYRUNE_GLYPHS.size).toBeGreaterThan(400);
  });

  it("matches by set code, in any case", () => {
    expect(setGlyph("lea", sets)).toBe("\ue600");
    expect(setGlyph("LEA", sets)).toBe("\ue600");
  });

  it("matches set codes that Keyrune names differently", () => {
    expect(setGlyph("p02", sets)).toBe(glyph("po2"));
    expect(setGlyph("tle", sets)).toBe(glyph("tle-border"));
  });

  it("falls back to the symbol Scryfall uses for the set", () => {
    expect(setGlyph("tc16", sets)).toBe(glyph("c16"));
    expect(setGlyph("phtr", sets)).toBe(glyph("pmei")); // Scryfall's "star"
    expect(setGlyph("g11", sets)).toBe(glyph("parl")); // Scryfall's "dci"
  });

  it("gives no symbol rather than a wrong one", () => {
    expect(setGlyph("nau", sets)).toBeUndefined(); // Scryfall's "default": no symbol yet
    expect(setGlyph("zzz", sets)).toBeUndefined();
    expect(setGlyph("tc16", new SetCatalog([]))).toBeUndefined();
  });
});
