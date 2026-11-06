import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { release } from "../scripts/release-tag.ts";
import { sh, tmp } from "./helpers.ts";

/** A small repo with a package.json, as release sees this one. */
function makeRepo(): string {
  const repo = join(tmp("release"), "repo");
  mkdirSync(repo);
  const git = (...a: string[]) => sh(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ name: "x", version: "0.0.0" }, null, 2)}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  return repo;
}

const green = ["true"];
const noHeavy = { heavy: [] as string[] };
const installed = { install: () => ({ ok: true, out: "doctor: fine" }) };

test("a dirty tree refuses, and nothing is tagged", () => {
  const repo = makeRepo();
  writeFileSync(join(repo, "stray.txt"), "x");
  const r = release("0.1.0", { repo, check: green, ...installed, ...noHeavy });
  expect(r.ok).toBe(false);
  expect(r.lines.join("\n")).toContain("the tree is not clean");
  expect(sh(["git", "-C", repo, "tag"]).out.trim()).toBe("");
});

test("a red check refuses, and the version stays", () => {
  const repo = makeRepo();
  const r = release("0.1.0", { repo, check: ["false"], ...installed, ...noHeavy });
  expect(r.ok).toBe(false);
  expect(r.lines.join("\n")).toContain("is red");
  expect(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version).toBe("0.0.0");
  expect(sh(["git", "-C", repo, "tag"]).out.trim()).toBe("");
});

test("a failing heavy check refuses, and nothing is tagged", () => {
  const repo = makeRepo();
  const r = release("0.1.0", { repo, check: green, heavy: ["echo planted fault; exit 1"], ...installed });
  expect(r.ok).toBe(false);
  expect(r.lines.join("\n")).toContain("a heavy check fails");
  expect(sh(["git", "-C", repo, "tag"]).out.trim()).toBe("");
});

test("a bad version refuses", () => {
  expect(release("v1", { repo: makeRepo(), check: green, ...installed, ...noHeavy }).ok).toBe(false);
});

test("a green release sets the version, tags it, installs from the tag and does not push", () => {
  const repo = makeRepo();
  sh(["git", "-C", repo, "remote", "add", "origin", "/nonexistent/remote.git"]);
  let installedTag = "";
  const r = release("0.1.0", {
    repo,
    check: green,
    ...noHeavy,
    install: (_repo, tag) => {
      installedTag = tag;
      return { ok: true, out: "doctor: fine" };
    },
  });
  expect(r.ok).toBe(true);
  expect(installedTag).toBe("v0.1.0");
  expect(sh(["git", "-C", repo, "show", "v0.1.0:package.json"]).out).toContain('"version": "0.1.0"');
  expect(sh(["git", "-C", repo, "rev-list", "-n1", "v0.1.0"]).out.trim()).toBe(sh(["git", "-C", repo, "rev-parse", "HEAD"]).out.trim());
  expect(r.lines.join("\n")).toContain("not pushed");
  // the tag exists once: a second release of it refuses
  expect(release("0.1.0", { repo, check: green, ...installed, ...noHeavy }).lines.join("\n")).toContain("the tag v0.1.0 exists");
});

test("a failed install fails the release and takes the tag back", () => {
  const repo = makeRepo();
  const r = release("0.2.0", { repo, check: green, ...noHeavy, install: () => ({ ok: false, out: "no doctor" }) });
  expect(r.ok).toBe(false);
  expect(r.lines.join("\n")).toContain("taken back");
  expect(sh(["git", "-C", repo, "tag"]).out.trim()).toBe("");
  expect(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version).toBe("0.0.0");
});
