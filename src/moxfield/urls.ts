const DECK_PATH = /^\/decks\/([A-Za-z0-9_-]{10,})(?:\/|$)/;
const BARE_ID = /^[A-Za-z0-9_-]{10,}$/;

/** The deck's public id from a moxfield.com deck path, e.g. `/decks/oEACJK3IjEqXyOouWwOe3Q`. */
export function deckIdFromPath(pathname: string): string | undefined {
  return DECK_PATH.exec(pathname)?.[1];
}

/** The deck's public id from a full Moxfield deck URL or a bare id; undefined if it's neither. */
export function deckIdFromInput(input: string | undefined): string | undefined {
  const text = input?.trim() ?? "";
  if (BARE_ID.test(text)) return text;
  try {
    const url = new URL(text);
    return /(^|\.)moxfield\.com$/.test(url.hostname) ? deckIdFromPath(url.pathname) : undefined;
  } catch {
    return undefined;
  }
}

export function deckUrl(publicId: string): string {
  return `https://moxfield.com/decks/${publicId}`;
}
