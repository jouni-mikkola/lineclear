import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companyOf, type Described, describe, harnesses, readModelFile, readRegistry } from "../src/models.ts";

function fake(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "models-")), "fake");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

test("a model found nowhere in the repo is returned", () => {
  const pi = fake(`printf 'provider model context\\nacme zorblax-9 1M\\n'`);
  const reg = readRegistry(harnesses({ PI_BIN: pi }));
  expect(reg).toContainEqual({ harness: "pi", provider: "acme", name: "zorblax-9" });
});

test("a harness that fails or is missing adds nothing", () => {
  const bad = fake(`echo oops/model; exit 1`);
  expect(readRegistry(harnesses({ PI_BIN: bad }))).toEqual([]);
  expect(readRegistry(harnesses({ PI_BIN: "/nonexistent/x" }))).toEqual([]);
});

const reg = [
  { harness: "pi", provider: "acme", name: "zorblax-9" },
  { harness: "pi", provider: "other", name: "mystery-1" },
];

test("the file overrides a model over its provider, and a model with no entry stays as it is", () => {
  const dir = mkdtempSync(join(tmpdir(), "models-"));
  writeFileSync(
    join(dir, "models.json"),
    JSON.stringify({ providers: { acme: { company: "acme-corp", cost: 2 } }, models: { "acme/zorblax-9": { tier: "top", cost: 5 } } }),
  );
  const { file, problem } = readModelFile(dir);
  expect(problem).toBe("");
  const [a, b] = describe(reg, file);
  expect(a).toMatchObject({ company: "acme-corp", tier: "top", cost: 5 });
  expect(b).toEqual(reg[1]);
});

test("two unknown models from different providers are different companies", () => {
  const [a, b] = describe(reg, readModelFile("/nonexistent-dir").file);
  expect(companyOf(a as Described)).toBe("acme");
  expect(companyOf(b as Described)).toBe("other");
});

test("a malformed file is ignored", () => {
  const dir = mkdtempSync(join(tmpdir(), "models-"));
  writeFileSync(join(dir, "models.json"), JSON.stringify({ models: { "acme/zorblax-9": { cost: "cheap" } } }));
  const { file, problem } = readModelFile(dir);
  expect(problem).toContain("cost");
  expect(describe(reg, file)[0]).toEqual(reg[0]);
  writeFileSync(join(dir, "models.json"), "{nope");
  expect(readModelFile(dir).problem).toContain("not valid JSON");
});

test("a tier the file misspells is a problem, not the best rank", () => {
  const dir = mkdtempSync(join(tmpdir(), "models-"));
  writeFileSync(join(dir, "models.json"), JSON.stringify({ models: { "acme/zorblax-9": { tier: "Top" } } }));
  expect(readModelFile(dir).problem).toContain("tier");
});
