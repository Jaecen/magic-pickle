import { Fragment } from "preact";

/** A deck hash's words, with the 4 letters a label prints in bold and the printing word set apart. */
export function HashWords({ words }: { words: readonly string[] }) {
  return (
    <span class="hash-words">
      {words.map((w, i) => (
        <Fragment key={i}>
          {i === 3 ? " · " : i > 0 ? " " : ""}
          <span class="hash-word">
            <b>{w.slice(0, 4)}</b>
            {w.slice(4)}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
