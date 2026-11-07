import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
// The wordmark drawn inline, so it is in the first paint, before any script runs.
const WORDMARK = readFileSync(new URL("../brand/wordmark.svg", import.meta.url), "utf8").replace(
  "<svg ",
  '<svg role="img" aria-label="Lineclear" class="h-7 w-auto" ',
);

/** index.html's `<!--wordmark-->` becomes the wordmark itself, and the views draw it from `__WORDMARK__`. */
const wordmark: Plugin = {
  name: "wordmark",
  transformIndexHtml: (html) => html.replace("<!--wordmark-->", WORDMARK),
  config: () => ({ define: { __WORDMARK__: JSON.stringify(WORDMARK) } }),
};

// Lineclear's web pages. `bun run web:build` (and install.sh) builds them into dist, and `lineclear run` serves that.
export default defineConfig({ root: import.meta.dirname, plugins: [react(), tailwindcss(), wordmark], build: { outDir: "dist", emptyOutDir: true } });
