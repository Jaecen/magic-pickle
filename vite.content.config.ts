// The content script must be a single classic script, so it's built on its own as an IIFE.
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: false,
    target: "firefox128",
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/content/index.ts"),
      formats: ["iife"],
      name: "magicPickleContent",
      fileName: () => "content.js",
    },
  },
});
