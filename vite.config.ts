// Builds the extension page and background script as ES modules into dist/. The content script can't be a
// module, so it has its own build (vite.content.config.ts) that runs after this one.
import preact from "@preact/preset-vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { keyruneGlyphs } from "./src/build/keyrune.ts";

export default defineConfig({
  root: "src",
  publicDir: resolve(import.meta.dirname, "public"),
  plugins: [preact(), keyruneGlyphs()],
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    target: "firefox128",
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      input: {
        pick: resolve(import.meta.dirname, "src/pages/pick/index.html"),
        label: resolve(import.meta.dirname, "src/pages/label/index.html"),
        background: resolve(import.meta.dirname, "src/background/index.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
