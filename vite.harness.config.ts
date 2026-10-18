// Dev-only: bundles src/devtools/harness.tsx for injection into a moxfield.com tab (see that file).
import preact from "@preact/preset-vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { keyruneGlyphs } from "./src/build/keyrune.ts";

export default defineConfig({
  publicDir: false,
  plugins: [preact(), keyruneGlyphs()],
  build: {
    outDir: resolve(import.meta.dirname, "dist-harness"),
    emptyOutDir: true,
    target: "firefox128",
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/devtools/harness.tsx"),
      formats: ["iife"],
      name: "magicPickleHarnessBundle",
      fileName: () => "harness.js",
      cssFileName: "harness",
    },
  },
});
