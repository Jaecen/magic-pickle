import { describe, expect, it } from "vitest";
import { deckIdFromInput, deckIdFromPath } from "./urls";

describe("deck ids", () => {
  it("reads deck pages, not other paths", () => {
    expect(deckIdFromPath("/decks/AbCdEfGhIjKlMnOpQrStUv")).toBe("AbCdEfGhIjKlMnOpQrStUv");
    expect(deckIdFromPath("/decks/AbCdEfGhIjKlMnOpQrStUv/primer")).toBe("AbCdEfGhIjKlMnOpQrStUv");
    expect(deckIdFromPath("/decks/personal")).toBeUndefined();
    expect(deckIdFromPath("/collection")).toBeUndefined();
  });

  it("accepts a URL or a bare id", () => {
    expect(deckIdFromInput("https://moxfield.com/decks/AbCdEfGhIjKlMnOpQrStUv")).toBe("AbCdEfGhIjKlMnOpQrStUv");
    expect(deckIdFromInput(" AbCdEfGhIjKlMnOpQrStUv ")).toBe("AbCdEfGhIjKlMnOpQrStUv");
    expect(deckIdFromInput("https://example.com/decks/AbCdEfGhIjKlMnOpQrStUv")).toBeUndefined();
    expect(deckIdFromInput("")).toBeUndefined();
  });
});
