import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { commands, main } from "../src/cli.ts";
import { accountHome, stableRefusal } from "../src/paths.ts";

const width = () => Math.max(...Object.keys(commands).map((n) => n.length)) + 1;

const run = async (args: string[]) => {
  const out: string[] = [];
  const code = await main(args, (l) => out.push(l));
  return { code, out };
};

test("--help lists the commands", async () => {
  const { code, out } = await run(["--help"]);
  expect(code).toBe(0);
  for (const name of Object.keys(commands)) expect(out.join("\n").split("\n")).toContain(`  ${name.padEnd(width())}${commands[name]}`);
});

test("an unknown command prints one line and exits 2", async () => {
  const { code, out } = await run(["nope"]);
  expect(code).toBe(2);
  expect(out).toHaveLength(1);
});

test("bin/lineclear runs", async () => {
  const env = {
    ...process.env,
    LINECLEAR_CONFIG: join(tmpdir(), "lc-bin-config"),
    LINECLEAR_HOME: join(tmpdir(), "lc-bin-home"),
    LINECLEAR_PORT: "7999",
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
  };
  const p = Bun.spawnSync(["bin/lineclear", "nope"], { env });
  expect(p.exitCode).toBe(2);
  expect(p.stdout.toString().trim().split("\n")).toEqual([`lineclear: unknown command 'nope', try 'lineclear --help'`]);
  const h = Bun.spawnSync(["bin/lineclear", "--help"]);
  expect(h.exitCode).toBe(0);
  expect(h.stdout.toString()).toContain("Commands:");
});

test("--version prints the version and the short commit", async () => {
  const version = (await Bun.file("package.json").json()).version;
  const sha = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout.toString().trim();
  const p = Bun.spawnSync(["bin/lineclear", "--version"]);
  expect(p.exitCode).toBe(0);
  expect(p.stdout.toString()).toBe(`lineclear ${version} ${sha}\n`);
  expect(Bun.spawnSync(["bin/lineclear", "--help"]).stdout.toString()).toContain("--version");
});

test("--version says unknown in a copy with no .git", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-version-"));
  mkdirSync(join(dir, "bin"));
  cpSync("src", join(dir, "src"), { recursive: true });
  cpSync("pi", join(dir, "pi"), { recursive: true });
  for (const shared of ["server/server/live/engine/machine.ts", "server/server/live/secrets.ts"]) {
    mkdirSync(dirname(join(dir, shared)), { recursive: true });
    cpSync(shared, join(dir, shared));
  }
  cpSync("bin/lineclear", join(dir, "bin/lineclear"));
  cpSync("package.json", join(dir, "package.json"));
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const p = Bun.spawnSync([join(dir, "bin/lineclear"), "--version"]);
  expect(p.exitCode).toBe(0);
  expect(p.stdout.toString()).toBe(`lineclear ${version} unknown\n`);
  rmSync(dir, { recursive: true });
});

test("the repo's bin/lineclear refuses the stable config and data folders and changes no file", async () => {
  // the account's real folders, only read: a refused run must leave them as they are
  const account = accountHome();
  const stableConfig = join(account, ".config", "lineclear");
  const stable = [stableConfig, join(account, ".lineclear")];
  // the live instance writes to these folders too, so a refused run is judged by files it could add: only new names count, and only at the top of each folder: the subfolders (inbox, check queue, waits, projects) fill with live work at any moment
  const files = () => stable.flatMap((dir) => (existsSync(dir) ? readdirSync(dir) : []));
  // the runs are independent, so they start together: one after another they take most of the test's 5 s under load
  const run = async (extra: Record<string, string>, ...args: string[]) => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      LINECLEAR_CONFIG: undefined,
      LINECLEAR_HOME: undefined,
      LINECLEAR_PORT: undefined,
      LINECLEAR_WEB_PORT: undefined,
      ...extra,
    };
    const p = Bun.spawn(["bin/lineclear", ...args], { env: env as Record<string, string>, stdout: "ignore", stderr: "pipe" });
    const [stderr, exitCode] = await Promise.all([new Response(p.stderr).text(), p.exited]);
    return { exitCode, stderr };
  };
  const own = mkdtempSync(join(tmpdir(), "lc-own-"));
  const config = { LINECLEAR_CONFIG: join(own, "config") };
  const before = files();
  const [plain, stableEnv, port, noData, ok, version] = await Promise.all([
    run({}, "project", "list"),
    run({ LINECLEAR_CONFIG: stableConfig }, "project", "list"),
    run({ ...config, LINECLEAR_HOME: join(own, "data"), LINECLEAR_PORT: "7421" }, "project", "list"),
    run(config, "project", "list"),
    run({ ...config, LINECLEAR_HOME: join(own, "data") }, "project", "list"),
    run({}, "--version"),
  ]);
  for (const p of [plain, stableEnv]) {
    expect(p.exitCode).toBe(2);
    expect(p.stderr).toContain("stable config folder");
    expect(p.stderr).toContain("LINECLEAR_CONFIG");
  }
  expect(port.stderr).toContain("stable port 7421");
  expect(noData.stderr).toContain("stable data folder");
  expect(ok.exitCode).toBe(0);
  expect(version.exitCode).toBe(0);
  const known = new Set(before);
  expect(files().filter((f) => !known.has(f) && !/\.(log|tmp|lock)$/.test(f))).toEqual([]);
  rmSync(own, { recursive: true });
}, 15_000);

test("a serving command with no port of its own is refused as the stable port", () => {
  const own = { HOME: "/tmp/own", LINECLEAR_CONFIG: "/tmp/own/config", LINECLEAR_HOME: "/tmp/own/data" };
  const stable = "/home/stable";
  expect(stableRefusal(process.cwd(), ["run"], own, stable)).toContain("stable port 7421");
  expect(stableRefusal(process.cwd(), ["serve", "--port", "7421"], own, stable)).toContain("stable port 7421");
  expect(stableRefusal(process.cwd(), ["serve", "--port", "9123"], own, stable)).toBe("");
  expect(stableRefusal(process.cwd(), ["project", "list"], own, stable)).toBe("");
});

test("roadmap check runs from a checkout on the stable folders, status does not", () => {
  const stable = "/home/stable";
  const onStable = { HOME: stable, LINECLEAR_PORT: "7421" };
  expect(stableRefusal(process.cwd(), ["roadmap", "check", "."], onStable, stable)).toBe("");
  expect(stableRefusal(process.cwd(), ["roadmap", "status", ".", "--space", "x"], onStable, stable)).toContain("stable");
});

test("a release build has no .git and is never refused", () => {
  const build = mkdtempSync(join(tmpdir(), "lc-build-"));
  const env = { HOME: "/nonexistent-home" };
  expect(stableRefusal(build, ["project", "list"], env, env.HOME)).toBe("");
  mkdirSync(join(build, ".git"));
  expect(stableRefusal(build, ["project", "list"], env, env.HOME)).toContain("stable config folder");
  rmSync(build, { recursive: true });
});

test("every listed command is one the CLI knows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-help-"));
  const env = {
    ...process.env,
    HOME: dir,
    LINECLEAR_CONFIG: dir,
    LINECLEAR_HOME: dir,
    LINECLEAR_PORT: "7999",
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
  };
  const bin = join(dirname(import.meta.dir), "bin", "lineclear");
  try {
    const unknown = await Promise.all(
      Object.keys(commands)
        .filter((name) => name !== "merge")
        .map(async (name) => {
          const p = Bun.spawn([bin, name, "--help"], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore", detached: true });
          // the board's merge retries a closed port for seconds; every other command ends at once
          // a kill only stops a hang: it is no proof the command is unknown, so a slow start under load passes
          const kill = setTimeout(() => process.kill(-p.pid, "SIGKILL"), 6000);
          const text = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
          await p.exited;
          clearTimeout(kill);
          return /unknown command/.test(text) ? name : "";
        }),
    );
    expect(unknown.filter(Boolean)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);

const ANSWER_P90_MS = 100;
const p90 = (ms: number[]): number => [...ms].sort((a, b) => a - b)[Math.ceil(ms.length * 0.9) - 1] ?? 0;

test("the lineclear command's own start takes at most 100 ms, p90", async () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ out: "ok\n", code: 0 }) });
  try {
    const env = { ...process.env, LINECLEAR_URL: `http://127.0.0.1:${server.port}`, LINECLEAR_CHAT: "", HOME: mkdtempSync(join(tmpdir(), "lc-speed-")) };
    const ms: number[] = [];
    for (let i = 0; i < 8; i++) {
      const at = performance.now();
      const p = Bun.spawn(["perl", "server/helper/route.pl", join(process.cwd(), "server/helper/lineclear"), "show"], { env, stdout: "pipe", stderr: "pipe" });
      expect(await new Response(p.stdout).text()).toBe("ok\n");
      // the first run warms the file cache
      if (i > 0) ms.push(performance.now() - at);
    }
    expect(p90(ms)).toBeLessThanOrEqual(ANSWER_P90_MS);
  } finally {
    server.stop(true);
  }
});

test("room, task list and show are answered in 100 ms, p90", () => {
  const script = `
    const { mkdtempSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), "lc-speed-home-"));
    process.env.HERDR_SOCKET_PATH = join(process.env.LINECLEAR_HOME, "no-herdr.sock");
    process.env.NODE_ENV = "test";
    const { LiveSource } = await import("./server/live/source.ts");
    const src = new LiveSource();
    const times = {};
    for (const args of [["room"], ["task", "list"], ["show"]]) {
      await src.cli(args, {});
      const ms = [];
      for (let i = 0; i < 7; i++) {
        const at = performance.now();
        const r = await src.cli(args, {});
        ms.push(performance.now() - at);
        if (r.code) throw new Error(args.join(" ") + ": " + r.out);
      }
      times[args.join(" ")] = ms;
    }
    console.log(JSON.stringify(times));
    process.exit(0);`;
  const p = Bun.spawnSync(["bun", "-e", script], { cwd: "server", env: { ...process.env, LINECLEAR_CHAT: "" } });
  expect(p.stderr.toString()).toBe("");
  const times = JSON.parse(p.stdout.toString().trim().split("\n").pop() ?? "{}") as Record<string, number[]>;
  expect(Object.keys(times)).toEqual(["room", "task list", "show"]);
  for (const ms of Object.values(times)) expect(p90(ms)).toBeLessThanOrEqual(ANSWER_P90_MS);
}, 10000);
