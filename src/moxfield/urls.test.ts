import { describe, expect, it } from "vitest";
import { deckIdFromInput, deckIdFromPath } from "./urls";

describe("deck ids", () => {
  it("reads deck pages, not other paths", () => {
    expect(deckIdFromPath("/decks/oEACJK3IjEqXyOouWwOe3Q")).toBe("oEACJK3IjEqXyOouWwOe3Q");
    expect(deckIdFromPath("/decks/oEACJK3IjEqXyOouWwOe3Q/primer")).toBe("oEACJK3IjEqXyOouWwOe3Q");
    expect(deckIdFromPath("/decks/personal")).toBeUndefined();
    expect(deckIdFromPath("/collection")).toBeUndefined();
  });

  it("accepts a URL or a bare id", () => {
    expect(deckIdFromInput("https://moxfield.com/decks/oEACJK3IjEqXyOouWwOe3Q")).toBe("oEACJK3IjEqXyOouWwOe3Q");
    expect(deckIdFromInput(" oEACJK3IjEqXyOouWwOe3Q ")).toBe("oEACJK3IjEqXyOouWwOe3Q");
    expect(deckIdFromInput("https://example.com/decks/oEACJK3IjEqXyOouWwOe3Q")).toBeUndefined();
    expect(deckIdFromInput("")).toBeUndefined();
  });
});
