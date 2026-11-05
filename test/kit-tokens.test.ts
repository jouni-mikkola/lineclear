// No view uses a colour or a type size outside the tokens (ui/brand/tokens.css): the kit and the views name colours
// by token (`bg-raised`, `var(--lc-fg)`) and sizes by the scale (`text-sm`), never by a value of their own.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const files = ["ui/kit", "ui/web"].flatMap((dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(
      (f) =>
        f.isFile() &&
        !/(^|\/)(dist|node_modules|public)(\/|$)/.test(f.parentPath) &&
        /\.(tsx?|css)$/.test(f.name) &&
        !/-(samples|print)\.ts$/.test(f.name) &&
        f.name !== "samples.ts",
    )
    .map((f) => join(f.parentPath, f.name)),
);

const offences = (re: RegExp) =>
  files.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .flatMap((line, i) => (line.trimStart().startsWith("//") ? [] : [...line.matchAll(re)].map((m) => `${f}:${i + 1} ${m[0]}`))),
  );

test("no colour outside the tokens", () => {
  expect(
    offences(
      /#[0-9a-fA-F]{3,8}\b(?![\w-])|\b(?:rgb|rgba|hsl|hsla|oklch)\(|\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|shadow)-(?:white|black|(?:red|green|amber|gray|zinc|neutral|slate|stone|orange|yellow|blue)-\d+)\b/g,
    ),
  ).toEqual([]);
});

test("no type size off the scale", () => {
  // the scale is text-xs 12, sm 14, base 16, lg 18 (a card or section title), xl 22 (a detail), 2xl 32 (a view title
  // on a phone) and answer 48: a size in px, rem or em, or a font-size of its own, is off it
  expect(offences(/\btext-\[[^\]]*\]|font-size\s*:\s*[^;}]*\d|fontSize\s*[:=]\s*[{"']?\s*\d/g)).toEqual([]);
});

test("the tokens hold the board's measures and surface steps", () => {
  const css = readFileSync("ui/brand/tokens.css", "utf8");
  for (const t of [
    "--lc-unit: 4px",
    "--lc-rail-w: 232px",
    "--lc-content-w: 1128px",
    "--lc-row: 44px",
    "--lc-row-phone: 48px",
    "--lc-radius: 12px",
    "--lc-raised-2",
    "--lc-raised-3",
    "--lc-line3",
    "--lc-hover-ms: 120ms",
    "--lc-press-ms: 100ms",
  ]) {
    expect(css).toContain(t);
  }
});
