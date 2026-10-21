// A label image for the Supvan E11 (design doc §6.6): 8 dots/mm and 11 mm (88 dots) printable height, on tape of
// any length. The E11 doesn't print the first and last 2 mm, so those stay blank. Figures from khromov's E11 driver
// (github.com/khromov/supvan-katasymbol-printer-web-ui, src/lib/printer/families/e11.ts).

import { encode } from "uqr";
import { fitText } from "./layout";

export const E11 = { dotsPerMm: 8, height: 88, endMargin: 16 };

export interface LabelContent {
  name: string;
  url: string;
  words: readonly string[];
  /** When the deck was last changed in Moxfield (UTC ISO time). */
  updated: string;
}

export interface E11Layout {
  lengthMm: number;
  /** The shortest label that fits the words at their smallest size. */
  minLengthMm: number;
  /** False if the label is shorter than `minLengthMm`, so the words are cut off. */
  wordsFit: boolean;
}

const GAP = 12;
const FONT = "system-ui, -apple-system, sans-serif";
// Font sizes in dots: the name shrinks before it's cut, the words shrink but are never cut.
const NAME = { max: 28, min: 20 };
const WORDS = { max: 24, min: 18 };
const DATE = 18;
/** How wide an automatic-length label lets the name get before it shrinks and is cut. */
const AUTO_NAME_WIDTH = 60 * E11.dotsPerMm;

/**
 * Draws the label onto `canvas` at 1 pixel per dot, pure black and white: the QR code, then the deck name, the four
 * words as their 4-letter prefixes, and the date the deck last changed. Without `lengthMm`, the label is as long as
 * the name and words need at full size.
 */
export function drawE11Label(canvas: HTMLCanvasElement, label: LabelContent, lengthMm?: number): E11Layout {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const font = (size: number) => `bold ${size}px ${FONT}`;
  const measure = (text: string, size: number) => {
    ctx.font = font(size);
    return ctx.measureText(text).width;
  };

  // The words as their 4-letter prefixes, which identify them: the card words, then the printing word.
  const [a, b, c, d] = label.words.map((w) => w.slice(0, 4));
  const words = `${a} ${b} ${c} · ${d}`;
  const left = E11.endMargin + E11.height + GAP;
  const lengthFor = (textWidth: number) => (left + Math.ceil(textWidth) + E11.endMargin) / E11.dotsPerMm;
  const minLengthMm = lengthFor(measure(words, WORDS.min));
  const length = lengthMm ?? lengthFor(Math.max(measure(words, WORDS.max), Math.min(measure(label.name, NAME.max), AUTO_NAME_WIDTH)));

  const width = Math.round(length * E11.dotsPerMm);
  canvas.width = width;
  canvas.height = E11.height;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, E11.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";

  // The QR code fills the height. The tape's blank edges above and below are its quiet zone.
  drawQr(ctx, label.url, E11.endMargin, 0, E11.height);

  const textWidth = width - E11.endMargin - left;
  const name = fitText(label.name, textWidth, NAME.max, NAME.min, measure);
  ctx.font = font(name.size);
  ctx.fillText(name.text, left, 25);
  ctx.font = font(fitText(words, textWidth, WORDS.max, WORDS.min, measure).size);
  ctx.fillText(words, left, 55);
  ctx.font = font(DATE);
  ctx.fillText(localDate(label.updated), left, 83);

  threshold(ctx, width, E11.height);
  return { lengthMm: length, minLengthMm, wordsFit: length >= minLengthMm };
}

/** `YYYY-MM-DD` in local time. */
function localDate(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Draws a QR code (error correction L, no border) as a `size`-pixel square, nearest-neighbor. */
function drawQr(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number): void {
  const { data } = encode(text, { ecc: "L", border: 0 });
  const n = data.length;
  const edge = (i: number) => Math.round((i * size) / n);
  data.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect(x + edge(c), y + edge(r), edge(c + 1) - edge(c), edge(r + 1) - edge(r));
    }),
  );
}

/** Turns anti-aliased text into the black and white dots a thermal head prints. */
function threshold(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i]! * 0.299 + px[i + 1]! * 0.587 + px[i + 2]! * 0.114 < 128 ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
