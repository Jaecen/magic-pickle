import type { Card } from "./types";

/** Color sections inside a set, in shelf order. All multicolor cards (gold, hybrid, …) share one bucket. */
export const COLOR_ORDER = ["W", "U", "B", "R", "G", "multi", "colorless", "land"] as const;
export type ColorBucket = (typeof COLOR_ORDER)[number];

const COLORS = new Set(["W", "U", "B", "R", "G"]);

/** Colors named by the symbols in a mana cost. Hybrid symbols count both colors; Phyrexian count theirs. */
export function costColors(manaCost: string | undefined): Set<string> {
  const colors = new Set<string>();
  for (const [, symbol = ""] of (manaCost ?? "").matchAll(/\{([^}]+)\}/g)) {
    for (const c of symbol.split("/")) if (COLORS.has(c)) colors.add(c);
  }
  return colors;
}

/**
 * The color section a card files under. The rule is the front face's frame color, which the data doesn't
 * carry, so it's approximated (design doc §6.3.1): lands are "land"; otherwise the colors in the front
 * face's mana cost (so devoid cards follow their cost); with no colored symbols, the card's colors or
 * color indicator; with none, colorless. `overrides` (by card name) handles cards this gets wrong.
 */
export function colorBucket(card: Card, overrides: ReadonlyMap<string, ColorBucket> = new Map()): ColorBucket {
  const front = card.card_faces?.[0];
  const frontName = front?.name ?? card.name.split(" // ")[0] ?? card.name;
  const override = overrides.get(card.name) ?? overrides.get(frontName);
  if (override) return override;

  const typeLine = front?.type_line ?? card.type_line.split(" // ")[0] ?? "";
  if (/\bLand\b/.test(typeLine)) return "land";

  let colors = costColors(front?.mana_cost ?? card.mana_cost?.split(" // ")[0]);
  if (colors.size === 0) {
    colors = new Set((front?.colors ?? card.colors ?? card.color_indicator ?? []).filter((c) => COLORS.has(c)));
  }
  if (colors.size > 1) return "multi";
  const [only] = colors;
  return (only as ColorBucket | undefined) ?? "colorless";
}
