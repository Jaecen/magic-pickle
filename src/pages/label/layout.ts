// Label text layout, independent of the canvas so it can be tested.

/** The width of `text` drawn at font size `size`. */
export type Measure = (text: string, size: number) => number;

/**
 * The largest font size from `max` down to `min` at which `text` fits in `width`. If it doesn't fit even at `min`,
 * it's cut to as many characters as fit, with no ellipsis: on a label, every character of the name helps.
 */
export function fitText(text: string, width: number, max: number, min: number, measure: Measure): { text: string; size: number } {
  for (let size = max; size >= min; size--) if (measure(text, size) <= width) return { text, size };
  let cut = text;
  while (cut.length > 0 && measure(cut, min) > width) cut = cut.slice(0, -1);
  return { text: cut.trimEnd(), size: min };
}
