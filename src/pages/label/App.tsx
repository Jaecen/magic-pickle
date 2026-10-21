import { useEffect, useRef, useState } from "preact/hooks";
import { deckHash, hashFragment, hashWords } from "../../engine/deckHash";
import { NotLoggedInError, type MoxfieldClient } from "../../moxfield/client";
import { getDeck } from "../../moxfield/decks";
import { deckIdFromInput, deckUrl } from "../../moxfield/urls";
import type { Store } from "../../util/store";
import { HashWords } from "../common/HashWords";
import { drawE11Label, type E11Layout, type LabelContent } from "./e11";

interface Props {
  client: MoxfieldClient;
  store: Store;
  /** Overrides the `?deck=` query parameter (used by the dev harness). */
  deck?: string;
}

type State = { status: "loading" } | { status: "done"; label: LabelContent } | { status: "error"; error: unknown };

/** The E11 label length set by hand, in mm; absent for automatic. (`e11LengthMm` held the old 41.5 mm-capped one.) */
const E11_LENGTH_KEY = "e11Length";
const OLD_E11_LENGTH_KEY = "e11LengthMm";
const MIN_E11_LENGTH_MM = 20;
const KHROMOV_APP = "https://khromov.github.io/supvan-katasymbol-printer-web-ui/";

export function LabelApp({ client, store, deck: deckProp }: Props) {
  const publicId = deckIdFromInput(deckProp ?? new URLSearchParams(location.search).get("deck") ?? undefined);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!publicId) return;
    getDeck(client, publicId)
      .then(async (deck) => {
        const hash = await deckHash(deck.entries);
        document.title = `${deck.name} label · Magic Pickle`;
        setState({
          status: "done",
          label: {
            name: deck.name,
            url: `${deckUrl(publicId)}#${hashFragment(hash)}`,
            words: hashWords(hash),
            updated: deck.lastUpdatedAtUtc,
          },
        });
      })
      .catch((error: unknown) => setState({ status: "error", error }));
  }, [client, publicId]);

  if (!publicId) {
    return (
      <main class="page">
        <h1>🥒 Magic Pickle</h1>
        <p class="error">No deck given. Open a label from a deck page in Moxfield.</p>
      </main>
    );
  }
  if (state.status === "loading") {
    return (
      <main class="page">
        <h1>🥒 Magic Pickle</h1>
        <p class="loading">Loading the deck…</p>
      </main>
    );
  }
  if (state.status === "error") {
    const { error } = state;
    return (
      <main class="page">
        <h1>🥒 Magic Pickle</h1>
        <div class="error">
          <p>{error instanceof Error ? error.message : String(error)}</p>
          {error instanceof NotLoggedInError && (
            <p>
              <a href="https://moxfield.com/account/signin" target="_blank" rel="noreferrer">
                Log in to Moxfield
              </a>
            </p>
          )}
        </div>
      </main>
    );
  }

  const { label } = state;
  return (
    <main class="page">
      <h1>{label.name}</h1>
      <p>
        Deck hash: <HashWords words={label.words} />
      </p>
      <p class="muted">
        The QR code opens <a href={label.url}>{label.url}</a>, which checks the label against the deck.
      </p>
      <E11Label label={label} store={store} />
    </main>
  );
}

function E11Label({ label, store }: { label: LabelContent; store: Store }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  /** Set by hand, or undefined for automatic. */
  const [lengthMm, setLengthMm] = useState<number>();
  const [layout, setLayout] = useState<E11Layout>();

  useEffect(() => {
    void store.get<number>(E11_LENGTH_KEY).then((saved) => saved && setLengthMm(saved));
    void store.remove(OLD_E11_LENGTH_KEY);
  }, [store]);
  useEffect(() => {
    if (!canvas.current) return;
    setLayout(drawE11Label(canvas.current, label, lengthMm));
    canvas.current.style.width = `${canvas.current.width * 3}px`;
  }, [label, lengthMm]);

  const download = () =>
    canvas.current?.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${label.name.replace(/[\\/:*?"<>|]+/g, "").trim()} - E11 label.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");

  return (
    <section class="label-printer">
      <h2>Supvan E11</h2>
      <p class="toolbar">
        <label class="check">
          Label length (mm)
          <input
            type="number"
            min={MIN_E11_LENGTH_MM}
            step={0.5}
            placeholder="auto"
            value={lengthMm ?? ""}
            onChange={(e) => {
              const typed = Number(e.currentTarget.value);
              const mm = e.currentTarget.value.trim() && typed > 0 ? Math.max(MIN_E11_LENGTH_MM, typed) : undefined;
              setLengthMm(mm);
              void (mm ? store.set(E11_LENGTH_KEY, mm) : store.remove(E11_LENGTH_KEY));
            }}
          />
        </label>
        {layout && lengthMm === undefined && <span class="muted">Automatic: {layout.lengthMm.toFixed(1)} mm</span>}
        <button type="button" onClick={download}>
          Download PNG
        </button>
      </p>
      {layout && !layout.wordsFit && (
        <p class="error">
          Too short for the words: this label needs at least {Math.ceil(layout.minLengthMm * 2) / 2} mm. Clear the length
          for automatic.
        </p>
      )}
      <div class="label-preview">
        <canvas ref={canvas} />
      </div>
      <p class="muted">
        One pixel per printer dot (8 per mm, 11 mm tall). Print it at 100% scale, for example with{" "}
        <a href={KHROMOV_APP} target="_blank" rel="noreferrer">
          khromov's Supvan web app
        </a>{" "}
        in Chrome or Edge.
      </p>
    </section>
  );
}
