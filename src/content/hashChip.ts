// The deck hash on Moxfield deck pages (design doc §6.6): the four words in the deck header, colored by how a
// label compares, and a dialog with the details. The work happens in the background script; this is only DOM.
// Everything lives in a shadow root, so Moxfield's styles and ours can't touch each other.

import type { DeckHashMessage, DeckHashReply, LabelReply, OpenLabelMessage } from "../messages";
import { el, link, words } from "./dom";

type Status = "neutral" | "match" | "printingsChanged" | "cardsChanged" | "error";

const STYLE = `
:host { all: initial; display: inline-block; font: 14px/1.4 system-ui, -apple-system, sans-serif; color: inherit; }
.chip { display: inline-flex; gap: 6px; align-items: center; padding: 2px 10px; border-radius: 999px; font: inherit;
  color: inherit; background: transparent; border: 1px solid currentColor; cursor: pointer; opacity: 0.9; }
.chip:hover { opacity: 1; }
.chip.match { background: var(--ok-bg); color: var(--ok-fg); border-color: var(--ok-fg); }
.chip.printingsChanged, .chip.cardsChanged { background: var(--warn-bg); color: var(--warn-fg); border-color: var(--warn-fg); }
.chip.error { opacity: 0.6; }
.words b { font-weight: 700; }
dialog { max-width: min(440px, calc(100vw - 32px)); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px;
  background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, -apple-system, sans-serif; }
dialog::backdrop { background: rgba(0, 0, 0, 0.4); }
h2 { font-size: 1.05rem; margin: 0 0 8px; }
p { margin: 8px 0; }
.big { font-size: 1.15rem; }
.muted { color: var(--muted); font-size: 0.92em; }
.result { border-radius: 8px; padding: 8px 12px; margin: 10px 0; }
.result.match { background: var(--ok-bg); }
.result.printingsChanged, .result.cardsChanged, .result.invalid { background: var(--warn-bg); }
ul { margin: 4px 0; padding-left: 20px; }
form, .buttons { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
input { flex: 1 1 180px; font: inherit; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--input); color: var(--fg); }
button.action { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--input);
  color: var(--fg); cursor: pointer; }
.buttons { justify-content: flex-end; }
`;

const LIGHT = "--bg:#fff;--fg:#1d1d1b;--muted:#6c6a64;--line:#d9d6ce;--input:#f6f5f1;--ok-bg:#e3f3e5;--ok-fg:#1f6b2a;--warn-bg:#fff1d6;--warn-fg:#8a5a00;";
const DARK = "--bg:#1f1f1d;--fg:#ecebe6;--muted:#a4a29b;--line:#45433e;--input:#2a2a27;--ok-bg:#183a20;--ok-fg:#8fdc9a;--warn-bg:#3a2d10;--warn-fg:#f2c46b;";

export class HashChip {
  readonly host = document.createElement("span");
  private readonly root = this.host.attachShadow({ mode: "open" });
  private readonly chip = document.createElement("button");
  private readonly dialog = document.createElement("dialog");
  private reply?: DeckHashReply;
  private loading = false;
  private refreshTimer?: ReturnType<typeof setTimeout>;

  /** `labels` holds the label to check per deck: from the URL the page was opened with, or typed in the dialog. */
  constructor(
    readonly publicId: string,
    private readonly labels: Map<string, string>,
  ) {
    this.host.id = "magic-pickle-hash";
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.chip.type = "button";
    this.chip.className = "chip";
    this.chip.addEventListener("click", () => {
      this.renderDialog();
      this.dialog.showModal();
    });
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) this.dialog.close(); // a click on the backdrop
    });
    this.root.append(style, this.chip, this.dialog);
    this.renderChip();
    void this.refresh();
  }

  /** Fetches the hash again, after a moment, so a burst of saves costs one request. */
  refreshSoon(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 1500);
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.renderChip();
    const message: DeckHashMessage = { type: "deckHash", publicId: this.publicId, label: this.labels.get(this.publicId) };
    try {
      this.reply = (await browser.runtime.sendMessage(message)) as DeckHashReply;
    } catch (e) {
      this.reply = { ok: false, error: e instanceof Error ? e.message : String(e), notLoggedIn: false };
    }
    this.loading = false;
    this.renderChip();
    if (this.dialog.open) this.renderDialog();
  }

  private status(): Status {
    if (!this.reply?.ok) return this.reply ? "error" : "neutral";
    const label = this.reply.label;
    if (!label) return "neutral";
    return label.valid ? label.comparison : "cardsChanged";
  }

  private renderChip(): void {
    this.host.setAttribute("style", this.palette());
    const status = this.status();
    this.chip.className = `chip ${status}`;
    const icon = { neutral: "", match: "✓ ", printingsChanged: "≈ ", cardsChanged: "≠ ", error: "" }[status];
    if (this.reply?.ok) {
      this.chip.replaceChildren(`🥒 ${icon}`, words(this.reply.words), this.loading ? " …" : "");
      this.chip.title = {
        neutral: "Magic Pickle deck hash: compare it with the deck's label. Click to check a label.",
        match: "The label matches this deck.",
        printingsChanged: "Same cards as the label, but printings changed. Click for details.",
        cardsChanged: "The deck changed since the label. Click for details.",
        error: "",
      }[status];
    } else {
      this.chip.replaceChildren(this.loading ? "🥒 …" : "🥒 hash unavailable");
      this.chip.title = this.reply && !this.reply.ok ? this.reply.error : "Magic Pickle deck hash";
    }
  }

  private renderDialog(): void {
    const reply = this.reply;
    const content: Node[] = [el("h2", {}, "Deck hash")];
    if (!reply) content.push(el("p", {}, "Loading…"));
    else if (!reply.ok) {
      content.push(el("p", {}, reply.error));
      if (reply.notLoggedIn) content.push(el("p", {}, link("https://moxfield.com/account/signin", "Log in to Moxfield")));
    } else {
      content.push(el("p", { class: "big" }, words(reply.words)));
      content.push(el("p", { class: "muted" }, "The first three words are the cards and counts; the last is the printings."));
      if (reply.label) content.push(labelResult(reply.label));
    }
    content.push(this.labelForm(), this.buttons());
    this.dialog.replaceChildren(...content);
  }

  private labelForm(): HTMLFormElement {
    const input = el("input", {
      type: "text",
      placeholder: "Words on the label",
      "aria-label": "Words on the label",
      autocomplete: "off",
      spellcheck: "false",
    }) as HTMLInputElement;
    input.value = this.labels.get(this.publicId)?.replace(/^#?mp\d+=/, "").replace(/-/g, " ") ?? "";
    const form = el("form", {}, input, el("button", { class: "action", type: "submit" }, "Check label")) as HTMLFormElement;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) this.labels.set(this.publicId, text);
      else this.labels.delete(this.publicId);
      void this.refresh();
    });
    return form;
  }

  private buttons(): HTMLElement {
    const make = el("button", { class: "action", type: "button" }, "Make label");
    make.addEventListener("click", () => {
      const message: OpenLabelMessage = { type: "openLabel", publicId: this.publicId };
      void browser.runtime.sendMessage(message);
    });
    // Focus starts here, not in the label field, so opening the dialog doesn't bring up a phone's keyboard.
    const close = el("button", { class: "action", type: "button", autofocus: "" }, "Close");
    close.addEventListener("click", () => this.dialog.close());
    return el("div", { class: "buttons" }, make, close);
  }

  /** Moxfield has light and dark themes of its own, so match the page rather than the system setting. */
  private palette(): string {
    const [r = 255, g = 255, b = 255] = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) ?? []).map(Number);
    return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? DARK : LIGHT;
  }
}

function labelResult(label: LabelReply): HTMLElement {
  if (!label.valid) return el("div", { class: "result invalid" }, el("p", {}, "That isn't four words from a Magic Pickle label."));
  const head = el("p", {}, "Label: ", words(label.words));
  const box = (status: string, ...children: Node[]) => el("div", { class: `result ${status}` }, head, ...children);
  if (label.comparison === "match") return box("match", el("p", {}, "✓ The label matches the deck, down to the printings."));
  if (label.comparison === "printingsChanged") {
    return box(
      "printingsChanged",
      el(
        "p",
        {},
        "Same cards and counts, but at least one printing, finish, or proxy changed since the label. Moxfield's history doesn't record which.",
      ),
    );
  }
  const revision = label.revision;
  if (!revision.found) {
    return box(
      "cardsChanged",
      el(
        "p",
        {},
        revision.complete
          ? "The cards changed since the label, and no revision in the deck's history matches it. Moxfield's history misses some edits."
          : "The cards changed since the label, and it doesn't match any revision in the last 1,000 history entries.",
      ),
    );
  }
  const added = revision.changes.filter((c) => c.quantity > 0);
  const removed = revision.changes.filter((c) => c.quantity < 0);
  const list = (changes: typeof added, sign: string) =>
    el("ul", {}, ...changes.map((c) => el("li", {}, `${sign}${Math.abs(c.quantity)} ${c.name}`)));
  return box(
    "cardsChanged",
    el("p", {}, `The deck changed since the label (first change ${new Date(revision.changedSince).toLocaleString()}).`),
    ...(added.length ? [el("p", {}, "Added to the deck:"), list(added, "+")] : []),
    ...(removed.length ? [el("p", {}, "Removed from the deck:"), list(removed, "−")] : []),
    el("p", { class: "muted" }, "Printing changes since the label can't be checked."),
  );
}
