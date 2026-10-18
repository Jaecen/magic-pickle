import { describe, expect, it } from "vitest";
import { fakeMoxfield, rawCard, type RawRow } from "../../tests/fakeMoxfield";
import { MoxfieldClient } from "./client";
import { CONCURRENT_SEARCHES, exactNameQueries, lookUpCards, MAX_QUERY_CHARS, PAGE_SIZE, searchCollection } from "./collection";

const rows = (names: string[], perName = 1): RawRow[] =>
  names.flatMap((name, i) =>
    Array.from({ length: perName }, (_, k) => ({ id: `r${i}-${k}`, quantity: 1, card: rawCard({ name, set: "otj", cn: String(k + 1) }) })),
  );

describe("exactNameQueries", () => {
  it("ORs exact-name terms into queries under the length cap, covering every name once", () => {
    const names = Array.from({ length: 79 }, (_, i) => `Some Fairly Long Card Name ${i}`);
    const queries = exactNameQueries([...names, names[0]!]);
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.every((q) => q.length <= MAX_QUERY_CHARS)).toBe(true);
    expect(queries.join(" or ").match(/!"/g)).toHaveLength(79);
  });

  it("escapes quotes in names", () => {
    expect(exactNameQueries(['"Ach! Hans, Run!"'])).toEqual(['!"\\"Ach! Hans, Run!\\""']);
  });
});

describe("searchCollection", () => {
  it("follows hasMore with the server's session id until the scan finishes", async () => {
    const server = fakeMoxfield({ collection: rows(["Filler", "Evolving Wilds", "Sol Ring"], 4), stages: 5 });
    const client = new MoxfieldClient(server.fetch);
    const found = await searchCollection(client, '!"Sol Ring"');
    expect(found.map((r) => r.card.name)).toEqual(["Sol Ring", "Sol Ring", "Sol Ring", "Sol Ring"]);
    const searches = server.apiRequests().filter((r) => r.url.pathname === "/v1/collections/search");
    expect(searches).toHaveLength(5);
    expect(searches[0]!.url.searchParams.has("searchSessionId")).toBe(false);
    expect(new Set(searches.slice(1).map((r) => r.url.searchParams.get("searchSessionId")))).toEqual(new Set(["session0"]));
  });

  it("moves to the next page once a page is full", async () => {
    const server = fakeMoxfield({ collection: rows(["Sol Ring"], PAGE_SIZE + 5), stages: 1 });
    const found = await searchCollection(new MoxfieldClient(server.fetch), '!"Sol Ring"');
    expect(found).toHaveLength(PAGE_SIZE + 5);
    const pages = server.apiRequests().filter((r) => r.url.pathname === "/v1/collections/search").map((r) => r.url.searchParams.get("pageNumber"));
    expect(pages).toEqual(["1", "2"]);
  });
});

describe("lookUpCards", () => {
  it("reads a Phyrexian printing's default-English row as a Phyrexian copy", async () => {
    const vraska = rawCard({ name: "Vraska, Betrayal's Sting", set: "one", cn: "326", lang: "ph" });
    const server = fakeMoxfield({ collection: [{ id: "v1", quantity: 1, card: vraska }] });
    const [row] = await lookUpCards(new MoxfieldClient(server.fetch), ["Vraska, Betrayal's Sting"]);
    expect(row).toMatchObject({ languageCode: "ph", card: { lang: "ph" } });
  });

  it("finds every name in a deck-sized lookup despite the query cap", async () => {
    const names = Array.from({ length: 79 }, (_, i) => `Card Number ${i} of the Zur Deck`);
    const server = fakeMoxfield({ collection: rows(names, 2) });
    const found = await lookUpCards(new MoxfieldClient(server.fetch), names);
    expect(new Set(found.map((r) => r.card.name))).toEqual(new Set(names));
    expect(found).toHaveLength(158);
  });

  it(`runs at most ${CONCURRENT_SEARCHES} searches at once`, async () => {
    const names = Array.from({ length: 200 }, (_, i) => `Card ${i} with a reasonably long name`);
    const server = fakeMoxfield({ collection: rows(names) });
    let inFlight = 0;
    let peak = 0;
    const tracking: typeof server.fetch = async (input, init) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      try {
        return await server.fetch(input, init);
      } finally {
        inFlight--;
      }
    };
    await lookUpCards(new MoxfieldClient(tracking), names);
    expect(peak).toBeLessThanOrEqual(CONCURRENT_SEARCHES);
    expect(peak).toBeGreaterThan(1);
  });
});
