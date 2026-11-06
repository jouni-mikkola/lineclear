// The words check: fails on a word that `docs/brand.md` under "Words" lists as not used for a thing (its last column).
// It reads the views, the README and the docs. `ROADMAP.md`, `backlog.md` and `brand.md` itself are left
// out: the roadmap and the backlog are working text, and brand.md names the words it forbids.
import { readFileSync, readdirSync } from "node:fs";

export type Banned = { phrase: string; word: string };

/** The "Not these" cells of the Words table: each phrase with the word that should be used. */
export function bannedWords(brand: string): Banned[] {
  const words = brand.slice(brand.indexOf("\n## Words"), brand.indexOf("\n## Content"));
  const out: Banned[] = [];
  for (const line of words.split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    const [word = "", , , notThese = ""] = cells;
    if (cells.length !== 4 || word === "Word" || /^-+$/.test(word)) continue;
    for (const phrase of notThese
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean))
      out.push({ phrase, word });
  }
  return out;
}

const walk = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`, ext) : ext.test(e.name) ? [`${dir}/${e.name}`] : []));

/** Every file the check reads, relative to the repo root. */
export function wordFiles(root: string): string[] {
  const docs = readdirSync(`${root}/docs`)
    .filter((f) => f.endsWith(".md") && !["ROADMAP.md", "backlog.md", "brand.md"].includes(f))
    .map((f) => `docs/${f}`);
  const views = [...walk(`${root}/ui/kit`, /\.(tsx?|css)$/), ...walk(`${root}/ui/web`, /\.(tsx?|html|webmanifest)$/)].map((f) => f.slice(root.length + 1));
  return [...views, "README.md", ...docs, "docs/design/board.html"];
}

export function findWords(root: string): string[] {
  const banned = bannedWords(readFileSync(`${root}/docs/brand.md`, "utf8"));
  const hits: string[] = [];
  for (const file of wordFiles(root)) {
    const lines = readFileSync(`${root}/${file}`, "utf8").split("\n");
    for (const { phrase, word } of banned) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      lines.forEach((l, i) => {
        const m = re.exec(l);
        if (m) hits.push(`${file}:${i + 1}: "${m[0]}", brand.md says "${word}"`);
      });
    }
  }
  return hits;
}

if (import.meta.main) {
  const hits = findWords(process.argv[2] ?? ".");
  for (const h of hits) console.error(h);
  process.exit(hits.length > 0 ? 1 : 0);
}
