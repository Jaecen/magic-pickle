// An in-memory stand-in for api2.moxfield.com and Scryfall's /sets, reproducing the behavior the spike
// measured (design doc §4): bearer tokens from startup/authenticated, incremental collection search with
// server-issued session ids, and the ~1,000-character query cap.

import setsFixture from "./fixtures/scryfall-sets.json";
import type { FetchFn } from "../src/moxfield/client";

export interface RawCard {
  scryfall_id: string;
  name: string;
  set: string;
  cn: string;
  lang: string;
  type_line: string;
  mana_cost?: string;
  colors?: string[];
  frame?: string;
  [extra: string]: unknown;
}

export interface RawDeck {
  publicId: string;
  name: string;
  folder?: string;
  lastUpdatedAtUtc?: string;
  boards: Record<string, Array<RawPrinting & { printingData?: RawPrinting[] }>>;
  authorTags?: Record<string, string[]>;
}

export interface RawPrinting {
  quantity: number;
  finish?: string;
  isProxy?: boolean;
  card: RawCard;
}

export interface RawRow {
  id: string;
  quantity: number;
  finish?: string;
  isProxy?: boolean;
  language?: string;
  card: RawCard;
}

export interface FakeOptions {
  decks?: RawDeck[];
  collection?: RawRow[];
  /** Stages the server takes to scan the collection. */
  stages?: number;
  loggedIn?: boolean;
  tokenLifetimeSec?: number;
  /** Make every API call after sign-in return this status. */
  failWith?: number;
}

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
}

export const QUERY_CAP = 1000;

/** A Moxfield-shaped card with the extra fields real responses carry. */
export function rawCard(fields: Partial<RawCard> & Pick<RawCard, "name" | "set">): RawCard {
  return {
    scryfall_id: `${fields.set}-${fields.cn ?? "1"}-${fields.name}`,
    cn: "1",
    lang: "en",
    type_line: "Creature — Test",
    mana_cost: "{1}{W}",
    colors: ["W"],
    frame: "2015",
    prices: { usd: 0.25 },
    legalities: { commander: "legal" },
    ...fields,
  };
}

export function fakeJwt(expSec: number): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ exp: expSec, sub: "tester" })}.signature`;
}

export function fakeMoxfield(options: FakeOptions = {}) {
  const { decks = [], collection = [], stages = 5, loggedIn = true, tokenLifetimeSec = 900 } = options;
  const requests: RecordedRequest[] = [];
  const validTokens = new Set<string>();
  const sessions = new Map<string, { q: string; stage: number }>();
  let tokensIssued = 0;
  let sessionCounter = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const fetch: FetchFn = async (input, init = {}) => {
    const url = new URL(input);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const method = init.method ?? "GET";
    requests.push({ method, url, headers });

    if (url.hostname === "api.scryfall.com" && url.pathname === "/sets") return json(200, setsFixture);
    if (url.hostname !== "api2.moxfield.com") return json(404, {});

    if (url.pathname === "/v1/startup/authenticated" && method === "POST") {
      if (!loggedIn) return json(401, {});
      const jwt = fakeJwt(Math.floor(Date.now() / 1000) + tokenLifetimeSec + tokensIssued++);
      validTokens.add(jwt);
      return json(200, { refresh: { access_token: jwt }, wishList: [], allLists: [], muted: [], follows: [] });
    }

    const bearer = headers.Authorization?.replace(/^Bearer /, "");
    if (!bearer || !validTokens.has(bearer)) return json(401, {});
    if (options.failWith) return json(options.failWith, {});

    if (url.pathname === "/v3/decks") {
      return json(200, {
        decks: decks.map((d) => ({
          publicId: d.publicId,
          name: d.name,
          lastUpdatedAtUtc: d.lastUpdatedAtUtc ?? "2026-01-01T00:00:00Z",
          folder: d.folder ? { id: `f-${d.folder}`, name: d.folder } : null,
          format: "commander",
        })),
        pinnedDeckIds: [],
      });
    }

    const deckMatch = /^\/v3\/decks\/all\/([^/]+)$/.exec(url.pathname);
    if (deckMatch) {
      const deck = decks.find((d) => d.publicId === decodeURIComponent(deckMatch[1]!));
      if (!deck) return json(404, {});
      const boards = Object.fromEntries(
        Object.entries(deck.boards).map(([board, entries]) => [
          board,
          {
            count: entries.reduce((n, e) => n + e.quantity, 0),
            cards: Object.fromEntries(
              entries.map((e, i) => [`${board}${i}`, { quantity: e.quantity, finish: e.finish ?? "nonFoil", isProxy: e.isProxy ?? false, boardType: board, card: e.card, ...(e.printingData ? { printingData: e.printingData } : {}) }]),
            ),
          },
        ]),
      );
      return json(200, {
        id: `int-${deck.publicId}`,
        publicId: deck.publicId,
        name: deck.name,
        lastUpdatedAtUtc: deck.lastUpdatedAtUtc ?? "2026-01-01T00:00:00Z",
        boards,
        authorTags: deck.authorTags ?? {},
      });
    }

    if (url.pathname === "/v1/collections/search") {
      const pageSize = Number(url.searchParams.get("pageSize"));
      const pageNumber = Number(url.searchParams.get("pageNumber"));
      let sessionId = url.searchParams.get("searchSessionId") ?? undefined;
      let session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) {
        // Unknown or missing session ids start a new scan, like the real server.
        sessionId = `session${sessionCounter++}`;
        session = { q: url.searchParams.get("q") ?? "", stage: 0 };
        sessions.set(sessionId, session);
      }
      session.stage = Math.min(stages, session.stage + 1);
      const names = exactNames(session.q.slice(0, QUERY_CAP));
      const scanned = collection.slice(0, Math.ceil((collection.length * session.stage) / stages));
      const matches = scanned.filter((r) => names.size === 0 || names.has(r.card.name));
      const page = matches.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
      return json(200, {
        totalResults: matches.length,
        hasMore: session.stage < stages || matches.length > pageNumber * pageSize,
        searchSessionId: sessionId,
        pageNumber,
        pageSize,
        data: page.map((r) => ({
          id: r.id,
          quantity: r.quantity,
          condition: "nearMint",
          finish: r.finish ?? "nonFoil",
          isProxy: r.isProxy ?? false,
          language: { id: "x", code: r.language ?? "en", name: "?" },
          card: r.card,
        })),
      });
    }
    return json(404, {});
  };

  return { fetch, requests, apiRequests: () => requests.filter((r) => r.url.hostname === "api2.moxfield.com") };
}

/** Names in `!"…"` terms; terms cut off by the query cap don't count, as on the real server. */
function exactNames(q: string): Set<string> {
  const names = new Set<string>();
  for (const m of q.matchAll(/!"((?:[^"\\]|\\.)*)"/g)) names.add(m[1]!.replace(/\\(.)/g, "$1"));
  return names;
}
