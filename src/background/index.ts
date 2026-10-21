import { checkLabel } from "../app/labels";
import { deckHash, hashWords, parseHash } from "../engine/deckHash";
import { LABEL_PAGE, PICK_PAGE, SITE_HEADERS_KEY, isMessage, type DeckHashReply, type LabelReply } from "../messages";
import { MoxfieldClient, NotLoggedInError, type SiteHeaders } from "../moxfield/client";
import { getDeck } from "../moxfield/decks";
import { deckIdFromInput } from "../moxfield/urls";

const client = new MoxfieldClient(
  (input, init) => fetch(input, init),
  async () => ((await browser.storage.local.get(SITE_HEADERS_KEY))[SITE_HEADERS_KEY] as SiteHeaders | undefined) ?? {},
);

async function openPage(page: string, publicId: string | undefined): Promise<void> {
  const query = publicId ? `?deck=${encodeURIComponent(publicId)}` : "";
  await browser.tabs.create({ url: browser.runtime.getURL(page) + query });
}

/** The deck's hash for the content script, and the result of checking a label against it. */
async function deckHashReply(publicId: string, labelText: string | undefined): Promise<DeckHashReply> {
  try {
    const deck = await getDeck(client, publicId);
    const words = hashWords(await deckHash(deck.entries));
    if (labelText === undefined) return { ok: true, name: deck.name, words };
    const label = parseHash(labelText);
    const reply: LabelReply = label
      ? { valid: true, words: hashWords(label), ...(await checkLabel(client, deck, label)) }
      : { valid: false };
    return { ok: true, name: deck.name, words, label: reply };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), notLoggedIn: e instanceof NotLoggedInError };
  }
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (isMessage(message, "openPicklist")) return openPage(PICK_PAGE, message.publicId);
  if (isMessage(message, "openLabel")) return openPage(LABEL_PAGE, message.publicId);
  if (isMessage(message, "deckHash")) return deckHashReply(message.publicId, message.label);
  return undefined;
});

// The toolbar button opens the picklist for the deck in the current tab, if it's a Moxfield deck page.
browser.action.onClicked.addListener((tab) => openPage(PICK_PAGE, deckIdFromInput(tab.url)));

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

// When a Moxfield page saves something (a deck edit is a PUT, POST, PATCH, or DELETE), tell it so the deck hash it
// shows can be refreshed. Sign-in calls are POSTs too, but they don't change a deck.
const SAVING_METHODS = new Set(["PUT", "POST", "PATCH", "DELETE"]);
browser.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0 || !SAVING_METHODS.has(details.method)) return;
    if (/\/(startup\/authenticated|account\/token\/refresh)$/.test(new URL(details.url).pathname)) return;
    browser.tabs.sendMessage(details.tabId, { type: "moxfieldChanged" }).catch(() => {
      // Not every Moxfield tab has the content script listening yet.
    });
  },
  { urls: ["https://api2.moxfield.com/*"] },
);

let lastStored = "";
async function rememberSiteHeaders(headers: SiteHeaders): Promise<void> {
  const serialized = JSON.stringify(headers);
  if (serialized === lastStored) return;
  lastStored = serialized;
  await browser.storage.local.set({ [SITE_HEADERS_KEY]: headers });
}
