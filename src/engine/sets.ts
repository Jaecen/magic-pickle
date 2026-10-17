import type { SetInfo } from "./types";

/** Scryfall's set list, indexed for lookups (design doc §6.3.3). */
export class SetCatalog {
  private readonly byCode = new Map<string, SetInfo>();
  private readonly byBlock = new Map<string, SetInfo[]>();

  constructor(sets: Iterable<SetInfo>) {
    for (const set of sets) {
      const normalized = { ...set, code: set.code.toLowerCase() };
      this.byCode.set(normalized.code, normalized);
      if (set.block_code) {
        const members = this.byBlock.get(set.block_code) ?? [];
        members.push(normalized);
        this.byBlock.set(set.block_code, members);
      }
    }
  }

  get(code: string): SetInfo | undefined {
    return this.byCode.get(code.toLowerCase());
  }

  blockMembers(blockCode: string): readonly SetInfo[] {
    return this.byBlock.get(blockCode) ?? [];
  }
}
