const $ = (id) => document.getElementById(id);
const MOX_TABS = ["https://moxfield.com/*", "https://www.moxfield.com/*"];
const HOSTS = { origins: ["https://moxfield.com/*", "https://www.moxfield.com/*", "https://api2.moxfield.com/*", "<all_urls>"] };

// Request contexts under test. "auth" = replay captured headers incl. Authorization,
// "cookie" = captured headers minus Authorization (cookies only), "anon" = nothing.
const CONTEXTS = {
  "ext-auth":    { where: "ext",  headers: "auth",   credentials: "include" },
  "ext-cookie":  { where: "ext",  headers: "cookie", credentials: "include" },
  "ext-anon":    { where: "ext",  headers: "none",   credentials: "omit" },
  "cs-auth":     { where: "cs",   headers: "auth" },
  "page-auth":   { where: "page", headers: "auth" },
  "page-cookie": { where: "page", headers: "cookie" },
};

const report = { generatedAt: null, env: null, permissions: null, auth: null, endpoints: [], storage: null, replays: [], deck: null, batch: [], rate: null };
const fixtures = {}; // label -> raw response text
let deckCards = [];

// ---------- helpers ----------

const SENSITIVE = /token|auth(?!or)|email|password|secret|cookie|session/i;
const ID_KEY = /^[A-Za-z0-9_-]{8,}$/;

function schema(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? [schema(v[0], depth + 1), `…len=${v.length}`] : ["(empty)"];
  if (typeof v === "object") {
    if (depth > 9) return "{…}";
    const keys = Object.keys(v);
    // Collapse id-keyed maps (e.g. boards.mainboard.cards) to one representative entry.
    if (keys.length >= 3 && keys.every((k) => ID_KEY.test(k) && /\d/.test(k))) {
      return { "{id}": schema(v[keys[0]], depth + 1), "(entries)": keys.length };
    }
    const out = {};
    for (const k of keys) out[k] = SENSITIVE.test(k) ? "[redacted]" : schema(v[k], depth + 1);
    return out;
  }
  if (typeof v === "string") return `string ${JSON.stringify(v.length > 40 ? v.slice(0, 40) + "…" : v)}`;
  return `${typeof v} ${v}`;
}

function pattern(u) {
  try {
    const url = new URL(u);
    const path = url.pathname
      .split("/")
      .map((s) =>
        /^\d+$/.test(s) || /^[0-9a-f-]{32,36}$/i.test(s) || (s.length >= 10 && /\d/.test(s) && /[A-Za-z]/.test(s) && /^[A-Za-z0-9_-]+$/.test(s))
          ? "{id}"
          : s
      )
      .join("/");
    return url.host + path;
  } catch {
    return u;
  }
}

function summarize(json) {
  if (!json || typeof json !== "object") return {};
  const s = {};
  for (const k of ["totalResults", "totalPages", "pageNumber", "pageSize", "name", "visibility", "folder", "publicId"]) {
    if (k in json && typeof json[k] !== "object") s[k] = json[k];
  }
  if (Array.isArray(json.data)) s.dataLength = json.data.length;
  if (Array.isArray(json)) s.arrayLength = json.length;
  if (json.boards) s.boards = Object.fromEntries(Object.entries(json.boards).map(([b, v]) => [b, v?.count ?? null]));
  return s;
}

const tryJson = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
const cfBlocked = (r) => r.status === 403 && /text\/html/.test(r.contentType ?? "");

async function authHeaders() {
  return browser.runtime.sendMessage({ type: "auth:get" });
}

async function moxTabId() {
  const tabs = await browser.tabs.query({ url: MOX_TABS });
  if (!tabs.length) throw new Error("no moxfield.com tab open");
  // Prefer a collection page, then the most recently used tab.
  tabs.sort((a, b) => (/\/collection/.test(b.url) - /\/collection/.test(a.url)) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return tabs[0].id;
}

async function csSend(msg) {
  const tabId = await moxTabId();
  try {
    return await browser.tabs.sendMessage(tabId, msg);
  } catch {
    await browser.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return browser.tabs.sendMessage(tabId, msg);
  }
}

async function request(ctxName, { url, method = "GET", body = null }) {
  const ctx = CONTEXTS[ctxName];
  const captured = (await authHeaders())?.headers ?? [];
  let headers = {};
  if (ctx.headers === "auth") headers = Object.fromEntries(captured);
  if (ctx.headers === "cookie") headers = Object.fromEntries(captured.filter(([n]) => n.toLowerCase() !== "authorization"));
  if (method === "GET") {
    for (const k of Object.keys(headers)) if (k.toLowerCase() === "content-type") delete headers[k];
  }
  await browser.runtime.sendMessage({ type: "probe:mark", url });

  let r;
  if (ctx.where === "ext") {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { method, headers, credentials: ctx.credentials, body: method === "GET" ? undefined : body });
      const text = await res.text();
      r = { status: res.status, ms: Math.round(performance.now() - t0), bytes: text.length, contentType: res.headers.get("content-type"), text };
    } catch (e) {
      r = { status: null, ms: Math.round(performance.now() - t0), error: String(e) };
    }
  } else {
    try {
      r = await csSend({ type: "cs:fetch", url, method, headers, body, ctx: ctx.where });
    } catch (e) {
      r = { status: null, error: String(e) };
    }
  }
  r.json = r.text ? tryJson(r.text) : undefined;
  r.cf = cfBlocked(r);
  return r;
}

function statusCell(r) {
  if (r.error) return `<span class="bad">ERR ${escape(r.error)}</span>`;
  const cls = r.status >= 200 && r.status < 300 ? "ok" : "bad";
  return `<span class="${cls}">${r.status}${r.cf ? " (Cloudflare)" : ""}</span>`;
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// ---------- 0: setup ----------

async function setup() {
  const [info, plat] = await Promise.all([browser.runtime.getBrowserInfo(), browser.runtime.getPlatformInfo()]);
  report.env = { browser: `${info.name} ${info.version}`, os: plat.os, arch: plat.arch };
  $("env").textContent = `${report.env.browser} on ${plat.os}/${plat.arch}`;
  await refreshPerms();
  await refreshAuth();
}

async function refreshPerms() {
  const has = await browser.permissions.contains(HOSTS);
  report.permissions = { hostPermissionsGranted: has };
  $("perm").innerHTML = has ? `<span class="ok">Host permissions granted</span>` : `<span class="bad">Host permissions NOT granted. Click the button.</span>`;
  $("grant").hidden = has;
}

async function refreshAuth() {
  const a = await authHeaders();
  report.auth = a ? { captured: true, capturedAt: a.capturedAt, headerNames: a.headers.map(([n]) => n) } : { captured: false };
  $("auth").innerHTML = a
    ? `<span class="ok">Captured Moxfield's request headers</span> <span class="muted">(${a.capturedAt}): ${a.headers.map(([n]) => escape(n)).join(", ")}</span>`
    : `<span class="warn">No Authorization header seen yet. Browse Moxfield while logged in (step 1).</span>`;
}

$("grant").onclick = async () => {
  await browser.permissions.request(HOSTS);
  refreshPerms();
};

// ---------- 1: traffic ----------

async function refreshTraffic() {
  const log = await browser.runtime.sendMessage({ type: "log:get" });
  const site = log.filter((e) => !e.fromProbe);
  $("logcount").textContent = `${site.length} site requests recorded (${log.length - site.length} from probe)`;

  const groups = new Map();
  for (const e of site) {
    const key = `${e.method} ${pattern(e.url)}`;
    const g = groups.get(key) ?? { method: e.method, pattern: pattern(e.url), count: 0, statuses: new Set(), auth: new Set(), params: new Set(), headerNames: new Set(), bodies: [], example: null };
    g.count++;
    g.statuses.add(e.error ?? e.status);
    g.auth.add(e.hasAuth ? (e.authLooksJwt ? "Bearer JWT" : e.authScheme) : "none");
    for (const k of new URL(e.url).searchParams.keys()) g.params.add(k);
    e.headerNames.forEach((h) => g.headerNames.add(h));
    if (e.body && g.bodies.length < 2) g.bodies.push(e.body.slice(0, 500));
    g.example = e;
    groups.set(key, g);
  }

  report.endpoints = [...groups.values()].map((g) => ({
    method: g.method,
    pattern: g.pattern,
    count: g.count,
    statuses: [...g.statuses],
    auth: [...g.auth],
    queryParams: [...g.params],
    headerNames: [...g.headerNames],
    exampleUrl: g.example.url,
    bodySamples: g.bodies,
  }));

  const rows = report.endpoints
    .map(
      (g, i) => `<tr><td>${g.method}</td><td class="url">${escape(g.pattern)}<div class="muted">${escape(g.queryParams.join(", "))}</div></td>
      <td>${g.count}</td><td>${escape(g.statuses.join(", "))}</td><td>${escape(g.auth.join(", "))}</td><td><button data-i="${i}">Load</button></td></tr>`
    )
    .join("");
  $("endpoints").innerHTML = `<tr><th>Method</th><th>Endpoint (params)</th><th>#</th><th>Status</th><th>Auth</th><th></th></tr>${rows}`;
  $("endpoints").querySelectorAll("button[data-i]").forEach((b) => {
    b.onclick = () => {
      const g = report.endpoints[+b.dataset.i];
      $("method").value = g.method;
      $("url").value = g.exampleUrl;
      $("body").value = groups.get(`${g.method} ${g.pattern}`).example.body ?? "";
      $("url").scrollIntoView({ behavior: "smooth", block: "center" });
    };
  });
  await refreshAuth();
}

$("refresh").onclick = refreshTraffic;
$("clear").onclick = async () => {
  await browser.runtime.sendMessage({ type: "log:clear" });
  refreshTraffic();
};

// ---------- 2: storage ----------

$("storage").onclick = async () => {
  try {
    report.storage = await csSend({ type: "cs:storage" });
  } catch (e) {
    report.storage = { error: String(e) };
  }
  $("storageOut").hidden = false;
  $("storageOut").textContent = JSON.stringify(report.storage, null, 2);
};

// ---------- 3: replay ----------

for (const name of Object.keys(CONTEXTS)) {
  $("ctxs").insertAdjacentHTML("beforeend", `<label class="chk"><input type="checkbox" value="${name}" checked>${name}</label>`);
  $("batchCtx").insertAdjacentHTML("beforeend", `<option>${name}</option>`);
}

$("replay").onclick = async () => {
  const req = { url: $("url").value.trim(), method: $("method").value, body: $("body").value || null };
  if (!req.url) return;
  const ctxs = [...$("ctxs").querySelectorAll("input:checked")].map((c) => c.value);
  $("replayOut").innerHTML = `<tr><th>Context</th><th>Status</th><th>ms</th><th>Bytes</th><th>Summary</th></tr>`;
  let firstGood = null;
  for (const ctx of ctxs) {
    const r = await request(ctx, req);
    const sum = summarize(r.json);
    const row = { context: ctx, method: req.method, pattern: pattern(req.url), url: req.url, status: r.status, cf: r.cf, ms: r.ms, bytes: r.bytes, error: r.error, summary: sum };
    report.replays.push(row);
    if (r.text) fixtures[`replay ${ctx} ${req.method} ${req.url}`] = r.text;
    if (!firstGood && r.json !== undefined && r.status < 300) firstGood = { r, row };
    $("replayOut").insertAdjacentHTML(
      "beforeend",
      `<tr><td>${ctx}</td><td>${statusCell(r)}</td><td>${r.ms ?? ""}</td><td>${r.bytes ?? ""}</td><td><code>${escape(JSON.stringify(sum))}</code></td></tr>`
    );
  }
  if (firstGood) {
    const sch = schema(firstGood.r.json);
    firstGood.row.schema = sch;
    $("replaySchema").hidden = false;
    $("replaySchema").textContent = JSON.stringify(sch, null, 2);
  }
};

// ---------- 4: deck ----------

function extractCards(deck) {
  const cards = [];
  for (const [board, b] of Object.entries(deck.boards ?? {})) {
    for (const entry of Object.values(b?.cards ?? {})) {
      const c = entry.card ?? {};
      cards.push({ board, quantity: entry.quantity, finish: entry.finish, name: c.name, set: c.set, cn: c.cn, scryfall_id: c.scryfall_id, lang: c.lang });
    }
  }
  return cards;
}

$("deck").onclick = async () => {
  const id = $("deckId").value.trim();
  if (!id) return;
  const url = `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(id)}`;
  const attempts = [];
  let deck = null;
  for (const ctx of ["ext-auth", "ext-cookie", "ext-anon", "page-auth"]) {
    const r = await request(ctx, { url });
    attempts.push({ context: ctx, status: r.status, cf: r.cf, ms: r.ms, error: r.error });
    if (!deck && r.status === 200 && r.json) {
      deck = r.json;
      fixtures[`deck ${id}`] = r.text;
    }
  }
  if (deck) {
    deckCards = extractCards(deck);
    const fields = ["name", "set", "cn", "scryfall_id", "finish", "lang"];
    report.deck = {
      attempts,
      summary: summarize(deck),
      topLevelKeys: Object.keys(deck),
      cardCount: deckCards.length,
      printingFieldCoverage: Object.fromEntries(fields.map((f) => [f, deckCards.filter((c) => c[f] != null).length])),
      sampleCards: deckCards.slice(0, 3),
      cardEntrySchema: schema(Object.values(Object.values(deck.boards ?? {}).find((b) => b?.count)?.cards ?? {})[0] ?? null),
    };
  } else {
    report.deck = { attempts, error: "no context returned the deck" };
  }
  $("deckOut").hidden = false;
  $("deckOut").textContent = JSON.stringify(report.deck, null, 2);
};

// ---------- 5: batch + rate ----------

function templated(names) {
  const q = names.map((n) => `!"${n.replace(/"/g, '\\"')}"`).join(" or ");
  const url = $("url").value.trim();
  const body = $("body").value;
  if (!url.includes("{{Q}}") && !body.includes("{{Q}}")) throw new Error("Put {{Q}} in the URL or body in section 3 first");
  return {
    method: $("method").value,
    url: url.replace("{{Q}}", encodeURIComponent(q)),
    body: body ? body.replace("{{Q}}", JSON.stringify(q).slice(1, -1)) : null,
    q,
  };
}

function namesFound(json) {
  const items = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return new Set(items.map((i) => (i.card?.name ?? i.name ?? "").toLowerCase()).filter(Boolean));
}

// Exact match, or match on either face of a double-faced card ("Front // Back").
function nameMatched(found, name) {
  const n = name.toLowerCase();
  if (found.has(n)) return true;
  const front = n.split(" // ")[0];
  return [...found].some((f) => f === front || f.startsWith(n + " //") || f.split(" // ")[0] === front);
}

$("batch").onclick = async () => {
  const names = [...new Set(deckCards.filter((c) => c.board !== "maybeboard" && c.board !== "tokens").map((c) => c.name).filter(Boolean))];
  if (!names.length) return alert("Fetch a deck first (section 4).");
  const ctx = $("batchCtx").value;
  $("batchOut").innerHTML = `<tr><th>Names</th><th>Status</th><th>ms</th><th>URL len</th><th>Summary</th><th>Names found</th></tr>`;
  report.batch = [];
  for (const n of [1, 10, 25, 50, names.length]) {
    if (n > names.length && n !== names.length) continue;
    const slice = names.slice(0, n);
    let req;
    try { req = templated(slice); } catch (e) { return alert(e.message); }
    const r = await request(ctx, req);
    const found = namesFound(r.json);
    const matched = slice.filter((x) => nameMatched(found, x));
    const row = { context: ctx, names: n, status: r.status, cf: r.cf, ms: r.ms, urlLength: req.url.length, queryLength: req.q.length, summary: summarize(r.json), distinctNamesReturned: found.size, requestedNamesMatched: matched.length, error: r.error };
    report.batch.push(row);
    if (r.text) fixtures[`batch ${n}`] = r.text;
    $("batchOut").insertAdjacentHTML(
      "beforeend",
      `<tr><td>${n}</td><td>${statusCell(r)}</td><td>${r.ms ?? ""}</td><td>${req.url.length}</td><td><code>${escape(JSON.stringify(row.summary))}</code></td><td>${matched.length}/${n}</td></tr>`
    );
    if (n === names.length) break;
  }
};

$("rate").onclick = async () => {
  const names = [...new Set(deckCards.map((c) => c.name).filter(Boolean))].slice(0, 30);
  if (!names.length) return alert("Fetch a deck first (section 4).");
  const ctx = $("batchCtx").value;
  const statuses = {};
  const times = [];
  const t0 = performance.now();
  for (const [i, n] of names.entries()) {
    let req;
    try { req = templated([n]); } catch (e) { return alert(e.message); }
    const r = await request(ctx, req);
    const key = r.error ? "error" : r.cf ? `${r.status}-cf` : r.status;
    statuses[key] = (statuses[key] ?? 0) + 1;
    times.push(r.ms ?? 0);
    $("rateOut").textContent = `${i + 1}/${names.length} ${JSON.stringify(statuses)}`;
    if (r.status === 429 || r.cf) break;
  }
  report.rate = {
    context: ctx,
    requests: times.length,
    statuses,
    avgMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    maxMs: Math.max(...times),
    wallMs: Math.round(performance.now() - t0),
  };
  $("rateOut").textContent = JSON.stringify(report.rate);
};

// ---------- ★: automated run ----------

// Only these boards are physically in a built deck; sideboard and maybeboard ("Considering") are not.
const PICK_BOARDS = new Set(["mainboard", "commanders", "companions"]);
const orQuery = (names) => names.map((n) => `!"${n.replace(/"/g, '\\"')}"`).join(" or ");

function searchUrl(base, params) {
  const u = new URL(base);
  u.searchParams.delete("searchSessionId");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

// Claim names and lifetime only; never the token or claim values.
function jwtInfo(headers) {
  const v = headers?.find(([n]) => n.toLowerCase() === "authorization")?.[1];
  if (!v) return { present: false };
  try {
    const p = JSON.parse(atob(v.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return {
      present: true,
      claimNames: Object.keys(p),
      lifetimeSec: p.exp && p.iat ? p.exp - p.iat : null,
      secondsUntilExpiry: p.exp ? Math.round(p.exp - Date.now() / 1000) : null,
    };
  } catch (e) {
    return { present: true, decodeError: String(e) };
  }
}

$("auto").onclick = async () => {
  const out = (msg) => ($("autoLog").textContent += msg + "\n");
  $("autoLog").textContent = "";
  $("autoLog").hidden = false;
  const auto = (report.auto = {});
  try {
    const log = await browser.runtime.sendMessage({ type: "log:get" });
    const site = log.filter((e) => !e.fromProbe && e.method === "GET" && e.status === 200);
    const last = (re) => site.findLast((e) => re.test(new URL(e.url).pathname))?.url;
    const searchBase = last(/^\/v1\/collections\/search$/);
    const typedId = $("deckId").value.trim();
    const deckUrl = typedId ? `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(typedId)}` : last(/^\/v3\/decks\/all\/[^/]+$/);
    const decksUrl = last(/^\/v3\/decks$/);
    const foldersUrl = last(/^\/v1\/deck-folders$/);
    if (!searchBase || !deckUrl) throw new Error("Need a recorded collection search and a deck (or a deck id in section 4). Do step 1 first.");

    auto.jwt = jwtInfo((await authHeaders())?.headers);
    out(`JWT: ${JSON.stringify(auto.jwt)}`);

    // Which request contexts work for each kind of call?
    auto.matrix = {};
    const probes = { search: searchUrl(searchBase, { q: "", pageSize: "1", pageNumber: "1" }), deck: deckUrl, decksList: decksUrl };
    for (const [label, url] of Object.entries(probes)) {
      if (!url) continue;
      auto.matrix[label] = {};
      for (const c of Object.keys(CONTEXTS)) {
        const r = await request(c, { url });
        auto.matrix[label][c] = r.error ? `ERR ${r.error}` : `${r.status}${r.cf ? " cloudflare" : ""}`;
      }
      out(`${label}: ${JSON.stringify(auto.matrix[label])}`);
    }
    const ok = (v) => /^2\d\d$/.test(v ?? "");
    const ctx = ["ext-auth", "ext-cookie", "cs-auth", "page-auth", "page-cookie", "ext-anon"].find(
      (c) => ok(auto.matrix.search[c]) && ok(auto.matrix.deck[c])
    );
    auto.bestContext = ctx ?? null;
    if (!ctx) throw new Error("No context could read both collection search and the deck");
    out(`Using context: ${ctx}`);
    const get = async (url, label) => {
      const r = await request(ctx, { url });
      if (r.text && label) fixtures[label] = r.text;
      return r;
    };

    // Deck printing data.
    const deck = (await get(deckUrl, "deck")).json;
    deckCards = extractCards(deck);
    const fields = ["name", "set", "cn", "scryfall_id", "finish", "lang"];
    auto.deck = {
      ids: { id: deck.id ?? null, publicId: deck.publicId ?? null },
      summary: summarize(deck),
      topLevelKeys: Object.keys(deck),
      boards: [...new Set(deckCards.map((c) => c.board))],
      cardCount: deckCards.length,
      printingFieldCoverage: Object.fromEntries(fields.map((f) => [f, deckCards.filter((c) => c[f] != null).length])),
      sampleCards: deckCards.slice(0, 3),
      cardEntrySchema: schema(Object.values(Object.values(deck.boards ?? {}).find((b) => b?.count)?.cards ?? {})[0] ?? null),
    };
    out(`Deck: ${auto.deck.cardCount} entries, printing coverage ${JSON.stringify(auto.deck.printingFieldCoverage)}`);
    let pick = deckCards.filter((c) => PICK_BOARDS.has(c.board));
    if (!pick.length) pick = deckCards.filter((c) => c.board !== "maybeboard");
    const names = [...new Set(pick.map((c) => c.name).filter(Boolean))];

    // Page-size cap, collection size, and collection entry shape.
    const big = await get(searchUrl(searchBase, { q: "", pageSize: "1000", pageNumber: "1" }));
    auto.pageSizeProbe = {
      requested: 1000, status: big.status, returned: big.json?.data?.length ?? null,
      totalResults: big.json?.totalResults ?? null, totalPages: big.json?.totalPages ?? null, ms: big.ms, bytes: big.bytes,
    };
    auto.collectionResponseSchema = schema(big.json ? { ...big.json, data: big.json.data?.slice(0, 1) } : null);
    out(`Page size probe: ${JSON.stringify(auto.pageSizeProbe)}`);

    // Does the deckId filter return the collection entries for a deck's cards?
    auto.deckIdFilter = [];
    for (const [kind, id] of Object.entries(auto.deck.ids)) {
      if (!id) continue;
      const r = await get(searchUrl(searchBase, { q: "", deckId: id, pageSize: "1000", pageNumber: "1" }), `collection deckId=${kind}`);
      const found = namesFound(r.json);
      const row = {
        idKind: kind, status: r.status, ms: r.ms, totalResults: r.json?.totalResults ?? null, totalPages: r.json?.totalPages ?? null,
        distinctNamesReturned: found.size, deckNamesMatched: names.filter((n) => nameMatched(found, n)).length, deckNames: names.length,
      };
      auto.deckIdFilter.push(row);
      out(`deckId filter (${kind}): ${JSON.stringify(row)}`);
    }

    // Batched OR'd exact-name lookups.
    auto.batch = [];
    for (const n of [...new Set([10, 25, 50, names.length].map((x) => Math.min(x, names.length)))]) {
      const slice = names.slice(0, n);
      const url = searchUrl(searchBase, { q: orQuery(slice), pageSize: "1000", pageNumber: "1" });
      const r = await get(url, `batch ${n}`);
      const found = namesFound(r.json);
      const unmatched = slice.filter((x) => !nameMatched(found, x));
      const row = {
        names: n, status: r.status, cf: r.cf, ms: r.ms, urlLength: url.length, totalResults: r.json?.totalResults ?? null,
        totalPages: r.json?.totalPages ?? null, matched: n - unmatched.length,
        unmatchedSample: n === names.length ? unmatched.slice(0, 25) : undefined,
      };
      auto.batch.push(row);
      out(`batch ${n}: ${JSON.stringify(row)}`);
    }

    // Rate test: sequential single-card lookups.
    const statuses = {};
    const times = [];
    const t0 = performance.now();
    for (const n of names.slice(0, 30)) {
      const r = await get(searchUrl(searchBase, { q: orQuery([n]), pageSize: "100", pageNumber: "1" }));
      const key = r.error ? "error" : r.cf ? `${r.status}-cf` : r.status;
      statuses[key] = (statuses[key] ?? 0) + 1;
      times.push(r.ms ?? 0);
      if (r.status === 429 || r.cf) break;
    }
    auto.rate = {
      requests: times.length, statuses, avgMs: Math.round(times.reduce((a, b) => a + b, 0) / (times.length || 1)),
      maxMs: Math.max(0, ...times), wallMs: Math.round(performance.now() - t0),
    };
    out(`rate: ${JSON.stringify(auto.rate)}`);

    // Decks list and folders: what identifies a "built" deck?
    for (const [label, url] of [["decksList", decksUrl], ["folders", foldersUrl]]) {
      if (!url) continue;
      const r = await get(url, label);
      auto[label] = { status: r.status, summary: summarize(r.json), schema: schema(r.json) };
      out(`${label}: ${r.status} ${JSON.stringify(auto[label].summary)}`);
    }
    out("Done. Copy the report in section 6.");
  } catch (e) {
    auto.error = String(e);
    out(`ERROR: ${e}`);
  }
};

const esc = (n) => n.replace(/"/g, '\\"');

async function pool(items, size, fn) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const k = next++;
        results[k] = await fn(items[k]);
      }
    })
  );
  return results;
}

$("lookup").onclick = async () => {
  const out = (msg) => ($("lookupLog").textContent += msg + "\n");
  $("lookupLog").textContent = "";
  $("lookupLog").hidden = false;
  const lk = (report.lookup = {});
  try {
    const log = await browser.runtime.sendMessage({ type: "log:get" });
    const searchBase = log
      .filter((e) => !e.fromProbe && e.method === "GET" && e.status === 200)
      .findLast((e) => /^\/v1\/collections\/search$/.test(new URL(e.url).pathname))?.url;
    if (!searchBase) throw new Error("No recorded collection search. Do step 1 first.");
    if (!deckCards.length) throw new Error("Run the automated tests first (they load the deck).");
    const names = [...new Set(deckCards.filter((c) => PICK_BOARDS.has(c.board)).map((c) => c.name))].slice(0, 20);
    const run = async (q) => {
      const url = searchUrl(searchBase, { q, pageSize: "1000", pageNumber: "1" });
      const r = await request("ext-auth", { url });
      return { status: r.status, ms: r.ms, totalResults: r.json?.totalResults ?? null, found: namesFound(r.json) };
    };

    // 1. Single exact-name lookups: which names does `!"Name"` find at all?
    const singles = [];
    for (const n of names) {
      const r = await run(`!"${esc(n)}"`);
      singles.push({ name: n, status: r.status, totalResults: r.totalResults, matched: nameMatched(r.found, n) });
    }
    lk.singles = { tested: names.length, matched: singles.filter((s) => s.matched).length, misses: singles.filter((s) => !s.matched) };
    out(`singles: ${lk.singles.matched}/${lk.singles.tested} matched; misses: ${JSON.stringify(lk.singles.misses)}`);

    // 2. OR syntaxes, using only names known to be owned (from step 1).
    const owned = singles.filter((s) => s.matched).map((s) => s.name);
    const variants = {
      '!"A" or !"B"': (ns) => ns.map((n) => `!"${esc(n)}"`).join(" or "),
      '(!"A" or !"B")': (ns) => `(${ns.map((n) => `!"${esc(n)}"`).join(" or ")})`,
      '!"A" OR !"B"': (ns) => ns.map((n) => `!"${esc(n)}"`).join(" OR "),
      'name:"A" or name:"B"': (ns) => ns.map((n) => `name:"${esc(n)}"`).join(" or "),
      '"A" or "B"': (ns) => ns.map((n) => `"${esc(n)}"`).join(" or "),
      '(!"A") or (!"B")': (ns) => ns.map((n) => `(!"${esc(n)}")`).join(" or "),
    };
    lk.variants = [];
    const sizes = [...new Set([2, 5, owned.length].map((x) => Math.min(x, owned.length)))].filter((x) => x >= 2);
    for (const size of sizes) {
      const slice = owned.slice(0, size);
      for (const [label, build] of Object.entries(variants)) {
        const r = await run(build(slice));
        const row = { variant: label, size, status: r.status, totalResults: r.totalResults, matched: slice.filter((n) => nameMatched(r.found, n)).length, ms: r.ms };
        lk.variants.push(row);
        out(`${label} ×${size}: ${row.status} matched ${row.matched}/${size}, results ${row.totalResults}`);
      }
    }

    // 3. Concurrency: the same single lookups, 6 at a time.
    const t0 = performance.now();
    const conc = await pool(names, 6, (n) => run(`!"${esc(n)}"`));
    const statuses = {};
    for (const r of conc) statuses[r.status ?? "error"] = (statuses[r.status ?? "error"] ?? 0) + 1;
    lk.concurrency = { parallel: 6, requests: names.length, statuses, wallMs: Math.round(performance.now() - t0) };
    out(`concurrency: ${JSON.stringify(lk.concurrency)}`);
    out("Done. Copy the report in section 6.");
  } catch (e) {
    lk.error = String(e);
    out(`ERROR: ${e}`);
  }
};

$("diag").onclick = async () => {
  const out = (msg) => ($("diagLog").textContent += msg + "\n");
  $("diagLog").textContent = "";
  $("diagLog").hidden = false;
  const d = (report.searchDiag = { variants: [] });
  try {
    const log = await browser.runtime.sendMessage({ type: "log:get" });
    const rec = log
      .filter((e) => !e.fromProbe && e.method === "GET" && e.status === 200 && /\/v1\/collections\/search$/.test(new URL(e.url).pathname))
      .findLast((e) => new URL(e.url).searchParams.get("q")?.trim());
    if (!rec) throw new Error('Search your collection in Moxfield (e.g. !"Evolving Wilds"), then click Refresh in step 1.');
    const ui = rec.url;
    const uiQ = new URL(ui).searchParams.get("q");
    d.uiQuery = uiQ;
    d.uiUrl = ui;

    // Raw string edits keep the site's exact encoding; URLSearchParams edits re-encode everything.
    const rawSet = (url, k, v) => url.replace(new RegExp(`([?&]${k}=)[^&]*`), `$1${v}`);
    const rawNoSession = ui.replace(/([?&])searchSessionId=[^&]*&?/, "$1");
    const reserialized = (() => { const u = new URL(ui); u.searchParams.set("q", uiQ); return u.toString(); })();
    const variants = [
      ["A  site URL, exact", ui, "ext-auth"],
      ["A' site URL, exact, from content script", ui, "cs-auth"],
      ["B  A minus searchSessionId (raw)", rawNoSession, "ext-auth"],
      ["C  B + pageSize=100 (raw)", rawSet(rawNoSession, "pageSize", "100"), "ext-auth"],
      ["D  B + pageSize=1000 (raw)", rawSet(rawNoSession, "pageSize", "1000"), "ext-auth"],
      ["E  A re-encoded via URLSearchParams", reserialized, "ext-auth"],
      ["F  probe-style: no session, q trimmed, pageSize=1000", searchUrl(ui, { q: uiQ.trim(), pageSize: "1000", pageNumber: "1" }), "ext-auth"],
      ["G  F with pageSize=50", searchUrl(ui, { q: uiQ.trim(), pageSize: "50", pageNumber: "1" }), "ext-auth"],
      ["H  F with q untrimmed", searchUrl(ui, { q: uiQ, pageSize: "1000", pageNumber: "1" }), "ext-auth"],
      ["J  A again (repeatability)", ui, "ext-auth"],
    ];
    for (const [label, url, ctx] of variants) {
      const r = await request(ctx, { url });
      const row = { label, context: ctx, status: r.status, totalResults: r.json?.totalResults ?? null, dataLength: r.json?.data?.length ?? null, ms: r.ms, url };
      d.variants.push(row);
      out(`${label}: ${r.status} total=${row.totalResults} rows=${row.dataLength}`);
    }
    out("Done. Copy the report in section 6.");
  } catch (e) {
    d.error = String(e);
    out(`ERROR: ${e}`);
  }
};

// 16 random bytes as unpadded base64url (22 chars), the same shape as the site's searchSessionId.
function randomSessionId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

$("session").onclick = async () => {
  const out = (msg) => ($("sessionLog").textContent += msg + "\n");
  $("sessionLog").textContent = "";
  $("sessionLog").hidden = false;
  const st = (report.sessionTest = { runs: [] });
  try {
    const log = await browser.runtime.sendMessage({ type: "log:get" });
    const site = log.filter((e) => !e.fromProbe && e.method === "GET" && e.status === 200);
    const searches = site.filter((e) => /\/v1\/collections\/search$/.test(new URL(e.url).pathname));
    const base = searches.at(-1)?.url;
    const siteSession = searches.map((e) => new URL(e.url).searchParams.get("searchSessionId")).filter(Boolean).at(-1);
    if (!base) throw new Error("No recorded collection search. Do step 1 first.");

    if (!deckCards.length) {
      const typed = $("deckId").value.trim();
      const deckUrl = typed
        ? `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(typed)}`
        : site.findLast((e) => /^\/v3\/decks\/all\/[^/]+$/.test(new URL(e.url).pathname))?.url;
      if (!deckUrl) throw new Error("No deck. Open a deck in Moxfield (then Refresh) or enter a deck id in section 4.");
      const r = await request("ext-auth", { url: deckUrl });
      if (r.status !== 200) throw new Error(`Deck fetch failed: ${r.status}`);
      deckCards = extractCards(r.json);
      st.deckName = r.json.name;
    }
    const names = [...new Set(deckCards.filter((c) => PICK_BOARDS.has(c.board)).map((c) => c.name).filter(Boolean))];
    st.deckNames = names.length;
    st.siteSessionRecorded = !!siteSession;

    const run = async (label, session, q) => {
      const params = { q, pageSize: "1000", pageNumber: "1" };
      const u = new URL(searchUrl(base, params));
      if (session) u.searchParams.set("searchSessionId", session);
      const r = await request("ext-auth", { url: u.toString() });
      const found = namesFound(r.json);
      const asked = q === "" ? [] : names.filter((n) => q.includes(`"${esc(n)}"`));
      const row = {
        label, status: r.status, ms: r.ms, totalResults: r.json?.totalResults ?? null, totalPages: r.json?.totalPages ?? null,
        namesAsked: asked.length, namesMatched: asked.filter((n) => nameMatched(found, n)).length,
        unmatched: asked.filter((n) => !nameMatched(found, n)).slice(0, 15),
      };
      st.runs.push(row);
      out(`${label}: ${row.status} total=${row.totalResults} matched ${row.namesMatched}/${row.namesAsked} (${row.ms} ms)`);
      return row;
    };

    const all = orQuery(names);
    const ew = '!"Evolving Wilds"';
    const s1 = randomSessionId();
    const s2 = randomSessionId();
    await run("1 random session S1: Evolving Wilds", s1, ew);
    await run("2 S1 reused: whole deck OR", s1, all);
    await run("3 S1 reused: Evolving Wilds again", s1, ew);
    await run("4 fresh random S2: whole deck OR first", s2, all);
    if (siteSession) await run("5 site's session: whole deck OR", siteSession, all);
    await run("6 no session: whole deck OR (control)", null, all);
    await run("7 S1: whole deck OR, trailing space", s1, all + " ");
    out("Done. Copy the report in section 6.");
  } catch (e) {
    st.error = String(e);
    out(`ERROR: ${e}`);
  }
};

$("siteSearch").onclick = async () => {
  const out = (msg) => ($("siteSearchLog").textContent += msg + "\n");
  $("siteSearchLog").textContent = "";
  $("siteSearchLog").hidden = false;
  const ss = (report.siteSearch = {});
  const NEEDLES = ["searchSessionId", "collections/search"];
  const RADIUS = 300;
  try {
    // 1. How does the site's own code build the search request?
    const info = await csSend({ type: "cs:scripts", needles: NEEDLES, radius: RADIUS });
    ss.scriptsScanned = [];
    ss.hits = [...info.inlineHits];
    for (const url of info.urls) {
      try {
        const text = await (await fetch(url)).text();
        ss.scriptsScanned.push({ url, bytes: text.length });
        for (const n of NEEDLES) {
          let i = -1;
          let c = 0;
          while ((i = text.indexOf(n, i + 1)) !== -1 && c++ < 4) {
            ss.hits.push({ url, needle: n, context: text.slice(Math.max(0, i - RADIUS), i + n.length + RADIUS) });
          }
        }
      } catch (e) {
        ss.scriptsScanned.push({ url, error: String(e) });
      }
    }
    out(`scanned ${ss.scriptsScanned.length} scripts, ${ss.hits.length} hits`);

    // 2. Recent traffic from Moxfield pages, all hosts, in order.
    const log = await browser.runtime.sendMessage({ type: "log:get" });
    ss.recentTraffic = log
      .filter((e) => !e.fromProbe && e.method !== "OPTIONS")
      .slice(-60)
      .map((e) => ({ t: e.t, method: e.method, type: e.type, status: e.status ?? e.error, otherHost: !!e.otherHost, url: e.url.slice(0, 400), body: e.body?.slice(0, 400) ?? undefined }));
    out(`recent traffic: ${ss.recentTraffic.length} requests (${ss.recentTraffic.filter((e) => e.otherHost).length} to other hosts)`);

    // 3. New searches from the extension page vs. the content script.
    const base = log
      .filter((e) => !e.fromProbe && e.method === "GET" && e.status === 200)
      .findLast((e) => /\/v1\/collections\/search$/.test(new URL(e.url).pathname))?.url;
    if (!base) throw new Error("No recorded collection search. Search your collection in Moxfield, then Refresh in step 1.");
    ss.freshSearches = [];
    for (const name of ["Hero of Bladehold", "Evolving Wilds", "Sol Ring"]) {
      for (const [ctx, session] of [["ext-auth", null], ["cs-auth", null], ["cs-auth", randomSessionId()], ["ext-auth", randomSessionId()]]) {
        const u = new URL(searchUrl(base, { q: `!"${name}" `, pageSize: "50", pageNumber: "1" }));
        if (session) u.searchParams.set("searchSessionId", session);
        const r = await request(ctx, { url: u.toString() });
        const row = { name, context: ctx, session: !!session, status: r.status, totalResults: r.json?.totalResults ?? null, ms: r.ms, error: r.error };
        ss.freshSearches.push(row);
        out(`${name} via ${ctx}${session ? " + random session" : ""}: ${r.status} total=${row.totalResults}`);
      }
    }
    out("Done. Copy test results (short).");
  } catch (e) {
    ss.error = String(e);
    out(`ERROR: ${e}`);
  }
};

// The server scans the collection in stages: each response may set hasMore and return a server-issued
// searchSessionId. Keep asking (same page while it isn't full, next page once it is) until hasMore is false.
// Rows are collected by entry id, so it doesn't matter whether responses are cumulative or incremental.
async function continuationSearch(base, q, pageSize, maxRequests = 80) {
  const rows = new Map();
  const steps = [];
  let session = null;
  let page = 1;
  const t0 = performance.now();
  for (let n = 0; n < maxRequests; n++) {
    const u = new URL(searchUrl(base, { q, pageSize: String(pageSize), pageNumber: String(page) }));
    if (session) u.searchParams.set("searchSessionId", session);
    const r = await request("ext-auth", { url: u.toString() });
    const j = r.json ?? {};
    const data = Array.isArray(j.data) ? j.data : [];
    for (const row of data) rows.set(row.id ?? JSON.stringify(row).slice(0, 200), row);
    steps.push({ page, status: r.status, ms: r.ms, rows: data.length, hasMore: j.hasMore ?? null, totalResults: j.totalResults ?? null, gotSession: !!j.searchSessionId });
    if (n === 0) steps.topLevelKeys = Object.keys(j);
    if (r.status !== 200) break;
    session = j.searchSessionId ?? session;
    if (!j.hasMore) break;
    if (data.length >= pageSize) page++;
  }
  return { rows: [...rows.values()], steps, wallMs: Math.round(performance.now() - t0) };
}

$("contSearch").onclick = async () => {
  const out = (msg) => ($("contLog").textContent += msg + "\n");
  $("contLog").textContent = "";
  $("contLog").hidden = false;
  const cs = (report.continuation = { runs: [] });
  try {
    const log = await browser.runtime.sendMessage({ type: "log:get" });
    const site = log.filter((e) => !e.fromProbe && e.method === "GET" && e.status === 200);
    const base = site.findLast((e) => /\/v1\/collections\/search$/.test(new URL(e.url).pathname))?.url;
    if (!base) throw new Error("No recorded collection search. Search your collection in Moxfield, then Refresh in step 1.");
    if (!deckCards.length) {
      const typed = $("deckId").value.trim();
      const deckUrl = typed
        ? `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(typed)}`
        : site.findLast((e) => /^\/v3\/decks\/all\/[^/]+$/.test(new URL(e.url).pathname))?.url;
      if (!deckUrl) throw new Error("No deck. Open a deck in Moxfield (then Refresh) or enter a deck id in section 4.");
      const r = await request("ext-auth", { url: deckUrl });
      if (r.status !== 200) throw new Error(`Deck fetch failed: ${r.status}`);
      deckCards = extractCards(r.json);
      cs.deckName = r.json.name;
    }
    const names = [...new Set(deckCards.filter((c) => PICK_BOARDS.has(c.board)).map((c) => c.name).filter(Boolean))];

    const cases = [
      ["Evolving Wilds, pageSize 50", '!"Evolving Wilds"', 50, ["Evolving Wilds"]],
      ["Sol Ring, pageSize 1000", '!"Sol Ring"', 1000, ["Sol Ring"]],
      [`whole deck OR (${names.length} names), pageSize 1000`, orQuery(names), 1000, names],
      [`whole deck OR (${names.length} names), pageSize 100`, orQuery(names), 100, names],
    ];
    for (const [label, q, pageSize, asked] of cases) {
      const res = await continuationSearch(base, q, pageSize);
      const found = namesFound({ data: res.rows });
      const unmatched = asked.filter((n) => !nameMatched(found, n));
      const row = {
        label, requests: res.steps.length, wallMs: res.wallMs, rowsCollected: res.rows.length,
        copies: res.rows.reduce((a, r) => a + (r.quantity ?? 0), 0),
        namesMatched: asked.length - unmatched.length, namesAsked: asked.length, unmatched: unmatched.slice(0, 20),
        firstResponseKeys: res.steps.topLevelKeys, steps: res.steps,
      };
      cs.runs.push(row);
      out(`${label}: ${row.namesMatched}/${row.namesAsked} names, ${row.rowsCollected} rows, ${row.requests} requests, ${row.wallMs} ms`);
    }
    out("Done. Copy test results (short).");
  } catch (e) {
    cs.error = String(e);
    out(`ERROR: ${e}`);
  }
};

async function searchBaseAndNames() {
  const log = await browser.runtime.sendMessage({ type: "log:get" });
  const site = log.filter((e) => !e.fromProbe && e.method === "GET" && e.status === 200);
  const base = site.findLast((e) => /\/v1\/collections\/search$/.test(new URL(e.url).pathname))?.url;
  if (!base) throw new Error("No recorded collection search. Search your collection in Moxfield, then Refresh in step 1.");
  if (!deckCards.length) {
    const typed = $("deckId").value.trim();
    const deckUrl = typed
      ? `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(typed)}`
      : site.findLast((e) => /^\/v3\/decks\/all\/[^/]+$/.test(new URL(e.url).pathname))?.url;
    if (!deckUrl) throw new Error("No deck. Open a deck in Moxfield (then Refresh) or enter a deck id in section 4.");
    const r = await request("ext-auth", { url: deckUrl });
    if (r.status !== 200) throw new Error(`Deck fetch failed: ${r.status}`);
    deckCards = extractCards(r.json);
  }
  const names = [...new Set(deckCards.filter((c) => PICK_BOARDS.has(c.board)).map((c) => c.name).filter(Boolean))];
  return { base, names };
}

$("chunkSearch").onclick = async () => {
  const out = (msg) => ($("chunkLog").textContent += msg + "\n");
  $("chunkLog").textContent = "";
  $("chunkLog").hidden = false;
  const ck = (report.chunking = { sizes: [] });
  try {
    const { base, names } = await searchBaseAndNames();
    ck.deckNames = names.length;
    ck.namesInOrder = names;

    // 1. Are the previously-unmatched names really owned? Search a few one at a time.
    const prev = report.continuation?.runs?.find((r) => r.namesAsked > 1)?.unmatched ?? ["Azorius Signet", "Utter End", "Authority of the Consuls"];
    ck.singles = [];
    for (const n of prev.slice(0, 3)) {
      const res = await continuationSearch(base, `!"${esc(n)}"`, 1000);
      const row = { name: n, rows: res.rows.length, matched: nameMatched(namesFound({ data: res.rows }), n), requests: res.steps.length };
      ck.singles.push(row);
      out(`single ${n}: ${row.matched ? "found" : "NOT found"} (${row.rows} rows)`);
    }

    // 2. Whole deck split into groups of N names, 4 groups at a time.
    for (const size of [10, 20, 40]) {
      const chunks = [];
      for (let i = 0; i < names.length; i += size) chunks.push(names.slice(i, i + size));
      const t0 = performance.now();
      const results = await pool(chunks, 4, async (chunk) => {
        const q = orQuery(chunk);
        const res = await continuationSearch(base, q, 1000);
        const found = namesFound({ data: res.rows });
        const unmatched = chunk.filter((n) => !nameMatched(found, n));
        return { names: chunk.length, qLength: q.length, requests: res.steps.length, matched: chunk.length - unmatched.length, unmatched, rows: res.rows.length };
      });
      const row = {
        chunkSize: size, chunks: chunks.length, wallMs: Math.round(performance.now() - t0),
        matched: results.reduce((a, r) => a + r.matched, 0), namesAsked: names.length,
        requests: results.reduce((a, r) => a + r.requests, 0),
        perChunk: results.map(({ unmatched, ...r }) => ({ ...r, firstUnmatched: unmatched[0] ?? null })),
        unmatched: results.flatMap((r) => r.unmatched).slice(0, 20),
      };
      ck.sizes.push(row);
      out(`groups of ${size}: ${row.matched}/${row.namesAsked} names, ${row.requests} requests, ${row.wallMs} ms`);
    }
    out("Done. Copy test results (short).");
  } catch (e) {
    ck.error = String(e);
    out(`ERROR: ${e}`);
  }
};

$("refreshTok").onclick = async () => {
  const log = await browser.runtime.sendMessage({ type: "log:get" });
  // Fresh page loads use startup/authenticated; long-lived tabs use token/refresh. Both are cookie-authenticated.
  const posts = log.filter((e) => !e.fromProbe && e.method === "POST" && e.body);
  const rec =
    posts.findLast((e) => /\/v1\/account\/token\/refresh$/.test(e.url)) ??
    posts.findLast((e) => /\/v1\/startup\/authenticated$/.test(e.url));
  if (!rec) return alert("No recorded token call. Reload a moxfield.com tab, then Refresh in step 1.");
  const captured = (await authHeaders())?.headers ?? [];
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/plain, */*" };
  for (const [n, v] of captured) if (n.toLowerCase() === "x-moxfield-version") headers[n] = v;
  await browser.runtime.sendMessage({ type: "probe:mark", url: rec.url });

  const attempts = [];
  for (const where of ["ext", "cs"]) {
    let r;
    if (where === "ext") {
      try {
        const res = await fetch(rec.url, { method: "POST", headers, body: rec.body, credentials: "include" });
        r = { status: res.status, text: await res.text() };
      } catch (e) {
        r = { status: null, error: String(e) };
      }
    } else {
      r = await csSend({ type: "cs:fetch", url: rec.url, method: "POST", headers, body: rec.body, ctx: "cs" }).catch((e) => ({ error: String(e) }));
    }
    const json = r.text ? tryJson(r.text) : undefined;
    attempts.push({
      endpoint: new URL(rec.url).pathname, context: where, status: r.status, error: r.error,
      responseKeys: json && typeof json === "object" ? Object.keys(json) : null,
      returnsJwt: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(r.text ?? ""),
    });
    if (r.status >= 200 && r.status < 300) break;
  }
  report.tokenRefresh = attempts;
  $("refreshOut").textContent = JSON.stringify(attempts);
};

// ---------- 6: report ----------

function reportText() {
  report.generatedAt = new Date().toISOString();
  return JSON.stringify(report, null, 2);
}

function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("copy").onclick = async () => {
  await refreshTraffic();
  await navigator.clipboard.writeText(reportText());
  $("copyMsg").textContent = "Copied.";
};
$("copyShort").onclick = async () => {
  const { env, auth, chunking } = report;
  await navigator.clipboard.writeText(JSON.stringify({ generatedAt: new Date().toISOString(), env, auth, chunking }, null, 2));
  $("copyMsg").textContent = "Copied test results.";
};
$("dlReport").onclick = async () => {
  await refreshTraffic();
  download("moxfield-probe-report.json", reportText());
};
$("dlFixtures").onclick = () => download("moxfield-probe-fixtures.json", JSON.stringify(fixtures, null, 2));

// ---------- init ----------

const deckParam = new URLSearchParams(location.search).get("deck");
if (deckParam) $("deckId").value = deckParam;
setup().then(refreshTraffic);
