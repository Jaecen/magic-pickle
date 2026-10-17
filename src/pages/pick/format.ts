import type { ColorBucket } from "../../engine/color";
import type { Pick } from "../../engine/picklist";
import { SECTIONS, type SectionId } from "../../engine/sections";
import type { Placement } from "../../engine/sort";
import type { Card, Finish } from "../../engine/types";

export function sectionLabel(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)?.label ?? id;
}

export function sectionLocation(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)?.location ?? "";
}

export function where(placement: Placement): string {
  const section = sectionLabel(placement.section);
  return placement.group ? `${section} › ${placement.group}` : section;
}

export function printing(card: Card, finish: Finish, languageCode: string): string {
  const parts = [`${card.set.toUpperCase()} #${card.cn}`];
  if (finish !== "nonFoil") parts.push(finish === "foil" ? "Foil" : "Etched");
  if (languageCode !== "en") parts.push(languageCode.toUpperCase());
  return parts.join(" · ");
}

export function pickId(p: Pick): string {
  return `${p.card.scryfall_id}|${p.finish}|${p.languageCode}|${p.fromBinder ? "binder" : "loose"}`;
}

export const COLOR_LABELS: Record<ColorBucket, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  multi: "Multicolor",
  colorless: "Colorless",
  land: "Land",
};
