// A label image for the Supvan E11 (design doc §6.6): 8 dots/mm, 11 mm (88 dots) printable height, at most 332 dots
// long. The E11 doesn't print the first and last 2 mm, so those stay blank. Figures from khromov's E11 driver
// (github.com/khromov/supvan-katasymbol-printer-web-ui, src/lib/printer/families/e11.ts).

import { encode } from "uqr";
import { fitText } from "./layout";

export const E11 = { dotsPerMm: 8, height: 88, endMargin: 16, maxLengthMm: 41.5 };

export interface LabelContent {
  name: string;
  url: string;
  words: readonly string[];
}

const GAP = 12;
const FONT = "system-ui, -apple-system, sans-serif";

/** Draws the label onto `canvas` at 1 pixel per dot, pure black and white. */
export function drawE11Label(canvas: HTMLCanvasElement, label: LabelContent, lengthMm: number): void {
  const width = Math.round(Math.min(lengthMm, E11.maxLengthMm) * E11.dotsPerMm);
  canvas.width = width;
  canvas.height = E11.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, E11.height);
  ctx.fillStyle = "#000";

  // The QR code fills the height. The tape's blank edges above and below are its quiet zone.
  drawQr(ctx, label.url, E11.endMargin, 0, E11.height);

  const left = E11.endMargin + E11.height + GAP;
  const textWidth = width - E11.endMargin - left;
  ctx.textBaseline = "alphabetic";
  const font = (size: number) => `bold ${size}px ${FONT}`;
  const measure = (text: string, size: number) => {
    ctx.font = font(size);
    return ctx.measureText(text).width;
  };

  const name = fitText(label.name, textWidth, 30, 20, measure);
  ctx.font = font(name.size);
  ctx.fillText(name.text, left, 26);

  // The words as their 4-letter prefixes, which identify them: the card words, then the printing word.
  const [a, b, c, d] = label.words.map((w) => w.slice(0, 4));
  const words = fitText(`${a} ${b}`, textWidth, 28, 16, measure);
  const lastLine = `${c} · ${d}`;
  const size = Math.min(words.size, fitText(lastLine, textWidth, 28, 16, measure).size);
  ctx.font = font(size);
  ctx.fillText(`${a} ${b}`, left, 56);
  ctx.fillText(lastLine, left, 84);

  threshold(ctx, width, E11.height);
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
