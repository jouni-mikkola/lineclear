import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { asksMain } from "./asks.ts";
import { backupMain } from "./backup.ts";
import { storeMain } from "./store-copies.ts";
import { eventMain } from "./events.ts";
import { dispatcherMain, moveMain } from "./dispatcher.ts";
import { doctor, herdrVersions, realProbe, testedHerdr } from "./doctor.ts";
import { fixAll, remoteLeft } from "./retire.ts";
import { askMain } from "./inbox.ts";
import { inboxMain } from "./inbox-answer.ts";
import { exportMain, inboxAll, statusAll } from "./export.ts";
import { cachedRead } from "./reads-cache.ts";
import { machineMain } from "./machines.ts";
import { readMachines } from "./machine-list.ts";
import { fetchExportSync, relationOf } from "./remotes.ts";
import { kitMain, remoteKitDiffs } from "./kit-cli.ts";
import { readKit, wantedKit } from "./kit.ts";
import { measureMain } from "./measure-main.ts";
import { packMain } from "./pack.ts";
import { planMain } from "./plan.ts";
import { planStatus } from "./requests.ts";
import { resolveProject } from "./resolve.ts";
import { codeCommit, pathsFor } from "./paths.ts";
import { candidateMain } from "./candidate-check.ts";
import { promoteMain } from "./promote-cmd.ts";
import { readRelease, releaseMain, releaseTry } from "./release.ts";
import { type Ask, setupGate } from "./project.ts";
import { setupMain } from "./setup.ts";
import { project } from "./project-cli.ts";
import { roadmapMain } from "./roadmap-cli.ts";
import { demoMain } from "./demo.ts";
import { partsMain } from "./parts-check.ts";
import { decisionsPath, realWorld, runMain } from "./rules.ts";
import { fileFixNow } from "./self-fix.ts";
import { startWeb } from "./web.ts";
import { remoteSecretNames } from "./secret-sync.ts";
import { secretFolderNames, secrets, totp } from "./secrets.ts";
import { stallsMain } from "./stall-class.ts";
import { trackMain } from "./track.ts";
import { migrateAll, migrateMain } from "./migrate.ts";
import { boardMain, isBoardJob, serveMain } from "./serve.ts";
import { waitsMain } from "./waits.ts";
import { realRemover, uninstall } from "./uninstall.ts";

export const commands: Record<string, string> = {
  export: "Print what this machine holds as JSON, for the machine that shows all of them",
  doctor:
    "Check each part and name the command that fixes a problem (--fix removes the old install's plugin and skills and test folders older than a day, on every machine; --here limits either to this one)",
  pack: "List the token pack's parts, or turn one on or off (pack on <part>, pack off <part>)",
  kit: "Print what pi loads here (packages, extensions, skills, pack parts); kit --write [<project>] makes docs/kit.md for every machine",
  measure: "Print asks, wait, cost and the health measures from files and git (no AI)",
  machine: "Add a machine by its SSH host (installs Lineclear there and runs its doctor), list, remove or update machines",
  project: "Add, list, change, remove and check projects",
  roadmap: "Check, show or import the roadmap (roadmap show <id> prints one step)",
  parts: "Check that the part pages in docs/parts/ are true: parts check [<repo>]",
  setup: "Choose a model for the worker, reviewer, planner and step checker from the logged-in harnesses (the reviewer from another company than the worker)",
  run: "Run the rule loop and serve the web pages (--once, --dry-run; --board <port> also starts herdr and the board where no service does), or only serve them on fixed demo data (--demo)",
  serve: "Serve the board (the web server): serve --port <port>",
  migrate:
    "Copy spaces, settings and open tasks from the old install to Lineclear's own server (--dry-run lists, --check after a run, --all moves every machine, --back returns to the old install and loses nothing)",
  space: "The board's spaces: space add <path> --name <name>, space list, space rename, space remove",
  task: "The board's tasks: task add, list, show, tell, stop, close (task --help lists them)",
  show: "Show the board's few settings: show [--space <name>]",
  ready: 'A task\'s agent says its change is ready: ready <id> --summary "..."',
  merge: "Merge a task's change: merge <id>",
  artifact: "Make, update or list a task's artifacts (a report, a dashboard)",
  mode: "Set a space's coordinator to regular (its timer stays off): mode <space> regular",
  heartbeat: "Show or change a space's heartbeat checklist: heartbeat [<space>]",
  pr: "Push a task's branch and open its pull request: pr <id>",
  models: "List each agent program's models and effort levels: models [<program>]",
  checks: "Wait for GitHub's checks on a task's pull request: checks <id>",
  alert: 'Send an alert to your devices: alert "<title>" --body "<why now>"',
  automation: "Timed tasks: automation add, edit, list, pause, resume, run, remove",
  restart: "Restart a space's coordinator or a task's agent: restart <space|id>",
  set: "Change a setting of the board: set <key> <value> [--machine | --space <name>]",
  unset: "Go back to a setting's default: unset <key>",
  todo: "Show a task that waits for a go as To do: todo <id>",
  done: "End a task that has nothing to merge: done <id>",
  secret: "Use a secret by name in a command: secret run NAME -- <command>",
  secrets: "Set, list and load secrets from the vault Settings > Secrets shows (values come from stdin, never from arguments)",
  stalls: "Print the stalls of the last day by class with the minutes lost (--hours N, --json)",
  track: "Run the test track: a fixture project through the whole chain; pass, or the stall class that broke it (--after-update rolls back a broken update)",
  release:
    "Show the stable and next builds, the last promotion and why next is held (release status); release run tests main and promotes it when green, as the rule loop does every 2 minutes; release check <version> checks a candidate on its own (check, smoke, canary, store both ways); release promote <version> makes a checked candidate stable and leaves the Inbox item to read; release try [version] starts a test instance on a copy of the data, release try --stop ends it",
  store: "The local copies of the task store (store list, store copy, store restore <name>); the rule loop takes one an hour, an update one before it",
  backup: "Back up Lineclear's data and secrets with restic (backup status, backup restore <dir> [--from <machine>]); the rule loop runs it hourly",
  totp: "Print the current code of a stored login: totp NAME reads NAME_TOTP from this folder's secrets",
  status:
    'Show what stops each project and what each task waits for; --plan [<task>] shows the steps of a plan; a task\'s agent reports progress: status <id> "<line>" --done <0-100> [--left 5m]',
  event:
    'Put an event no log holds, such as a review round, in the stream the live map shows: event <part> <start|end|switch|skip|fail> "<text>" [--task <id>]',
  wait: "Declare a wait: owner --kind login|money|outward, login, checks, browser, task <id>, or until <time>",
  plan: 'Start a planning task: plan <project> "<goal>"; plan submit sends its roadmap change to the Inbox; a task\'s agent lists its steps: plan <id> --step "..."',
  move: "Send a plan change to the Inbox: move <project> <step> --after <ids>",
  dispatcher: "Make the Dispatcher chat: dispatcher setup; dispatcher projects lists what it picks a project from",
  ask: "Put a question with choices in the Inbox, and wait for the answer (--kind login|outward); a card in a chat is card",
  card: 'Ask the chat a question with choices: card "<question>" --choice "<label>" ... (the board\'s old ask)',
  answer: 'Answer a choice card of a space\'s coordinator chat in words: answer <card id> "<answer>" --space <name>',
  asks: "Count the last week's needs-you cards by kind and say which a rule answers",
  inbox: "List open items of every machine (--all adds closed ones of this one), or answer one: inbox answer <n> <choice>",
  resume: "End this task's declared wait",
  check: "Run the project's check (or the command given) in its turn: one full check at a time per machine; --changed runs only what the branch changed",
  slot: 'Run a heavy command (a test or browser suite) when a check slot is free: slot "<command>"',
  uninstall: "Remove what install added (--all also removes settings and secrets)",
  help: "List the commands (one meaning per name: status, plan and ask say above which job a word does, doctor checks every machine)",
};

export function helpText(): string {
  const width = Math.max(...Object.keys(commands).map((n) => n.length)) + 1;
  const lines = Object.entries(commands).map(([name, about]) => `  ${name.padEnd(width)}${about}`);
  return ["Usage: lineclear <command>", "", "Commands:", ...lines, "", "Options:", "  --version Print the version and the commit that runs"].join("\n");
}

const root = join(dirname(import.meta.dir));

/** "<version> (<short commit>)"; the commit is `unknown` outside a git checkout. */
export function versionLine(dir: string = root): string {
  const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  let commit = "unknown";
  if (existsSync(join(dir, ".git"))) {
    const p = Bun.spawnSync(["git", "-C", dir, "rev-parse", "--short", "HEAD"]);
    if (p.exitCode === 0) commit = p.stdout.toString().trim() || "unknown";
  }
  return `lineclear ${version} ${commit}`;
}

// project names are lowercase, so an upper-case prefix is always a task
const TASK_ID = /^[A-Z][A-Z0-9]*-\d+$/;

/** `lineclear status [<project>]`: a project written loosely is read as the one it means, or refused with the two nearest. */
function statusProject(raw: string | undefined, out: (line: string) => void, local = false): number {
  if (raw === undefined) return cachedRead("status", out) ?? statusAll(out, process.env);
  const r = resolveProject(raw);
  // a project of another machine is not in this one's list: its own machine tells it
  if ("error" in r && TASK_ID.test(raw)) return (out(`lineclear status: '${raw}' is a task, and status takes a project. Try 'lineclear task show ${raw}'`), 1);
  if ("error" in r) return !local && readMachines().length > 0 ? statusAll(out, process.env, raw) : (out(`lineclear status: ${r.error}`), 1);
  if (r.loose) out(`status of ${r.name} (read '${raw}' as ${r.name})`);
  return statusAll(out, process.env, r.name, local);
}

/** Runs one command and returns the exit code. A command that throws prints one line, never a stack trace. */
export async function main(args: string[], out: (line: string) => void = console.log, ask: Ask = defaultAsk()): Promise<number> {
  try {
    return await dispatch(args, out, ask);
  } catch (e) {
    out(`lineclear ${args[0] ?? ""}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`.replace("lineclear : ", "lineclear: "));
    return 1;
  }
}

async function dispatch(args: string[], out: (line: string) => void = console.log, ask: Ask = defaultAsk()): Promise<number> {
  const [name, ...rest] = args;
  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    out(helpText());
    return 0;
  }
  if (name === "--version") {
    out(versionLine());
    return 0;
  }
  if (name === "wait" || name === "resume" || name === "check" || name === "slot") return waitsMain(name, rest, out);
  if (name === "doctor" || name === "uninstall") {
    try {
      return await installCommand(name, rest, out);
    } catch (e) {
      out(`lineclear: ${e instanceof Error ? e.message : e}`);
      return 1;
    }
  }
  if (name === "setup") return setupMain(rest, out, ask);
  const stop = (name === "project" && rest[0] === "add") || (name === "run" && rest[0] === "--once") ? setupGate() : undefined;
  if (stop) return (out(`lineclear ${name === "run" ? "run" : "add"}: ${stop}`), 1);
  if (name === "project") return project(rest, ask, out);
  if (isBoardJob(name, rest)) return boardMain(args, out);
  const handler = COMMANDS[name];
  if (handler) return handler(rest, out);
  out(`lineclear: unknown command '${name}', try 'lineclear --help'`);
  return 2;
}

type Out = (line: string) => void;

const STATUS_USAGE = "usage: lineclear status [<project>] [--local] | lineclear status --plan [<task>]";

function statusCommand(rest: string[], out: Out): number | Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) return (out(STATUS_USAGE), 0);
  if (rest[0] === "--plan") return rest.length > 2 ? (out("usage: lineclear status --plan [<task>]"), 2) : planStatus(out, process.env, rest[1]);
  // --local is how a machine asks another: the receiver never asks a third, so a call goes one hop at most
  const local = rest.includes("--local");
  const args = rest.filter((a) => a !== "--local");
  if (args.length > 1 || args[0]?.startsWith("-")) return (out(STATUS_USAGE), 2);
  return statusProject(args[0], out, local);
}

function inboxCommand(rest: string[], out: Out): number | Promise<number> {
  if (rest[0] === "--help" || rest[0] === "-h") return (out("usage: lineclear inbox [--all] | lineclear inbox answer <n> <choice> [--note <text>]"), 0);
  if (rest.length === 0) return cachedRead("inbox", out) ?? inboxAll(out);
  return inboxMain(rest, out);
}

/** The commands that are one call: each gets the words after its name. */
const COMMANDS: Record<string, (rest: string[], out: Out) => number | Promise<number>> = {
  measure: measureMain,
  stalls: (rest, out) => stallsMain(rest, out, decisionsPath()),
  track: trackMain,
  machine: (rest, out) => machineMain(rest, out, process.env, (evidence) => fileFixNow(realWorld(process.env), "command-failed", evidence)),
  roadmap: roadmapMain,
  parts: partsMain,
  run: (rest, out) => (rest[0] === "--demo" ? demoMain(rest.slice(1), out) : runMain(rest, out, undefined, { web: startWeb })),
  serve: serveMain,
  export: (_rest, out) => exportMain(out),
  migrate: (rest, out) => (rest.includes("--all") ? migrateAll(rest, out) : migrateMain(rest, out)),
  secrets,
  totp,
  store: storeMain,
  backup: backupMain,
  release: (rest, out) =>
    rest[0] === "try"
      ? releaseTry(rest.slice(1), out)
      : rest[0] === "check"
        ? candidateMain(rest.slice(1), out)
        : rest[0] === "promote"
          ? promoteMain(rest.slice(1), out)
          : releaseMain(rest, out),
  status: statusCommand,
  plan: planMain,
  move: moveMain,
  dispatcher: dispatcherMain,
  ask: askMain,
  asks: (rest, out) => asksMain(rest, out),
  inbox: inboxCommand,
  event: eventMain,
  kit: kitMain,
  pack: packMain,
};

async function installCommand(name: "doctor" | "uninstall", rest: string[], out: (line: string) => void): Promise<number> {
  const paths = pathsFor();
  if (name === "doctor") {
    const probe = realProbe(paths);
    if (rest.includes("--fix")) {
      const bad = rest.find((a) => a !== "--fix" && a !== "--here");
      if (bad !== undefined) return (out(`lineclear: doctor --fix takes only --here, not '${bad}'`), 2);
      return await fixAll(probe, out, process.env, rest.includes("--here"));
    }
    const here = rest.includes("--here");
    const hosts = here ? [] : readMachines().map((m) => m.host);
    if (probe.which("herdr")) probe.herdr = { tested: testedHerdr(), machines: herdrVersions(probe.run, here) };
    if (hosts.length > 0)
      probe.machines = {
        commit: codeCommit(),
        stable: readRelease().stable?.commit,
        others: hosts.map((host) => {
          const e = fetchExportSync(host);
          return { host, commit: e?.commit ?? null, ...(e ? { relation: relationOf(codeCommit(), e.commit) } : {}), helperApart: e?.helperApart };
        }),
      };
    if (hosts.length > 0) probe.secrets = { here: secretFolderNames(), others: hosts.map((host) => ({ host, names: remoteSecretNames(host) })) };
    probe.kit = { here: readKit(), want: wantedKit(), others: here ? [] : remoteKitDiffs() };
    const code = doctor(probe, out);
    if (here) return code;
    const left = await remoteLeft(out);
    return code === 0 && left === 0 ? 0 : 1;
  }
  const bad = rest.find((a) => a !== "--all");
  if (bad !== undefined) {
    out(`lineclear: uninstall takes only --all, not '${bad}'`);
    return 2;
  }
  return uninstall(realRemover(paths), rest.includes("--all"), out);
}

/** Asks on the terminal, or null when there is no terminal to ask on. */
function defaultAsk(): Ask {
  if (!process.stdin.isTTY) return null;
  return async (question) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  };
}
