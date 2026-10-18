import type { Card } from "../src/engine/types";

/** A minimal card for tests: a white 2-drop creature in a modern frame unless overridden. */
export function card(fields: Partial<Card> & Pick<Card, "name">): Card {
  return {
    scryfall_id: `${fields.set ?? "tst"}-${fields.name}`,
    set: "tst",
    cn: "1",
    lang: "en",
    type_line: "Creature — Test",
    mana_cost: "{1}{W}",
    colors: ["W"],
    frame: "2015",
    ...fields,
  };
}
