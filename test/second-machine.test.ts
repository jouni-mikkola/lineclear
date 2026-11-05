import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { codeCommit, codeVersion } from "../src/paths.ts";
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
  slotsBusy?: number;
  unreachable?: boolean;
  /** Project settings added to the project's (`local: false`). */
  settings?: object;
}

/** A project whose origin is a real bare repo, a fake shepherdr here, and a fake `ssh` that runs the command at a fake home. */
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
    JSON.stringify({ desc: "Do the held thing.\n\nSettings: (from shepherdr show; where the brief above says otherwise, it wins)\n- Review: on." }),
  );
  writeFileSync(join(fake, "tasks.json"), JSON.stringify(o.localTasks ?? []));
  script(
    join(bin, "lineclear"),
    `case "$1 $2" in
  "task list") cat "${fake}/tasks.json" ;;
  "task add") echo "$*" >> "${fake}/adds.log" ;;
  "task show") cat "${fake}/show.json" ;;
  "task close") echo "$*" >> "${fake}/closes.log" ;;
  show*) echo "machine.maxTasks       ${o.localMax ?? 0}  (here)" ;;
esac`,
  );
  script(join(bin, "pi"), `echo "provider model context"; echo "anthropic claude-sonnet-5-5 1M"; echo "anthropic claude-opus-5-5 1M"`);

  // The second machine: a home folder with the helper, the machine settings and the slot files.
  const home = join(dir, "farbox-home");
  const seen = join(dir, "farbox.log");
  script(
    join(home, ".lineclear", "helper", "bin", "lineclear"),
    `case "$1 $2" in
  "task list") cat "${home}/tasks.json" ;;
  "task add") echo "ADD $*" >> "${seen}" ;;
  "space list") [ -f "${home}/space" ] && cat "${home}/space"; true ;;
  "space add") echo "SPACE $*" >> "${seen}"; echo "lineclear  LIN  $3" > "${home}/space" ;;
  show*) echo "machine.maxTasks       ${o.remoteMax ?? 8}  (farbox)" ;;
esac`,
  );
  // read once: HEAD moving under the run (a rebase, a commit) would make the fake machine look like another build
  const build = { version: codeVersion(), commit: codeCommit() };
  // `secrets import <space>` keeps what it was sent and the space, since the fake machine has no vault of its own
  script(
    join(home, ".local", "bin", "lineclear"),
    `[ "$1 $2" = "secrets import" ] && { echo "$3" > "$HOME/imported-space"; cat > "$HOME/imported"; exit 0; }
echo "lineclear ${build.version} ${build.commit}"`,
  );
  writeFileSync(join(home, "tasks.json"), JSON.stringify(o.remoteTasks ?? []));
  mkdirSync(join(home, ".config", "lineclear", "check-slots", "m"), { recursive: true });
  writeFileSync(join(home, ".config", "lineclear", "machine.json"), JSON.stringify({ loadPerCore: o.remoteLoadPerCore ?? 1e6, checkSlots: 2 }));
  for (let i = 0; i < (o.slotsBusy ?? 0); i++) writeFileSync(join(home, ".config", "lineclear", "check-slots", "m", `slot-${i}`), String(process.pid));
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
  writeFileSync(join(config, "machine.json"), JSON.stringify({ loadPerCore: 1e6 }));
  // No GIT_* variable of the run around the test (a hook's GIT_DIR, a global config) reaches the clone on the fake machine.
  const own = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const vars = {
    ...own,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    LINECLEAR_CONFIG: config,
    LINECLEAR_MAIN_HOME: join(dir, "data"),
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"),
    SHEPHERDR_BIN: join(bin, "lineclear"),
    PI_BIN: join(bin, "pi"),
    LINECLEAR_SSH: ssh,
    TMPDIR: join(dir, "tmp"),
    XDG_CACHE_HOME: join(dir, "cache"),
  };
  const doTick = (dryRun = false, world: Partial<World> = {}) =>
    tick({ ...realWorld(vars), room: (host, space) => readRoom(host, space, vars, build), load: () => 0, ...world }, dryRun, vars);
  const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  const down = () => writeFileSync(ssh, `#!/bin/sh\necho "ssh: connect to host farbox port 22: Connection timed out" >&2; exit 255\n`);
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
  expect(t.remote()).toContain("SPACE space add");
  expect(t.remote()).toContain("ADD task add A Title A --brief");
  expect(t.remote()).toContain("because A");
  expect(t.remote()).toContain("--space lineclear");
  expect(t.remote()).toContain("--reviewer-model anthropic/claude-opus-5-5");
});

test("the space is added once, not on every start", () => {
  const t = setup({ steps: [step("A", "a"), step("B", "b")], localMax: 0 });
  t.doTick();
  expect(t.remote().match(/SPACE/g)).toHaveLength(1);
  writeFileSync(
    join(t.home, "tasks.json"),
    JSON.stringify([
      { id: "LIN-1", title: "A Title A", status: "work" },
      { id: "LIN-2", title: "B Title B", status: "work" },
    ]),
  );
  expect(t.doTick()).toEqual([]);
  expect(t.remote().match(/SPACE/g)).toHaveLength(1);
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
  expect(d[0]?.reason).toContain("No route to host");
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

test("a second machine that is loaded or has all its check slots busy takes no task", () => {
  const loaded = setup({ steps: [step("A")], localMax: 0, remoteLoadPerCore: 0.0001 });
  expect(loaded.doTick()[0]!.reason).toContain("farbox: load average");
  expect(loaded.remote()).toBe("");
  const busy = setup({ steps: [step("A")], localMax: 0, slotsBusy: 2 });
  expect(busy.doTick()[0]!.reason).toContain("farbox: all 2 check slots are in use");
  expect(busy.remote()).toBe("");
});

test("a second machine on another build than this one's takes no task, and one on the same build does", () => {
  const onBuild = (commit: string) => {
    const t = setup({ steps: [step("A")], localMax: 0 });
    script(join(t.home, ".local", "bin", "lineclear"), `echo "lineclear 0.1.0 ${commit}"`);
    return t;
  };
  const apart = onBuild("deadbeef");
  const reason = apart.doTick()[0]?.reason ?? "";
  expect(reason).toContain("farbox: it runs deadbee but this machine runs");
  expect(reason).toContain("lineclear machine update farbox");
  expect(apart.remote()).toBe("");
  const same = onBuild(codeCommit().slice(0, 7));
  expect(same.doTick().map((x) => x.kind)).toEqual(["start"]);
});

test("a release has no commit: its version tells the machines apart", () => {
  const onVersion = (version: string) => {
    const t = setup({ steps: [step("A")], localMax: 0 });
    script(join(t.home, ".local", "bin", "lineclear"), `echo "lineclear ${version} unknown"`);
    return t;
  };
  const apart = onVersion("9.9.9");
  expect(apart.doTick()[0]?.reason).toContain("farbox: it runs 9.9.9 but this machine runs");
  expect(
    onVersion(codeVersion())
      .doTick()
      .map((x) => x.kind),
  ).toEqual(["start"]);
});

test("a machine that does not say its build takes no task", () => {
  const t = setup({ steps: [step("A")], localMax: 0 });
  script(join(t.home, ".local", "bin", "lineclear"), "exit 1");
  expect(t.doTick()[0]?.reason).toContain("does not say which build it runs");
  expect(t.remote()).toBe("");
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

test("a silent Needs you climbs the ladder in a space that also uses the second machine", () => {
  const t = setup({ steps: [step("A")], localMax: 1, localTasks: [{ id: "LIN-9", title: "A Title A", status: "need", sub: "Waits for your reply" }] });
  const cards: { id: string; task: string; at: number }[] = [];
  const world = { ...realWorld(t.vars), load: () => 0, stallCards: () => cards };
  tick(world, false, t.vars); // sets the time from which cards count
  cards.push({ id: "c1", task: "LIN-9", at: Date.now() + 60_000 });
  const d = tick(world, false, t.vars);
  expect(d.filter((x) => x.kind === "stall" && x.event !== "stall" && x.event !== "end").map((x) => x.reason.split(":")[0])).toEqual(["rung 1"]);
});

const held = { id: "LIN-9", title: "Hand made", status: "queued", sub: "Waiting for a free slot" };

test("a held hand-made task starts on the second machine when this one is full, and closes here", () => {
  const t = setup({ steps: [], localMax: 1, localTasks: [{ id: "LIN-1", title: "busy", status: "work" }, held] });
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["LIN-9:start"]);
  expect(d[0]?.reason).toContain("farbox");
  expect(t.remote()).toContain("ADD task add Hand made --brief Do the held thing.");
  expect(t.remote()).not.toContain("Settings: (from shepherdr show");
  expect(t.closes()).toContain("task close LIN-9");
  expect(t.local()).toBe("");
});

test("a held task with a branch pushes it to origin first and the new brief names it", () => {
  const t = setup({ steps: [], localMax: 1, localTasks: [held] });
  git(t.repo, "checkout", "-q", "-b", "work/9-hand-made");
  writeFileSync(join(t.repo, "mine.txt"), "mine\n");
  git(t.repo, "add", "-A");
  git(t.repo, "commit", "-qm", "work only here");
  git(t.repo, "checkout", "-q", "-");
  t.doTick();
  const pushed = Bun.spawnSync(["git", "-C", t.repo, "ls-remote", "origin", "refs/heads/work/9-hand-made"]).stdout.toString();
  expect(pushed).toContain("refs/heads/work/9-hand-made");
  expect(t.remote()).toContain("branch work/9-hand-made");
  expect(t.closes()).toContain("task close LIN-9 --force");
});

test("a held task whose branch cannot be pushed stays here, not closed", () => {
  const t = setup({ steps: [], localMax: 1, localTasks: [held] });
  git(t.repo, "branch", "work/9-hand-made");
  git(t.repo, "remote", "set-url", "origin", join(t.dir, "nowhere.git"));
  const d = t.doTick();
  expect(d[0]?.reason).toContain("could not be pushed");
  expect(t.remote()).toBe("");
  expect(t.closes()).toBe("");
});

test("a held task of the rule loop (a step, a health fix) is left where it is", () => {
  const t = setup({
    steps: [step("A")],
    localMax: 1,
    localTasks: [
      { ...held, title: "A Title A" },
      { ...held, id: "LIN-8", title: "Fix health abc1234" },
    ],
  });
  expect(t.doTick().filter((x) => x.kind === "start")).toEqual([]);
  expect(t.remote()).toBe("");
});

test("a held task stays where it is when the second machine has no room", () => {
  const t = setup({ steps: [], localMax: 1, remoteMax: 1, remoteTasks: [{ id: "LIN-1", title: "busy", status: "work" }], localTasks: [held] });
  expect(t.doTick()).toEqual([]);
  expect(t.remote()).toBe("");
  expect(t.closes()).toBe("");
});

test("a held task whose local copy would not close is not made twice", () => {
  const t = setup({ steps: [], localMax: 1, localTasks: [held] });
  t.doTick();
  t.doTick();
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

test("remote commands use the helper in ~/.lineclear and work when the old ~/.shepherdr folder is gone", () => {
  const t = setup({ steps: [step("A")], localMax: 0 });
  expect(existsSync(join(t.home, ".shepherdr"))).toBe(false);
  expect(t.doTick()[0]?.kind).toBe("start");
});
