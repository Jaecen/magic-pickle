import type { HistoryEntry } from "../engine/revisions";
import type { MoxfieldClient } from "./client";
import { historyPageSchema } from "./schemas";

/**
 * A deck's history, newest first, fetched a page at a time as it's read (§4.3). Each entry is one card's quantity
 * change on one board. Printing and finish swaps aren't recorded, and entries show the printing a card was added
 * with, so only names and quantities are kept.
 */
export async function* deckHistory(client: MoxfieldClient, publicId: string, pageSize = 100): AsyncGenerator<HistoryEntry> {
  for (let page = 1; ; page++) {
    const path = `/v2/decks/all/${encodeURIComponent(publicId)}/history?pageNumber=${page}&pageSize=${pageSize}`;
    const { data, totalPages } = await client.get(path, historyPageSchema);
    for (const e of data) yield { board: e.boardType, name: e.card.name, quantityDelta: e.quantityDelta, at: e.updatedAtUtc };
    if (page >= totalPages || data.length === 0) return;
  }
}
