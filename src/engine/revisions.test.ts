import { describe, expect, it } from "vitest";
import { cardListHash } from "./deckHash";
import { findLabelRevision, type HistoryEntry } from "./revisions";

const counts = (entries: Record<string, number>) => new Map(Object.entries(entries));

async function* stream(entries: HistoryEntry[]) {
  yield* entries;
}

// Newest first, as Moxfield returns it. The deck went: {Ring 1, Zur 1} → +Path → Zur to commanders → −Ring, +Crypt.
const history: HistoryEntry[] = [
  { board: "mainboard", name: "Mana Crypt", quantityDelta: 1, at: "2026-10-04T00:00:00Z" },
  { board: "mainboard", name: "Sol Ring", quantityDelta: -1, at: "2026-10-03T00:00:00Z" },
  { board: "maybeboard", name: "Sol Ring", quantityDelta: 1, at: "2026-10-03T00:00:00Z" },
  { board: "commanders", name: "Zur", quantityDelta: 1, at: "2026-10-02T00:00:00Z" },
  { board: "mainboard", name: "Zur", quantityDelta: -1, at: "2026-10-02T00:00:00Z" },
  { board: "mainboard", name: "Path", quantityDelta: 1, at: "2026-10-01T00:00:00Z" },
  { board: "mainboard", name: "Zur", quantityDelta: 1, at: "2026-09-01T00:00:00Z" },
  { board: "mainboard", name: "Sol Ring", quantityDelta: 1, at: "2026-09-01T00:00:00Z" },
];
const now = counts({ Zur: 1, Path: 1, "Mana Crypt": 1 });

describe("findLabelRevision", () => {
  it("finds the label's revision and what changed since", async () => {
    const label = await cardListHash(counts({ Zur: 1, "Sol Ring": 1 }));
    expect(await findLabelRevision(now, stream(history), label)).toEqual({
      found: true,
      changedSince: "2026-10-01T00:00:00Z",
      changes: [
        { name: "Mana Crypt", quantity: 1 },
        { name: "Path", quantity: 1 },
        { name: "Sol Ring", quantity: -1 },
      ],
    });
  });

  it("undoes same-time entries together and ignores boards outside the deck", async () => {
    const label = await cardListHash(counts({ Zur: 1, Path: 1, "Sol Ring": 1 }));
    const result = await findLabelRevision(now, stream(history), label);
    expect(result).toMatchObject({ found: true, changedSince: "2026-10-03T00:00:00Z" });
  });

  it("reports no match when history doesn't explain the label", async () => {
    const label = await cardListHash(counts({ "Black Lotus": 1 }));
    expect(await findLabelRevision(now, stream(history), label)).toEqual({ found: false, complete: true });
  });

  it("stops after maxEntries", async () => {
    const label = await cardListHash(counts({ Zur: 1, "Sol Ring": 1 }));
    expect(await findLabelRevision(now, stream(history), label, 3)).toEqual({ found: false, complete: false });
  });
});
