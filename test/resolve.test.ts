import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { fold, nearest, resolveProject, resolveStep } from "../src/resolve.ts";

const temps: string[] = [];
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

function config(names: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "lc-resolve-"));
  temps.push(dir);
  for (const [name, repo] of Object.entries(names)) {
    mkdirSync(join(dir, "projects", name), { recursive: true });
    writeFileSync(
      join(dir, "projects", name, "settings.json"),
      JSON.stringify({ repo, space: name, check: "true", models: { worker: [], reviewer: [], planner: [] } }),
    );
  }
  return { ...process.env, LINECLEAR_CONFIG: dir };
}

test("fold drops case, accents and punctuation", () => {
  expect(fold("Web-Shop")).toBe("webshop");
  expect(fold("Kärkäs Ääni")).toBe("karkasaani");
});

test("a project written loosely is found, or refused with the two nearest", () => {
  const e = config({ lineclear: "/r/lineclear", webshop: "/r/web-shop", budget: "/r/budget" });
  expect(resolveProject("lineclear", e)).toEqual({ name: "lineclear", loose: false });
  expect(resolveProject("Lineclear", e)).toEqual({ name: "lineclear", loose: true });
  expect(resolveProject("webshopin", e)).toEqual({ name: "webshop", loose: true });
  expect(resolveProject("Web-Shop", e)).toEqual({ name: "webshop", loose: true });
  expect(resolveProject("budg", e)).toEqual({ name: "budget", loose: true });
  expect(resolveProject("lineclaer", e)).toEqual({ name: "lineclear", loose: true });
  const bad = resolveProject("budjetti", e);
  expect("error" in bad && bad.error).toContain("no project 'budjetti', nearest: 'budget' and ");
  expect(resolveProject("xyz", config({}))).toEqual({ error: "no projects, add one with 'lineclear project add <repo>'" });
});

test("a project that fits two is refused", () => {
  const e = config({ budget: "/r/budget", budgeting: "/r/b2" });
  expect("error" in resolveProject("budg", e)).toBe(true);
});

const steps = [
  { id: "U40", title: "The line moves" },
  { id: "U41", title: "UI motion from one source" },
  { id: "L5", title: "Project settings" },
];

test("a step is found by id in any case or by title, or refused with the two nearest", () => {
  expect(resolveStep("U41", steps)).toEqual({ name: "U41", loose: false });
  expect(resolveStep("u41", steps)).toEqual({ name: "U41", loose: true });
  expect(resolveStep("project settings", steps)).toEqual({ name: "L5", loose: true });
  expect(resolveStep("motion", steps)).toEqual({ name: "U41", loose: true });
  expect(resolveStep("U42", steps)).toEqual({ error: "no step 'U42', nearest: 'U40 The line moves' and 'U41 UI motion from one source'" });
  expect(nearest("U42", ["U40", "U41", "L5"])).toEqual(["U40", "U41"]);
});

test("wrong arguments print the usage line, never a stack trace", async () => {
  const lines: string[] = [];
  expect(await main(["status", "--bogus"], (l) => lines.push(l))).toBe(2);
  expect(await main(["move", "x"], (l) => lines.push(l))).toBe(2);
  expect(await main(["plan"], (l) => lines.push(l))).toBe(2);
  expect(lines.join("\n")).toContain("usage: lineclear status");
  expect(lines.join("\n")).toContain("usage: lineclear move");
  expect(lines.join("\n")).toContain("usage: lineclear plan");
  expect(lines.join("\n")).not.toContain("    at ");
});
