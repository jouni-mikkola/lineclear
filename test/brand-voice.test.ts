import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { releaseProblems } from "../scripts/release-notes.ts";

const root = join(import.meta.dir, "..");

/** The voice's list of what is never written, from docs/brand.md. */
function never(brand: string): string[] {
  const list = brand.slice(brand.indexOf("<!-- voice:never -->"), brand.indexOf("<!-- /voice:never -->"));
  return [...list.matchAll(/^- (.+)$/gm)].map(([, w = ""]) => w.trim());
}

/** What a text says that the voice never says, each with the words around it. */
function offVoice(text: string, words: string[]): string[] {
  const plain = text.replace(/\s+/g, " ");
  return words.flatMap((w) => {
    // from the start of a word: "unlock" finds "unlocks", but "seamless" is not found in "unseamless"
    const i = plain.search(new RegExp(`(?<![\\w-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
    return i < 0 ? [] : [`"${w}" in "...${plain.slice(Math.max(0, i - 30), i + w.length + 30)}..."`];
  });
}

const NEVER = never(readFileSync(join(root, "docs", "brand.md"), "utf8"));

test("the voice's list is there and the check finds a word of it", () => {
  expect(NEVER.length).toBeGreaterThan(10);
  expect(NEVER).toContain("How it works");
  expect(offVoice("A seamless way to work.", NEVER)).toHaveLength(1);
  expect(offVoice("You decide. The rest runs on its own.", NEVER)).toEqual([]);
});

// The README joins this check when it takes its one form (U66, after the film of U68).
test("every release's notes keep the voice", () => {
  const dir = join(root, "docs", "releases");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) expect(offVoice(readFileSync(join(dir, f), "utf8"), NEVER), f).toEqual([]);
});

test("every release's notes follow the template and show what changed", () => {
  expect(releaseProblems(root)).toEqual([]);
});
