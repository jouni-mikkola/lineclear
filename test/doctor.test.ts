import { tailnetName } from "../src/published.ts";
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trimCache } from "../src/tmpdirs.ts";
import { doctor, doctorChecks, herdrVersions, realProbe, testedHerdr, type Probe } from "../src/doctor.ts";
import { storedTaskIds } from "../src/doctor-task-ids.ts";
import { cacheEnvFile, pathsFor } from "../src/paths.ts";

const paths = pathsFor({ HOME: "/nonexistent-home" });
const probe = (over: Partial<Probe> = {}): Probe => ({
  dataDir: "/nonexistent-home/data",
  paths,
  pathDirs: ["/nonexistent-home/.local/bin"],
  which: (c) => `/usr/bin/${c}`,
  run: () => null,
  ...over,
});

test("a missing tool is one problem with its installer command", () => {
  const checks = doctorChecks(probe({ which: (c) => (c === "herdr" ? null : `/usr/bin/${c}`) }));
  const herdr = checks.find((c) => c.name === "herdr");
  expect(herdr?.problem).toBe("herdr is not installed");
  expect(herdr?.fix).toBe("curl -fsSL https://herdr.dev/install.sh | sh");
});

test("doctor prints the model a new task would use", () => {
  const lines: string[] = [];
  doctor(probe({ newTaskModel: () => "fakeco/zeta-1" }), (l) => lines.push(l));
  expect(lines).toContain("ok     new task model: fakeco/zeta-1");
});

test("doctor does not ask for herdr-projects 2.0 to be installed", () => {
  const names = doctorChecks(probe()).map((c) => c.name);
  expect(names).not.toContain("herdr-projects");
});

test("doctor exits 1 and prints one fix per problem on a machine with nothing installed", () => {
  const out: string[] = [];
  const code = doctor(probe({ which: () => null, pathDirs: [] }), (l) => out.push(l));
  expect(code).toBe(1);
  expect(out.filter((l) => l.startsWith("FAILED"))).toHaveLength(out.filter((l) => l.includes("fix:")).length);
  expect(out.join("\n")).toContain("git is not installed");
});

test("a failing command's exit code and last lines are shown, secrets masked", () => {
  const probe = realProbe(paths, { LINECLEAR_CONFIG: "/nonexistent" });
  expect(probe.run(["sh", "-c", "echo boom >&2; exit 3"])).toBeNull();
  expect(probe.failure).toBe("exit 3\nboom");
});

test("doctor prints the failure tail under a problem", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-svc-"));
  const own = pathsFor({ HOME: dir });
  mkdirSync(join(own.unit, ".."), { recursive: true });
  writeFileSync(own.unit, `ExecStart=${own.app}/bin/lineclear run\n`);
  const lines: string[] = [];
  const bus = (cmd: string[]) => (cmd.includes("show-environment") ? "" : null);
  doctor(probe({ paths: own, run: bus, failure: "exit 7\nno service" }), (l) => lines.push(l));
  expect(lines.join("\n")).toContain("is not running\nexit 7\nno service");
  rmSync(dir, { recursive: true });
});

test("a machine with no systemd user services needs no unit: the loop runs with its board", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-nobus-"));
  const own = pathsFor({ HOME: dir });
  const svc = doctorChecks(probe({ paths: own, run: () => null })).find((c) => c.name.startsWith("service"));
  expect(svc?.problem).toBe("");
  expect(svc?.name).toContain("`lineclear run`");
  rmSync(dir, { recursive: true });
});

test("doctor warns when the server listens beyond 127.0.0.1, with the command that fixes it", () => {
  const name = "listens on 127.0.0.1 only";
  const find = (over: Partial<Probe>) => doctorChecks(probe(over)).find((c) => c.name === name)!;
  expect(find({}).problem).toBe("");
  expect(find({ listen: "127.0.0.1" }).problem).toBe("");
  const wide = find({ listen: "0.0.0.0" });
  expect(wide.problem).toContain("0.0.0.0");
  expect(wide.fix).toContain("unset-environment LINECLEAR_HOST");
  expect(wide.fix).toContain("restart lineclear.service");
  const dir = mkdtempSync(join(tmpdir(), "doctor-listen-"));
  const own = pathsFor({ HOME: dir });
  mkdirSync(join(own.unit, ".."), { recursive: true });
  writeFileSync(own.unit, `ExecStart=${own.app}/bin/lineclear run\nEnvironment=LINECLEAR_HOST=0.0.0.0\n`);
  expect(find({ paths: own }).problem).toContain("0.0.0.0");
  rmSync(dir, { recursive: true });
});

test("agents are told nothing about herdr-projects 2.0 or its plugin", () => {
  const root = join(import.meta.dir, "..", "server");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).filter((x) => !x.isSymbolicLink()))
      e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name));
  };
  walk(join(root, "skill"));
  files.push(join(root, "server", "live", "prompts.ts"));
  for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(/herdr-projects/);
  // the skills the brief points to are this repo's own, found beside the code and not in a herdr plugin folder
  const brief = readFileSync(join(root, "server", "live", "prompts.ts"), "utf8");
  expect(brief).toContain("const SKILLS = join(OWN, 'skill')");
  for (const n of ["lineclear", "lineclear-agent", "lineclear-coordinator"]) expect(existsSync(join(root, "skill", n, "SKILL.md"))).toBe(true);
});

test("doctor checks lingering and names the one command that turns it on", () => {
  const off = doctorChecks(probe({ user: "ann", run: (c) => (c[0] === "loginctl" ? "Linger=no\n" : null) })).find((c) => c.name === "starts at boot");
  expect(off?.problem).toContain("lingering is off for ann");
  expect(off?.fix).toBe("sudo loginctl enable-linger ann");
  const on = doctorChecks(probe({ user: "ann", run: (c) => (c[0] === "loginctl" ? "Linger=yes\n" : null) })).find((c) => c.name === "starts at boot");
  expect(on?.problem).toBe("");
});

test("the compile cache is trimmed oldest first to its cap", () => {
  const dir = mkdtempSync(join(tmpdir(), "lineclear-cache-"));
  try {
    for (const [name, age] of [
      ["a", 3],
      ["b", 2],
      ["c", 1],
    ] as const) {
      writeFileSync(join(dir, name), "x".repeat(100));
      utimesSync(join(dir, name), Date.now() / 1000 - age * 100, Date.now() / 1000 - age * 100);
    }
    expect(trimCache(dir, 200)).toBe(100);
    expect(readdirSync(dir).sort()).toEqual(["b", "c"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a machine whose herdr is not the tested one is named, and one that answers nothing too", () => {
  const answers: Record<string, string> = {
    "herdr --version": "herdr 0.9.5\n",
    "herdr machine list --json": JSON.stringify([
      { id: "a1", label: "desktop", enabled: true },
      { id: "b2", label: "old", enabled: false },
      { id: "c3", label: "laptop", enabled: true },
    ]),
    "timeout -k 5 20 herdr --machine a1 status server": "status: running\nversion: 0.9.6\n",
  };
  const asked: string[] = [];
  const machines = herdrVersions((cmd) => {
    asked.push(cmd.join(" "));
    return answers[cmd.join(" ")] ?? null;
  }, false);
  expect(machines).toEqual([
    { machine: "this machine", version: "0.9.5" },
    { machine: "desktop", version: "0.9.6" },
    { machine: "laptop", version: null },
  ]);
  expect(asked.some((c) => c.includes("--machine b2"))).toBe(false);
  const checks = doctorChecks(probe({ herdr: { tested: "0.9.5", machines } })).filter((c) => c.name.startsWith("herdr 0.9.5"));
  expect(checks.map((c) => c.problem)).toEqual(["", "desktop runs herdr 0.9.6, and Lineclear is tested with 0.9.5", "the herdr on laptop does not answer"]);
  expect(herdrVersions(() => "herdr 0.9.5", true)).toEqual([{ machine: "this machine", version: "0.9.5" }]);
});

test("the tested herdr is the adapter's pin", () => {
  const adapter = readFileSync(join(import.meta.dir, "..", "server", "server", "live", "herdr.ts"), "utf8");
  expect(adapter).toContain(`version: '${testedHerdr()}'`);
  expect(testedHerdr()).toMatch(/^\d+\.\d+\.\d+$/);
});

test("the stable build check fails for a checkout or a build that is not a release, and passes for a release", () => {
  const data = mkdtempSync(join(tmpdir(), "lineclear-builds-"));
  const build = (name: string, files: string[]) => {
    mkdirSync(join(data, "builds", name, "bin"), { recursive: true });
    for (const f of files) mkdirSync(join(data, "builds", name, f), { recursive: true });
    writeFileSync(join(data, "builds", name, "bin/lineclear"), "");
    return join(data, "builds", name, "bin/lineclear");
  };
  const check = (service: string, command: string) =>
    doctorChecks(probe({ dataDir: data, runFrom: { service, command } })).filter((c) => c.name === "stable build")[0] as { problem: string; fix: string };
  const release = build("1.0.0", []);
  writeFileSync(join(data, "builds/1.0.0/.release"), "1.0.0\n");
  const loose = build("scratch", []);
  const checkout = build("2.0.0", [".git"]);
  writeFileSync(join(data, "builds/2.0.0/.release"), "2.0.0\n");
  expect(check(release, release).problem).toBe("");
  expect(check(loose, release).problem).toContain("is not a release build");
  expect(check(release, checkout).problem).toContain("is a git checkout");
  const outside = join(data, "repo/bin/lineclear");
  mkdirSync(join(data, "repo/bin"), { recursive: true });
  writeFileSync(outside, "");
  expect(check(outside, release).problem).toContain("is not in");
  expect(check(release, release).fix).toContain("LINECLEAR_REF=v");
  rmSync(data, { recursive: true, force: true });
});

test("doctor fails on an installed file or pi setting that points into a git checkout, and names it", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-checkout-"));
  const own = pathsFor({ HOME: dir });
  const check = () => doctorChecks(probe({ paths: own, dataDir: join(dir, ".lineclear") })).find((c) => c.name === "installed paths");
  expect(check()?.problem).toBe("");
  const tree = join(dir, "work/tree");
  mkdirSync(join(tree, "pi"), { recursive: true });
  writeFileSync(join(tree, ".git"), "gitdir: /nowhere\n");
  mkdirSync(join(dir, ".pi/agent"), { recursive: true });
  const settings = join(dir, ".pi/agent/settings.json");
  writeFileSync(settings, JSON.stringify({ extensions: [join(tree, "pi/extension.ts")] }));
  expect(check()?.problem).toBe(`${settings} points into ${tree}`);
  rmSync(dir, { recursive: true, force: true });
});

test("a board unit beside the service fails the one-server check", () => {
  const unit = "lineclear-serve-7421.service loaded active running a\n";
  const two = doctorChecks(probe({ run: (c) => (c.includes("lineclear-serve-*.service") ? unit : null) })).find((c) => c.name === "one server");
  expect(two?.problem).toContain("lineclear-serve-7421.service");
  expect(two?.fix).toBe("systemctl --user disable --now lineclear-serve-7421.service");
  const one = doctorChecks(probe({ run: () => null })).find((c) => c.name === "one server");
  expect(one?.problem).toBe("");
});

test("doctor fails when the published address of the web pages does not answer", () => {
  const find = (p: Partial<Probe>) => doctorChecks(probe(p)).find((c) => c.name.startsWith("published address"));
  expect(find({})?.problem).toBe("");
  expect(find({ published: "https://box.ts.net:7420", run: (c) => (c[0] === "curl" ? "" : null) })?.problem).toBe("");
  const bad = find({ published: "https://box.ts.net:7420", run: () => null });
  expect(bad?.problem).toContain("https://box.ts.net:7420 does not answer");
  expect(bad?.fix).toBe("tailscale serve --bg --https=7420 http://127.0.0.1:7420");
});

test("the tailnet name comes from tailscale status", () => {
  expect(tailnetName('{"Self":{"DNSName":"box.tail1.ts.net."}}')).toBe("box.tail1.ts.net");
  expect(tailnetName("")).toBeUndefined();
});

test("doctor fails when NODE_COMPILE_CACHE is not set where install sets it, and the fix installs again", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-cache-"));
  const own = pathsFor({ HOME: dir });
  let withManager = "";
  const find = () => doctorChecks(probe({ paths: own, run: () => withManager })).find((c) => c.name === "compile cache on disk");
  expect(find()?.problem).toContain("NODE_COMPILE_CACHE");
  expect(find()?.fix).toContain("install.sh");
  mkdirSync(join(own.cacheEnv, ".."), { recursive: true });
  writeFileSync(own.cacheEnv, "NODE_COMPILE_CACHE=/tmp/node-compile-cache\n");
  expect(find()?.problem).not.toBe("");
  writeFileSync(own.cacheEnv, cacheEnvFile());
  expect(find()?.problem).not.toBe(""); // the manager does not have it
  withManager = cacheEnvFile();
  expect(find()?.problem).toBe("");
  expect(doctorChecks(probe({ paths: own })).find((c) => c.name === "compile cache on disk")?.skip).toBe(true); // no systemd user services
  rmSync(dir, { recursive: true });
});

test("a malformed models.json is a doctor problem and a good or missing one is not", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-models-"));
  const problem = () => doctorChecks(probe({ dataDir: dir })).find((c) => c.name === "models.json")?.problem;
  expect(problem()).toBe("");
  writeFileSync(join(dir, "models.json"), "{nope");
  expect(problem()).toContain("models.json");
});

test("doctor fails on a task id that two tasks hold, an alias counted, and passes on unique ids", () => {
  const find = (ids: string[]) => doctorChecks(probe({ taskIds: () => ids })).find((c) => c.name === "task ids");
  expect(find(["OMA-91", "OMA-92", "machine-b:OMA-91"])?.problem).toBe("");
  expect(find(["OMA-91", "OMA-92", "oma-91"])?.problem).toContain("OMA-91");
});

test("doctor reads the live store and its cold file for a duplicate task id", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-ids-"));
  writeFileSync(join(dir, "tasks.json"), JSON.stringify({ tasks: [{ id: "OMA-91" }] }));
  writeFileSync(join(dir, "tasks-cold.jsonl"), `${JSON.stringify({ id: "OMA-91" })}\n`);
  const cold = join(dir, "tasks-cold.jsonl");
  writeFileSync(
    cold,
    `${JSON.stringify({ id: "OMA-5" })}\n${JSON.stringify({ id: "OMA-5", title: "b" })}\n${JSON.stringify({ id: "OMA-6" })}\n${JSON.stringify({ gone: "OMA-6" })}\n{cut`,
  );
  expect(storedTaskIds(dir).sort()).toEqual(["OMA-5", "OMA-91"]);
  writeFileSync(cold, `${JSON.stringify({ id: "OMA-91" })}\n`);
  expect(doctorChecks(probe({ taskIds: () => storedTaskIds(dir) })).find((c) => c.name === "task ids")?.problem).toContain("OMA-91");
});
