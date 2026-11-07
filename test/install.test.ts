import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { makeStubs, sh, tmp } from "./helpers.ts";
import { extensionFile } from "../src/paths.ts";
import { loadFactor } from "../scripts/check-speed.ts";

// Each test runs install.sh for real: 30 s covers an idle machine, and the limit grows with the load.
setDefaultTimeout(30_000 * loadFactor());

const root = tmp("install");
const home = join(root, "home");
const repo = join(root, "repo");
const { bin: stubs, state } = makeStubs(root);
const git = (...a: string[]) => sh(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
const bunCache = sh(["bun", "pm", "cache"]).out.trim();

const app = join(home, ".local/share/lineclear");

// The running service, as far as the smoke check sees it: the pages, the Lineclear API and a chat. A version that has a
// file BROKEN in it breaks what the file says ("chat": a message is refused, "paused": it pauses the project p).
// It runs in a process of its own: the tests wait on install.sh without letting this process answer.
const fake = Bun.spawn(
  [
    "bun",
    "-e",
    `const fs = require("fs"), f = ${JSON.stringify(join(app, "BROKEN"))};
const broken = () => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "");
const settings = ${JSON.stringify(join(home, ".config/lineclear/projects/p/settings.json"))};
// a version that pauses a project saves that, as the rules would
const pause = () => { if (broken() === "paused" && fs.existsSync(settings)) fs.writeFileSync(settings, JSON.stringify({ ...JSON.parse(fs.readFileSync(settings, "utf8")), paused: true })); };
// a version that wipes the store, as the update on desktop did
const wipe = () => { if (broken() === "wipe") for (const n of ["tasks.json", "tasks-cold.jsonl"]) fs.rmSync(${JSON.stringify(join(home, ".lineclear"))} + "/" + n, { force: true }); };
const s = Bun.serve({ port: 0, fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === "/") pause();
  if (path === "/") wipe();
  if (path === "/api/snapshot") return Response.json({ host: "m", places: [{ id: "p:a", machine: "m", chat: "p:a", mode: "regular" }, { id: "p:b", machine: "m", home: true, chat: "p:b", mode: "regular" }] });
  if (path === "/api/action") return broken() === "chat" ? Response.json({ error: "refused" }, { status: 500 }) : Response.json({ waiting: false });
  return new Response("<html></html>");
} });
console.log(s.port);
setInterval(() => {}, 1000);`,
  ],
  { stdout: "pipe", stderr: "inherit" },
);
const service = {
  port: Number(
    await new Promise<string>((done) =>
      fake.stdout
        .getReader()
        .read()
        .then((r) => done(new TextDecoder().decode(r.value))),
    ),
  ),
};

const kitFile = join(root, "kit.json");
writeFileSync(kitFile, JSON.stringify({ pi: "", packages: {}, owners: ["Lineclear", "herdr"] }));

const env = () => ({
  LINECLEAR_KIT: kitFile,
  LINECLEAR_PORT: String(service.port),
  LINECLEAR_SMOKE_SECONDS: "4",
  PATH: `${join(home, ".local/bin")}:${stubs}:${process.env.PATH}`,
  HOME: home,
  // a playwright daemon keeps its session files under the cache dir of its HOME: this run's own, never a shared one
  PWTEST_DAEMON_SESSION_DIR: join(root, "playwright-daemon"),
  XDG_CACHE_HOME: join(root, "cache"),
  TMPDIR: tmpdir(),
  BUN_INSTALL_CACHE_DIR: bunCache,
  LINECLEAR_REPO: repo,
  LINECLEAR_REF: "main",
});
// LINECLEAR_REPO is a local clone, the way someone with access to a private repo installs it: no network, no public repo.
const install = () => sh(["sh", "install.sh"], { env: env() });
/** doctor found nothing wrong but the build, its paths : these tests install from a branch, which doctor rightly refuses as not a release */
const wellButBuild = (r: { out: string }) =>
  expect(r.out.split("\n").filter((l) => l.startsWith("FAILED") && !/^FAILED (stable build|installed paths|agents on the old command name)/.test(l))).toEqual(
    [],
  );
/** it exited 0; when not, the failure shows what it printed */
const passes = (r: { code: number | null; out: string }) => expect({ code: r.code, out: r.code ? r.out : "" }).toEqual({ code: 0, out: "" });
const lineclear = (...a: string[]) => sh([join(home, ".local/bin/lineclear"), ...a], { env: env() });

/**
 * Every file under home with its size, mode and mtime (or link target), to see that a run changed nothing. A run
 * that rewrites a file with the same content counts as a change too; hashing the 20,000 files of node_modules took
 * seconds per call on a busy machine.
 */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isSymbolicLink()) out.push(`${relative(dir, p)} -> ${readlinkSync(p)}`);
      else {
        const s = lstatSync(p);
        out.push(`${relative(dir, p)} ${s.size} ${s.mode} ${s.mtimeMs}`);
      }
    }
  };
  walk(dir);
  return out.sort();
}

beforeAll(() => {
  mkdirSync(join(home, ".lineclear"), { recursive: true });
  writeFileSync(join(home, ".lineclear/server.json"), JSON.stringify({ port: service.port }));
  // The repository to install: this checkout's files, as the first commit on main.
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  // the first install fetches the whole checkout (about 100 MB): stored and served uncompressed and without a delta
  // search, that fetch takes seconds instead of half a minute on a busy machine
  git("config", "core.compression", "0");
  git("config", "pack.window", "0");
  const files = sh(["git", "ls-files", "-co", "--exclude-standard"]).out.trim().split("\n");
  for (const f of files) {
    if (!existsSync(f)) continue;
    mkdirSync(join(repo, f, ".."), { recursive: true });
    cpSync(f, join(repo, f));
  }
  git("add", "-A");
  git("commit", "-q", "-m", "first");
}, 120_000); // copying the whole checkout takes longer than bun's 5 s default on a busy machine
afterAll(() => {
  fake.kill();
  sh(["rm", "-rf", root]);
});

test("install adds Lineclear, the extension and the service, and doctor passes", () => {
  const r = install();
  passes(r);
  expect(existsSync(join(state, "lineclear"))).toBe(false); // no herdr-projects 2.0 plugin
  expect(existsSync(join(home, ".local/share/lineclear/bin/lineclear"))).toBe(true);
  const ext = join(home, ".pi/agent/extensions/lineclear.ts");
  expect(lstatSync(ext).isSymbolicLink()).toBe(false); // pi resolves a link's imports from the link's folder
  expect(readFileSync(ext, "utf8")).toBe(extensionFile(join(home, ".local/share/lineclear")));
  expect(existsSync(join(home, ".local/share/lineclear/ui/web/dist/index.html"))).toBe(true);
  expect(readFileSync(join(home, ".config/systemd/user/lineclear.service"), "utf8")).toContain("lineclear run");
  const unit = readFileSync(join(home, ".config/systemd/user/lineclear.service"), "utf8");
  expect(unit).toMatch(/^Environment="PATH=.+"$/m);
  expect(unit).toContain(`:${stubs}:`);
  expect(readFileSync(join(state, "tailscale.log"), "utf8")).toContain(`serve --bg --https=${service.port} http://127.0.0.1:${service.port}`); // the web and board ports are published
  expect(existsSync(join(state, "linger"))).toBe(true); // lingering is on, so the service starts at boot
  // the compile cache goes to the disk cache for every user service and session
  expect(readFileSync(join(home, ".config/environment.d/60-lineclear.conf"), "utf8")).toBe(
    `NODE_COMPILE_CACHE=${join(root, "cache/lineclear/node-compile-cache")}\n`,
  );
  const d = lineclear("doctor");
  expect(d.out).toContain("ok     starts at boot");
  expect(d.out).toContain("ok     compile cache on disk");
  wellButBuild(d);
  expect(d.out).toContain("FAILED stable build");
}, 180_000); // the first full build of the app and its web pages, then a doctor run

test("where lingering needs root, install prints the one command and doctor names it", () => {
  rmSync(join(state, "linger"), { force: true });
  writeFileSync(join(state, "linger-needs-root"), "");
  const r = install();
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/Run this once: sudo loginctl enable-linger \S+/);
  const d = lineclear("doctor");
  expect(d.code).toBe(1);
  expect(d.out).toMatch(/FAILED starts at boot: lingering is off/);
  expect(d.out).toMatch(/fix: sudo loginctl enable-linger/);
  rmSync(join(state, "linger-needs-root"));
  passes(install());
  wellButBuild(lineclear("doctor"));
}, 180_000); // two installs and two doctor runs

test("a second install changes no file", () => {
  const before = snapshot(home);
  const r = install();
  expect(r.code).toBe(0);
  expect(snapshot(home)).toEqual(before);
}, 180_000); // a full install after a snapshot of the home folder

test("install again updates Lineclear to the newest commit", () => {
  writeFileSync(join(repo, "newer.txt"), "newer\n");
  git("add", "-A");
  git("commit", "-q", "-m", "second");
  const r = install();
  expect(r.code).toBe(0);
  expect(existsSync(join(home, ".local/share/lineclear/newer.txt"))).toBe(true);
  expect(readFileSync(join(state, "systemctl.log"), "utf8")).toContain("--user restart lineclear.service");
});

test("install loads the token pack: parts show in doctor, a switch holds, a second install changes no file", () => {
  mkdirSync(join(repo, "pi/parts"), { recursive: true });
  writeFileSync(join(repo, "pi/parts/sample.ts"), "export default function (pi: any) { pi.on('tool_result', () => undefined); }\n");
  git("add", "-A");
  git("commit", "-q", "-m", "a part");
  const r = install();
  expect(r.code).toBe(0);
  expect(r.out).toContain(
    "Token pack: on   batched-reads, on   compaction, on   compaction-notes, on   compaction-point, on   cut-output, on   no-sleep, on   sample",
  );
  expect(lineclear("doctor").out).toContain(
    "ok     token pack: batched-reads on, compaction on, compaction-notes on, compaction-point on, cut-output on, no-sleep on, sample on",
  );
  expect(lineclear("pack", "off", "sample").out).toContain("sample: off");
  expect(lineclear("doctor").out).toContain(
    "ok     token pack: batched-reads on, compaction on, compaction-notes on, compaction-point on, cut-output on, no-sleep on, sample off",
  );
  const before = snapshot(home);
  passes(install());
  expect(snapshot(home)).toEqual(before); // the switch is kept, and no file changed
  expect(lineclear("pack", "on", "sample").out).toContain("sample: on");
}, 180_000); // two installs and five commands

/** Commits a version that breaks the service the way BROKEN says, installs it, and puts the repository back. */
function installBroken(how: string) {
  // the project p is Running before the update
  const dir = join(home, ".config/lineclear/projects/p");
  mkdirSync(dir, { recursive: true });
  const settings = join(dir, "settings.json");
  writeFileSync(settings, JSON.stringify({ repo, space: "p", check: "true", models: {} }));
  writeFileSync(join(repo, "BROKEN"), `${how}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", `broken: ${how}`);
  const good = git("rev-parse", "HEAD~1").out.trim();
  const r = install();
  const after = JSON.parse(readFileSync(settings, "utf8"));
  rmSync(dir, { recursive: true });
  git("reset", "-q", "--hard", good);
  return { r, good, after };
}
// The Inbox items on disk (read here, not through src/inbox.ts: importing that module early changes other test files)
const inbox = (): { kind: string; question: string }[] => {
  const dir = join(home, ".config/lineclear/inbox");
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    : [];
};

test("an update that breaks the chat is rolled back, and the Inbox says so", () => {
  const before = sh(["git", "-C", app, "rev-parse", "HEAD"]).out.trim();
  const restarts = () =>
    readFileSync(join(state, "systemctl.log"), "utf8")
      .split("\n")
      .filter((l) => l.includes("--user restart lineclear.service")).length;
  const restartedBefore = restarts();
  const { r, good } = installBroken("chat");
  expect(before).toBe(good);
  expect(r.code).not.toBe(0);
  expect(sh(["git", "-C", app, "rev-parse", "HEAD"]).out.trim()).toBe(before);
  expect(existsSync(join(app, "BROKEN"))).toBe(false);
  expect(restarts()).toBe(restartedBefore + 2); // on the new version, then back on the old one
  const items = inbox();
  expect(items).toHaveLength(1);
  expect(items[0]!.kind).toBe("stuck");
  expect(items[0]!.question).toContain("a coordinator chat does not accept a message");
  expect(items[0]!.question).toContain(`Putting ${before.slice(0, 7)} back`);
}, 180_000);

test("an update that pauses a Running project is rolled back too", () => {
  const { r, after } = installBroken("paused");
  expect(r.code).not.toBe(0);
  expect(after.paused).toBeUndefined(); // the project is Running again, not only the code back
  expect(existsSync(join(app, "BROKEN"))).toBe(false);
  const items = inbox();
  expect(items).toHaveLength(2);
  expect(items[1]?.question).toContain("p is Paused, it was Running");
}, 180_000);

test("an update that wipes the task store is rolled back and the tasks come back", () => {
  const data = join(home, ".lineclear");
  const tasks = JSON.stringify({ next: {}, tasks: [{ id: "T-1" }, { id: "T-2" }] });
  writeFileSync(join(data, "tasks.json"), tasks);
  writeFileSync(join(data, "tasks-cold.jsonl"), '{"id":"T-0"}\n');
  const before = sh(["git", "-C", app, "rev-parse", "HEAD"]).out.trim();
  const { r } = installBroken("wipe");
  expect(r.code).not.toBe(0);
  expect(sh(["git", "-C", app, "rev-parse", "HEAD"]).out.trim()).toBe(before); // the version is back
  expect(readFileSync(join(data, "tasks.json"), "utf8")).toBe(tasks); // and so are the tasks
  expect(readFileSync(join(data, "tasks-cold.jsonl"), "utf8")).toBe('{"id":"T-0"}\n');
  const copies = join(app, "store-copies");
  const made = readdirSync(copies)
    .filter((n) => n.startsWith("update-"))
    .sort();
  const newest = made.at(-1) ?? "";
  expect(readFileSync(join(copies, newest, "tasks.json"), "utf8")).toBe(tasks); // the copy aside was made first
  expect(readFileSync(join(copies, newest, "source"), "utf8").trim()).toBe(data);
  expect(inbox().at(-1)?.question).toContain("the task store holds 0 tasks, it held 3 before the update");
}, 180_000);

test("a version that works passes the smoke check and stays", () => {
  writeFileSync(join(repo, "good.txt"), "good\n");
  git("add", "-A");
  git("commit", "-q", "-m", "good");
  const r = install();
  expect(r.code).toBe(0);
  expect(r.out).toContain("the new version works");
  expect(existsSync(join(app, "good.txt"))).toBe(true);
  expect(install().code).toBe(0);
  expect(existsSync(join(app, "good.txt"))).toBe(true);
}, 240_000);

test("doctor names a problem and its fix, and exits 1", () => {
  sh(["rm", "-f", join(home, ".pi/agent/extensions/lineclear.ts")]);
  const d = lineclear("doctor");
  expect(d.code).toBe(1);
  expect(d.out).toContain("FAILED pi extension");
  expect(d.out).toContain("fix: curl -fsSL");
  passes(install());
  wellButBuild(lineclear("doctor"));
});

test("install replaces the link an older install made, and doctor fails a link", () => {
  const ext = join(home, ".pi/agent/extensions/lineclear.ts");
  sh(["ln", "-sfn", join(home, ".local/share/lineclear/pi/extension.ts"), ext]);
  const d = lineclear("doctor");
  expect(d.code).toBe(1);
  expect(d.out).toContain("is a link, so pi cannot find the extension's imports");
  passes(install());
  expect(lstatSync(ext).isSymbolicLink()).toBe(false);
  wellButBuild(lineclear("doctor"));
  writeFileSync(ext, "export default () => {};\n");
  expect(install().code).not.toBe(0); // a file of your own is never overwritten
  rmSync(ext);
  passes(install());
});

test("uninstall keeps settings and secrets, and --all leaves none of Lineclear's files", () => {
  const cfg = join(home, ".config/lineclear/projects/p");
  mkdirSync(cfg, { recursive: true });
  writeFileSync(join(cfg, "secrets.env"), "A=1\n");
  const keep = lineclear("uninstall");
  expect(keep.code).toBe(0);
  expect(existsSync(join(cfg, "secrets.env"))).toBe(true);
  expect(existsSync(join(home, ".local/share/lineclear/.git"))).toBe(false);
  expect(existsSync(join(home, ".local/share/lineclear/store-copies"))).toBe(true); // the copies of the store stay
  passes(install());
  expect(lineclear("uninstall", "--all").code).toBe(0);
  const left = snapshot(home).filter((l) => l.includes("lineclear") && !l.startsWith(".lineclear/")); // .lineclear/ is the server's folder, with this test's fakes
  expect(left).toEqual([]);
  expect(existsSync(join(state, "active"))).toBe(false);
});

test("uninstall removes the old link, and leaves a pi extension of your own", () => {
  const ext = join(home, ".pi/agent/extensions/lineclear.ts");
  passes(install());
  rmSync(ext);
  sh(["ln", "-sfn", join(home, ".local/share/lineclear/pi/extension.ts"), ext]);
  expect(lineclear("uninstall").code).toBe(0);
  expect(sh(["test", "-L", ext]).code).not.toBe(0);
  passes(install());
  rmSync(ext);
  writeFileSync(ext, "export default () => {};\n");
  expect(lineclear("uninstall").code).toBe(0);
  expect(readFileSync(ext, "utf8")).toBe("export default () => {};\n");
  rmSync(ext);
  passes(install());
}, 180_000); // two installs

test("the README names the install variables and the fork's notice, and the license exists", () => {
  const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf8");
  expect(readme).toContain("LINECLEAR_REPO");
  expect(readme).toContain("server/NOTICE");
  expect(readFileSync(join(import.meta.dir, "../LICENSE"), "utf8")).toContain("MIT License");
  const notice = readFileSync(join(import.meta.dir, "../server/NOTICE"), "utf8");
  expect(notice).toContain("server/LICENSE");
  expect(notice).toContain("Permission is hereby granted");
  expect(notice).toContain("Elias Stravik");
  const forkLicense = readFileSync(join(import.meta.dir, "../server/LICENSE"), "utf8");
  expect(forkLicense).toContain("MIT License");
  expect(forkLicense).toContain("Elias Stravik");
});

test("a release installs into builds/<version>, the service and the command run from current, and a newer one becomes current with the first as previous", () => {
  const home2 = join(root, "home-release");
  mkdirSync(join(home2, ".lineclear"), { recursive: true });
  writeFileSync(join(home2, ".lineclear/server.json"), JSON.stringify({ port: service.port }));
  const releaseEnv = (tag: string) => ({ ...env(), HOME: home2, PATH: `${join(home2, ".local/bin")}:${stubs}:${process.env.PATH}`, LINECLEAR_REF: tag });
  const release = (version: string) => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    writeFileSync(join(repo, "package.json"), `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
    git("commit", "-q", "-am", `Release ${version}`);
    git("tag", "-a", `v${version}`, "-m", version);
  };
  const installRelease = (version: string) => sh(["sh", "install.sh"], { env: releaseEnv(`v${version}`) });
  const builds = join(home2, ".lineclear/builds");
  const unit = () => readFileSync(join(home2, ".config/systemd/user/lineclear.service"), "utf8");

  release("1.0.0");
  passes(installRelease("1.0.0"));
  expect(sh(["readlink", join(builds, "current")]).out.trim()).toBe(join(builds, "1.0.0"));
  expect(existsSync(join(builds, "1.0.0/.git"))).toBe(false);
  expect(existsSync(join(builds, "1.0.0/ui/web/dist/index.html"))).toBe(true);
  expect(unit()).toContain(`${builds}/current/bin/lineclear run`);
  expect(unit()).not.toContain(repo);
  expect(sh(["readlink", "-f", join(home2, ".local/bin/lineclear")]).out.trim()).toBe(join(builds, "1.0.0/bin/lineclear"));
  expect(existsSync(join(builds, "previous"))).toBe(false);
  const doctor = () => sh([join(home2, ".local/bin/lineclear"), "doctor"], { env: releaseEnv("v1.0.0") });
  expect(doctor().out).toContain("ok     stable build");
  // every installed file names the stable path: the extension pi loads, the unit and the command link
  const installed = [".pi/agent/extensions/lineclear.ts", ".config/systemd/user/lineclear.service"];
  for (const file of installed) {
    const text = readFileSync(join(home2, file), "utf8");
    expect(text).toContain(`${builds}/current/`);
    expect(text).not.toMatch(/\/builds\/(?!current\/)/);
    expect(text).not.toContain(repo);
  }
  expect(sh(["readlink", join(home2, ".local/bin/lineclear")]).out.trim()).toBe(join(builds, "current/bin/lineclear"));
  // nothing else Lineclear wrote outside builds/ names a build folder other than current
  const strays = sh(["grep", "-rIlE", "/builds/(1\\.|previous)", home2, "--exclude-dir=builds"]);
  expect(strays.out.trim()).toBe("");

  release("1.0.1");
  passes(installRelease("1.0.1"));
  expect(sh(["readlink", join(builds, "current")]).out.trim()).toBe(join(builds, "1.0.1"));
  expect(sh(["readlink", join(builds, "previous")]).out.trim()).toBe(join(builds, "1.0.0"));
  expect(doctor().out).toContain("current 1.0.1, previous 1.0.0");
  expect(existsSync(join(builds, "1.0.0/.release"))).toBe(true);
  expect(unit()).not.toContain(repo);

  // a Lineclear worktree beside the release: nothing installed points into it, and a planted pi setting that does fails doctor
  const worktree = join(root, "worktree");
  mkdirSync(join(worktree, "pi"), { recursive: true });
  writeFileSync(join(worktree, ".git"), "gitdir: /nowhere\n");
  expect(doctor().out).toContain("ok     installed paths");
  const settings = join(home2, ".pi/agent/settings.json");
  mkdirSync(join(home2, ".pi/agent"), { recursive: true });
  writeFileSync(settings, JSON.stringify({ extensions: [join(worktree, "pi/extension.ts")] }));
  const planted = doctor();
  expect(planted.code).toBe(1);
  expect(planted.out).toContain(`FAILED installed paths: ${settings} points into ${worktree}`);
  rmSync(settings);

  // a link to a git checkout is not a release: doctor fails and names the install
  const checkout = join(root, "checkout");
  mkdirSync(join(checkout, "bin"), { recursive: true });
  mkdirSync(join(checkout, ".git"), { recursive: true });
  writeFileSync(join(checkout, "bin/lineclear"), "#!/bin/sh\n");
  const onCheckout = { ...releaseEnv("v1.0.1"), PATH: `${join(checkout, "bin")}:${process.env.PATH}` };
  const bad = sh([join(builds, "current/bin/lineclear"), "doctor"], { env: onCheckout });
  expect(bad.code).toBe(1);
  expect(bad.out).toMatch(/FAILED stable build: .*lineclear on PATH/);
  expect(bad.out).toContain("LINECLEAR_REF=v");
}, 240_000);
