import { describe, expect, it } from "vitest";
import { parseFontGlyphs } from "./keyrune";

describe("parseFontGlyphs", () => {
  it("reads each glyph's names, including comma-separated aliases", () => {
    const svg = `
      <glyph unicode="&#x20;" horiz-adv-x="512" d="" />
      <glyph unicode="&#xe600;" glyph-name="lea" d="M0 0z" />
      <glyph unicode="&#xe63a;" glyph-name="nms, nem" d="M0 0z" />
      <glyph unicode="&#xe9f0;" glyph-name="Y26-Alchemy-2026" d="M0 0z" />`;
    expect(parseFontGlyphs(svg)).toEqual(
      new Map([
        ["lea", "\ue600"],
        ["nms", "\ue63a"],
        ["nem", "\ue63a"],
        ["y26-alchemy-2026", "\ue9f0"],
      ]),
    );
  });
});
