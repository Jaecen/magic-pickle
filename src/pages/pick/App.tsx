import { createContext } from "preact";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";
import { z } from "zod";
import { generatePicklist, type GenerateResult } from "../../app/generate";
import type { Holding, Notice, Pick } from "../../engine/picklist";
import { SetCatalog } from "../../engine/sets";
import { priceOf, sleevingFor } from "../../engine/storage";
import type { Card, Finish } from "../../engine/types";
import { MoxfieldChangedError, NotLoggedInError, type FetchFn, type MoxfieldClient } from "../../moxfield/client";
import { deckIdFromInput, deckUrl } from "../../moxfield/urls";
import type { Store } from "../../util/store";
import { COLOR_LABELS, pickId, printing, sectionLabel, sectionLocation, where } from "./format";
import { setGlyph } from "./symbols";

interface Props {
  client: MoxfieldClient;
  store: Store;
  fetchFn: FetchFn;
}

type State =
  | { status: "loading"; step: string }
  | { status: "done"; result: GenerateResult }
  | { status: "error"; error: unknown };

const progressKey = (publicId: string) => `progress:${publicId}`;
/** Whether pick lines show the sleeve hint. One setting for every deck; on unless turned off. */
const SHOW_SLEEVES_KEY = "showSleeves";

/** Scryfall's set list, for set symbols. */
const SetsContext = createContext(new SetCatalog([]));

/** `deck` overrides the `?deck=` query parameter (used by the dev harness). */
export function App(props: Props & { deck?: string }) {
  const publicId = deckIdFromInput(props.deck ?? new URLSearchParams(location.search).get("deck") ?? undefined);
  if (!publicId) return <DeckInput />;
  return <Picklist {...props} publicId={publicId} />;
}

function DeckInput() {
  const [value, setValue] = useState("");
  const id = deckIdFromInput(value);
  return (
    <main class="page">
      <h1>🥒 Magic Pickle</h1>
      <p class="muted">Open a deck in Moxfield and click the 🥒 button, or paste the deck's URL here.</p>
      <form
        class="deck-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (id) location.search = `?deck=${encodeURIComponent(id)}`;
        }}
      >
        <input
          type="text"
          placeholder="https://moxfield.com/decks/…"
          value={value}
          onInput={(e) => setValue(e.currentTarget.value)}
          aria-label="Moxfield deck URL or id"
        />
        <button type="submit" disabled={!id}>
          Make picklist
        </button>
      </form>
    </main>
  );
}

function Picklist({ client, store, fetchFn, publicId }: Props & { publicId: string }) {
  const [state, setState] = useState<State>({ status: "loading", step: "Starting…" });
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [hidePicked, setHidePicked] = useState(false);
  const [showSleeves, setShowSleeves] = useState(true);

  const run = useCallback(() => {
    setState({ status: "loading", step: "Starting…" });
    generatePicklist(publicId, { client, store, fetchFn, onStep: (step) => setState({ status: "loading", step }) })
      .then((result) => {
        document.title = `${result.deck.name} · Magic Pickle`;
        setState({ status: "done", result });
      })
      .catch((error: unknown) => setState({ status: "error", error }));
  }, [client, store, fetchFn, publicId]);

  // Saved progress loads once; after that, every change is saved.
  const progressLoaded = useRef(false);
  useEffect(() => {
    run();
    void store.get<boolean>(SHOW_SLEEVES_KEY).then((show) => setShowSleeves(show ?? true));
    void store.get<string[]>(progressKey(publicId)).then((ids) => {
      setPicked(new Set(ids ?? []));
      progressLoaded.current = true;
    });
  }, [run, store, publicId]);
  useEffect(() => {
    if (progressLoaded.current) void store.set(progressKey(publicId), [...picked]);
  }, [picked, store, publicId]);

  // Functional update, so quick successive clicks don't overwrite each other.
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (state.status === "loading") {
    return (
      <main class="page">
        <h1>🥒 Magic Pickle</h1>
        <p class="loading">{state.step}</p>
      </main>
    );
  }
  if (state.status === "error") return <ErrorView error={state.error} retry={run} client={client} />;

  const { deck, picklist, sets, stats } = state.result;
  const copies = picklist.picks.reduce((n, p) => n + p.quantity, 0);
  const forThisPull = picklist.notices.filter((n) => n.kind !== "overAllocated");
  const outOfSync = picklist.notices.filter((n) => n.kind === "overAllocated");
  const pickedCopies = picklist.picks.filter((p) => picked.has(pickId(p))).reduce((n, p) => n + p.quantity, 0);

  return (
    <SetsContext.Provider value={sets}>
      <main class="page">
        <header class="deck-header">
          <h1>{deck.name}</h1>
          <p class="muted">
            {pickedCopies} of {copies} cards pulled
            {forThisPull.length > 0 && ` · ${forThisPull.length} need attention`}
          </p>
          <div class="toolbar">
            <a href={deckUrl(deck.publicId)} target="_blank" rel="noreferrer">
              Open in Moxfield
            </a>
            <button type="button" onClick={run}>
              Regenerate
            </button>
            <label class="check">
              <input type="checkbox" checked={hidePicked} onChange={(e) => setHidePicked(e.currentTarget.checked)} />
              Hide pulled
            </label>
            <label class="check" title="Mark cards to store in a penny sleeve or double sleeve">
              <input
                type="checkbox"
                checked={showSleeves}
                onChange={(e) => {
                  setShowSleeves(e.currentTarget.checked);
                  void store.set(SHOW_SLEEVES_KEY, e.currentTarget.checked);
                }}
              />
              Sleeves
            </label>
          </div>
        </header>

        {forThisPull.length > 0 && <Notices notices={forThisPull} deckLink={deckUrl(deck.publicId)} />}

        {picklist.skipped.length > 0 && (
          <p class="skipped">
            Not included:{" "}
            {picklist.skipped
              .map((s) => `${s.quantity} ${s.name}${s.reason === "proxy" ? " (proxy)" : s.reason === "token" ? " (token)" : ""}`)
              .join(", ")}
          </p>
        )}

        <PickList picks={picklist.picks} picked={picked} hidePicked={hidePicked} showSleeves={showSleeves} onToggle={toggle} />

        {outOfSync.length > 0 && (
          <details class="out-of-sync">
            <summary>
              {outOfSync.length} Moxfield {outOfSync.length === 1 ? "record" : "records"} out of sync
            </summary>
            <p class="muted">
              Built decks list more copies of these printings than your collection has. They don't affect this pull, but
              the deck or collection records in Moxfield should be corrected.
            </p>
            {outOfSync.map((n, i) => (
              <article class={`notice ${n.kind}`} key={i}>
                <NoticeBody notice={n} deckLink={deckUrl(deck.publicId)} />
              </article>
            ))}
          </details>
        )}

        <Diagnostics client={client} stats={stats} />
      </main>
    </SetsContext.Provider>
  );
}

function PickList(props: {
  picks: Pick[];
  picked: ReadonlySet<string>;
  hidePicked: boolean;
  showSleeves: boolean;
  onToggle: (id: string) => void;
}) {
  const { picks, picked, hidePicked, showSleeves, onToggle } = props;
  const visible = hidePicked ? picks.filter((p) => !picked.has(pickId(p))) : picks;
  if (picks.length === 0) return <p class="muted">Nothing to pull.</p>;
  if (visible.length === 0) return <p class="muted">Everything's pulled. 🎉</p>;

  const rows = [];
  let section = "";
  let group: string | undefined;
  for (const p of visible) {
    if (p.placement.section !== section) {
      section = p.placement.section;
      group = undefined;
      rows.push(
        <h2 class="section" key={`s:${section}`}>
          {sectionLabel(p.placement.section)} <span class="muted">{sectionLocation(p.placement.section)}</span>
        </h2>,
      );
    }
    if (p.placement.group && p.placement.group !== group) {
      group = p.placement.group;
      rows.push(
        <h3 class="group" key={`g:${section}:${group}`}>
          {group}
        </h3>,
      );
    }
    const id = pickId(p);
    rows.push(
      <label class={`pick${picked.has(id) ? " done" : ""}`} key={id}>
        <input type="checkbox" checked={picked.has(id)} onChange={() => onToggle(id)} />
        <span class={`pip c-${p.placement.color}`} title={COLOR_LABELS[p.placement.color]} />
        <span class="qty">{p.quantity}×</span>
        <span class="name">
          {p.card.name}
          {showSleeves && <SleeveBadge card={p.card} finish={p.finish} />}
        </span>
        <span class="printing">
          <SetSymbol code={p.card.set} />
          {printing(p.card, p.finish, p.languageCode)}
          {p.fromBinder && <span class="badge">binder</span>}
        </span>
      </label>,
    );
  }
  return <section class="picks">{rows}</section>;
}

function Notices({ notices, deckLink }: { notices: Notice[]; deckLink: string }) {
  return (
    <section class="notices">
      <h2>Needs attention</h2>
      {notices.map((n, i) => (
        <article class={`notice ${n.kind}`} key={i}>
          <NoticeBody notice={n} deckLink={deckLink} />
        </article>
      ))}
    </section>
  );
}

function NoticeBody({ notice: n, deckLink }: { notice: Notice; deckLink: string }) {
  const title = (
    <h3>
      {n.card.name}{" "}
      <span class="printing">
        <SetSymbol code={n.card.set} />
        {printing(n.card, n.finish, n.languageCode)}
      </span>
    </h3>
  );
  if (n.kind === "overAllocated") {
    return (
      <>
        {title}
        <p>
          Built decks use {n.used} but your collection has {n.owned}. Moxfield's records are off for this printing.
        </p>
        <Holders holders={n.heldBy} />
      </>
    );
  }
  const short = n.wanted - n.picked;
  const summary =
    n.picked > 0
      ? `${n.picked} of ${n.wanted} are on the picklist; ${short} more aren't free.`
      : n.owned === 0
        ? "You don't own this printing."
        : n.owned === 1
          ? "Your only copy is in use."
          : `All ${n.owned} of your copies are in use.`;
  if (n.kind === "printingNotFree") {
    return (
      <>
        {title}
        <p>{summary}</p>
        <Holders holders={n.heldBy} />
        <p class="label">Free printings:</p>
        <ul class="alternatives">
          {n.alternatives.map((a, i) => (
            <li key={i}>
              {a.free}× <SetSymbol code={a.card.set} />
              {printing(a.card, a.finish, a.languageCode)} <span class="muted">· {where(a.placement)}</span>
            </li>
          ))}
        </ul>
        <p>
          <a href={deckLink} target="_blank" rel="noreferrer">
            Change the printing in Moxfield
          </a>
          , then regenerate.
        </p>
      </>
    );
  }
  return (
    <>
      {title}
      <p>
        {summary} No other printing has a free copy.
        {n.heldBy.length === 0 && n.owned === 0 && " It isn't in your collection."}
      </p>
      <Holders holders={n.heldBy} />
    </>
  );
}

function Holders({ holders }: { holders: Holding[] }) {
  if (holders.length === 0) return null;
  return (
    <p class="holders">
      In:{" "}
      {holders.map((h, i) => (
        <span key={i}>
          {i > 0 && ", "}
          <a href={deckUrl(h.publicId)} target="_blank" rel="noreferrer">
            {h.deck}
          </a>{" "}
          <span class="muted">
            ({h.quantity}× <SetSymbol code={h.card.set} />
            {printing(h.card, h.finish, h.card.lang)})
          </span>
        </span>
      ))}
    </p>
  );
}

/** How the copy should be stored when it's filed back: sleeved, or double-sleeved. */
function SleeveBadge({ card, finish }: { card: Card; finish: Finish }) {
  const sleeving = sleevingFor(card, finish);
  if (!sleeving) return null;
  const price = priceOf(card, finish);
  const rarity = card.rarity ? card.rarity[0]!.toUpperCase() + card.rarity.slice(1) : "";
  const reason = price !== undefined && price >= 1 ? `$${price.toFixed(2)}` : rarity;
  const label = sleeving === "doubleSleeve" ? "Double sleeve" : "Sleeve";
  return (
    <span class={`sleeve ${sleeving}`} title={[label, rarity, price !== undefined && `$${price.toFixed(2)}`].filter(Boolean).join(" · ")}>
      {label}
      {reason && <span class="reason"> · {reason}</span>}
    </span>
  );
}

function SetSymbol({ code }: { code: string }) {
  const sets = useContext(SetsContext);
  const glyph = setGlyph(code, sets);
  if (!glyph) return null;
  return (
    <span class="set-symbol" title={sets.get(code)?.name} aria-hidden="true">
      {glyph}
    </span>
  );
}

function ErrorView({ error, retry, client }: { error: unknown; retry: () => void; client: MoxfieldClient }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main class="page">
      <h1>🥒 Magic Pickle</h1>
      <div class="error">
        <p>{message}</p>
        {error instanceof NotLoggedInError && (
          <p>
            <a href="https://moxfield.com/account/signin" target="_blank" rel="noreferrer">
              Log in to Moxfield
            </a>
          </p>
        )}
        {error instanceof MoxfieldChangedError && (
          <p class="muted">The extension needs updating to match Moxfield. Nothing was changed in your account.</p>
        )}
        <button type="button" onClick={retry}>
          Try again
        </button>
      </div>
      <Diagnostics client={client} />
    </main>
  );
}

function Diagnostics({ client, stats }: { client: MoxfieldClient; stats?: GenerateResult["stats"] }) {
  const [headerCheck, setHeaderCheck] = useState<string>();
  const totalMs = client.log.reduce((n, e) => n + e.ms, 0);

  const checkHeaders = async () => {
    setHeaderCheck("Checking…");
    const attempt = async (siteHeaders: boolean) => {
      try {
        await client.get("/v3/decks", z.unknown(), { siteHeaders });
        return "OK";
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    };
    const [withHeaders, without] = [await attempt(true), await attempt(false)];
    setHeaderCheck(`With site headers: ${withHeaders}. Without: ${without}.`);
  };

  return (
    <details class="diagnostics">
      <summary>Diagnostics</summary>
      {stats && (
        <p class="muted">
          {stats.builtDecks} built decks, {stats.binderDecks} binder decks ({stats.decksFetched} fetched),{" "}
          {stats.cardsSearched} cards searched, {stats.collectionRows} collection rows, {(stats.ms / 1000).toFixed(1)} s.
        </p>
      )}
      <p>
        <button type="button" onClick={checkHeaders}>
          Check whether Moxfield needs the site headers
        </button>{" "}
        {headerCheck}
      </p>
      <table>
        <thead>
          <tr>
            <th>Request</th>
            <th>Status</th>
            <th>ms</th>
          </tr>
        </thead>
        <tbody>
          {client.log.map((e, i) => (
            <tr key={i}>
              <td>
                {e.method} {e.path}
              </td>
              <td>{e.error ?? e.status}</td>
              <td>{e.ms}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted">{client.log.length} requests, {totalMs} ms total.</p>
    </details>
  );
}
