import { IN_DECK_BOARDS } from "../engine/picklist";
import type { Deck, DeckEntry } from "../engine/types";
import { MoxfieldChangedError, type MoxfieldClient } from "./client";
import { deckEntrySchema, deckListSchema, deckSchema, toDeckEntry } from "./schemas";

export interface DeckSummary {
  publicId: string;
  name: string;
  lastUpdatedAtUtc: string;
  folder?: string;
}

/** A deck as the engine needs it, plus the timestamp used to cache it. */
export interface FetchedDeck extends Deck {
  lastUpdatedAtUtc: string;
}

/** Every deck of the logged-in user, in one request. */
export async function listDecks(client: MoxfieldClient): Promise<DeckSummary[]> {
  const { decks } = await client.get("/v3/decks", deckListSchema);
  return decks.map((d) => ({
    publicId: d.publicId,
    name: d.name,
    lastUpdatedAtUtc: d.lastUpdatedAtUtc,
    ...(d.folder ? { folder: d.folder.name } : {}),
  }));
}

/** One deck (private ones too), keeping only the boards physically in a deck (§4.4). */
export async function getDeck(client: MoxfieldClient, publicId: string): Promise<FetchedDeck> {
  const path = `/v3/decks/all/${encodeURIComponent(publicId)}`;
  const raw = await client.get(path, deckSchema);
  const entries: DeckEntry[] = [];
  for (const [board, contents] of Object.entries(raw.boards)) {
    if (!IN_DECK_BOARDS.has(board) || !contents) continue;
    for (const [id, value] of Object.entries(contents.cards)) {
      const parsed = deckEntrySchema.safeParse(value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new MoxfieldChangedError(path, `boards.${board}.cards.${id}.${issue?.path.join(".")}: ${issue?.message}`);
      }
      entries.push(toDeckEntry(board, parsed.data));
    }
  }
  return {
    publicId: raw.publicId,
    name: raw.name,
    lastUpdatedAtUtc: raw.lastUpdatedAtUtc,
    entries,
    ...(raw.authorTags ? { tags: raw.authorTags } : {}),
  };
}
