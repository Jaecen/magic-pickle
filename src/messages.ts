/** Sent by the content script's 🥒 button to have the background open the picklist page. */
export interface OpenPicklistMessage {
  type: "openPicklist";
  publicId?: string;
}

export function isOpenPicklistMessage(message: unknown): message is OpenPicklistMessage {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "openPicklist";
}

/** storage.local key for the headers learned from Moxfield's own traffic. */
export const SITE_HEADERS_KEY = "moxfieldSiteHeaders";

export const PICK_PAGE = "pages/pick/index.html";
