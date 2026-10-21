// Small DOM helpers for the content script, which doesn't use Preact.

/** The words with the 4 letters a label prints in bold, and the printing word set apart. */
export function words(list: readonly string[]): HTMLElement {
  const span = el("span", { class: "words" });
  list.forEach((w, i) => {
    if (i > 0) span.append(i === 3 ? " · " : " ");
    span.append(el("b", {}, w.slice(0, 4)), w.slice(4));
  });
  return span;
}

export function link(href: string, text: string): HTMLElement {
  return el("a", { href, target: "_blank", rel: "noreferrer" }, text);
}

export function el(tag: string, attrs: Record<string, string>, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}
