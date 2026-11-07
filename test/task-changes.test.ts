import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDiff, taskChanges } from "../src/task-changes.ts";

const sh = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdout: "pipe", stderr: "pipe" });

test("a branch's diff is split by file with its counts, and a binary file has no lines", () => {
  const out = [
    "diff --git a/a.ts b/a.ts",
    "index 1..2 100644",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -1,2 +1,2 @@",
    " keep",
    "-old",
    "+new",
    "diff --git a/b.png b/b.png",
    "new file mode 100644",
    "Binary files /dev/null and b/b.png differ",
    "",
  ].join("\n");
  const { files, more } = parseDiff(out);
  expect(more).toBe(0);
  expect(files[0]).toMatchObject({ path: "a.ts", added: 1, removed: 1, cut: 0 });
  expect(files[0]?.lines[0]).toBe("@@ -1,2 +1,2 @@");
  expect(files[1]).toMatchObject({ path: "b.png", binary: true, lines: [] });
});

test("a long file is cut and files past the cap are counted", () => {
  const big = `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1,500 @@\n${Array.from({ length: 500 }, (_, i) => `+l${i}`).join("\n")}\n`;
  expect(parseDiff(big).files[0]).toMatchObject({ added: 500, cut: 101 });
  const many = Array.from({ length: 85 }, (_, i) => `diff --git a/f${i} b/f${i}\n--- a/f${i}\n+++ b/f${i}\n@@ -1 +1 @@\n-a\n+b\n`).join("");
  expect(parseDiff(many)).toMatchObject({ more: 5 });
});

test("a task's changes come from its worktree against its base", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-changes-"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  sh(repo, "init", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "one\n");
  sh(repo, "add", ".");
  sh(repo, "commit", "-m", "first");
  sh(repo, "checkout", "-b", "work");
  writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
  sh(repo, "commit", "-am", "second");
  writeFileSync(join(dir, "tasks.json"), JSON.stringify({ tasks: [{ id: "A-1", worktree: repo }] }));
  const read = taskChanges("A-1", dir, false);
  expect(read?.base).toBe("main");
  expect(read?.files).toMatchObject([{ path: "a.txt", added: 1, removed: 0 }]);
  expect(taskChanges("B-2", dir, false)).toBeUndefined();
});
