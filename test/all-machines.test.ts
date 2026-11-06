import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../src/cli.ts";
import { doctorChecks, type Probe } from "../src/doctor.ts";
import { statusAll } from "../src/export.ts";
import { projectsData } from "../src/home-data.ts";
import { migrateAll } from "../src/migrate.ts";
import { fixAll, remoteLeft } from "../src/retire.ts";
import { pathsFor } from "../src/paths.ts";
import { refreshRemotes, relationOf } from "../src/remotes.ts";
import { waitingForYou } from "../src/waiting.ts";
import { sh, tmp } from "./helpers.ts";

// each machine read starts a whole Lineclear process over the fake ssh: more than bun's 5 s default on a busy machine
setDefaultTimeout(60_000);

const root = tmp("all-machines");
afterAll(() => sh(["rm", "-rf", root]));

const BIN = resolve(import.meta.dir, "..", "bin", "lineclear");
const put = (path: string, value: unknown) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
};

/** A herdr-projects 2.0 folder with one space and one open task. */
const oldWorld = (dir: string, key: string, name: string) => {
  put(join(dir, "spaces.json"), [{ name, path: "/nowhere", key, base: "main" }]);
  put(join(dir, "tasks.json"), { next: { [key]: 2 }, tasks: [{ id: `${key}-1`, title: `${name} task`, told: "work", created: 1 }], red: {} });
};

/**
 * Two machines: "here" is this process's, "box" is reached through a fake `ssh` that runs the command under another
 * HOME with its own Lineclear folders, as a second machine would.
 */
function world() {
  const here = {
    HOME: join(root, "here"),
    LINECLEAR_HOME: join(root, "here", "data"),
    LINECLEAR_OLD_DIR: join(root, "here", "old"),
    LINECLEAR_CONFIG: join(root, "here", "config"),
  };
  const box = {
    HOME: join(root, "box"),
    LINECLEAR_HOME: join(root, "box", "data"),
    LINECLEAR_OLD_DIR: join(root, "box", "old"),
    LINECLEAR_CONFIG: join(root, "box", "config"),
  };
  oldWorld(here.LINECLEAR_OLD_DIR, "HER", "alpha");
  oldWorld(box.LINECLEAR_OLD_DIR, "BOX", "beta");
  put(
    join(box.HOME, ".local", "bin", "lineclear"),
    `#!/bin/sh\nexport LINECLEAR_HOME='${box.LINECLEAR_HOME}' LINECLEAR_OLD_DIR='${box.LINECLEAR_OLD_DIR}' LINECLEAR_CONFIG='${box.LINECLEAR_CONFIG}'\nexec '${process.execPath}' '${BIN}' "$@"\n`,
  );
  chmodSync(join(box.HOME, ".local", "bin", "lineclear"), 0o755);
  const ssh = join(root, "ssh");
  put(ssh, `#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nshift\nHOME='${box.HOME}' exec sh -c "$1"\n`);
  chmodSync(ssh, 0o755);
  const env = { ...here, PATH: process.env.PATH, LINECLEAR_SSH: ssh };
  put(join(here.LINECLEAR_CONFIG, "machines.json"), { machines: [{ host: "box", state: "ready", since: "2026-01-01T00:00:00.000Z" }] });
  return { env, box };
}

test("migrate --all --dry-run lists what moves on each machine and copies nothing", async () => {
  const { env, box } = world();
  const lines: string[] = [];
  expect(await migrateAll(["--all", "--dry-run"], (l) => lines.push(l), env)).toBe(0);
  const text = lines.join("\n");
  expect(text).toContain("This machine (dry run)");
  expect(text).toContain("box (dry run)");
  expect(text).toContain("HER-1");
  expect(text).toContain("BOX-1");
  expect(existsSync(box.LINECLEAR_HOME)).toBe(false);
  expect(existsSync(env.LINECLEAR_HOME)).toBe(false);
});

/** Each read starts a whole Lineclear process; one that a loaded machine delays past the 30 s read limit shows nothing, so read again. */
async function refreshUntil(env: Record<string, string | undefined>, seen: () => boolean): Promise<void> {
  for (let tries = 0; tries < 4; tries++) {
    await refreshRemotes(env);
    if (seen()) return;
  }
}

test("migrate --all moves both machines, and one Home shows the work of both", async () => {
  const { env, box } = world();
  const lines: string[] = [];
  expect(await migrateAll(["--all"], (l) => lines.push(l), env)).toBe(0);
  expect(lines.at(-1)).toBe("Moved: 2 machines.");
  expect(JSON.parse(readFileSync(join(env.LINECLEAR_HOME, "tasks.json"), "utf8")).tasks[0].id).toBe("HER-1");
  expect(JSON.parse(readFileSync(join(box.LINECLEAR_HOME, "tasks.json"), "utf8")).tasks[0].id).toBe("BOX-1");

  await refreshUntil(env, () => projectsData(env).length === 2);
  const home = projectsData(env);
  expect(home.map((p) => [p.name, p.machine ?? "here"])).toEqual([
    ["alpha", "here"],
    ["beta on box", "box"],
  ]);
  expect(home[1]!.tasks.map((t) => t.id)).toEqual(["BOX-1"]);

  // the same work in the other places: the Inbox and the status
  put(join(box.LINECLEAR_CONFIG, "inbox", "1.json"), {
    n: 1,
    kind: "step",
    task: "BOX-1",
    question: "Which?",
    choices: ["a", "b"],
    since: "2026-01-01T00:00:00.000Z",
  });
  await refreshUntil(env, () => waitingForYou(env).items.length === 1);
  const waiting = waitingForYou(env);
  expect(waiting.items.map((i) => [i.n, i.machine])).toEqual([[1, "box"]]);
  const said: string[] = [];
  statusAll((l) => said.push(l), env);
  expect(said.join("\n")).toContain("1 thing waits for you");
}, 240_000);

test("status <project> is answered by the machine that has the project", async () => {
  const { env, box } = world();
  put(join(box.LINECLEAR_CONFIG, "projects", "beta", "settings.json"), { name: "beta", repo: "/nowhere", check: "true", models: {} });
  const said: string[] = [];
  const code = statusAll((l) => said.push(l), env, "beta");
  expect(said.join("\n")).toContain("box  ");
  expect(code).toBe(0);
});

test("status of a name no machine has asks each machine once and no machine asks back", () => {
  const { env, box } = world();
  // the fake ssh logs every forwarded call; the box's own machine list names "here", so a bounce would show
  put(join(box.LINECLEAR_CONFIG, "machines.json"), { machines: [{ host: "here", state: "ready" }] });
  const log = join(root, "ssh-calls");
  const ssh = join(root, "ssh-logged");
  put(ssh, `#!/bin/sh\necho "$@" >> '${log}'\nexec '${env.LINECLEAR_SSH}' "$@"\n`);
  chmodSync(ssh, 0o755);
  const said: string[] = [];
  const code = statusAll((l) => said.push(l), { ...env, LINECLEAR_SSH: ssh }, "nobody", false);
  expect(code).toBe(1);
  expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
});

test("status of a task id says it takes a project and points to task show", () => {
  const said: string[] = [];
  return main(["status", "LIN-958"], (l) => said.push(l)).then((code) => {
    expect(code).toBe(1);
    expect(said.join("\n")).toContain("task show LIN-958");
  });
});

test("a machine that cannot be reached is named in the status, and shows no work", async () => {
  const { env } = world();
  const dead = join(root, "dead-ssh");
  put(dead, "#!/bin/sh\nexit 255\n");
  chmodSync(dead, 0o755);
  const said: string[] = [];
  statusAll((l) => said.push(l), { ...env, LINECLEAR_SSH: dead });
  expect(said).toContain("box  cannot be reached over SSH");
});

/** A probe of a machine at `aaaaaaa1111` that knows these other machines. */
const machinesProbe = (others: NonNullable<Probe["machines"]>["others"], stable?: string): Probe => ({
  oldDir: "/nonexistent-old",
  paths: pathsFor({ HOME: "/nonexistent-home" }),
  pathDirs: [],
  which: (c) => `/usr/bin/${c}`,
  run: () => null,
  machines: { commit: "aaaaaaa1111", stable, others },
});
const check = (probe: Probe, name: string) => doctorChecks(probe).find((c) => c.name === name) ?? { name, problem: "missing", fix: "" };

test("doctor names a machine that is behind, with the command that updates it", () => {
  const probe = machinesProbe([
    { host: "box", commit: "bbbbbbb2222" },
    { host: "same", commit: "aaaaaaa1111" },
    { host: "off", commit: null },
  ]);
  expect(check(probe, "machine box").problem).toBe("box runs bbbbbbb, apart from this machine's aaaaaaa");
  expect(check(probe, "machine box").fix).toBe("lineclear machine update box");
  expect(check(probe, "machine same").problem).toBe("");
  expect(check(probe, "machine off").problem).toContain("cannot be reached");
});

test("doctor compares machines by git ancestry and says which is stable", () => {
  const probe = machinesProbe(
    [
      { host: "old", commit: "bbbbbbb2222", relation: "behind" },
      { host: "new", commit: "ccccccc3333", relation: "ahead" },
      { host: "odd", commit: "ddddddd4444", relation: "different" },
    ],
    "bbbbbbb2222",
  );
  expect(check(probe, "machine old").problem).toBe("old runs bbbbbbb, older than this machine's aaaaaaa; stable is bbbbbbb, which old runs");
  expect(check(probe, "machine new").problem).toBe("");
  expect(check(probe, "machine new").info).toBe("new runs ccccccc, newer than this machine's aaaaaaa; stable is bbbbbbb, which neither runs");
  expect(check(probe, "machine odd").problem).toContain("apart from this machine's aaaaaaa");
});

test("doctor --fix runs on each machine, once, and says what each removed", async () => {
  const { env } = world();
  const fake = join(root, "ssh-fix");
  put(
    fake,
    `#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nshift\necho "$1" >> '${join(root, "fix.log")}'\necho "Removed the skill /x/lineclear"\n`,
  );
  chmodSync(fake, 0o755);
  const probe: Probe = { oldDir: join(root, "none"), paths: pathsFor({ HOME: "/nonexistent-home" }), pathDirs: [], which: () => null, run: () => null };
  const lines: string[] = [];
  await fixAll(probe, (l) => lines.push(l), { ...env, LINECLEAR_SSH: fake });
  expect(lines).toEqual(["This machine", "  Nothing to remove.", "box", "  Removed the skill /x/lineclear"]);
  const sent = readFileSync(join(root, "fix.log"), "utf8").trim().split("\n");
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("'doctor' '--fix' '--here'");
});

test("after migrate --all, an agent on a remote machine reaches the server by the old and the new helper socket", async () => {
  sh(["rm", "-rf", join(root, "here"), join(root, "box")]);
  const { env, box } = world();
  // an agent started under herdr-projects 2.0 there has its helper folder
  mkdirSync(join(box.LINECLEAR_OLD_DIR, "helper"), { recursive: true });
  expect(await migrateAll(["--all"], () => {}, env)).toBe(0);
  // the server's tunnel on the remote machine opens the socket in the new folder
  const now = join(box.LINECLEAR_HOME, "helper", "main.sock");
  mkdirSync(join(box.LINECLEAR_HOME, "helper"), { recursive: true });
  const server = Bun.serve({ unix: now, fetch: () => new Response("server") });
  try {
    for (const sock of [now, join(box.LINECLEAR_OLD_DIR, "helper", "main.sock")]) {
      const res = await fetch("http://localhost/api/cli", { unix: sock });
      expect(await res.text()).toBe("server");
    }
  } finally {
    server.stop(true);
  }
});

test("doctor names a machine whose helper socket paths differ, with the command that links them", () => {
  const probe: Probe = {
    oldDir: "/nonexistent-old",
    paths: pathsFor({ HOME: "/nonexistent-home" }),
    pathDirs: [],
    which: (c) => `/usr/bin/${c}`,
    run: () => null,
    machines: {
      commit: "aaaaaaa1111",
      others: [
        { host: "box", commit: "aaaaaaa1111", helperApart: true },
        { host: "ok", commit: "aaaaaaa1111", helperApart: false },
      ],
    },
  };
  const checks = doctorChecks(probe);
  const box = checks.find((c) => c.name === "helper socket paths on box")!;
  expect(box.problem).toContain("box");
  expect(box.fix).toBe("ssh box lineclear migrate --link-helper");
  expect(checks.some((c) => c.name === "helper socket paths on ok")).toBe(false);
});

test("a remote machine that holds only the helper gets the socket link from migrate --all", async () => {
  sh(["rm", "-rf", join(root, "here"), join(root, "box")]);
  const { env, box } = world();
  sh(["rm", "-rf", box.LINECLEAR_OLD_DIR]);
  mkdirSync(join(box.LINECLEAR_OLD_DIR, "helper"), { recursive: true });
  expect(await migrateAll(["--all"], () => {}, env)).toBe(0);
  const now = join(box.LINECLEAR_HOME, "helper", "main.sock");
  const server = Bun.serve({ unix: now, fetch: () => new Response("server") });
  try {
    const res = await fetch("http://localhost/api/cli", { unix: join(box.LINECLEAR_OLD_DIR, "helper", "main.sock") });
    expect(await res.text()).toBe("server");
  } finally {
    server.stop(true);
  }
});

test("relationOf reads git ancestry", () => {
  const repo = mkdtempSync(join(tmpdir(), "lc-relation-"));
  const git = (...a: string[]) =>
    Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdin: "ignore" })
      .stdout.toString()
      .trim();
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "a");
  const a = git("rev-parse", "HEAD");
  git("commit", "-q", "--allow-empty", "-m", "b");
  const b = git("rev-parse", "HEAD");
  git("checkout", "-q", "-b", "side", a);
  git("commit", "-q", "--allow-empty", "-m", "c");
  const c = git("rev-parse", "HEAD");
  expect(relationOf(b, b, repo)).toBe("same");
  expect(relationOf(b, a, repo)).toBe("behind");
  expect(relationOf(a, b, repo)).toBe("ahead");
  expect(relationOf(b, c, repo)).toBe("different");
  expect(relationOf(b, "0".repeat(40), repo)).toBe("different");
  rmSync(repo, { recursive: true, force: true });
});

test("doctor names a machine that still has the old folders, and --fix archives them there", async () => {
  sh(["rm", "-rf", join(root, "here"), join(root, "box")]);
  const { env, box } = world();
  for (const d of [box.LINECLEAR_OLD_DIR, join(box.HOME, ".herdr-projects")]) {
    sh(["rm", "-rf", d]);
    put(join(d, "file.txt"), "kept in the archive");
  }
  const said: string[] = [];
  expect(await remoteLeft((l) => said.push(l), env)).toBeGreaterThan(0);
  expect(said.join("\n")).toContain("box: old folders archived");

  const probe: Probe = { oldDir: join(root, "none"), paths: pathsFor({ HOME: "/nonexistent-home" }), pathDirs: [], which: () => null, run: () => null };
  const lines: string[] = [];
  await fixAll(probe, (l) => lines.push(l), env);
  expect(lines.join("\n")).toContain("Packed");
  expect(existsSync(box.LINECLEAR_OLD_DIR) || existsSync(join(box.HOME, ".herdr-projects"))).toBe(false);
  expect(readdirSync(join(box.HOME, "archive")).filter((f) => f.endsWith(".tgz"))).toHaveLength(2);
});
