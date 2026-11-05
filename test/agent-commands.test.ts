// L311: agents are told only `lineclear`. Every board command the code calls is a `lineclear` one, and no
// brief, skill, template or prompt tells an agent to run `shepherdr`.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { commands } from "../src/cli.ts";
import { brandedAnswer, isBoardJob } from "../src/serve.ts";

const root = join(import.meta.dir, "..");
const AGENT_DIRS = ["src", "pi", "scripts", "templates", "kit", "server/skill/lineclear", "server/skill/lineclear-agent", "server/skill/lineclear-coordinator"];

function filesUnder(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((n) => {
    const rel = join(dir, n);
    return statSync(join(root, rel)).isDirectory() ? filesUnder(rel) : /\.(ts|tsx|md|json)$/.test(n) ? [rel] : [];
  });
}
const lines = AGENT_DIRS.flatMap((d) => filesUnder(d)).flatMap((file) =>
  readFileSync(join(root, file), "utf8")
    .split("\n")
    .map((text, i) => ({ at: `${file}:${i + 1}`, text })),
);

const isComment = (file: string, t: string) => /\.tsx?:\d+$/.test(file) && /^\s*(\/\/|\*|\/\*)/.test(t);
/** A line that tells an agent to run the old command: in backticks or after "run", never in a pattern or a tag. */
const TELLS =
  /`shepherdr [a-z]|\b(run|use) shepherdr\b|\bshepherdr (ask|merge|status|wait|ready|done|card|task|space|show|heartbeat|pr|artifact|secret|models|checks|alert|todo|answer|mode)\b/i;
const IS_PATTERN = /\/[^/\n]*shepherdr[^/\n]*\/[gimsuy]*[.,;)]/;

test("no brief, skill, template or prompt tells an agent to run shepherdr", () => {
  const found = lines.filter((l) => !isComment(l.at, l.text) && !IS_PATTERN.test(l.text) && !l.text.includes("<shepherdr") && TELLS.test(l.text));
  expect(found.map((l) => `${l.at}: ${l.text.trim()}`)).toEqual([]);
});

test("the check catches a line that tells an agent to run shepherdr", () => {
  expect(TELLS.test("so its task list is there (shepherdr task list on box)")).toBe(true);
  expect(TELLS.test("Use shepherdr heartbeat to say you are alive")).toBe(true);
  expect(TELLS.test("Say where you are with `shepherdr status`, then carry on.")).toBe(true);
  expect(TELLS.test("then run shepherdr merge again")).toBe(true);
  expect(TELLS.test("so its task list is there (shepherdr task list on box)")).toBe(true);
  expect(TELLS.test("Use shepherdr heartbeat to say you are alive")).toBe(true);
  expect(TELLS.test("Say where you are with `lineclear status`.")).toBe(false);
});

/** Every board subcommand the code names: in backticks as `shepherdr <word>`, or as the word after the command in a call. */
function calledWords(): string[] {
  const words = new Set<string>();
  for (const l of lines) {
    if (l.text.includes("<shepherdr") || IS_PATTERN.test(l.text)) continue;
    for (const m of l.text.matchAll(/`shepherdr ([a-z][a-z-]*)\b/g)) words.add(m[1] as string);
    for (const m of l.text.matchAll(/\[(?:shepherdr|serverBin\([^)]*\)), "([a-z-]+)"/g)) words.add(m[1] as string);
  }
  return [...words];
}

const SAMPLE_ARGS: Record<string, string[]> = { status: ["T-1", "a line"], plan: ["--step", "L1"] };
// the board's `ask` is `lineclear card`: `ask` is the Inbox question of Lineclear
const RENAMED: Record<string, string> = { ask: "card" };

test("every board command the code calls is a lineclear command with the same output", () => {
  const words = calledWords();
  expect(words).toContain("task");
  expect(words).toContain("merge");
  for (const w of words) {
    const name = RENAMED[w] ?? w;
    const routed = isBoardJob(name, SAMPLE_ARGS[name] ?? []) || name in commands;
    expect({ word: w, routed }).toEqual({ word: w, routed: true });
    expect(brandedAnswer(`run shepherdr ${w} X-1`)).toBe(`run lineclear ${name} X-1`);
  }
});
