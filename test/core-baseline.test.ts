import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const turn = JSON.stringify({ message: { role: "assistant", usage: { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 3000 } } });

function session(home: string, cwd: string): void {
  const dir = join(home, ".pi/agent/sessions", `--${cwd.slice(1).replaceAll("/", "-")}--`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "2026-11-07T01-00-00-000Z_a.jsonl"), `${turn}\n${turn}\n`);
}

test("chat-tokens sees the coordinator and the Dispatcher in a session folder", () => {
  const home = mkdtempSync(join(tmpdir(), "chat-tokens-"));
  mkdirSync(join(home, ".lineclear"), { recursive: true });
  writeFileSync(join(home, ".lineclear/spaces.json"), JSON.stringify([{ name: "app", path: "/work/app" }]));
  session(home, "/work/app");
  session(home, join(home, ".config/lineclear/dispatcher"));

  const out = spawnSync("bun", [join(import.meta.dir, "../scripts/core-baseline.ts"), "chat-tokens", "20"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  }).stdout;

  expect(out).toContain("coordinator input (new), k tokens per session: median 8 k");
  expect(out).toContain("Dispatcher input (new), k tokens per session: median 8 k");
  expect(out.match(/\(1 runs\)/g)?.length).toBe(6);
});
