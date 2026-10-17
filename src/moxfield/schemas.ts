// Runtime shapes of the undocumented Moxfield responses (design doc §4.3–4.4). Only the fields the extension
// uses are declared; everything else is dropped. A mismatch becomes a MoxfieldChangedError instead of
// quietly wrong availability numbers (§4.6).

import { z } from "zod";
import type { Card, CollectionRow, DeckEntry } from "../engine/types";

// Extension pages forbid eval; tell zod not to probe for it.
z.config({ jitless: true });

const optionalString = z.string().nullish().transform((v) => v ?? undefined);
const optionalStrings = z.array(z.string()).nullish().transform((v) => v ?? undefined);

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
  })
  .transform((c): Card => stripUndefined(c));

export const deckEntrySchema = z.object({
  quantity: z.number(),
  finish: finishSchema,
  isProxy: z.boolean().nullish(),
  card: cardSchema,
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
      languageCode: r.language?.code ?? r.card.lang,
      card: r.card,
    }),
  );

/** One response of `GET /v1/collections/search` (§4.5). */
export const collectionPageSchema = z.object({
  hasMore: z.boolean().nullish(),
  searchSessionId: z.string().nullish(),
  data: z.array(collectionRowSchema),
});

export function toDeckEntry(board: string, raw: z.output<typeof deckEntrySchema>): DeckEntry {
  return stripUndefined({ board, quantity: raw.quantity, finish: raw.finish, isProxy: raw.isProxy ?? undefined, card: raw.card });
}

/** Drops undefined-valued keys so cached objects stay small and tests compare cleanly. */
function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
