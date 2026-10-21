// Runtime shapes of the undocumented Moxfield responses (design doc §4.3–4.4). Only the fields the extension
// uses are declared; everything else is dropped. A mismatch becomes a MoxfieldChangedError instead of
// quietly wrong availability numbers (§4.6).

import { z } from "zod";
import type { Card, CollectionRow, DeckEntry } from "../engine/types";

// Extension pages forbid eval; tell zod not to probe for it.
z.config({ jitless: true });

const optionalString = z.string().nullish().transform((v) => v ?? undefined);
const optionalStrings = z.array(z.string()).nullish().transform((v) => v ?? undefined);
// Prices only decide the sleeve hint, so an odd value is dropped rather than failing the whole response.
const optionalPrice = z.number().nullish().catch(undefined).transform((v) => v ?? undefined);

export const finishSchema = z.enum(["nonFoil", "foil", "etched"]);

const faceSchema = z.object({
  name: z.string(),
  mana_cost: optionalString,
  type_line: optionalString,
  colors: optionalStrings,
});

export const cardSchema = z
  .object({
    scryfall_id: z.string(),
    name: z.string(),
    set: z.string(),
    cn: z.string(),
    lang: z.string(),
    type_line: z.string(),
    mana_cost: optionalString,
    colors: optionalStrings,
    color_indicator: optionalStrings,
    card_faces: z.array(faceSchema).nullish().transform((v) => v ?? undefined),
    frame: optionalString,
    isToken: z.boolean().nullish().transform((v) => v ?? undefined),
    rarity: optionalString,
    prices: z
      .object({ usd: optionalPrice, usd_foil: optionalPrice, usd_etched: optionalPrice })
      .nullish()
      .catch(undefined)
      .transform((p) => (p && (p.usd ?? p.usd_foil ?? p.usd_etched) !== undefined ? stripUndefined(p) : undefined)),
  })
  .transform((c): Card => stripUndefined(c));

const printingSchema = z.object({
  quantity: z.number(),
  finish: finishSchema,
  isProxy: z.boolean().nullish(),
  card: cardSchema,
});

/**
 * One deck line. When `printingData` is present it holds the line's actual printings, overriding the line's
 * own card and finish (§4.4): e.g. a line saying nonFoil whose printingData says foil, or 1 nonfoil + 1 foil
 * under a single line.
 */
export const deckEntrySchema = printingSchema.extend({
  printingData: z.array(printingSchema).nullish(),
});

/** `GET /v3/decks/all/{publicId}`. Boards stay raw; only the boards the engine counts get parsed. */
export const deckSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  lastUpdatedAtUtc: z.string(),
  boards: z.record(z.string(), z.object({ cards: z.record(z.string(), z.unknown()) }).nullish()),
  authorTags: z.record(z.string(), z.array(z.string())).nullish(),
});

/** `GET /v3/decks`. */
export const deckListSchema = z.object({
  decks: z.array(
    z.object({
      publicId: z.string(),
      name: z.string(),
      lastUpdatedAtUtc: z.string(),
      folder: z.object({ id: z.string(), name: z.string() }).nullish(),
    }),
  ),
});

/** One page of `GET /v2/decks/all/{publicId}/history`, newest first (§4.3). */
export const historyPageSchema = z.object({
  pageNumber: z.number(),
  totalPages: z.number(),
  data: z.array(
    z.object({
      boardType: z.string(),
      quantityDelta: z.number(),
      updatedAtUtc: z.string(),
      card: z.object({ name: z.string() }),
    }),
  ),
});

const collectionRowSchema = z
  .object({
    id: z.string(),
    quantity: z.number(),
    finish: finishSchema,
    isProxy: z.boolean().nullish(),
    language: z.object({ code: z.string() }).nullish(),
    card: cardSchema,
  })
  .transform(
    (r): CollectionRow => ({
      id: r.id,
      quantity: r.quantity,
      finish: r.finish,
      isProxy: r.isProxy ?? undefined,
      languageCode: copyLanguage(r.language?.code, r.card.lang),
      card: r.card,
    }),
  );

/** One response of `GET /v1/collections/search` (§4.5). */
export const collectionPageSchema = z.object({
  hasMore: z.boolean().nullish(),
  searchSessionId: z.string().nullish(),
  data: z.array(collectionRowSchema),
});

/**
 * The language of a physical copy. Moxfield defaults a row's language to English even when the printing
 * itself is another language (Phyrexian ONE #326, Japanese alt-art planeswalkers), so an "English" row of a
 * non-English printing is really in the printing's language.
 */
export function copyLanguage(rowLanguage: string | undefined, printingLanguage: string): string {
  return !rowLanguage || rowLanguage === "en" ? printingLanguage : rowLanguage;
}

/** The engine's entries for one deck line: one per printing in `printingData`, or the line itself. */
export function toDeckEntries(board: string, raw: z.output<typeof deckEntrySchema>): DeckEntry[] {
  const entry = (p: z.output<typeof printingSchema>, quantity = p.quantity): DeckEntry =>
    stripUndefined({ board, quantity, finish: p.finish, isProxy: p.isProxy ?? undefined, card: p.card });
  const printings = (raw.printingData ?? []).filter((p) => p.quantity > 0);
  if (printings.length === 0) return [entry(raw)];
  const entries = printings.map((p) => entry(p));
  // If the printings don't cover the whole line, the rest falls back to the line's own printing.
  const remainder = raw.quantity - printings.reduce((n, p) => n + p.quantity, 0);
  if (remainder > 0) entries.push(entry(raw, remainder));
  return entries;
}

/** Drops undefined-valued keys so cached objects stay small and tests compare cleanly. */
function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
