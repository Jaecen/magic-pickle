import { deckIdFromInput } from "../moxfield/urls";
import { PICK_PAGE, SITE_HEADERS_KEY, isOpenPicklistMessage } from "../messages";
import type { SiteHeaders } from "../moxfield/client";

async function openPicklist(publicId: string | undefined): Promise<void> {
  const query = publicId ? `?deck=${encodeURIComponent(publicId)}` : "";
  await browser.tabs.create({ url: browser.runtime.getURL(PICK_PAGE) + query });
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (isOpenPicklistMessage(message)) return openPicklist(message.publicId);
  return undefined;
});

// The toolbar button opens the picklist for the deck in the current tab, if it's a Moxfield deck page.
browser.action.onClicked.addListener((tab) => openPicklist(deckIdFromInput(tab.url)));

// Learn the extra headers Moxfield's own pages send, so the extension can send them too (design doc Q7).
browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!/^https:\/\/(www\.)?moxfield\.com\//.test(details.originUrl ?? "")) return;
    const header = (name: string) => details.requestHeaders?.find((h) => h.name.toLowerCase() === name)?.value;
    const learned: SiteHeaders = { version: header("x-moxfield-version"), sessionUser: header("x-session-user") };
    if (learned.version || learned.sessionUser) void rememberSiteHeaders(learned);
  },
  { urls: ["https://api2.moxfield.com/*"] },
  ["requestHeaders"],
);

let lastStored = "";
async function rememberSiteHeaders(headers: SiteHeaders): Promise<void> {
  const serialized = JSON.stringify(headers);
  if (serialized === lastStored) return;
  lastStored = serialized;
  await browser.storage.local.set({ [SITE_HEADERS_KEY]: headers });
}
