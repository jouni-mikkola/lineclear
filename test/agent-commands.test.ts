import { expect, test } from "bun:test";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commands } from "../src/cli.ts";
import { boardMain, isBoardJob } from "../src/serve.ts";
import { tmp } from "./helpers.ts";

const ROOT = join(import.meta.dir, "..");
const DIRS = ["src", "pi", "scripts", "templates", "server/skill"];
// `lineclear <word>` in a code span or at the start of a line, and a spawn of the board command by its first word
const CALL = /(?:`|^\s*(?:\$ )?)lineclear (?:--url \S+ )?([a-z][a-z-]*)/g;
const SPAWN = /serverBin\([^)]*\)\s*,\s*\[?\s*"([a-z][a-z-]*)"/g;

/** Every subcommand the files call, with the first place that calls it. */
function calledSubcommands(): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of DIRS) {
    for (const file of new Bun.Glob(`${dir}/**/*.{ts,md,json,sh}`).scanSync(ROOT)) {
      const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const re of [CALL, SPAWN]) for (const m of line.matchAll(re)) if (m[1] && !found.has(m[1])) found.set(m[1], `${file}:${i + 1}`);
      });
    }
  }
  return found;
}

test("every subcommand that the code, skills and templates call is a lineclear command", () => {
  const called = calledSubcommands();
  expect(called.size).toBeGreaterThan(30);
  const missing = [...called].filter(([word]) => !(word in commands)).map(([word, at]) => `${word} (${at})`);
  expect(missing).toEqual([]);
});

test("a board job through lineclear passes the same arguments and gives the same output as the board command", async () => {
  const dir = tmp("agent-commands");
  const fake = join(dir, "board");
  writeFileSync(fake, '#!/bin/sh\necho "board: $*"\n');
  chmodSync(fake, 0o755);
  process.env.LINECLEAR_SERVER_BIN = fake;
  try {
    const samples: Record<string, string[]> = { status: ["LIN-1", "line", "--done", "50"], plan: ["LIN-1", "--step", "a step"] };
    for (const word of calledSubcommands().keys()) {
      const args = [word, ...(samples[word] ?? ["x", "--flag", "a b"])];
      // `secret` runs another command and shows its output live, untouched
      if (word === "secret" || !isBoardJob(word, args.slice(1))) continue;
      const lines: string[] = [];
      expect(await boardMain(args, (l) => lines.push(l))).toBe(0);
      expect(lines.join("\n")).toBe(`board: ${args.join(" ")}`);
    }
  } finally {
    delete process.env.LINECLEAR_SERVER_BIN;
  }
});
