// Build time only (a Vite plugin; never bundled). Provides `virtual:keyrune-glyphs`, Keyrune's glyph for each
// name in its font, read from the glyph names in its SVG font. Keyrune's font files are SIL OFL 1.1; the rest of
// the package (its stylesheet, source SVGs) is GPL-3.0, so nothing else from it is used or shipped.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

const ID = "virtual:keyrune-glyphs";

/** Reads `<glyph glyph-name="nms, nem" unicode="&#xe63a;" …>` into a map from each name to its glyph. */
export function parseFontGlyphs(svg: string): Map<string, string> {
  const glyphs = new Map<string, string>();
  for (const [tag] of svg.matchAll(/<glyph\b[^>]*>/g)) {
    const names = /glyph-name="([^"]*)"/.exec(tag)?.[1];
    const hex = /unicode="&#x([0-9a-f]+);"/i.exec(tag)?.[1];
    if (!names || !hex) continue;
    const glyph = String.fromCodePoint(parseInt(hex, 16));
    for (const name of names.split(",")) glyphs.set(name.trim().toLowerCase(), glyph);
  }
  return glyphs;
}

export function keyruneGlyphs(): Plugin {
  return {
    name: "keyrune-glyphs",
    resolveId: (id) => (id === ID ? `\0${ID}` : undefined),
    load(id) {
      if (id !== `\0${ID}`) return;
      const path = createRequire(import.meta.url).resolve("keyrune/fonts/keyrune.svg");
      this.addWatchFile(path);
      const glyphs = parseFontGlyphs(readFileSync(path, "utf8"));
      return `export default ${JSON.stringify(Object.fromEntries(glyphs))};`;
    },
  };
}
