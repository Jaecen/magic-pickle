// How a copy should be stored when it's filed back: loose, sleeved, or double-sleeved (design doc §5.4).

import { DOUBLE_SLEEVE_ABOVE_USD, SLEEVE_PRICE_USD, SLEEVED_RARITIES } from "./sections";
import type { Card, Finish } from "./types";

export type Sleeving = "sleeve" | "doubleSleeve";

/** The copy's price in its finish. Falls back to the nonfoil price when the finish has none listed. */
export function priceOf(card: Card, finish: Finish): number | undefined {
  const prices = card.prices;
  if (!prices) return undefined;
  const byFinish = finish === "foil" ? prices.usd_foil : finish === "etched" ? prices.usd_etched : prices.usd;
  return byFinish ?? prices.usd;
}

/** The sleeving a copy needs, or undefined if it's stored loose. */
export function sleevingFor(card: Card, finish: Finish): Sleeving | undefined {
  const price = priceOf(card, finish) ?? 0;
  if (price > DOUBLE_SLEEVE_ABOVE_USD) return "doubleSleeve";
  if (price >= SLEEVE_PRICE_USD || SLEEVED_RARITIES.has(card.rarity ?? "")) return "sleeve";
  return undefined;
}
