import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installMachine, machineMain, machinesView, remoteLoad } from "../src/machines.ts";
import { HOST, readMachines } from "../src/machine-list.ts";
import { until } from "./helpers.ts";

// a machine this one installs follows it: it takes this machine's promotions and makes none
const FOLLOWS = `LINECLEAR_FOLLOWS='${hostname().split(".")[0]}'`;
const FAKE_SSH = resolve(import.meta.dir, "..", "ui", "test", "fake-ssh");
let root: string;
let env: Record<string, string | undefined>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lineclear-machines-"));
  env = { HOME: root, PATH: process.env.PATH, LINECLEAR_CONFIG: join(root, "config"), LINECLEAR_SSH: FAKE_SSH, FAKE_SSH_LOG: join(root, "ssh.log") };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const log = () => readFileSync(join(root, "ssh.log"), "utf8");

test("adding a machine sends install.sh over SSH, runs its doctor there and saves it ready", async () => {
  const out: string[] = [];
  expect(await machineMain(["add", "me@build-box"], (l) => out.push(l), env)).toBe(0);
  expect(log()).toContain(`me@build-box env ${FOLLOWS} sh -s < #!/bin/sh`);
  expect(log()).toContain("me@build-box doctor");
  expect(out.at(-1)).toBe("me@build-box is ready: doctor passed there.");
  expect(readMachines(env)).toMatchObject([{ host: "me@build-box", state: "ready", doctor: ["ok     git", "ok     service", "All well."] }]);
});

test("the ref and repo go along, quoted", async () => {
  await installMachine("build-box", { ...env, LINECLEAR_REF: "work/x", LINECLEAR_REPO: "/srv/it's here" });
  expect(log()).toContain(`build-box env LINECLEAR_REF='work/x' LINECLEAR_REPO='/srv/it'\\''s here' ${FOLLOWS} sh -s < #!/bin/sh`);
});

test("a failed doctor or an unreachable host is saved as failed, with why", async () => {
  const out: string[] = [];
  expect(await machineMain(["add", "broken-box"], (l) => out.push(l), env)).toBe(1);
  expect(await machineMain(["add", "offline-box"], (l) => out.push(l), env)).toBe(1);
  const [broken, offline] = readMachines(env);
  expect(broken).toMatchObject({ host: "broken-box", state: "failed" });
  expect(broken!.doctor).toContain("FAILED service: lineclear.service is not running");
  expect(offline).toMatchObject({ host: "offline-box", state: "failed" });
  expect(offline!.doctor![0]).toBe("SSH could not reach offline-box.");
});

test("a host is never an option or a command", async () => {
  for (const bad of ["-oProxyCommand=x", "a b", "a;b", "$(x)", "", "a/b"]) expect(HOST.test(bad)).toBe(false);
  for (const good of ["build-box", "me@10.0.0.5", "box.example.com", "me@fe80::1"]) expect(HOST.test(good)).toBe(true);
  expect(await machineMain(["add", "-oProxyCommand=x"], () => {}, env)).toBe(1);
});

test("an install whose process is gone reads as failed", () => {
  mkdirSync(env.LINECLEAR_CONFIG!, { recursive: true });
  writeFileSync(
    join(env.LINECLEAR_CONFIG!, "machines.json"),
    JSON.stringify({ machines: [{ host: "a", state: "installing", since: "2026-01-01T00:00:00Z", pid: 2 ** 22 + 7 }] }),
  );
  expect(readMachines(env)).toMatchObject([{ host: "a", state: "failed", doctor: ["The install stopped before it finished. Try again."] }]);
});

test("list and remove", async () => {
  await installMachine("build-box", env);
  const out: string[] = [];
  await machineMain(["list"], (l) => out.push(l), env);
  expect(out[0]).toContain("this machine");
  expect(out[1]).toStartWith("build-box  ready");
  expect(await machineMain(["remove", "build-box"], () => {}, env)).toBe(0);
  expect(readMachines(env)).toEqual([]);
  expect(await machineMain(["remove", "build-box"], () => {}, env)).toBe(1);
});

test("a machine's load and limit come over SSH; the view reads them in the background", async () => {
  expect(await remoteLoad("build-box", env)).toEqual({ load: 2.5, limit: 4 });
  expect(await remoteLoad("offline-box", env)).toBeNull();
  await installMachine("build-box", env);
  const view = machinesView(env);
  const first = view();
  expect(first[0]).toMatchObject({ local: true });
  expect(first[1]).toMatchObject({ host: "build-box", state: "ready" });
  expect(first[1]!.load).toBeUndefined();
  await until(() => view()[1]?.load !== undefined);
  expect(view()[1]).toMatchObject({ host: "build-box", state: "ready", load: 2.5, limit: 4 });
});

test("a machine removed while it installs stays removed, and one installed again keeps its place", async () => {
  const slow = { ...env, FAKE_SSH_SECONDS: "1" };
  const install = installMachine("build-box", slow);
  await until(() => readMachines(env)[0]?.state === "installing");
  expect(readMachines(env)).toMatchObject([{ host: "build-box", state: "installing" }]);
  expect(await machineMain(["remove", "build-box"], () => {}, env)).toBe(0);
  await install;
  expect(readMachines(env)).toEqual([]);

  await installMachine("one", env);
  await installMachine("broken-two", env);
  await installMachine("three", env);
  await installMachine("broken-two", env);
  expect(readMachines(env).map((m) => m.host)).toEqual(["one", "broken-two", "three"]);
});

test("machine update runs install.sh again on each machine, without letting it update the others", async () => {
  await machineMain(["add", "build-box"], () => {}, env);
  const out: string[] = [];
  expect(await machineMain(["update"], (l) => out.push(l), env)).toBe(0);
  expect(log()).toContain(`build-box env LINECLEAR_NO_FANOUT='1' ${FOLLOWS} sh -s < #!/bin/sh`);
  expect(out.at(-1)).toBe("build-box is up to date.");
  expect(await machineMain(["update", "nowhere"], (l) => out.push(l), env)).toBe(1);
});

test("machines update in turn: a failure there stops the run and leaves the next machine on its old build", async () => {
  for (const h of ["good-box", "broken-box", "last-box"]) await installMachine(h, env);
  writeFileSync(join(root, "ssh.log"), "");
  const out: string[] = [];
  const code = await machineMain(["update"], (l) => out.push(l), env);
  expect(code).toBe(1);
  const lines = log()
    .split("\n")
    .filter((l) => l.includes(" sh -s < "));
  expect(lines.map((l) => `${l.split(" ")[0]} update`)).toEqual(["good-box update", "broken-box update"]);
  expect(out).toContain("good-box is up to date.");
  expect(out).toContain("Stopped: last-box stay on their old build.");
});

test("a good build reaches the second machine after the first", async () => {
  for (const h of ["one-box", "two-box"]) await installMachine(h, env);
  writeFileSync(join(root, "ssh.log"), "");
  expect(await machineMain(["update"], () => {}, env)).toBe(0);
  const hosts = log()
    .split("\n")
    .filter((l) => l.includes(" sh -s < "))
    .map((l) => l.split(" ")[0]);
  expect(hosts).toEqual(["one-box", "two-box"]);
});

test("this machine's task slots: as many as Lineclear's machine.maxTasks, busy as many as tasks at work", async () => {
  const bin = join(root, "lineclear");
  writeFileSync(bin, "#!/bin/sh\n[ \"$1\" = show ] && printf 'machine.maxTasks       4  (here)\\n'\nexit 0\n", { mode: 0o755 });
  let busy = 3;
  const view = machinesView(
    { ...env, LINECLEAR_SERVER_BIN: bin },
    () => Date.now(),
    () => busy,
  );
  // the limit is read in the background: a read never waits on Lineclear
  await until(() => !!view()[0]!.slots, 20);
  expect(view()[0]!.slots).toEqual({ total: 4, busy: 3 });
  busy = 9;
  expect(view()[0]!.slots).toEqual({ total: 4, busy: 4 });
  // without a count of tasks at work, or a Lineclear that says its limit, no sidings are drawn
  expect(machinesView({ ...env, LINECLEAR_SERVER_BIN: bin })()[0]!.slots).toBeUndefined();
  // a Lineclear that fails: once its read is over (the working one, read at the same time, has its slots), none
  const broken = machinesView(
    { ...env, LINECLEAR_SERVER_BIN: "/bin/false" },
    () => Date.now(),
    () => 1,
  );
  const working = machinesView(
    { ...env, LINECLEAR_SERVER_BIN: bin },
    () => Date.now(),
    () => 1,
  );
  broken();
  await until(() => !!working()[0]!.slots, 20);
  expect(working()[0]!.slots).toBeDefined();
  expect(broken()[0]!.slots).toBeUndefined();
});

test("a machine's load comes over the worker link (its export) when it tells it, not the SSH read", async () => {
  const exported = JSON.stringify({ commit: "0".repeat(40), projects: [], load: { load: 6.5, limit: 8 } });
  const told = { ...env, FAKE_SSH_EXPORT: exported };
  await installMachine("export-box", told);
  const view = machinesView(told);
  view();
  await until(() => view()[1]?.relation !== undefined);
  expect(view()[1]).toMatchObject({ host: "export-box", state: "ready", load: 6.5, limit: 8, version: "0".repeat(40), relation: "different", behind: true });
});
