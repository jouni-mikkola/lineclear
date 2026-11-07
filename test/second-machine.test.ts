import { cpus } from "node:os";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { realWorld, tick } from "../src/rules.ts";
import type { World } from "../src/world.ts";
import { readRoom } from "../src/spread.ts";
import { roadmapData } from "../src/roadmap-view.ts";
import { git, originWithClone, script } from "./fakes.ts";

// Each test makes a real origin and clones with git: under load that passes bun's 5 s default.
setDefaultTimeout(30_000);

const temps: string[] = [];
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const step = (id: string, locks = "repo") => `### ${id} Title ${id}\n- why: because ${id}\n- done when:\n  - first ${id}\n- locks: ${locks}\n- after: none\n`;

interface Opts {
  steps: string[];
  localMax?: number;
  localTasks?: object[];
  /** What the fake second machine says: its tasks, its slots, its load limit. */
  remoteTasks?: object[];
  remoteMax?: number;
  remoteLoadPerCore?: number;
  unreachable?: boolean;
  freeKb?: number;
  /** Project settings added to the project's (`local: false`). */
  settings?: object;
}

/** A project whose origin is a real bare repo, a fake lineclear here, and a fake `ssh` that runs the command at a fake home. */
function setup(o: Opts) {
  const dir = mkdtempSync(join(tmpdir(), "lc-second-"));
  temps.push(dir);
  const { repo } = originWithClone(dir, { "docs/ROADMAP.md": `# Roadmap\n\n## Phase 0\n\n${o.steps.join("\n")}` });
  git(repo, "fetch", "-q", "origin");

  const bin = join(dir, "bin");
  mkdirSync(bin);
  const fake = join(dir, "fake");
  mkdirSync(fake);
  writeFileSync(
    join(fake, "show.json"),
    JSON.stringify({ desc: "Do the held thing.\n\nSettings: (from lineclear show; where the brief above says otherwise, it wins)\n- Review: on." }),
  );
  writeFileSync(join(fake, "tasks.json"), JSON.stringify(o.localTasks ?? []));
  script(join(bin, "pi"), `echo "provider model context"; echo "anthropic claude-sonnet-5-5 1M"; echo "anthropic claude-opus-5-5 1M"`);

  // The second machine: a home folder for the clone and the secrets (over SSH) and the files the one server's fake reads.
  const home = join(dir, "farbox-home");
  const seen = join(dir, "farbox.log");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "tasks.json"), JSON.stringify(o.remoteTasks ?? []));
  writeFileSync(join(home, "max"), String(o.remoteMax ?? 8));
  if (o.unreachable) writeFileSync(join(home, "down"), "");
  // `secrets import <space>` keeps what it was sent and the space, since the fake machine has no vault of its own
  script(join(home, ".local", "bin", "lineclear"), `[ "$1 $2" = "secrets import" ] && { echo "$3" > "$HOME/imported-space"; cat > "$HOME/imported"; exit 0; }`);
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(join(dir, "config", "machine.json"), JSON.stringify({ loadPerCore: o.remoteLoadPerCore ?? 0.5 }));
  // The one server's `room` and `task list` for farbox, and `task add --on farbox`, which lands in the second machine's log.
  writeFileSync(
    join(fake, "farbox.js"),
    `const fs = require("fs");
const [cmd, sub, ...rest] = process.argv.slice(2);
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const remote = read("${home}/tasks.json");
if (cmd === "room") {
  if (fs.existsSync("${home}/down")) { console.error("herdr could not reach farbox for workspace.list"); process.exit(1); }
  const working = remote.filter((t) => t.status === "work").length;
  console.log(JSON.stringify({ host: "farbox", load: 1, cores: 4, freeKb: ${o.freeKb ?? 8_000_000}, working, max: Number(fs.readFileSync("${home}/max", "utf8")) }));
} else if (cmd === "task" && sub === "list") {
  console.log(JSON.stringify([...read("${fake}/tasks.json"), ...remote.map((t) => ({ ...t, machine: "farbox" }))]));
} else if (cmd === "task" && sub === "add") {
  const line = [cmd, sub, ...rest].join(" ");
  fs.appendFileSync(rest.includes("--on") ? "${seen}" : "${fake}/adds.log", (rest.includes("--on") ? "ADD " : "") + line + "\\n");
} else if (cmd === "task" && sub === "show") process.stdout.write(fs.readFileSync("${fake}/show.json"));
else if (cmd === "task" && sub === "close") fs.appendFileSync("${fake}/closes.log", [cmd, sub, ...rest].join(" ") + "\\n");
else if (cmd === "show") console.log("machine.maxTasks       ${o.localMax ?? 0}  (here)");
`,
  );
  script(join(bin, "lineclear"), `exec bun "${fake}/farbox.js" "$@"`);
  // The fake ssh: its last argument is the command; it runs at the fake home, or the machine is down.
  const ssh = join(bin, "ssh");
  script(
    ssh,
    o.unreachable ? `echo "ssh: connect to host farbox port 22: No route to host" >&2; exit 255` : `for a; do c="$a"; done\nHOME="${home}" exec sh -c "$c"`,
  );

  const config = join(dir, "config");
  mkdirSync(join(config, "projects", "lineclear"), { recursive: true });
  writeFileSync(
    join(config, "projects", "lineclear", "settings.json"),
    JSON.stringify({
      repo,
      space: "lineclear",
      check: "bun run check",
      machines: ["farbox"],
      ...o.settings,
      models: { worker: ["anthropic/claude-sonnet-5-5"], reviewer: ["anthropic/claude-opus-5-5"], planner: ["anthropic/claude-opus-5-5"] },
    }),
  );
  // No GIT_* variable of the run around the test (a hook's GIT_DIR, a global config) reaches the clone on the fake machine.
  const own = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const vars = {
    ...own,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    LINECLEAR_CONFIG: config,
    LINECLEAR_MAIN_HOME: join(dir, "data"),
    LINECLEAR_HOME: join(dir, "lineclear"),
    LINECLEAR_SERVER_BIN: join(bin, "lineclear"),
    PI_BIN: join(bin, "pi"),
    LINECLEAR_SSH: ssh,
    TMPDIR: join(dir, "tmp"),
    XDG_CACHE_HOME: join(dir, "cache"),
  };
  const doTick = (dryRun = false, world: Partial<World> = {}) =>
    tick({ ...realWorld(vars), room: (host, space) => readRoom(host, space, vars), load: () => 0, ...world }, dryRun, vars);
  const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  const down = () => {
    writeFileSync(join(home, "down"), "");
    writeFileSync(ssh, `#!/bin/sh\necho "ssh: connect to host farbox port 22: Connection timed out" >&2; exit 255\n`);
  };
  return {
    dir,
    repo,
    home,
    vars,
    doTick,
    down,
    local: () => read(join(fake, "adds.log")),
    closes: () => read(join(fake, "closes.log")),
    remote: () => read(seen),
  };
}

test("a ready step with no room here starts on the second machine, which clones the repo once", () => {
  const t = setup({ steps: [step("A")], localMax: 0 });
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["A:start"]);
  const reason = d[0]?.reason ?? "";
  expect(reason).toContain("on farbox (load ");
  expect(reason).toMatch(/ there, 0\.0 of \d+ here\)/);
  expect(t.local()).toBe("");
  expect(existsSync(join(t.home, "code", "lineclear", ".git"))).toBe(true);
  expect(t.remote()).toContain("ADD task add A Title A --brief");
  expect(t.remote()).toContain("because A");
  expect(t.remote()).toContain("--space lineclear");
  expect(t.remote()).toContain("--reviewer-model anthropic/claude-opus-5-5");
});

const setVault = (t: ReturnType<typeof setup>, levels: Record<string, Record<string, string>>) => {
  const vault = Object.fromEntries(
    Object.entries(levels).map(([level, names]) => [level, Object.fromEntries(Object.entries(names).map(([n, value]) => [n, { value, at: 1 }]))]),
  );
  mkdirSync(t.vars.LINECLEAR_MAIN_HOME, { recursive: true });
  writeFileSync(join(t.vars.LINECLEAR_MAIN_HOME, ["vault", "json"].join(".")), JSON.stringify(vault));
};

test("the project's secrets reach the second machine over SSH, by 'secrets import', in no file of the project", () => {
  const t = setup({ steps: [step("A")], localMax: 0 });
  setVault(t, { all: { TOKEN: "s3cret value" } });
  const d = t.doTick();
  expect(d[0]!.kind).toBe("start");
  expect(readFileSync(join(t.home, "imported"), "utf8")).toBe("TOKEN='s3cret value'\n");
  expect(readFileSync(join(t.home, "imported-space"), "utf8").trim()).toBe("lineclear");
  expect(existsSync(join(t.home, ".config", "lineclear", "projects", "lineclear", ["secrets", "env"].join(".")))).toBe(false);
  expect(JSON.stringify(d) + t.remote() + t.local()).not.toContain("s3cret");
});

test("the vault sends that machine's own levels and the project's, not this machine's", () => {
  const t = setup({ steps: [step("A")], localMax: 0 });
  const here = hostname().split(".")[0];
  setVault(t, { all: { A: "all" }, "m:farbox": { B: "there" }, [`m:${here}`]: { C: "here" }, [`p:${here}:lineclear`]: { D: "project" } });
  t.doTick();
  const sent = readFileSync(join(t.home, "imported"), "utf8");
  expect(sent).toContain("A='all'");
  expect(sent).toContain("B='there'");
  expect(sent).toContain("D='project'");
  expect(sent).not.toContain("C=");
});

test("a machine that is not started on gets no secrets", () => {
  const t = setup({ steps: [step("A")], localMax: 2 });
  setVault(t, { all: { TOKEN: "x" } });
  t.doTick();
  expect(existsSync(join(t.home, "imported"))).toBe(false);
});

test("this machine goes first when it has room", () => {
  const t = setup({ steps: [step("A")], localMax: 2 });
  const d = t.doTick();
  expect(d[0]!.kind).toBe("start");
  expect(d[0]?.reason).not.toContain("on farbox");
  expect(t.local()).toContain("task add A Title A");
  expect(t.remote()).toBe("");
});

test("a loaded home sends a new step to the second machine, which has more room", () => {
  const t = setup({ steps: [step("A")], localMax: 2 });
  const d = t.doTick(false, { load: () => cpus().length * 0.9 });
  expect(d[0]?.kind).toBe("start");
  expect(d[0]?.reason).toContain("on farbox");
  expect(t.remote()).toContain("task add A Title A");
  expect(t.local()).toBe("");
});

test("a step whose lock a task on the second machine holds does not start, and no step starts twice", () => {
  const t = setup({
    steps: [step("A", "repo"), step("B", "repo")],
    localMax: 3,
    remoteTasks: [{ id: "LIN-9", title: "A Title A", status: "work", sub: "Review" }],
  });
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["B:skip"]);
  expect(d[0]!.reason).toContain("lock 'repo' is held by A");
  expect(t.local()).toBe("");
  expect(t.remote()).toBe("");
});

test("a step that starts working on the second machine, or merges on main, after the tick read them is not started; a closed task blocks nothing", () => {
  const t = setup({
    steps: [step("A", "a"), step("B", "b"), step("C", "c")],
    localMax: 3,
    remoteTasks: [{ id: "LIN-8", title: "C Title C", status: "done", closed: true, closedBy: "close" }],
  });
  const later = join(t.dir, "later.json");
  writeFileSync(
    later,
    JSON.stringify([
      { id: "LIN-9", title: "A Title A", status: "work" },
      { id: "LIN-8", title: "C Title C", status: "done", closed: true, closedBy: "close" },
    ]),
  );
  let fetches = 0;
  // The first fetch is the tick's own read; the next one comes just before a start, when A works on farbox and B is on main.
  const d = t.doTick(false, {
    fetch: (repo) => {
      if (fetches++ === 1) {
        writeFileSync(join(t.repo, "b.txt"), "b");
        git(t.repo, "add", "-A");
        git(t.repo, "commit", "-qm", "LIN-7: B Title B");
        git(t.repo, "push", "-q", "origin", "HEAD:main");
        writeFileSync(join(t.home, "tasks.json"), readFileSync(later, "utf8"));
      }
      return realWorld(t.vars).fetch(repo);
    },
  });
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["A:skip", "B:skip", "C:start"]);
  expect(d[0]!.reason).toContain("does not start twice");
  expect(d[1]!.reason).toContain("merged on origin/main");
  expect(t.local()).toContain("task add C Title C");
  expect(t.local()).not.toContain("Title A");
  expect(t.local()).not.toContain("Title B");
  expect(t.remote()).toBe("");
});

test("a step working or waiting on the other machine, or merged on main, is not started here; a closed task blocks nothing", () => {
  const t = setup({
    steps: [step("A", "a"), step("B", "b"), step("C", "c"), step("D", "d")],
    localMax: 3,
    remoteTasks: [
      { id: "LIN-9", title: "A Title A", status: "work" },
      { id: "LIN-10", title: "D Title D", status: "need", sub: "waits for you" },
      { id: "LIN-8", title: "C Title C", status: "done", closed: true, closedBy: "close" },
    ],
  });
  writeFileSync(join(t.repo, "b.txt"), "b");
  git(t.repo, "add", "-A");
  git(t.repo, "commit", "-qm", "LIN-7: B Title B");
  git(t.repo, "push", "-q", "origin", "HEAD:main");
  const d = t.doTick();
  expect(d.filter((x) => x.kind === "start").map((x) => x.step)).toEqual(["C"]);
  expect(t.local()).toContain("task add C Title C");
  for (const id of ["A", "B", "D"]) expect(t.local()).not.toContain(`Title ${id}`);
  expect(t.remote()).toBe("");
});

test("two ready steps with one lock start one task in all, wherever it runs", () => {
  const t = setup({ steps: [step("A", "repo"), step("B", "repo")], localMax: 0 });
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["A:start", "B:skip"]);
  expect(t.remote().match(/ADD/g)).toHaveLength(1);
});

test("a machine that cannot be reached is skipped and noted, and the local steps still start", () => {
  const t = setup({ steps: [step("A")], localMax: 2, unreachable: true });
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["machine:farbox:skip", "A:start"]);
  expect(d[0]!.reason).toContain("machine farbox skipped");
  expect(d[0]?.reason).toContain("cannot be reached");
  expect(t.local()).toContain("task add A Title A");
});

test("with no room anywhere the step waits, and the reason names each machine", () => {
  const t = setup({
    steps: [step("A")],
    localMax: 1,
    localTasks: [{ id: "LIN-1", title: "Other", status: "work" }],
    remoteMax: 1,
    remoteTasks: [{ id: "LIN-2", title: "Other", status: "work" }],
  });
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["A:skip"]);
  expect(d[0]!.reason).toContain("no free slot in space 'lineclear'");
  expect(d[0]!.reason).toContain("farbox: no free slot (1 of 1 working)");
});

test("a second machine that is loaded takes no task", () => {
  const loaded = setup({ steps: [step("A")], localMax: 0, remoteLoadPerCore: 0.0001 });
  expect(loaded.doTick()[0]!.reason).toContain("farbox: load average");
  expect(loaded.remote()).toBe("");
});

test("a dry run starts nothing on the second machine", () => {
  const t = setup({ steps: [step("A")], localMax: 0 });
  expect(t.doTick(true)[0]!.reason).toContain("would start on farbox");
  expect(t.remote()).toBe("");
  expect(existsSync(join(t.home, "code"))).toBe(false);
});

test("a task on the second machine shows in the roadmap like a local one", () => {
  const t = setup({ steps: [step("A")], localMax: 0, remoteTasks: [{ id: "LIN-9", title: "A Title A", status: "work", sub: "Review" }] });
  t.doTick();
  const r = roadmapData("lineclear", t.vars);
  if (!("ok" in r)) throw new Error("no roadmap");
  const a = r.ok.steps.find((s) => s.id === "A")!;
  expect(a.state).toBe("work");
  expect(a.task).toEqual({ id: "LIN-9@farbox", status: "work", sub: "Review · on farbox" });
});

test("a second machine that is down adds no task to the roadmap", () => {
  const t = setup({ steps: [step("A")], unreachable: true });
  const r = roadmapData("lineclear", t.vars);
  if (!("ok" in r)) throw new Error("no roadmap");
  expect(r.ok.steps[0]!.state).toBe("ready");
});

test("a machine that goes down keeps the locks and steps of the tasks it ran: nothing starts twice", () => {
  const t = setup({
    steps: [step("A", "repo"), step("B", "repo")],
    localMax: 3,
    remoteTasks: [{ id: "LIN-9", title: "A Title A", status: "work", sub: "Review" }],
  });
  expect(t.doTick().map((x) => `${x.step}:${x.kind}`)).toEqual(["B:skip"]);
  t.down();
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["machine:farbox:skip"]);
  expect(d[0]!.reason).toContain("its 1 known open tasks still count");
  // B keeps waiting on A's lock, as before: its decision did not change
  expect(t.local()).toBe("");
  // the views still show the task it last ran
  const r = roadmapData("lineclear", t.vars);
  if (!("ok" in r)) throw new Error("no roadmap");
  expect(r.ok.steps.find((s) => s.id === "A")?.state).toBe("work");
});

test("a second machine will not take a task into a clone of another repo", () => {
  const t = setup({ steps: [step("A")], localMax: 0 });
  mkdirSync(join(t.home, "code", "lineclear"), { recursive: true });
  git(join(t.home, "code", "lineclear"), "init", "-q");
  git(join(t.home, "code", "lineclear"), "remote", "add", "origin", "https://example.invalid/other.git");
  const d = t.doTick();
  expect(d[0]!.reason).toContain("another origin");
  expect(t.remote()).toBe("");
});

test("a step started on the second machine still holds its step and lock when that machine is down next tick", () => {
  const t = setup({ steps: [step("A", "repo"), step("B", "repo")], localMax: 0 });
  expect(t.doTick().map((x) => `${x.step}:${x.kind}`)).toEqual(["A:start", "B:skip"]);
  t.down();
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["machine:farbox:skip"]);
  expect(t.local()).toBe("");
  expect(t.remote().match(/ADD/g)).toHaveLength(1);
});

test("local: false starts a step only on the second machine even when this one has a slot", () => {
  const t = setup({ steps: [step("A")], localMax: 4, settings: { local: false } });
  const d = t.doTick();
  expect(d[0]?.reason).toContain("on farbox");
  expect(t.local()).toBe("");
  expect(t.remote()).toContain("ADD task add A Title A");
});

test("local: false with the second machine full starts nothing here", () => {
  const t = setup({ steps: [step("A")], localMax: 4, remoteMax: 0, settings: { local: false } });
  const d = t.doTick();
  expect(d[0]?.kind).toBe("skip");
  expect(d[0]?.reason).toContain("kept off this machine");
  expect(t.local()).toBe("");
});

test("remote commands use the helper in ~/.lineclear and work when the old folder is gone", () => {
  const t = setup({ steps: [step("A")], localMax: 0 });
  expect(existsSync(join(t.home, [".shep", "herdr"].join("")))).toBe(false);
  expect(t.doTick()[0]?.kind).toBe("start");
});

test("a second machine with little free memory takes no task", () => {
  const t = setup({ steps: [step("A")], localMax: 0, freeKb: 200_000 });
  expect(t.doTick()[0]?.reason).toContain("MiB of memory is free");
  expect(t.remote()).toBe("");
});
