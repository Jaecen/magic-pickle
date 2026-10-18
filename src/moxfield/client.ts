// Authenticated access to Moxfield's undocumented API (design doc §4.1–4.2).

import type { z } from "zod";

export const API = "https://api2.moxfield.com";

/** Headers Moxfield's own site sends, learned from its traffic (§4.1). Whether they're required is open (Q7). */
export interface SiteHeaders {
  version?: string;
  sessionUser?: string;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class MoxfieldError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MoxfieldError";
  }
}

export class NotLoggedInError extends MoxfieldError {
  constructor(endpoint: string, status: number) {
    super("Not logged in to Moxfield. Log in at moxfield.com, then try again.", endpoint, status);
    this.name = "NotLoggedInError";
  }
}

/** Moxfield (or Cloudflare in front of it) keeps refusing requests, most likely rate limiting. */
export class MoxfieldUnavailableError extends MoxfieldError {
  constructor(endpoint: string, status?: number) {
    super(
      "Moxfield is refusing requests right now, probably rate limiting. Wait a few minutes and try again.",
      endpoint,
      status,
    );
    this.name = "MoxfieldUnavailableError";
  }
}

/** A response didn't have the shape this extension expects: Moxfield probably changed its API (§4.6). */
export class MoxfieldChangedError extends MoxfieldError {
  constructor(endpoint: string, detail: string) {
    super(`Moxfield's response from ${endpoint} has changed: ${detail}`, endpoint);
    this.name = "MoxfieldChangedError";
  }
}

export interface RequestLogEntry {
  method: string;
  /** Path without the query string. */
  path: string;
  status?: number;
  ms: number;
  error?: string;
}

interface Token {
  jwt: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** Renew this long before the token's own expiry. */
const EXPIRY_MARGIN_MS = 60_000;
/** Waits before retrying a refused request. A Cloudflare block or rate limit shows up as 429/5xx, or as a
 * network error when the block page lacks CORS headers. */
const RETRY_DELAYS_MS = [1_000, 3_000];
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

export class MoxfieldClient {
  readonly log: RequestLogEntry[] = [];
  private token?: Token;
  private pendingToken?: Promise<Token>;

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly siteHeaders: () => Promise<SiteHeaders> = async () => ({}),
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** GETs `path` (relative to {@link API}) and validates the JSON body with `schema`. */
  async get<S extends z.ZodType>(path: string, schema: S, options: { siteHeaders?: boolean } = {}): Promise<z.output<S>> {
    const body = await this.authorizedJson(path, options.siteHeaders ?? true);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new MoxfieldChangedError(pathOnly(path), `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
    }
    return parsed.data;
  }

  private async authorizedJson(path: string, withSiteHeaders: boolean, retried = false): Promise<unknown> {
    const token = await this.getToken();
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token.jwt}` };
    if (withSiteHeaders) Object.assign(headers, await this.siteHeaderValues());
    const response = await this.send("GET", path, { headers });
    if (response.status === 401 && !retried) {
      this.token = undefined;
      return this.authorizedJson(path, withSiteHeaders, true);
    }
    if (response.status === 401 || response.status === 403) throw new NotLoggedInError(pathOnly(path), response.status);
    if (!response.ok) throw new MoxfieldError(`Moxfield returned ${response.status} for ${pathOnly(path)}`, pathOnly(path), response.status);
    return response.json();
  }

  private async getToken(): Promise<Token> {
    if (this.token && this.token.expiresAt - EXPIRY_MARGIN_MS > this.now()) return this.token;
    this.pendingToken ??= this.authenticate().finally(() => (this.pendingToken = undefined));
    this.token = await this.pendingToken;
    return this.token;
  }

  /** Gets a fresh access token the way a moxfield.com page load does, using the login cookie (§4.2). */
  private async authenticate(): Promise<Token> {
    const path = "/v1/startup/authenticated";
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    Object.assign(headers, await this.siteHeaderValues());
    const response = await this.send("POST", path, { headers, body: JSON.stringify({ isAppLogin: false }) });
    if (response.status === 401 || response.status === 403) throw new NotLoggedInError(path, response.status);
    if (!response.ok) throw new MoxfieldError(`Moxfield returned ${response.status} when signing in`, path, response.status);
    const jwt = findJwt(await response.json());
    if (!jwt) throw new MoxfieldChangedError(path, "no access token in the response");
    return { jwt, expiresAt: jwtExpiry(jwt) ?? this.now() + 10 * 60_000 };
  }

  private async siteHeaderValues(): Promise<Record<string, string>> {
    const { version, sessionUser } = await this.siteHeaders();
    const headers: Record<string, string> = {};
    if (version) headers["x-moxfield-version"] = version;
    if (sessionUser) headers["X-Session-User"] = sessionUser;
    return headers;
  }

  /** Sends one request, retrying with backoff while Moxfield refuses it. Every attempt is logged. */
  private async send(method: string, path: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const started = this.now();
      const entry: RequestLogEntry = { method, path: pathOnly(path), ms: 0 };
      this.log.push(entry);
      let response: Response | undefined;
      try {
        response = await this.fetchFn(`${API}${path}`, { ...init, method, credentials: "include" });
        entry.status = response.status;
      } catch (e) {
        entry.error = String(e);
      } finally {
        entry.ms = this.now() - started;
      }
      if (response && !RETRY_STATUSES.has(response.status)) return response;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw new MoxfieldUnavailableError(pathOnly(path), response?.status);
      await this.sleep(delay);
    }
  }
}

const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;

/** Finds the access token in a response whose exact shape isn't documented, preferring keys that say "access". */
export function findJwt(value: unknown): string | undefined {
  if (typeof value === "string") return JWT.test(value) ? value : undefined;
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value);
  entries.sort(([a], [b]) => Number(/access/i.test(b)) - Number(/access/i.test(a)));
  for (const [key, v] of entries) {
    if (/refresh/i.test(key) && typeof v === "string") continue; // a refresh token isn't an access token
    const found = findJwt(v);
    if (found) return found;
  }
  return undefined;
}

/** The token's `exp` claim as epoch ms, if readable. */
export function jwtExpiry(jwt: string): number | undefined {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function pathOnly(path: string): string {
  return path.split("?")[0]!;
}
