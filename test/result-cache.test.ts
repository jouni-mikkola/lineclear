import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordPassed, splitCached } from "../scripts/result-cache.ts";

test("a passed test file is not run again until it or a file it loads changes", () => {
  const root = mkdtempSync(join(tmpdir(), "rc-"));
  const before = process.env.LINECLEAR_CONFIG;
  const config = mkdtempSync(join(tmpdir(), "rc-config-"));
  process.env.LINECLEAR_CONFIG = config;
  writeFileSync(join(root, "a.test.ts"), "test a");
  writeFileSync(join(root, "lib.ts"), "v1");
  const map = { "a.test.ts": ["a.test.ts", "lib.ts"] };
  const first = splitCached(root, ["./a.test.ts", "./b.test.ts"], map, "bun1");
  expect(first.run).toEqual(["./a.test.ts", "./b.test.ts"]); // nothing passed yet; b is not in the map
  recordPassed(root, first.keys, first.run);
  expect(readFileSync(join(config, "check-runs.jsonl"), "utf8")).toContain('"kind":"pass"');
  expect(splitCached(root, ["./a.test.ts", "./b.test.ts"], map, "bun1")).toMatchObject({ cached: ["./a.test.ts"], run: ["./b.test.ts"] });
  writeFileSync(join(root, "other.ts"), "a main change the test does not load");
  expect(splitCached(root, ["./a.test.ts"], map, "bun1").cached).toEqual(["./a.test.ts"]);
  writeFileSync(join(root, "lib.ts"), "v2");
  expect(splitCached(root, ["./a.test.ts"], map, "bun1").run).toEqual(["./a.test.ts"]);
  writeFileSync(join(root, "lib.ts"), "v1");
  expect(splitCached(root, ["./a.test.ts"], map, "bun2").run).toEqual(["./a.test.ts"]); // another bun
  if (before === undefined) delete process.env.LINECLEAR_CONFIG;
  else process.env.LINECLEAR_CONFIG = before;
});
