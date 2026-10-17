// Runs on moxfield.com. Two jobs:
//  1. Inject a "Pickle" button on deck pages (tests the "invoke from deck editor" entry point,
//     including surviving Moxfield's client-side navigation).
//  2. Act as a fetch proxy for the probe page so we can compare request contexts:
//     "cs"   = content-script fetch (extension principal, moxfield.com document)
//     "page" = content.fetch (request made as if by the page itself)
if (!window.__pickleProbe) {
  window.__pickleProbe = true;

  const DECK_PATH = /^\/decks\/([A-Za-z0-9_-]{6,})/;
  let button = null;

  function syncButton() {
    const m = location.pathname.match(DECK_PATH);
    if (m && !document.body.contains(button)) {
      button = document.createElement("button");
      button.textContent = "🥒 Pickle";
      button.title = "Magic Pickle probe: open picklist page for this deck";
      Object.assign(button.style, {
        position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483647,
        padding: "8px 14px", borderRadius: "999px", border: "none",
        background: "#3a7d44", color: "white", font: "600 14px system-ui", cursor: "pointer",
        boxShadow: "0 2px 8px rgba(0,0,0,.3)",
      });
      button.addEventListener("click", () => {
        const id = location.pathname.match(DECK_PATH)?.[1];
        browser.runtime.sendMessage({ type: "open", deckId: id });
      });
      document.body.appendChild(button);
    } else if (!m && button) {
      button.remove();
      button = null;
    }
  }
  // Moxfield is an SPA; watch for both URL changes and DOM rewrites.
  new MutationObserver(syncButton).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(syncButton, 1000);
  syncButton();

  async function doFetch({ url, method, headers, body, ctx }) {
    const opts = { method: method ?? "GET", headers: headers ?? {}, credentials: "include" };
    if (body != null && opts.method !== "GET") opts.body = body;
    const t0 = performance.now();
    try {
      const res =
        ctx === "page"
          ? await content.fetch(url, typeof cloneInto === "function" ? cloneInto(opts, window) : opts)
          : await fetch(url, opts);
      const text = await res.text();
      return {
        status: res.status,
        ms: Math.round(performance.now() - t0),
        bytes: text.length,
        contentType: res.headers.get("content-type"),
        text,
      };
    } catch (e) {
      return { status: null, ms: Math.round(performance.now() - t0), error: String(e) };
    }
  }

  function storageProbe() {
    const describe = (store) => {
      const out = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        const v = store.getItem(k) ?? "";
        out.push({
          key: k,
          length: v.length,
          looksJwt: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(v),
          mentionsToken: /token/i.test(k) || /"(access|refresh)_?token"/i.test(v),
        });
      }
      return out;
    };
    return {
      origin: location.origin,
      localStorage: describe(localStorage),
      sessionStorage: describe(sessionStorage),
      // HttpOnly cookies are invisible here, which is itself informative.
      cookieNames: document.cookie.split(";").map((c) => c.split("=")[0].trim()).filter(Boolean),
    };
  }

  // Script URLs the page loaded (the probe page fetches and searches them), plus matches in inline scripts.
  // Inline scripts may embed user data, so only the text around a match is returned.
  function scriptInfo(needles, radius) {
    const urls = new Set([...document.scripts].map((s) => s.src).filter(Boolean));
    for (const e of performance.getEntriesByType("resource")) {
      if (e.initiatorType === "script" || /\.m?js(\?|$)/.test(e.name)) urls.add(e.name);
    }
    const inlineHits = [];
    [...document.scripts].filter((s) => !s.src).forEach((s, k) => {
      const text = s.textContent ?? "";
      for (const n of needles) {
        const i = text.indexOf(n);
        if (i !== -1) inlineHits.push({ url: `inline#${k}`, needle: n, context: text.slice(Math.max(0, i - radius), i + n.length + radius) });
      }
    });
    return { urls: [...urls], inlineHits };
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "cs:fetch") return doFetch(msg);
    if (msg.type === "cs:storage") return Promise.resolve(storageProbe());
    if (msg.type === "cs:scripts") return Promise.resolve(scriptInfo(msg.needles ?? [], msg.radius ?? 250));
  });
}
