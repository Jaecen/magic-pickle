/** One face of a multi-faced card, as Moxfield nests it in `card_faces`. */
export interface CardFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  colors?: string[];
}

/**
 * The parts of Moxfield's card object that the engine uses. Deck entries and collection rows carry the
 * same object (design doc §4.4); field names follow Moxfield, which mostly follows Scryfall.
 */
export interface Card {
  scryfall_id: string;
  name: string;
  /** Lowercase set code, e.g. `c16`. */
  set: string;
  /** Collector number. */
  cn: string;
  /** Language of the printing, e.g. `en`, `ph`. */
  lang: string;
  type_line: string;
  mana_cost?: string;
  colors?: string[];
  color_indicator?: string[];
  card_faces?: CardFace[];
  /** Scryfall frame: `1993`, `1997`, `2003`, `2015`, or `future`. */
  frame?: string;
  isToken?: boolean;
}

export type Finish = "nonFoil" | "foil" | "etched";

/** One entry from Scryfall's set list, trimmed to what the sort needs (§6.3.3). */
export interface SetInfo {
  code: string;
  name: string;
  /** `YYYY-MM-DD`. */
  released_at: string;
  set_type: string;
  block_code?: string;
  parent_set_code?: string;
  /**
   * The name of Scryfall's symbol for the set (from `icon_svg_uri`). Often another set's code, e.g. `c16` for the
   * C16 tokens, or a generic one such as `star`, `dci`, or `default`.
   */
  icon?: string;
}

/** One card line in a deck. `board` is Moxfield's board name: `mainboard`, `commanders`, `maybeboard`, … */
export interface DeckEntry {
  board: string;
  quantity: number;
  finish: Finish;
  isProxy?: boolean;
  card: Card;
}

export interface Deck {
  publicId: string;
  name: string;
  entries: readonly DeckEntry[];
  /** Moxfield's per-card tags (`authorTags`), keyed by card name. */
  tags?: Readonly<Record<string, readonly string[]>>;
}

/** One collection row: a printing in one finish, condition, and language. */
export interface CollectionRow {
  id: string;
  quantity: number;
  finish: Finish;
  isProxy?: boolean;
  /** The copy's language (`language.code`), which can differ from `card.lang`. */
  languageCode: string;
  card: Card;
}
