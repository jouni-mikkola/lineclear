import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

test("TypeScript is strict and covers src and test", () => {
  const config = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
  expect(config.compilerOptions.strict).toBe(true);
  expect(config.include).toEqual(expect.arrayContaining(["src", "test"]));
});

test("src, test and bin/lineclear exist, and the bin runs on Bun", () => {
  expect(statSync(join(root, "src")).isDirectory()).toBe(true);
  expect(statSync(join(root, "test")).isDirectory()).toBe(true);
  expect(existsSync(join(root, "bin/lineclear"))).toBe(true);
  expect(readFileSync(join(root, "bin/lineclear"), "utf8").startsWith("#!/usr/bin/env bun\n")).toBe(true);
  expect(statSync(join(root, "bin/lineclear")).mode & 0o111).not.toBe(0);
});
