// Where a collection copy lives, and its position in pull order (design doc §6.3).
// Binder copies are placed separately (§6.3.2); this covers everything else.

import { COLOR_ORDER, colorBucket, type ColorBucket } from "./color";
import { compareText, nameSortKey } from "./names";
import { COLOR_OVERRIDES, MERGED_SECTIONS, SECTION_INDEX, SET_SECTIONS, TYPE_SECTIONS, type SectionId } from "./sections";
import type { SetCatalog } from "./sets";
import type { Card, SetInfo } from "./types";

/** Compared element by element: numbers by value, strings with {@link compareText}. */
export type SortKey = readonly (string | number)[];

export interface Placement {
  section: SectionId;
  /**
   * The drawer the copy is filed under, led by set codes as the drawers are labeled: "C13 - Commander 2013",
   * "CHK/BOK/SOK - Champions of Kamigawa block". Sibling sets get their own ("BIG - The Big Score"). Empty in
   * merged sections.
   */
  group: string;
  color: ColorBucket;
  key: SortKey;
}

const OLD_FRAMES = new Set(["1993", "1997"]);
/** Release of Eighth Edition, the first modern-frame set. */
const EIGHTH_EDITION = "2003-07-28";
/** Release of War of the Spark, the last set of the last block (GRN/RNA/WAR). */
const LAST_BLOCK_SET = "2019-05-03";
const UNKNOWN_DATE = "9999-12-31";

interface Group {
  key: string;
  label: string;
  date: string;
  /** "" for the primary set (or any member of a merged block); otherwise the sibling's set code. */
  sub: string;
}

export class CollectionSorter {
  private readonly setSections = new Map<string, SectionId>();
  private readonly groups = new Map<string, Group>();

  constructor(
    private readonly catalog: SetCatalog,
    private readonly colorOverrides: ReadonlyMap<string, ColorBucket> = COLOR_OVERRIDES,
  ) {}

  /** Places a non-binder copy of `card` whose collection row has language `languageCode`. */
  place(card: Card, languageCode: string): Placement {
    const color = colorBucket(card, this.colorOverrides);
    const code = card.set.toLowerCase();
    const section =
      languageCode !== "en" ? "foreign" : this.sectionFor(code, OLD_FRAMES.has(card.frame ?? ""));
    const group: Group = MERGED_SECTIONS.has(section) ? { key: "", label: "", date: "", sub: "" } : this.groupFor(code, section);
    return {
      section,
      group: group.label,
      color,
      key: [
        SECTION_INDEX.get(section)!,
        group.date,
        group.key,
        group.sub,
        COLOR_ORDER.indexOf(color),
        nameSortKey(card),
        card.cn,
        code,
      ],
    };
  }

  /** The section a set's cards go to (§6.3, "Which section wins", rules 3–6). */
  private sectionFor(code: string, oldFrame: boolean): SectionId {
    const named = SET_SECTIONS[code];
    if (named === "unSets" || named === "playtest") return named;
    const set = this.catalog.get(code);
    if (set && oldFrame && set.released_at < EIGHTH_EDITION) return "oldCards";
    return named ?? (set && TYPE_SECTIONS[set.set_type]) ?? "main";
  }

  /** Section of a whole set, for working out blocks and siblings. Pre-8th Edition sets are all old frame. */
  private setSection(code: string): SectionId {
    let section = this.setSections.get(code);
    if (!section) {
      section = this.sectionFor(code, true);
      this.setSections.set(code, section);
    }
    return section;
  }

  private groupFor(code: string, section: SectionId): Group {
    const cacheKey = `${section}:${code}`;
    let group = this.groups.get(cacheKey);
    if (!group) {
      group = this.computeGroup(code, section);
      this.groups.set(cacheKey, group);
    }
    return group;
  }

  private computeGroup(code: string, section: SectionId): Group {
    const set = this.catalog.get(code);
    if (!set) return { key: `set:${code}`, label: code.toUpperCase(), date: UNKNOWN_DATE, sub: "" };

    // A member of a classic block merges into the block.
    const ownBlock = this.classicBlock(set);
    if (ownBlock) return this.blockGroup(ownBlock, section, "");

    // A sibling files after its root set: follow parents while they're in the same section.
    let root = set;
    const seen = new Set([root.code]);
    for (let parent = this.parentOf(root); parent && !seen.has(parent.code); parent = this.parentOf(root)) {
      if (this.setSection(parent.code) !== section) break;
      seen.add(parent.code);
      root = parent;
    }
    const sub = root.code === code ? "" : code;
    const rootBlock = this.classicBlock(root);
    const group = rootBlock
      ? this.blockGroup(rootBlock, section, sub)
      : { key: `set:${root.code}`, label: setLabel(root), date: root.released_at, sub };
    return sub ? { ...group, label: setLabel(set) } : group;
  }

  private parentOf(set: SetInfo): SetInfo | undefined {
    return set.parent_set_code ? this.catalog.get(set.parent_set_code) : undefined;
  }

  /**
   * The block a set merges into, if any. Only expansion blocks through GRN/RNA/WAR count; Scryfall's other
   * "blocks" (all Commander products, all core sets, newer set families) aren't blocks here (§6.3.1).
   */
  private classicBlock(set: SetInfo): string | undefined {
    return set.set_type === "expansion" && set.block_code && set.released_at <= LAST_BLOCK_SET
      ? set.block_code
      : undefined;
  }

  /** A block's group within one section, dated by its earliest member in that section (e.g. Coldsnap). */
  private blockGroup(block: string, section: SectionId, sub: string): Group {
    const members = this.catalog
      .blockMembers(block)
      .filter((m) => this.classicBlock(m) === block && this.setSection(m.code) === section)
      .sort((a, b) => a.released_at.localeCompare(b.released_at));
    const first = members[0];
    return {
      key: `block:${block}`,
      label: !first
        ? block.toUpperCase()
        : members.length === 1
          ? setLabel(first) // e.g. Coldsnap, alone in Main without the rest of the Ice Age block
          : `${members.map((m) => m.code.toUpperCase()).join("/")} - ${first.name} block`,
      date: first?.released_at ?? UNKNOWN_DATE,
      sub,
    };
  }
}

function setLabel(set: SetInfo): string {
  return `${set.code.toUpperCase()} - ${set.name}`;
}

export function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const diff = typeof x === "number" && typeof y === "number" ? x - y : compareText(String(x), String(y));
    if (diff !== 0) return diff;
  }
  return 0;
}
