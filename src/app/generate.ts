// Generating a picklist end to end (design doc §5.2).

import { buildPicklist, namesToLookUp, type Picklist } from "../engine/picklist";
import { BINDER_DECKS, BUILT_FOLDER, COLLECTIONS_FOLDER } from "../engine/sections";
import { SetCatalog } from "../engine/sets";
import { CollectionSorter } from "../engine/sort";
import type { FetchFn, MoxfieldClient } from "../moxfield/client";
import { lookUpCards } from "../moxfield/collection";
import { getDeck, listDecks, type FetchedDeck } from "../moxfield/decks";
import { loadSets } from "../scryfall/sets";
import type { Store } from "../util/store";
import { loadDecksCached } from "./deckCache";

export interface GenerateDeps {
  client: MoxfieldClient;
  store: Store;
  fetchFn: FetchFn;
  onStep?: (step: string) => void;
  now?: () => number;
}

export interface GenerateResult {
  deck: FetchedDeck;
  picklist: Picklist;
  sets: SetCatalog;
  stats: { builtDecks: number; binderDecks: number; decksFetched: number; cardsSearched: number; collectionRows: number; ms: number };
}

export async function generatePicklist(publicId: string, deps: GenerateDeps): Promise<GenerateResult> {
  const { client, store, onStep = () => {} } = deps;
  const now = deps.now ?? Date.now;
  const started = now();

  onStep("Signing in to Moxfield and loading the deck…");
  const [deck, summaries, sets] = await Promise.all([
    getDeck(client, publicId),
    listDecks(client),
    loadSets(store, deps.fetchFn, now()),
  ]);

  const built = summaries.filter((s) => s.folder === BUILT_FOLDER && s.publicId !== publicId);
  const binders = summaries.filter(
    (s) => s.folder === COLLECTIONS_FOLDER && BINDER_DECKS.some((b) => s.name.startsWith(b.deck)),
  );
  onStep(`Loading ${built.length} built decks and ${binders.length} binder decks…`);
  const { decks, fetched } = await loadDecksCached(client, store, [...built, ...binders], (done, total) =>
    onStep(`Loading changed decks (${done} of ${total})…`),
  );
  const byId = new Map(decks.map((d) => [d.publicId, d]));
  const pickDecks = (list: typeof built) => list.map((s) => byId.get(s.publicId)).filter((d) => d !== undefined);

  const names = namesToLookUp(deck);
  onStep(`Searching your collection for ${names.length} cards…`);
  const collection = await lookUpCards(client, names);

  const catalog = new SetCatalog(sets);
  const picklist = buildPicklist({
    target: deck,
    builtDecks: pickDecks(built),
    binderDecks: pickDecks(binders),
    collection,
    sorter: new CollectionSorter(catalog),
  });
  return {
    deck,
    picklist,
    sets: catalog,
    stats: {
      builtDecks: built.length,
      binderDecks: binders.length,
      decksFetched: fetched,
      cardsSearched: names.length,
      collectionRows: collection.length,
      ms: now() - started,
    },
  };
}
