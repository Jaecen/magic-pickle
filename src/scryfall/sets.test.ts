import { describe, expect, it, vi } from "vitest";
import setsFixture from "../../tests/fixtures/scryfall-sets.json";
import { memoryStore } from "../util/store";
import { loadSets } from "./sets";

const DAY = 24 * 60 * 60 * 1000;
const ok = () => vi.fn(async () => new Response(JSON.stringify(setsFixture)));

describe("loadSets", () => {
  it("fetches, drops digital-only sets, and caches", async () => {
    const store = memoryStore();
    const fetchFn = ok();
    const sets = await loadSets(store, fetchFn, 1000);
    expect(sets.find((s) => s.code === "otj")).toMatchObject({ released_at: "2024-04-19", block_code: "otj" });
    expect(sets.some((s) => s.code.startsWith("y2"))).toBe(false);
    await loadSets(store, fetchFn, 1000 + 6 * DAY);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refreshes after 7 days, and falls back to the stale copy if Scryfall is down", async () => {
    const store = memoryStore();
    await loadSets(store, ok(), 0);
    const refetch = ok();
    await loadSets(store, refetch, 8 * DAY);
    expect(refetch).toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => new Response("", { status: 503 }));
    expect((await loadSets(store, down, 20 * DAY)).length).toBeGreaterThan(500);
  });

  it("fails clearly with no cache and no Scryfall", async () => {
    await expect(loadSets(memoryStore(), vi.fn(async () => new Response("", { status: 503 })), 0)).rejects.toThrow(
      "Couldn't load Scryfall's set list",
    );
  });
});
