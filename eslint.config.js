import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "dist/", "dist-harness/", "coverage/", "spikes/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Release tooling runs under Node.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
);
