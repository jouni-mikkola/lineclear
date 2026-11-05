// The shots check: every picture embedded in the README or a docs page is not of the app, or is a screenshot that
// `bun run shots` took (docs/shots/list.md), and every screenshot in the list is a file.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { shotsIn, strayPictures } from "../src/shots.ts";

const root = process.argv[2] ?? ".";
const read = (file: string) => readFileSync(join(root, file), "utf8");
const listFile = join(root, "docs", "shots", "list.md");
const listed = existsSync(listFile) ? shotsIn(read("docs/shots/list.md")) : [];
const problems: string[] = [];
if (listed.length === 0) problems.push("docs/shots/list.md names no screenshot (run bun run shots)");
for (const name of listed) if (!existsSync(join(root, "docs", "shots", name))) problems.push(`docs/shots/${name} is listed but missing (run bun run shots)`);

const pages = [
  "README.md",
  ...readdirSync(join(root, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/${f}`),
];
for (const page of pages) problems.push(...strayPictures(page, read(page), listed));

for (const p of problems) console.error(`shots check: ${p}`);
process.exit(problems.length > 0 ? 1 : 0);
