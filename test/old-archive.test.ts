import { expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorChecks, type Probe } from "../src/doctor.ts";
import { archiveFolder } from "../src/old-archive.ts";
import { pathsFor } from "../src/paths.ts";
import { fixRetired } from "../src/retire.ts";

function home() {
  const root = mkdtempSync(join(tmpdir(), "lc-archive-"));
  const env = { LINECLEAR_ARCHIVE_DIR: join(root, "archive") };
  return { root, env };
}

test("a folder is packed to <name>-<date>.tgz and removed; a hard link into ~/.lineclear stays whole", () => {
  const { root, env } = home();
  const old = join(root, ".shepherdr");
  const kept = join(root, ".lineclear");
  mkdirSync(join(old, "helper"), { recursive: true });
  mkdirSync(kept);
  writeFileSync(join(old, "helper", "secret.json"), "whole file");
  linkSync(join(old, "helper", "secret.json"), join(kept, "secret.json"));
  const file = archiveFolder(old, env, new Date("2026-11-04T10:00:00Z"));
  expect(file).toBe(join(root, "archive", "shepherdr-2026-11-04.tgz"));
  expect(existsSync(file)).toBe(true);
  expect(existsSync(old)).toBe(false);
  expect(readFileSync(join(kept, "secret.json"), "utf8")).toBe("whole file");
  const list = Bun.spawnSync(["tar", "-tzf", file]).stdout.toString();
  expect(list).toContain(".shepherdr/helper/secret.json");
});

test("a second archive on one day keeps the first", () => {
  const { root, env } = home();
  const day = new Date("2026-11-04T10:00:00Z");
  const make = () => {
    const d = join(root, ".herdr-projects");
    mkdirSync(d);
    return archiveFolder(d, env, day);
  };
  const first = make();
  const second = make();
  expect(second).not.toBe(first);
  expect(existsSync(first)).toBe(true);
  expect(first).toBe(join(root, "archive", "herdr-projects-2026-11-04.tgz"));
});

const probe = (over: Partial<Probe>): Probe => ({
  oldDir: "/nonexistent-old",
  paths: pathsFor({ HOME: "/nonexistent-home" }),
  pathDirs: [],
  which: () => null,
  run: () => null,
  ...over,
});

test("doctor names the old folders and --fix archives them unless a process uses one", () => {
  const { root, env } = home();
  const a = join(root, ".shepherdr");
  const b = join(root, ".herdr-projects");
  mkdirSync(a);
  mkdirSync(b);
  const base = { oldFolders: [a, b], archiveFolder: (d: string) => archiveFolder(d, env) };
  const named = doctorChecks(probe(base)).find((c) => c.name === "old folders archived");
  expect(named?.problem).toContain(a);
  expect(named?.problem).toContain(b);

  const lines: string[] = [];
  expect(fixRetired(probe({ ...base, oldUsers: () => ["42 pi"] }), (l) => lines.push(l))).toBe(1);
  expect(lines.join("\n")).toContain("Kept");
  expect(existsSync(a) && existsSync(b)).toBe(true);

  expect(fixRetired(probe({ ...base, oldUsers: () => [] }), (l) => lines.push(l))).toBe(0);
  expect(existsSync(a) || existsSync(b)).toBe(false);
  expect(doctorChecks(probe({ oldFolders: [] })).find((c) => c.name === "old folders archived")?.problem).toBe("");
});

test("--fix keeps the old folders while a browser profile is not copied out yet", () => {
  const { root, env } = home();
  const old = join(root, ".shepherdr");
  mkdirSync(join(old, "browser", "T1"), { recursive: true });
  writeFileSync(join(old, "browser", "T1.used"), "");
  const p = probe({ oldDir: old, dataDir: join(root, "lc"), oldFolders: [old], archiveFolder: (d) => archiveFolder(d, env) });
  expect(fixRetired(p, () => {})).toBe(1);
  expect(existsSync(old)).toBe(true);
});
