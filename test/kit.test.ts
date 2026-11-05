import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorChecks } from "../src/doctor.ts";
import { cutLine, kitMain, writeOptions } from "../src/kit-cli.ts";
import { kitDiff, kitOthers, kitMarkdown, ownerOf, readKit, wantedKit } from "../src/kit.ts";
import { pathsFor } from "../src/paths.ts";

const want = { pi: "1.4.0", packages: { a: "1.0.0" }, owners: ["Lineclear", "herdr"] };

/** A pi folder with one package, a Lineclear extension, a herdr one and an old one. */
function world() {
  const home = mkdtempSync(join(tmpdir(), "kit-"));
  const pi = join(home, ".pi", "agent");
  mkdirSync(join(pi, "extensions", "quota"), { recursive: true });
  mkdirSync(join(pi, "npm", "node_modules", "a"), { recursive: true });
  mkdirSync(join(pi, "skills", "herdr"), { recursive: true });
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ packages: ["npm:a@1.0.0"] }));
  writeFileSync(join(pi, "npm", "node_modules", "a", "package.json"), JSON.stringify({ version: "1.0.0" }));
  writeFileSync(join(pi, "extensions", "lineclear.ts"), "export {};\n");
  writeFileSync(join(pi, "extensions", "herdr-agent-state.ts"), "// installed by herdr\n");
  writeFileSync(join(pi, "extensions", "api-guard.ts"), "export {};\n");
  return { HOME: home, PI_CODING_AGENT_DIR: pi, LINECLEAR_CONFIG: join(home, "config") };
}

test("the kit is what the folders hold, with each extension's owner", () => {
  const kit = readKit(world(), () => "1.4.0");
  expect(kit.packages).toEqual([{ name: "a", spec: "npm:a@1.0.0", version: "1.0.0" }]);
  expect(kit.extensions.map((e) => `${e.name}:${e.owner}`)).toEqual(["api-guard:other", "herdr-agent-state:herdr", "lineclear:Lineclear", "quota:other"]);
  expect(kit.skills).toContain("herdr");
  expect(ownerOf("lineclear.ts", "")).toBe("Lineclear");
});

test("a kit that differs from the release names each difference", () => {
  const kit = readKit(world(), () => "1.3.0");
  expect(kitDiff(kit, want)).toEqual(["pi is 1.3.0, the release wants 1.4.0"]);
  // extensions Lineclear did not install are the owner's: named for information, never a difference
  expect(kitOthers(kit)).toEqual(["api-guard", "quota"]);
  expect(kitDiff({ ...kit, extensions: [{ name: "x", owner: "stranger" }] }, want)).toEqual([
    "pi is 1.3.0, the release wants 1.4.0",
    "extension x (stranger) is not in the release's kit",
  ]);
  expect(kitDiff({ ...kit, pi: "1.4.0", extensions: [] }, want)).toEqual([]);
  expect(kitDiff({ ...kit, pi: "1.4.0", extensions: [], packages: [] }, want)).toEqual(["a is missing, the release wants 1.0.0"]);
});

test("doctor fails a machine whose kit differs and one it cannot read", () => {
  const here = readKit(world(), () => "1.4.0");
  const checks = doctorChecks({
    oldDir: "/none",
    paths: pathsFor({ HOME: "/none" }),
    pathDirs: [],
    which: () => "x",
    run: () => null,
    kit: { here, want, others: [{ host: "t", diff: null }] },
  });
  const rows = checks.filter((c) => c.name.startsWith("agent kit"));
  expect(rows.map((c) => c.name)).toEqual(["agent kit on this machine", "agent kit on t"]);
  expect(rows[0]?.problem).toBe("");
  expect(rows[0]?.info).toBe("extensions of its owner, left alone: api-guard, quota");
  expect(rows[1]?.problem).toBe("t cannot be read");
});

test("the document lists each machine and says when nothing was measured", () => {
  const text = kitMarkdown(
    [
      { name: "this machine", kit: readKit(world(), () => "1.4.0") },
      { name: "other", kit: null },
    ],
    want,
    [],
    "2026-10-01",
  );
  expect(text).toContain("## this machine");
  expect(text).toContain("Could not be read.");
  expect(text).toContain("Not measured here");
  const fx = kitMarkdown([], want, [{ part: "cut-output", on: { perStep: 1.5, tokens: 1000, steps: 3 }, off: null }], "2026-10-01");
  expect(fx).toContain("| cut-output | $1.50, 1000 tokens (3 steps) | not measured |");
});

test("kit --json prints the kit and bad arguments print the usage", () => {
  const out: string[] = [];
  expect(kitMain(["--json"], (l) => out.push(l), world())).toBe(0);
  expect(JSON.parse(out[0] as string).packages[0].name).toBe("a");
  expect(kitMain(["--nope"], (l) => out.push(l), world())).toBe(2);
  expect(wantedKit().packages["pi-web-access"]).toBeString();
});

test("kit --write reads the project with or without a date", () => {
  expect(writeOptions(["p"])?.project).toBe("p");
  expect(writeOptions(["p", "--since", "2026-01-01"])).toEqual({ project: "p", since: "2026-01-01" });
  expect(writeOptions(["--since", "2026-01-01", "p"])?.project).toBe("p");
  expect(writeOptions([])?.project).toBeUndefined();
  expect(writeOptions(["--since", "soon"])).toBeNull();
  expect(writeOptions(["a", "b"])).toBeNull();
});

test("the cut line says how many cuts ran the command again", () => {
  const home = mkdtempSync(join(tmpdir(), "kit-cut-"));
  const log = join(home, "pack");
  mkdirSync(log, { recursive: true });
  const rows = [
    { ev: "cut", session: "s", id: 1 },
    { ev: "cut", session: "s", id: 2 },
    { ev: "read-again", session: "s", id: 1, how: "file" },
    { ev: "read-again", session: "s", id: 2, how: "rerun" },
  ];
  writeFileSync(join(log, "cut-output.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n"));
  expect(cutLine({ LINECLEAR_STATE: home })).toBe("cut-output: 2 cuts, 1 read through the saved file only, 1 (50 %) ran the command again");
  expect(cutLine({ LINECLEAR_STATE: join(home, "none") })).toBe("cut-output: no cut logged yet");
});
