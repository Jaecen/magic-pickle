// Scryfall's set list: release dates, blocks, and parent sets for the sort (design doc §6.3.3).

import type { SetInfo } from "../engine/types";
import type { FetchFn } from "../moxfield/client";
import type { Store } from "../util/store";

export const SETS_URL = "https://api.scryfall.com/sets";
const CACHE_KEY = "scryfallSets";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedSets {
  fetchedAt: number;
  sets: SetInfo[];
}

interface ScryfallSet {
  code: string;
  name: string;
  released_at?: string;
  set_type: string;
  block_code?: string;
  parent_set_code?: string;
  digital?: boolean;
}

/** The set list from cache, refetched when older than 7 days. A stale cache is used if Scryfall can't be reached. */
export async function loadSets(store: Store, fetchFn: FetchFn, now = Date.now()): Promise<SetInfo[]> {
  const cached = await store.get<CachedSets>(CACHE_KEY);
  if (cached && now - cached.fetchedAt < MAX_AGE_MS) return cached.sets;
  try {
    const response = await fetchFn(SETS_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Scryfall returned ${response.status}`);
    const body = (await response.json()) as { data: ScryfallSet[] };
    const sets = body.data.filter((s) => !s.digital).map(trimSet);
    await store.set(CACHE_KEY, { fetchedAt: now, sets } satisfies CachedSets);
    return sets;
  } catch (e) {
    if (cached) return cached.sets;
    throw new Error(`Couldn't load Scryfall's set list: ${String(e)}`, { cause: e });
  }
}

function trimSet(s: ScryfallSet): SetInfo {
  return {
    code: s.code,
    name: s.name,
    released_at: s.released_at ?? "9999-12-31",
    set_type: s.set_type,
    ...(s.block_code ? { block_code: s.block_code } : {}),
    ...(s.parent_set_code ? { parent_set_code: s.parent_set_code } : {}),
  };
}
