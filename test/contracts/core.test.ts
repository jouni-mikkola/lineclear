// The contract of core: what the other parts rely on from its safe writes, paths and name matching.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createAtomic, writeAtomic } from "../../pi/atomic.ts";
import { pathsFor } from "../../src/paths.ts";
import { projectsDir } from "../../src/project.ts";
import { nearest } from "../../src/resolve.ts";
import { tmp } from "../helpers.ts";

test("writeAtomic replaces the file whole and leaves no temp file", () => {
  const dir = tmp("contract-core");
  mkdirSync(join(dir, "a"));
  const file = join(dir, "a", "b.json");
  writeAtomic(file, "one");
  writeAtomic(file, "two");
  expect(readFileSync(file, "utf8")).toBe("two");
  expect(readdirSync(join(dir, "a"))).toEqual(["b.json"]);
});

test("createAtomic refuses a file that exists: the inbox numbers its items by it", () => {
  const file = join(tmp("contract-core"), "1.json");
  createAtomic(file, "first");
  expect(() => createAtomic(file, "second")).toThrow();
  expect(readFileSync(file, "utf8")).toBe("first");
});

test("the config folder follows LINECLEAR_CONFIG for every part", () => {
  const vars = { HOME: "/h", LINECLEAR_CONFIG: "/c" };
  expect(pathsFor(vars).config).toBe("/c");
  expect(projectsDir(vars)).toBe("/c/projects");
});

test("nearest names the closest name first, for a mistyped project or step", () => {
  expect(nearest("lineclaer", ["webshop", "lineclear"])[0]).toBe("lineclear");
});
