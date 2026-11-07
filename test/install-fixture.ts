import { afterAll, beforeAll, expect } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { makeStubs, sh, tmp } from "./helpers.ts";

/** A scratch home, a repository holding this checkout and a fake running service: what a test of install.sh runs against. One per test file, since the files of a run share modules. */
export async function installFixture() {
  const root = tmp("install");
  const home = join(root, "home");
  const repo = join(root, "repo");
  const { bin: stubs, state } = makeStubs(root);
  const git = (...a: string[]) => sh(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  const bunCache = sh(["bun", "pm", "cache"]).out.trim();

  const app = join(home, ".local/share/lineclear");

  // The running service, as far as the smoke check sees it: the pages, the Lineclear API, a chat and the rule loop's beat. A
  // version that has a file BROKEN in it breaks what the file says ("chat": a message is refused, "paused": it pauses the
  // project p, "loop": its loop never ticks).
  // It runs in a process of its own: the tests wait on install.sh without letting this process answer.
  const fake = Bun.spawn(
    [
      "bun",
      "-e",
      `const fs = require("fs"), f = ${JSON.stringify(join(home, ".lineclear/builds/current/BROKEN"))};
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
// the loop of the build that runs ticks, as src/loop-beat.ts writes it
const data = ${JSON.stringify(join(home, ".lineclear"))};
setInterval(() => {
  if (broken() === "loop") return;
  try { fs.writeFileSync(data + "/loop.json", JSON.stringify({ at: Date.now(), pid: process.pid, build: fs.realpathSync(data + "/builds/current") })); } catch {}
}, 200);`,
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
  const lineclear = (...a: string[]) => sh([join(home, ".local/bin/lineclear"), ...a], { env: env() });
  /** doctor found nothing wrong but the build, its paths : these tests install from a branch, which doctor rightly refuses as not a release */
  const wellButBuild = (r: { out: string }) =>
    expect(r.out.split("\n").filter((l) => l.startsWith("FAILED") && !/^FAILED (stable build|installed paths|agents on the old command name)/.test(l))).toEqual(
      [],
    );
  /** it exited 0; when not, the failure shows what it printed */
  const passes = (r: { code: number | null; out: string }) => expect({ code: r.code, out: r.code ? r.out : "" }).toEqual({ code: 0, out: "" });

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

  const current = join(home, ".lineclear/builds/current");

  return { root, home, repo, stubs, state, git, app, current, service, env, install, wellButBuild, passes, snapshot, lineclear };
}
