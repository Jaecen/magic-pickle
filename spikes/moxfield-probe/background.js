// Records every request Moxfield's own pages make to api2.moxfield.com so we can
// learn the undocumented endpoints, and keeps the most recent Authorization-bearing
// header set (in session storage only) so the probe page can replay requests.

const API_FILTER = { urls: ["https://api2.moxfield.com/*"] };
const FORBIDDEN = /^(cookie|host|user-agent|origin|referer|connection|content-length|accept-encoding|te|priority|sec-.*)$/i;
const MAX_LOG = 400;

let log = null; // lazily loaded from storage.session (event page may be suspended)
const bodies = new Map(); // requestId -> request body text
const started = new Map(); // requestId -> timestamp
const probeUrls = new Map(); // url -> expiry; requests issued by the probe itself

async function getLog() {
  if (!log) log = (await browser.storage.session.get("log")).log ?? [];
  return log;
}

let flushTimer = null;
function flush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => browser.storage.session.set({ log }), 250);
}

function isProbe(url) {
  const exp = probeUrls.get(url);
  return exp !== undefined && exp > Date.now();
}

browser.webRequest.onBeforeRequest.addListener(
  (d) => {
    started.set(d.requestId, d.timeStamp);
    const rb = d.requestBody;
    if (rb?.raw?.length) {
      try {
        bodies.set(d.requestId, rb.raw.map((p) => new TextDecoder().decode(p.bytes)).join(""));
      } catch {}
    } else if (rb?.formData) {
      bodies.set(d.requestId, JSON.stringify(rb.formData));
    }
  },
  API_FILTER,
  ["requestBody"]
);

browser.webRequest.onBeforeSendHeaders.addListener(
  async (d) => {
    const entries = await getLog();
    const headers = d.requestHeaders ?? [];
    const auth = headers.find((h) => h.name.toLowerCase() === "authorization");
    const entry = {
      requestId: d.requestId,
      t: new Date(d.timeStamp).toISOString(),
      method: d.method,
      url: d.url,
      type: d.type,
      originUrl: d.originUrl ?? null,
      fromProbe: isProbe(d.url) || (d.originUrl ?? "").startsWith("moz-extension:"),
      hasAuth: !!auth,
      authScheme: auth ? auth.value.split(" ")[0] : null,
      authLooksJwt: auth ? /^Bearer eyJ/.test(auth.value) : false,
      headerNames: headers.map((h) => h.name).sort(),
      body: bodies.get(d.requestId) ?? null,
      status: null,
      ms: null,
      error: null,
    };
    bodies.delete(d.requestId);
    entries.push(entry);
    if (entries.length > MAX_LOG) entries.splice(0, entries.length - MAX_LOG);
    flush();

    // Keep the newest replayable header set from Moxfield's own (non-probe) traffic.
    if (auth && !entry.fromProbe) {
      const replayable = headers.filter((h) => !FORBIDDEN.test(h.name)).map((h) => [h.name, h.value]);
      await browser.storage.session.set({ authHeaders: { headers: replayable, capturedAt: entry.t } });
    }
  },
  API_FILTER,
  ["requestHeaders"]
);

async function finish(d, patch) {
  const entries = await getLog();
  const e = entries.findLast((x) => x.requestId === d.requestId);
  if (e) {
    Object.assign(e, patch);
    const t0 = started.get(d.requestId);
    if (t0) e.ms = Math.round(d.timeStamp - t0);
    flush();
  }
  started.delete(d.requestId);
}

// Discovery: also record XHR/fetch/websocket/beacon traffic from moxfield.com pages to any *other* host,
// in case search sessions are set up somewhere other than api2.
const OTHER_TYPES = new Set(["xmlhttprequest", "websocket", "ping", "beacon", "other"]);
const tracked = new Set();

browser.webRequest.onBeforeRequest.addListener(
  async (d) => {
    if (new URL(d.url).host === "api2.moxfield.com" || !OTHER_TYPES.has(d.type)) return;
    const doc = d.documentUrl ?? d.originUrl ?? "";
    if (!/^https:\/\/(www\.)?moxfield\.com\//.test(doc)) return;
    const entries = await getLog();
    let body = null;
    try {
      if (d.requestBody?.raw?.length) body = d.requestBody.raw.map((p) => new TextDecoder().decode(p.bytes)).join("").slice(0, 2000);
      else if (d.requestBody?.formData) body = JSON.stringify(d.requestBody.formData).slice(0, 2000);
    } catch {}
    tracked.add(d.requestId);
    started.set(d.requestId, d.timeStamp);
    entries.push({
      requestId: d.requestId, t: new Date(d.timeStamp).toISOString(), method: d.method, url: d.url, type: d.type,
      originUrl: doc, fromProbe: false, otherHost: true, hasAuth: false, authScheme: null, authLooksJwt: false,
      headerNames: [], body, status: null, ms: null, error: null,
    });
    if (entries.length > MAX_LOG) entries.splice(0, entries.length - MAX_LOG);
    flush();
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

const isApi = (d) => new URL(d.url).host === "api2.moxfield.com";
browser.webRequest.onCompleted.addListener(
  (d) => (isApi(d) || tracked.has(d.requestId)) && finish(d, { status: d.statusCode }),
  { urls: ["<all_urls>"] }
);
browser.webRequest.onErrorOccurred.addListener(
  (d) => (isApi(d) || tracked.has(d.requestId)) && finish(d, { error: d.error }),
  { urls: ["<all_urls>"] }
);

browser.runtime.onMessage.addListener(async (msg, sender) => {
  switch (msg.type) {
    case "log:get":
      return getLog();
    case "log:clear":
      log = [];
      await browser.storage.session.set({ log });
      return true;
    case "auth:get":
      return (await browser.storage.session.get("authHeaders")).authHeaders ?? null;
    case "probe:mark":
      probeUrls.set(msg.url, Date.now() + 60_000);
      return true;
    case "open":
      await openProbe(msg.deckId);
      return true;
  }
});

async function openProbe(deckId) {
  const url = browser.runtime.getURL("probe.html") + (deckId ? `?deck=${encodeURIComponent(deckId)}` : "");
  await browser.tabs.create({ url });
}

browser.action.onClicked.addListener(() => openProbe());
