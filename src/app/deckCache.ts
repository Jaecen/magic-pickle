// Built and binder decks rarely change, so they're cached by publicId + lastUpdatedAtUtc from the decks
// list (design doc §5.3). An unchanged deck costs no request.

import type { MoxfieldClient } from "../moxfield/client";
import { getDeck, type DeckSummary, type FetchedDeck } from "../moxfield/decks";
import { mapLimit } from "../util/pool";
import type { Store } from "../util/store";

// Bump the version whenever deck parsing changes, so decks cached under the old parsing are refetched.
// v2: honor printingData (2026-10-18). v3: keep the signatureSpells board (2026-10-18).
const CACHE_KEY = "deckCache.v3";
const OLD_CACHE_KEYS = ["deckCache", "deckCache.v2"];
const CONCURRENT_DECK_FETCHES = 4;

type DeckCache = Record<string, FetchedDeck>;

/** Loads `summaries`, fetching only decks that changed, and drops cache entries for decks not asked for. */
export async function loadDecksCached(
  client: MoxfieldClient,
  store: Store,
  summaries: readonly DeckSummary[],
  onFetched?: (done: number, total: number) => void,
): Promise<{ decks: FetchedDeck[]; fetched: number }> {
  const cache = (await store.get<DeckCache>(CACHE_KEY)) ?? {};
  const stale = summaries.filter((s) => cache[s.publicId]?.lastUpdatedAtUtc !== s.lastUpdatedAtUtc);
  let done = 0;
  const fresh = await mapLimit(stale, CONCURRENT_DECK_FETCHES, async (s) => {
    const deck = await getDeck(client, s.publicId);
    onFetched?.(++done, stale.length);
    return deck;
  });
  for (const deck of fresh) cache[deck.publicId] = deck;

  const next: DeckCache = {};
  for (const s of summaries) if (cache[s.publicId]) next[s.publicId] = cache[s.publicId]!;
  await store.set(CACHE_KEY, next);
  for (const key of OLD_CACHE_KEYS) await store.remove(key);
  return { decks: summaries.map((s) => next[s.publicId]!).filter(Boolean), fetched: fresh.length };
}
