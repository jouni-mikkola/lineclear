import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordPassed, splitCached } from "../scripts/result-cache.ts";

test("a passed test file is not run again until it or a file it loads changes", () => {
  const root = mkdtempSync(join(tmpdir(), "rc-"));
  const before = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "rc-cache-"));
  writeFileSync(join(root, "a.test.ts"), "test a");
  writeFileSync(join(root, "lib.ts"), "v1");
  const map = { "a.test.ts": ["a.test.ts", "lib.ts"] };
  const first = splitCached(root, ["./a.test.ts", "./b.test.ts"], map, "bun1");
  expect(first.run).toEqual(["./a.test.ts", "./b.test.ts"]); // nothing passed yet; b is not in the map
  recordPassed(first.keys, first.run);
  expect(splitCached(root, ["./a.test.ts", "./b.test.ts"], map, "bun1")).toMatchObject({ cached: ["./a.test.ts"], run: ["./b.test.ts"] });
  writeFileSync(join(root, "lib.ts"), "v2");
  expect(splitCached(root, ["./a.test.ts"], map, "bun1").run).toEqual(["./a.test.ts"]);
  writeFileSync(join(root, "lib.ts"), "v1");
  expect(splitCached(root, ["./a.test.ts"], map, "bun2").run).toEqual(["./a.test.ts"]); // another bun
  if (before === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = before;
});
