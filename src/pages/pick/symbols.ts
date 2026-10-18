// Set symbols from Keyrune (https://keyrune.andrewgioia.com): the page draws the glyph in Keyrune's font
// (styles.css), looked up in the glyph names the font carries (src/build/keyrune.ts).

import fontGlyphs from "virtual:keyrune-glyphs";
import type { SetCatalog } from "../../engine/sets";

export const KEYRUNE_GLYPHS: ReadonlyMap<string, string> = new Map(Object.entries(fontGlyphs));

/**
 * Scryfall set codes and generic set icons that Keyrune's font names differently. `tle` has only layered glyphs;
 * `star` and `dci` are Scryfall's icons for media inserts and DCI promos.
 */
const ALIASES: Readonly<Record<string, string>> = {
  tle: "tle-border",
  mps: "mp1",
  p02: "po2",
  ren: "xren",
  rin: "xrin",
  pdrc: "pdgc",
  star: "pmei",
  dci: "parl",
};

/**
 * The Keyrune glyph for a set: by set code, then by the symbol Scryfall uses for it (token and promo sets mostly
 * use their parent's). Undefined when neither matches, rather than a generic symbol, which would be misleading when
 * matching cards by symbol.
 */
export function setGlyph(code: string, sets: SetCatalog, glyphs: ReadonlyMap<string, string> = KEYRUNE_GLYPHS): string | undefined {
  for (const name of [code.toLowerCase(), sets.get(code)?.icon]) {
    if (!name) continue;
    const glyph = glyphs.get(name) ?? glyphs.get(ALIASES[name] ?? "");
    if (glyph) return glyph;
  }
  return undefined;
}
