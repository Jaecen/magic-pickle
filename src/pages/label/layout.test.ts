import { describe, expect, it } from "vitest";
import { fitText } from "./layout";

// Every character is half the font size wide.
const measure = (text: string, size: number) => (text.length * size) / 2;

describe("fitText", () => {
  it("uses the largest size that fits", () => {
    expect(fitText("Zur", 30, 28, 18, measure)).toEqual({ text: "Zur", size: 20 });
    expect(fitText("Zur", 100, 28, 18, measure)).toEqual({ text: "Zur", size: 28 });
  });

  it("cuts the text at the smallest size, without an ellipsis or trailing space", () => {
    // 10 characters fit at size 18 in 90 units.
    expect(fitText("[1DH] Thantis's Jund Beatdown", 90, 28, 18, measure)).toEqual({ text: "[1DH] Than", size: 18 });
    expect(fitText("All the Slivers", 72, 28, 18, measure)).toEqual({ text: "All the", size: 18 });
  });
});
