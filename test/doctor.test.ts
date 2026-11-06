import { tailnetName } from "../src/published.ts";
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trimCache } from "../src/tmpdirs.ts";
import { doctor, doctorChecks, herdrVersions, realProbe, testedHerdr, type Probe } from "../src/doctor.ts";
import { cacheEnvFile, pathsFor } from "../src/paths.ts";
import { isOpen, noticeTimers, readItems } from "../src/inbox.ts";
import { fixRetired } from "../src/retire.ts";

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
  expect(svc?.name).toContain("lineclear run --board");
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

test("doctor names coordinator timers, and --fix turns them off", () => {
  const timerSetting = process.env.LINECLEAR_COORDINATOR_TIMER;
  delete process.env.LINECLEAR_COORDINATOR_TIMER;
  const dir = mkdtempSync(join(tmpdir(), "doctor-retired-"));
  const data = join(dir, "data");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "modes.json"), JSON.stringify({ a: "autopilot", b: "regular" }));
  const p = probe({ dataDir: data });
  const mine = ["no coordinator on a timer"];
  const bad = () =>
    doctorChecks(p)
      .filter((c) => mine.includes(c.name) && c.problem !== "")
      .map((c) => c.name);
  expect(bad()).toEqual(["no coordinator on a timer"]);
  const out: string[] = [];
  fixRetired(p, (l) => out.push(l));
  expect(out).toEqual(["Turned off the timer of a"]);
  expect(bad()).toEqual([]);
  writeFileSync(join(data, "modes.json"), JSON.stringify({ a: "autopilot" }));
  const live: string[] = [];
  const asked: string[] = [];
  expect(
    fixRetired(
      {
        ...p,
        running: () => true,
        setRegular: (id) => {
          asked.push(id);
          return true;
        },
      },
      (l) => live.push(l),
    ),
  ).toBe(0);
  expect(asked).toEqual(["a"]);
  expect(JSON.parse(readFileSync(join(data, "modes.json"), "utf8"))).toEqual({ a: "autopilot" });
  expect(fixRetired({ ...p, running: () => true, setRegular: () => false }, (l) => live.push(l))).toBe(1);
  expect(live.at(-1)).toContain("did not take the change");
  writeFileSync(join(data, "modes.json"), JSON.stringify({ a: "regular", b: "regular" }));
  expect(JSON.parse(readFileSync(join(data, "modes.json"), "utf8"))).toEqual({ a: "regular", b: "regular" });
  if (timerSetting !== undefined) process.env.LINECLEAR_COORDINATOR_TIMER = timerSetting;
  rmSync(dir, { recursive: true });
});

test("heal never flips a mode: it shows the timer in the Inbox once, and honours LINECLEAR_COORDINATOR_TIMER like the server", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-heal-"));
  const data = join(dir, "data");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "modes.json"), JSON.stringify({ a: "autopilot" }));
  const p = probe({ dataDir: data });
  const env = { ...process.env, HOME: dir, LINECLEAR_CONFIG: join(dir, "config"), LINECLEAR_COORDINATOR_TIMER: undefined };
  const out: string[] = [];
  const was = process.env.LINECLEAR_COORDINATOR_TIMER;
  delete process.env.LINECLEAR_COORDINATOR_TIMER;
  const report = (spaces: string[]) => noticeTimers(spaces, env);
  fixRetired(p, (l) => out.push(l), report);
  fixRetired(p, (l) => out.push(l), report);
  expect(out).toEqual([]);
  expect(JSON.parse(readFileSync(join(data, "modes.json"), "utf8"))).toEqual({ a: "autopilot" });
  const open = readItems(env).filter(isOpen);
  expect(open).toHaveLength(1);
  expect(open[0]!.question).toContain("Coordinator timer is on for a");
  process.env.LINECLEAR_COORDINATOR_TIMER = "on";
  try {
    expect(doctorChecks(p).find((c) => c.name === "no coordinator on a timer")?.problem).toBe("");
  } finally {
    if (was === undefined) delete process.env.LINECLEAR_COORDINATOR_TIMER;
    else process.env.LINECLEAR_COORDINATOR_TIMER = was;
  }
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

test("doctor shows the builds, names a roadmap stable cannot read, and says when another machine promotes", () => {
  const at = "2026-11-01T12:12:00Z";
  const release = {
    stable: { commit: "a".repeat(40), at },
    next: { commit: "b".repeat(40), at, result: "red" as const },
    checked: at,
    held: "next bbbbbbb failed: smoke",
  };
  const check = (over: Partial<Probe>) => doctorChecks(probe(over)).find((c) => c.name === "release");
  expect(check({})?.skip).toBe(true);
  expect(check({ release })?.problem).toBe("");
  expect(check({ release })?.info).toContain("held next bbbbbbb failed: smoke");
  expect(check({ release: { ...release, held: "cannot read main: ROADMAP.md:3" } })?.problem).toBe("cannot read main: ROADMAP.md:3");
  expect(check({ release: { ...release, held: "cannot read main: no ref" }, ci: true })?.problem).toBe("");
  expect(check({ release, follows: "desk" })?.info).toBe("follows desk, which promotes for it");
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

test("two board units on one store fail the one-server check", () => {
  const units = "lineclear-serve-7421.service loaded active running a\nlineclear-serve-7787.service loaded active running b\n";
  const two = doctorChecks(probe({ run: (c) => (c.includes("lineclear-serve-*.service") ? units : null) })).find((c) => c.name === "one server");
  expect(two?.problem).toContain("lineclear-serve-7787.service");
  expect(two?.fix).toBe("systemctl --user stop lineclear-serve-7787.service");
  const one = doctorChecks(probe({ run: (c) => (c.includes("lineclear-serve-*.service") ? units.split("\n").slice(0, 1).join("") : null) })).find(
    (c) => c.name === "one server",
  );
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
