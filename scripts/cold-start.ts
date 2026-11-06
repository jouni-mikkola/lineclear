// `bun run cold-start`: someone new installs Lineclear by the README and gets one step of a repo it did not write
// merged, with nothing of this machine's own setup. A fresh HOME (empty), a clean PATH, its own ports, and a copy of a
// small public repo in a local bare remote, so nothing is pushed off the machine. It prints the times and each place
// the README or the UI was not enough, for docs/numbers.md under "L49".
//
// Options (environment):
//   COLD_REF       the branch, tag or commit to install (default: this checkout's HEAD)
//   COLD_TARGET    the public repo to add (default: a small one with tests)
//   COLD_PROVIDERS pi providers whose API keys stand in for the newcomer's `pi /login` (default: every API key login).
//                  An OAuth login (openai-codex) is copied only when named here: its refresh would rotate this machine's own,
//                  so the run writes the newer token back when it ends.
//   COLD_CLAUDE_DIR a Claude Code config folder whose subscription stands in for the newcomer's, through the public
//                  pi package pi-claude-bridge, which the run installs as they would. Claude Code keeps that login
//                  fresh in place, so nothing of it is copied.
//   COLD_START_LOAD the load, in cores, under which the board and the loop start a task (default 3). This machine runs other work,
//                  which a newcomer's does not, and both hold tasks while the load is over 1x the cores.
//   COLD_MINUTES   how long to wait for the merged step (default 25: the heavy run stops a check at 30 minutes)
//   COLD_KEEP=1    keeps the fresh HOME and leaves Lineclear running there, to look at it after
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { company } from "../src/company.ts";
import { diskTmpRoot } from "../src/tmpdirs.ts";

const env = process.env;
const repoRoot = join(import.meta.dir, "..");
const ref = env.COLD_REF ?? sh(["git", "-C", repoRoot, "rev-parse", "HEAD"]).out;
const target = env.COLD_TARGET ?? "https://github.com/jonschlinkert/is-number.git";
const claudeDir = env.COLD_CLAUDE_DIR;
const providers = (env.COLD_PROVIDERS ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const minutes = Number(env.COLD_MINUTES ?? 25);
const startLoad = Number(env.COLD_START_LOAD ?? 3);
const webPort = 17420 + Math.floor(Math.random() * 500);
const boardPort = webPort + 1000;

// On disk, not in the RAM-backed /tmp: a fresh install is over a gigabyte and fills it.
const root = mkdtempSync(join(diskTmpRoot(), "lineclear-cold-"));
const home = join(root, "home");
mkdirSync(home);
/** The newcomer's environment: nothing of this one but the user, the terminal and the language. */
const fresh: Record<string, string> = {
  HOME: home,
  PATH: "/usr/local/bin:/usr/bin:/bin",
  USER: env.USER ?? "",
  LANG: env.LANG ?? "C.UTF-8",
  TERM: "xterm-256color",
  LINECLEAR_WEB_PORT: String(webPort),
  ...(claudeDir ? { CLAUDE_CONFIG_DIR: claudeDir } : {}),
};
const freshPath = `${home}/.local/bin:${home}/.bun/bin:${fresh.PATH}`;

const started = Date.now();
const times: [string, number][] = [];
const gaps: string[] = [];
let last = started;
const mark = (what: string) => {
  const now = Date.now();
  times.push([what, (now - last) / 1000]);
  last = now;
  console.log(`cold-start: ${what} (${Math.round((now - started) / 1000)} s)`);
};

function sh(cmd: string[], o: { cwd?: string; env?: Record<string, string>; input?: string } = {}) {
  const p = Bun.spawnSync(cmd, { cwd: o.cwd, env: o.env, stdin: o.input === undefined ? "ignore" : Buffer.from(o.input), stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
}

/** Runs a command as the newcomer, in a login-like shell with only their PATH. */
const asNew = (script: string, cwd = home) =>
  sh(["env", "-i", ...Object.entries({ ...fresh, PATH: freshPath }).map(([k, v]) => `${k}=${v}`), "sh", "-c", script], { cwd });

let loop: ReturnType<typeof Bun.spawn> | undefined;

/** Gives back an OAuth token the run refreshed, so this machine's own login is not left on a rotated one. */
function returnOauth() {
  try {
    const mine = JSON.parse(readFileSync(authFile, "utf8")) as typeof auth;
    const theirsNow = JSON.parse(readFileSync(join(home, ".pi", "agent", "auth.json"), "utf8")) as typeof auth;
    for (const p of Object.keys(theirs)) {
      if (theirs[p]?.type === "api_key") continue;
      if ((theirsNow[p]?.expires ?? 0) > (mine[p]?.expires ?? 0)) mine[p] = theirsNow[p] as never;
    }
    writeFileSync(authFile, JSON.stringify(mine, null, 2), { mode: 0o600 });
  } catch {
    // no fresh HOME file yet
  }
}

function stop(code: number): never {
  returnOauth();
  if (env.COLD_KEEP !== "1") {
    loop?.kill();
    asNew("herdr server stop");
    rmSync(root, { recursive: true, force: true });
  } else console.log(`cold-start: kept ${home}; the loop runs as pid ${loop?.pid}`);
  process.exit(code);
}

function fail(why: string): never {
  console.log(`cold-start: FAILED: ${why}`);
  report(false);
  stop(1);
}

function report(merged: boolean) {
  const lines = [
    `Cold start of ${ref.slice(0, 12)} on ${sh(["hostname"]).out}, ${new Date(started).toISOString().slice(0, 16)}Z: ${merged ? "a step merged" : "no step merged"}. Tasks start under a load of ${startLoad}x the cores.`,
    "",
    "| stage | seconds |",
    "|---|---|",
    ...times.map(([w, s]) => `| ${w} | ${Math.round(s)} |`),
    `| total | ${Math.round((Date.now() - started) / 1000)} |`,
    "",
    gaps.length ? "Where the README or the UI was not enough:" : "Where the README or the UI was not enough: none found.",
    ...gaps.map((g) => `- ${g}`),
  ];
  writeFileSync(join(root, "report.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

// 1. The README's install: clone, then install.sh, with the copy to install from named as the README says.
const src = join(home, "lineclear");
let r = asNew(`git clone -q ${repoRoot} ${src} && git -C ${src} checkout -q ${ref}`);
if (!r.ok) fail(`git clone: ${r.err}`);
r = asNew(`LINECLEAR_REPO=${repoRoot} LINECLEAR_REF=${ref} sh ${src}/install.sh`);
console.log(r.out);
if (!r.ok) fail(`install.sh: ${r.err.split("\n").slice(-5).join(" ")}`);
mark("install.sh");

// 2. No systemd here (a fresh HOME has no user bus): the install says to run the loop with its board, so we do.
if (!r.out.includes("lineclear run --board")) gaps.push("install.sh did not say how to start Lineclear without a service");
mkdirSync(join(home, ".lineclear"), { recursive: true });
// the board's file as a new board writes it (pi for every role, test/serve.test.ts), with the start load in before it reads it
const pi = { "task.agent": "pi", "coordinator.agent": "pi", "reviewer.agent": "pi" };
writeFileSync(
  join(home, ".lineclear", "settings.json"),
  JSON.stringify({ everywhere: pi, machine: { "machine.startLoad": `${startLoad}× cores` }, spaces: {} }),
);
// Lineclear's own loop holds starts by the same load, set in its machine.json
mkdirSync(join(home, ".config", "lineclear"), { recursive: true });
writeFileSync(join(home, ".config", "lineclear", "machine.json"), JSON.stringify({ loadPerCore: startLoad }));
loop = Bun.spawn(
  ["env", "-i", ...Object.entries({ ...fresh, PATH: freshPath }).map(([k, v]) => `${k}=${v}`), "sh", "-c", `exec lineclear run --board ${boardPort}`],
  {
    cwd: home,
    stdin: "ignore",
    stdout: Bun.file(join(root, "run.log")),
    stderr: Bun.file(join(root, "run.err")),
  },
);
const web = `http://127.0.0.1:${webPort}`;
const up = async () => {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(`${web}/api/home`)).ok) return true;
    } catch {
      // not yet
    }
    await Bun.sleep(1000);
  }
  return false;
};
if (!(await up())) fail(`the web pages did not answer: ${readFileSync(join(root, "run.err"), "utf8").slice(-600)}`);
mark("Lineclear answers");

// 3. The newcomer logs in to pi. Copying API keys stands in for `pi /login`, which needs a person at a terminal.
const authFile = join(homedir(), ".pi", "agent", "auth.json");
const auth = JSON.parse(readFileSync(authFile, "utf8")) as Record<string, { type?: string; expires?: number }>;
const wanted = providers.length || claudeDir ? providers : Object.keys(auth);
const theirs = Object.fromEntries(wanted.flatMap((p) => (auth[p]?.type === "api_key" || (auth[p] && providers.includes(p)) ? [[p, auth[p]]] : [])));
if (!Object.keys(theirs).length && !claudeDir) fail(`no API key login${providers.length ? ` for ${providers.join(", ")}` : ""} in ~/.pi/agent/auth.json`);
mkdirSync(join(home, ".pi", "agent"), { recursive: true });
if (claudeDir) {
  r = asNew("pi install npm:pi-claude-bridge");
  if (!r.ok) fail(`pi install npm:pi-claude-bridge: ${r.err.split("\n").slice(-3).join(" ")}`);
}
writeFileSync(join(home, ".pi", "agent", "auth.json"), JSON.stringify(theirs), { mode: 0o600 });
chmodSync(join(home, ".pi", "agent", "auth.json"), 0o600);
// a newcomer has git set up with their name; Lineclear does not ask for it
asNew("git config --global user.name 'New User' && git config --global user.email new@example.com && git config --global init.defaultBranch main");
r = asNew("lineclear doctor");
console.log(r.out);
if (!r.ok)
  gaps.push(
    `lineclear doctor: ${r.out
      .split("\n")
      .filter((l) => l.startsWith("FAILED"))
      .map((l) => l.replace(/^FAILED\s+/, ""))
      .join("; ")}`,
  );
mark("pi login and doctor");

// 4. Their own repo: a public one, copied into a local bare remote, so a merge pushes nowhere else.
const name =
  target
    .replace(/\.git$/, "")
    .split("/")
    .pop() ?? "repo";
const remote = join(root, `${name}.git`);
r = sh(["git", "clone", "-q", "--bare", target, remote]);
if (!r.ok) fail(`git clone ${target}: ${r.err}`);
r = asNew(`mkdir -p code && git clone -q ${remote} code/${name}`);
if (!r.ok) fail(`git clone of the bare copy: ${r.err}`);
const before = sh(["git", "-C", remote, "rev-parse", "HEAD"]).out;
mark("their repo in ~/code");

// 5. Home, as the page does it: the repos it offers, what it finds in one, and Start.
const page = await fetch(`${web}/`);
const token = /lineclear_token=([^;]+)/.exec(page.headers.get("set-cookie") ?? "")?.[1] ?? "";
const offered = (await (await fetch(`${web}/api/repos`)).json().catch(() => ({}))) as { repos?: { repo: string }[] };
const repo = join(home, "code", name);
if (!offered.repos?.some((x) => x.repo === repo)) gaps.push(`Home did not offer ${repo}`);
const found = (await (await fetch(`${web}/api/detect?repo=${encodeURIComponent(repo)}`)).json()) as Record<string, unknown>;
console.log(`cold-start: Home found ${JSON.stringify(found)}`);
if ("error" in found) fail(`Home could not read the repo: ${found.error}`);
// the plan is checked by a model of another company than the planner's: one company's models can never pass, so say so now
const companies = new Set(((found.models as string[] | undefined) ?? []).map((m) => company(m)));
if (companies.size < 2)
  fail(`the models Home offers are of one company (${[...companies].join(", ") || "none"}); the plan check needs two. Name a second login in COLD_PROVIDERS.`);
// the first run's setup, as the page does it: a worker, a reviewer and a plan checker of another company than the planner's
const offeredModels = (found.models as string[] | undefined) ?? [];
const worker = offeredModels[0] ?? "";
const other = offeredModels.find((m) => company(m) !== company(worker)) ?? worker;
const chosen = await fetch(`${web}/api/setup`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-lineclear-token": token, origin: web },
  body: JSON.stringify({ worker, reviewer: other, planner: worker, stepChecker: other }),
});
if (!chosen.ok) fail(`Setup on the web failed: ${JSON.stringify(await chosen.json().catch(() => ({})))}`);
// a login that is out of credit or usage would leave the planner silent for the whole wait: ask each chosen model once now
for (const model of new Set([worker, other])) {
  const asked = asNew(`timeout -k 5 90 pi --model ${model} -p 'Reply with ok.'`);
  if (!asked.ok)
    fail(
      `${model} does not answer (${(asked.out || asked.err).slice(0, 200)}): its login in ~/.pi/agent/auth.json is out of credit or usage, so no task could start`,
    );
}
const added = await fetch(`${web}/api/projects`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-lineclear-token": token },
  body: JSON.stringify(found),
});
const said = (await added.json().catch(() => ({}))) as Record<string, unknown>;
console.log(`cold-start: Start said ${JSON.stringify(said)}`);
if (!added.ok) fail(`Start on Home failed: ${said.error}`);
mark("project added on Home");

// 6. Wait for a merged step on their remote: a first roadmap, then one step of it.
const deadline = Date.now() + minutes * 60_000;
let planned = false;
while (Date.now() < deadline) {
  const log = sh(["git", "-C", remote, "log", "--format=%s%x01%b%x02", `${before}..HEAD`]).out;
  const commits = log
    .split("\x02")
    .map((c) => c.trim())
    .filter(Boolean);
  if (!planned && sh(["git", "-C", remote, "cat-file", "-e", "HEAD:docs/ROADMAP.md"]).ok) {
    planned = true;
    mark("first roadmap on main");
  }
  const step = commits.find((c) => /^[A-Za-z][A-Za-z0-9]*-\d+: \S+/.test(c) && !/^[^:]+: Plan/i.test(c) && !c.includes("ROADMAP"));
  if (planned && step) {
    mark(`a step merged: ${step.split("\x01")[0]}`);
    report(true);
    stop(0);
  }
  // A task that waits for something only its owner can give (allowance, a login) never merges: say so now, not after the
  // time is up. Any other question it asks, the loop's rules answer.
  const waiting = asNew(`lineclear status ${name}`)
    .out.split("\n")
    .find((l) => l.includes("waits for you") && /allowance|log ?in|sign ?in|captcha|code|budget/i.test(l));
  if (waiting) fail(`a task waits for its owner, so no step can merge: ${waiting.trim()}`);
  await Bun.sleep(20_000);
}
const status = asNew(`lineclear status ${name}; lineclear inbox`);
fail(`no step merged in ${minutes} min${planned ? "" : " (no roadmap either)"}. Status: ${status.out.slice(-800)}`);
