// Firefox exposes the WebExtension API as the `browser` global; these types come from webextension-polyfill
// (types only, the polyfill itself isn't used).
import type { Browser } from "webextension-polyfill";

declare global {
  const browser: Browser;
}
