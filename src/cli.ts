import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { storeMain } from "./store-copies.ts";
import { dispatcherMain, moveMain } from "./dispatcher.ts";
import { doctor, herdrVersions, realProbe, testedHerdr } from "./doctor.ts";
import { askMain } from "./inbox.ts";
import { inboxMain } from "./inbox-answer.ts";
import { status } from "./status.ts";
import { planMain } from "./plan.ts";
import { planStatus } from "./requests.ts";
import { resolveProject } from "./resolve.ts";
import { pathsFor } from "./paths.ts";
import { fillSetup } from "./fill-setup.ts";
import { type Ask, setupGate } from "./project.ts";
import { setupMain } from "./setup.ts";
import { project } from "./project-cli.ts";
import { roadmapMain } from "./roadmap-cli.ts";
import { demoMain } from "./demo.ts";
import { runMain } from "./rules.ts";
import { startWeb } from "./web.ts";
import { secrets, totp } from "../server/server/live/secrets.ts";
import { topMain } from "./top-cmd.ts";
import { boardMain, isBoardJob, serveMain } from "./serve.ts";
import { waitsMain } from "./waits.ts";
import { realRemover, uninstall } from "./uninstall.ts";
import { gitText } from "./git.ts";
import { recordReviewCall } from "./task-work.ts";

export const commands: Record<string, string> = {
  doctor: "Check each part and name the command that fixes a problem (--here checks only this machine)",
  project: "Add, list, change, remove and check projects",
  roadmap: "Check or show the roadmap (roadmap show <id> prints one step)",
  setup: "Choose a model for the worker, reviewer, planner and step checker from the logged-in harnesses (the reviewer from another company than the worker)",
  run: "Run the rule loop and serve the web pages (--once, --dry-run; --board <port> also starts herdr and the board where no service does), or only serve them on fixed demo data (--demo)",
  serve: "Serve the board (the web server): serve --port <port>",
  space: "The board's spaces: space add <path> --name <name>, space list, space rename, space remove",
  task: "The board's tasks: task add, list, show, tell, stop, close (task --help lists them)",
  show: "Show the board's few settings: show [--space <name>]",
  ready: 'A task\'s agent says its change is ready: ready <id> --summary "..."',
  merge: "Merge a task's change: merge <id>",
  artifact: "Make, update or list a task's artifacts (a report, a dashboard)",
  pr: "Push a task's branch and open its pull request: pr <id>",
  checks: "Wait for GitHub's checks on a task's pull request: checks <id>",
  alert: 'Send an alert to your devices: alert "<title>" --body "<why now>"',
  restart: "Restart a space's coordinator or a task's agent: restart <space|id>",
  set: "Change a setting of the board: set <key> <value> [--machine | --space <name>]",
  unset: "Go back to a setting's default: unset <key>",
  todo: "Show a task that waits for a go as To do: todo <id>",
  done: "End a task that has nothing to merge: done <id>",
  secret: "Use a secret by name in a command: secret run NAME -- <command>",
  secrets: 'Load the folder\'s secrets into a shell: eval "$(lineclear secrets env)" (add them in Settings > Secrets)',
  alive: "A task's agent beats: alive <id>",
  room: "A machine's room as herdr reads it, with its tasks at work and its slots: room [<machine>]",
  progress: 'A space\'s coordinator saves or reads its progress: progress ["<text>"]',
  checkpoint: "A space's coordinator commits its owned task's work: checkpoint \"<message>\"",
  complete: 'A space\'s coordinator proves its stopping goal and ends its run: complete "<evidence>"',
  top: "Every agent at work: its task, machine, phase, input tokens, minutes and what it waits for",
  store: "The local copies of the task store (store list, store copy, store restore <name>); the rule loop takes one an hour",
  totp: "Print the current code of a stored login: totp NAME reads NAME_TOTP from this folder's secrets",
  status:
    'Show what stops each project and what each task waits for; --plan [<task>] shows the steps of a plan; a task\'s agent reports progress: status <id> "<line>" --done <0-100> [--left 5m]',
  wait: "Declare a wait: owner --kind login|money|outward, login, checks, browser, task <id>, or until <time>",
  plan: 'Start a planning task: plan <project> "<goal>"; plan submit sends its roadmap change to the Inbox; a task\'s agent lists its steps: plan <id> --step "..."',
  move: "Send a plan change to the Inbox: move <project> <step> --after <ids>",
  dispatcher: "Make the Dispatcher chat: dispatcher setup; dispatcher projects lists what it picks a project from",
  ask: "Put a question with choices in the Inbox, and wait for the answer (--kind login|outward); a card in a chat is card",
  card: 'Ask the chat a question with choices: card "<question>" --choice "<label>" ... (the board\'s old ask)',
  inbox: "List open items of every machine (--all adds closed ones of this one), or answer one: inbox answer <n> <choice>",
  resume: "End this task's declared wait",
  check: "Run the project's check (or the command given) in its turn: one full check at a time per machine; --changed runs only what the branch changed",
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
    commit = gitText(dir, "rev-parse", "--short", "HEAD") || "unknown";
  }
  return `lineclear ${version} ${commit}`;
}

// project names are lowercase, so an upper-case prefix is always a task
const TASK_ID = /^[A-Z][A-Z0-9]*-\d+$/;

/** `lineclear status [<project>]`: a project written loosely is read as the one it means, or refused with the two nearest. */
function statusProject(raw: string | undefined, out: (line: string) => void): number {
  if (raw === undefined) return status(out, process.env);
  const r = resolveProject(raw);
  if ("error" in r && TASK_ID.test(raw)) return (out(`lineclear status: '${raw}' is a task, and status takes a project. Try 'lineclear task show ${raw}'`), 1);
  if ("error" in r) return (out(`lineclear status: ${r.error}`), 1);
  if (r.loose) out(`status of ${r.name} (read '${raw}' as ${r.name})`);
  return status(out, process.env, r.name);
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
  recordReviewCall();
  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    out(helpText());
    return 0;
  }
  if (name === "--version") {
    out(versionLine());
    return 0;
  }
  if (name === "wait" || name === "resume" || name === "check") return waitsMain(name, rest, out);
  if (name === "doctor" || name === "uninstall") {
    try {
      return await installCommand(name, rest, out);
    } catch (e) {
      out(`lineclear: ${e instanceof Error ? e.message : e}`);
      return 1;
    }
  }
  if (name === "setup") return setupMain(rest, out, ask);
  const gated = (name === "project" && rest[0] === "add") || (name === "run" && rest[0] === "--once");
  if (gated) fillSetup();
  const stop = gated ? setupGate() : undefined;
  if (stop) return (out(`lineclear ${name === "run" ? "run" : "add"}: ${stop}`), 1);
  if (name === "project") return project(rest, ask, out);
  if (isBoardJob(name, rest)) return boardMain(args, out);
  const handler = COMMANDS[name];
  if (handler) return handler(rest, out);
  out(`lineclear: unknown command '${name}', try 'lineclear --help'`);
  return 2;
}

type Out = (line: string) => void;

const STATUS_USAGE = "usage: lineclear status [<project>] | lineclear status --plan [<task>]";

function statusCommand(rest: string[], out: Out): number | Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) return (out(STATUS_USAGE), 0);
  if (rest[0] === "--plan") return rest.length > 2 ? (out("usage: lineclear status --plan [<task>]"), 2) : planStatus(out, process.env, rest[1]);
  if (rest.length > 1 || rest[0]?.startsWith("-")) return (out(STATUS_USAGE), 2);
  return statusProject(rest[0], out);
}

function inboxCommand(rest: string[], out: Out): number | Promise<number> {
  if (rest[0] === "--help" || rest[0] === "-h") return (out("usage: lineclear inbox [--all] | lineclear inbox answer <n> <choice> [--note <text>]"), 0);
  return inboxMain(rest, out);
}

/** The commands that are one call: each gets the words after its name. */
const COMMANDS: Record<string, (rest: string[], out: Out) => number | Promise<number>> = {
  top: (_rest, out) => topMain(out),
  roadmap: roadmapMain,
  run: (rest, out) => (rest[0] === "--demo" ? demoMain(rest.slice(1), out) : runMain(rest, out, undefined, { web: startWeb })),
  serve: serveMain,
  secrets,
  totp,
  store: storeMain,
  status: statusCommand,
  plan: planMain,
  move: moveMain,
  dispatcher: dispatcherMain,
  ask: askMain,
  inbox: inboxCommand,
};

async function installCommand(name: "doctor" | "uninstall", rest: string[], out: (line: string) => void): Promise<number> {
  const paths = pathsFor();
  if (name === "doctor") {
    const probe = realProbe(paths);
    const here = rest.includes("--here");
    if (probe.which("herdr")) probe.herdr = { tested: testedHerdr(), machines: herdrVersions(probe.run, here) };
    return doctor(probe, out);
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
