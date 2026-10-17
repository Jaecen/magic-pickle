// Collection search (design doc §4.5). The server scans the collection in stages, so one request is not a
// search: keep asking with the server-issued searchSessionId until hasMore is false. Queries over about
// 1,000 characters silently match only their first terms, so names are searched in groups.

import type { CollectionRow } from "../engine/types";
import { mapLimit } from "../util/pool";
import { MoxfieldError, type MoxfieldClient } from "./client";
import { collectionPageSchema } from "./schemas";

/** Comfortably under the ~1,000-character cap the spike found. */
export const MAX_QUERY_CHARS = 900;
export const PAGE_SIZE = 1000;
/** Searches run at the same time. 4 was measured to be fine (§4.5). */
export const CONCURRENT_SEARCHES = 4;
/** A search normally finishes in about 5 requests; this is a runaway guard. */
const MAX_REQUESTS_PER_SEARCH = 100;

/** The query parameters Moxfield's site sends, in its order; only q, paging, and the session vary. */
function searchPath(q: string, pageNumber: number, searchSessionId: string | undefined): string {
  const params = new URLSearchParams();
  if (searchSessionId) params.set("searchSessionId", searchSessionId);
  params.set("q", q);
  for (const key of ["setId", "deckId", "rarity", "condition", "game", "cardLanguageId", "finish", "isAlter", "isProxy", "tradeBinderId"]) {
    params.set(key, "");
  }
  params.set("pricingProvider", "tcgplayer");
  params.set("priceMinimum", "");
  params.set("priceMaximum", "");
  params.set("pageNumber", String(pageNumber));
  params.set("pageSize", String(PAGE_SIZE));
  params.set("sortType", "cardName");
  params.set("sortDirection", "ascending");
  return `/v1/collections/search?${params}`;
}

export function exactNameTerm(name: string): string {
  return `!"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Splits card names into OR queries of exact-name terms, each at most `maxChars` long. */
export function exactNameQueries(names: Iterable<string>, maxChars = MAX_QUERY_CHARS): string[] {
  const queries: string[] = [];
  let current = "";
  for (const name of new Set(names)) {
    const term = exactNameTerm(name);
    const joined = current ? `${current} or ${term}` : term;
    if (current && joined.length > maxChars) {
      queries.push(current);
      current = term;
    } else {
      current = joined;
    }
  }
  if (current) queries.push(current);
  return queries;
}

/** Runs one search to completion and returns every matching row. */
export async function searchCollection(client: MoxfieldClient, q: string): Promise<CollectionRow[]> {
  const rows = new Map<string, CollectionRow>();
  let session: string | undefined;
  let page = 1;
  for (let n = 0; n < MAX_REQUESTS_PER_SEARCH; n++) {
    const result = await client.get(searchPath(q, page, session), collectionPageSchema);
    for (const row of result.data) rows.set(row.id, row);
    session = result.searchSessionId ?? session;
    if (!result.hasMore) return [...rows.values()];
    if (result.data.length >= PAGE_SIZE) page++;
  }
  throw new MoxfieldError(`Collection search didn't finish after ${MAX_REQUESTS_PER_SEARCH} requests`, "/v1/collections/search");
}

/** Every collection row for the given card names, deduplicated. */
export async function lookUpCards(client: MoxfieldClient, names: Iterable<string>): Promise<CollectionRow[]> {
  const pages = await mapLimit(exactNameQueries(names), CONCURRENT_SEARCHES, (q) => searchCollection(client, q));
  const rows = new Map<string, CollectionRow>();
  for (const row of pages.flat()) rows.set(row.id, row);
  return [...rows.values()];
}
