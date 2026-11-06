import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

test("the word Autopilot is in no doc, CLI help or page of Lineclear", () => {
  const files = Bun.spawnSync(["git", "-C", root, "ls-files", "*.md", "*.ts", "*.tsx", "*.css", "*.json"]).stdout.toString().split("\n");
  // the roadmap names the step that removed the word; this file names the word to look for it; source-d.test.ts feeds the old word to the server to see it refused
  const skip = (f: string) => f === "docs/ROADMAP.md" || f === "test/one-word.test.ts" || f === "server/test/source-d.test.ts" || f.includes("node_modules/");
  const hits = files.filter((f) => f && !skip(f) && /\bAutopilot\b/.test(readFileSync(join(root, f), "utf8")));
  expect(hits).toEqual([]);
});

test("the CLI help says coordinator timer, never autopilot", () => {
  for (const f of ["server/server/live/args.ts", "src/cli.ts"]) {
    const shown = readFileSync(join(root, f), "utf8")
      .split("\n")
      .filter((l) => /autopilot/i.test(l) && !/autopilot runtime|autopilot-runtime|autopilot-runs/.test(l));
    expect(shown, f).toEqual([]);
  }
});
