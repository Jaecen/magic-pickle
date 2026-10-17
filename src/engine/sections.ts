// Hand-maintained description of how the physical collection is organized (design doc §6.3).
// When a new set or binder shows up, this is the file to edit.

import type { ColorBucket } from "./color";

export interface SectionDef {
  id: string;
  label: string;
  /** Where the section lives physically. */
  location: string;
  /** Merged sections sort as one big set (color, then name), ignoring set boundaries. */
  merged?: boolean;
}

/** Every section, in pull order. */
export const SECTIONS = [
  { id: "commander", label: "Commander", location: "Hotels" },
  { id: "duelDecks", label: "Duel Decks", location: "Hotels" },
  { id: "modern", label: "Modern", location: "Hotels", merged: true },
  { id: "main", label: "Main", location: "Hotels" },
  { id: "planeswalkerSymbol", label: "Planeswalker symbol", location: "Hotels", merged: true },
  { id: "planechase", label: "Planechase", location: "Hotels" },
  { id: "guildKit", label: "Guild Kit", location: "Hotels" },
  { id: "foreign", label: "Foreign language", location: "Hotels", merged: true },
  { id: "jumpstart", label: "Jumpstart", location: "Hotels" },
  { id: "secretLair", label: "Secret Lair", location: "Hotels" },
  { id: "signatureSpellbook", label: "Signature Spellbook", location: "Hotels" },
  { id: "modernHorizons", label: "Modern Horizons", location: "Hotels" },
  { id: "commanderLegends", label: "Commander Legends", location: "Hotels" },
  { id: "universesWithin", label: "Universes Within", location: "Hotels" },
  // The boxes have no physical order relative to each other; this order just has to stay fixed.
  { id: "oldCards", label: "Old cards", location: "Old cards boxes" },
  { id: "unSets", label: "Un-sets", location: "Un-sets box" },
  { id: "playtest", label: "Playtest cards", location: "Playtest box" },
  { id: "yellowBinder", label: "Yellow binder", location: "Yellow binder" },
  { id: "whiteBinder", label: "White binder", location: "White binder" },
  { id: "redBinder", label: "Red binder", location: "Red binder" },
] as const satisfies readonly SectionDef[];

export type SectionId = (typeof SECTIONS)[number]["id"];

export const SECTION_INDEX: ReadonlyMap<SectionId, number> = new Map(SECTIONS.map((s, i) => [s.id, i]));

export const MERGED_SECTIONS: ReadonlySet<SectionId> = new Set(
  (SECTIONS as readonly SectionDef[]).filter((s) => s.merged).map((s) => s.id as SectionId),
);

/** Sets that go to a named section regardless of their type or parent set. Lowercase codes. */
export const SET_SECTIONS: Readonly<Record<string, SectionId>> = {
  ...sectionFor("commander", [
    "cmd", "cm1", "c13", "c14", "c15", "c16", "cma", "c17", "cm2", "c18", "c19", "c20", "c21",
    "khc", "znc", "afc", "mic", "voc", "nec", "ncc", "dmc",
  ]),
  ...sectionFor("modern", ["cns", "cn2"]),
  ...sectionFor("planeswalkerSymbol", ["plst", "ulst", "mb2", "mbc"]),
  ...sectionFor("guildKit", ["gk1", "gk2"]),
  ...sectionFor("jumpstart", ["jmp", "j22", "j25"]),
  ...sectionFor("secretLair", ["sld", "slu", "slc"]),
  ...sectionFor("modernHorizons", ["mh1", "mh2", "mh3", "h1r", "h2r"]),
  ...sectionFor("commanderLegends", ["cmr"]),
  ...sectionFor("universesWithin", ["slx"]),
  ...sectionFor("unSets", ["ugl", "unh", "ust", "und", "unf", "sunf"]),
  ...sectionFor("playtest", ["cmb1", "cmb2"]),
};

/** Default section for a set not listed above, by Scryfall `set_type`. Anything else goes to Main. */
export const TYPE_SECTIONS: Readonly<Record<string, SectionId>> = {
  duel_deck: "duelDecks",
  // Reprint-based products, and all promos.
  core: "modern",
  masters: "modern",
  from_the_vault: "modern",
  premium_deck: "modern",
  promo: "modern",
  box: "modern",
  starter: "modern",
  arsenal: "modern",
  planechase: "planechase",
  spellbook: "signatureSpellbook",
};

/** A `Collections` deck whose cards have fixed copies in a binder (§6.3.2), matched by exact deck name. */
export interface BinderDeckDef {
  deck: string;
  binder: SectionId;
  /** If set, cards are arranged by their Moxfield tag in this order, then collector number, not by color and name. */
  tagOrder?: readonly string[];
}

/** Binder decks in pull order. A deck's position within its binder comes from its order here. */
export const BINDER_DECKS: readonly BinderDeckDef[] = [
  { deck: "Showcase - Theros Gods", binder: "yellowBinder" },
  { deck: "Showcase - KLD Viking Legends", binder: "yellowBinder" },
  { deck: "Showcase - STX Mystical Archives", binder: "yellowBinder" },
  { deck: "Showcase - SNC Gilded Foils", binder: "yellowBinder" },
  { deck: "Language - Phyrexian", binder: "yellowBinder" },
  { deck: "Showcase - WOE Enchanting Tales", binder: "yellowBinder" },
  { deck: "Showcase - OTJ Breaking News", binder: "yellowBinder" },
  { deck: "Showcase - BLB Courageous Critters", binder: "yellowBinder" },
  {
    deck: "Showcase - LTR Panoramas",
    binder: "whiteBinder",
    tagOrder: [
      "March of the Ents",
      "The Mines of Moria",
      "Farewells",
      "Battle of Pelennor Fields",
      "Destruction of the Ring",
      "The Scouring of the Shire",
      "Aragorn at Helm's Deep",
      "Flight of the Witch King",
      "Gandalf in the Pelennor Fields",
      "The Might of Galadriel",
      "Bilbo's Birthday Bash",
    ],
  },
];

/**
 * Cards whose frame color the mana-cost approximation gets wrong (§6.3.1), by card name.
 * Example: ["Transguild Courier", "colorless"] if its frame turns out not to be gold.
 */
export const COLOR_OVERRIDES: ReadonlyMap<string, ColorBucket> = new Map([]);

function sectionFor(section: SectionId, codes: string[]): Record<string, SectionId> {
  return Object.fromEntries(codes.map((c) => [c, section]));
}
