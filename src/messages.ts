import type { LabelCheck } from "./app/labels";

/** Sent by the content script's 🥒 button to have the background open the picklist page. */
export interface OpenPicklistMessage {
  type: "openPicklist";
  publicId?: string;
}

/** Sent by the content script to have the background open the label page for a deck. */
export interface OpenLabelMessage {
  type: "openLabel";
  publicId: string;
}

/** Asks the background for a deck's hash and, if `label` is given (typed words or a URL fragment), checks it. */
export interface DeckHashMessage {
  type: "deckHash";
  publicId: string;
  label?: string;
}

export type DeckHashReply =
  | { ok: true; name: string; words: string[]; label?: LabelReply }
  | { ok: false; error: string; notLoggedIn: boolean };

export type LabelReply = { valid: false } | ({ valid: true; words: string[] } & LabelCheck);

/** Sent by the background to a Moxfield tab after the page saved a change, so its hash can be refreshed. */
export interface MoxfieldChangedMessage {
  type: "moxfieldChanged";
}

type Message = OpenPicklistMessage | OpenLabelMessage | DeckHashMessage | MoxfieldChangedMessage;

export function isMessage<T extends Message["type"]>(message: unknown, type: T): message is Extract<Message, { type: T }> {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === type;
}

/** storage.local key for the headers learned from Moxfield's own traffic. */
export const SITE_HEADERS_KEY = "moxfieldSiteHeaders";

export const PICK_PAGE = "pages/pick/index.html";
export const LABEL_PAGE = "pages/label/index.html";
