import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fakeJwt, fakeMoxfield } from "../../tests/fakeMoxfield";
import { findJwt, jwtExpiry, MoxfieldChangedError, MoxfieldClient, MoxfieldUnavailableError, NotLoggedInError, type FetchFn } from "./client";

const anything = z.unknown();

describe("MoxfieldClient", () => {
  it("signs in once, even for concurrent requests, and sends the bearer token", async () => {
    const server = fakeMoxfield();
    const client = new MoxfieldClient(server.fetch);
    await Promise.all([client.get("/v3/decks", anything), client.get("/v3/decks", anything)]);
    const api = server.apiRequests();
    expect(api.filter((r) => r.url.pathname === "/v1/startup/authenticated")).toHaveLength(1);
    expect(api.filter((r) => r.url.pathname === "/v3/decks").every((r) => r.headers.Authorization?.startsWith("Bearer eyJ"))).toBe(true);
  });

  it("sends the learned site headers unless asked not to", async () => {
    const server = fakeMoxfield();
    const client = new MoxfieldClient(server.fetch, async () => ({ version: "2026.10.1", sessionUser: "abc" }));
    await client.get("/v3/decks", anything);
    await client.get("/v3/decks", anything, { siteHeaders: false });
    const [withHeaders, without] = server.apiRequests().filter((r) => r.url.pathname === "/v3/decks");
    expect(withHeaders!.headers).toMatchObject({ "x-moxfield-version": "2026.10.1", "X-Session-User": "abc" });
    expect(without!.headers["x-moxfield-version"]).toBeUndefined();
  });

  it("renews the token shortly before it expires", async () => {
    let now = Date.now();
    const server = fakeMoxfield({ tokenLifetimeSec: 900 });
    const client = new MoxfieldClient(server.fetch, undefined, () => now);
    await client.get("/v3/decks", anything);
    now += 10 * 60_000;
    await client.get("/v3/decks", anything);
    expect(server.apiRequests().filter((r) => r.url.pathname === "/v1/startup/authenticated")).toHaveLength(1);
    now += 5 * 60_000;
    await client.get("/v3/decks", anything);
    expect(server.apiRequests().filter((r) => r.url.pathname === "/v1/startup/authenticated")).toHaveLength(2);
  });

  it("reports a logged-out user clearly", async () => {
    const client = new MoxfieldClient(fakeMoxfield({ loggedIn: false }).fetch);
    await expect(client.get("/v3/decks", anything)).rejects.toBeInstanceOf(NotLoggedInError);
  });

  it("reports an unexpected response shape as a Moxfield change", async () => {
    const client = new MoxfieldClient(fakeMoxfield({ decks: [{ publicId: "aaaaaaaaaa", name: "A", boards: {} }] }).fetch);
    const error = await client.get("/v3/decks", z.object({ decks: z.array(z.object({ colour: z.string() })) })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MoxfieldChangedError);
    expect((error as Error).message).toContain("decks.0.colour");
  });

  it("retries refused requests with backoff, then reports rate limiting clearly", async () => {
    const server = fakeMoxfield();
    let refusals = 2;
    const flaky: FetchFn = async (input, init) => {
      if (input.includes("/v3/decks") && refusals-- > 0) throw new TypeError("NetworkError when attempting to fetch resource.");
      return server.fetch(input, init);
    };
    const waits: number[] = [];
    const client = new MoxfieldClient(flaky, undefined, Date.now, async (ms) => void waits.push(ms));
    await client.get("/v3/decks", anything);
    expect(waits).toEqual([1000, 3000]);

    const blocked: FetchFn = async (input, init) =>
      input.includes("/v3/decks") ? new Response("", { status: 429 }) : server.fetch(input, init);
    const stuck = new MoxfieldClient(blocked, undefined, Date.now, async () => {});
    await expect(stuck.get("/v3/decks", anything)).rejects.toBeInstanceOf(MoxfieldUnavailableError);
    expect(stuck.log.filter((e) => e.path === "/v3/decks").map((e) => e.status)).toEqual([429, 429, 429]);
  });

  it("logs every request", async () => {
    const client = new MoxfieldClient(fakeMoxfield({ failWith: 500 }).fetch);
    await expect(client.get("/v3/decks?x=1", anything)).rejects.toThrow("Moxfield returned 500");
    expect(client.log.map((e) => `${e.method} ${e.path} ${e.status}`)).toEqual([
      "POST /v1/startup/authenticated 200",
      "GET /v3/decks 500",
    ]);
  });
});

describe("findJwt", () => {
  const jwt = fakeJwt(2_000_000_000);
  it("finds a nested access token and skips refresh tokens", () => {
    expect(findJwt({ refresh: { access_token: jwt }, wishList: [] })).toBe(jwt);
    expect(findJwt({ refreshToken: fakeJwt(1), accessToken: jwt })).toBe(jwt);
    expect(findJwt({ nothing: "here" })).toBeUndefined();
  });

  it("reads the expiry claim", () => {
    expect(jwtExpiry(jwt)).toBe(2_000_000_000_000);
    expect(jwtExpiry("not.a.jwt")).toBeUndefined();
  });
});
