import { useEffect, useRef, useState } from "preact/hooks";
import { deckHash, hashFragment, hashWords } from "../../engine/deckHash";
import { NotLoggedInError, type MoxfieldClient } from "../../moxfield/client";
import { getDeck } from "../../moxfield/decks";
import { deckIdFromInput, deckUrl } from "../../moxfield/urls";
import type { Store } from "../../util/store";
import { HashWords } from "../common/HashWords";
import { E11, drawE11Label, type LabelContent } from "./e11";

interface Props {
  client: MoxfieldClient;
  store: Store;
  /** Overrides the `?deck=` query parameter (used by the dev harness). */
  deck?: string;
}

type State = { status: "loading" } | { status: "done"; label: LabelContent } | { status: "error"; error: unknown };

/** The last E11 label length used, in mm. */
const E11_LENGTH_KEY = "e11LengthMm";
const DEFAULT_E11_LENGTH_MM = 40;

export function LabelApp({ client, store, deck: deckProp }: Props) {
  const publicId = deckIdFromInput(deckProp ?? new URLSearchParams(location.search).get("deck") ?? undefined);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!publicId) return;
    getDeck(client, publicId)
      .then(async (deck) => {
        const hash = await deckHash(deck.entries);
        document.title = `${deck.name} label · Magic Pickle`;
        setState({ status: "done", label: { name: deck.name, url: `${deckUrl(publicId)}#${hashFragment(hash)}`, words: hashWords(hash) } });
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
  const [lengthMm, setLengthMm] = useState(DEFAULT_E11_LENGTH_MM);

  useEffect(() => {
    void store.get<number>(E11_LENGTH_KEY).then((saved) => saved && setLengthMm(saved));
  }, [store]);
  useEffect(() => {
    if (!canvas.current) return;
    drawE11Label(canvas.current, label, lengthMm);
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
            min={20}
            max={E11.maxLengthMm}
            step={0.5}
            value={lengthMm}
            onChange={(e) => {
              const mm = Math.min(E11.maxLengthMm, Math.max(20, Number(e.currentTarget.value) || DEFAULT_E11_LENGTH_MM));
              setLengthMm(mm);
              void store.set(E11_LENGTH_KEY, mm);
            }}
          />
        </label>
        <button type="button" onClick={download}>
          Download PNG
        </button>
      </p>
      <div class="label-preview">
        <canvas ref={canvas} />
      </div>
      <p class="muted">
        One pixel per printer dot (8 per mm, 11 mm tall). Print it at 100% scale, for example with khromov's Supvan web
        app in Chrome or Edge.
      </p>
    </section>
  );
}
