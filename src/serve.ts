import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { dataDir, serverBin } from "./paths.ts";

const server = join(import.meta.dir, "..", "server");

/** The board's roles whose agent Lineclear runs: pi, which its extension and kit are for. */
const PI_ROLES = ["task.agent", "coordinator.agent", "reviewer.agent"];

/**
 * The board starts Claude Code for a role nobody has set, and a newcomer may not have it. A new board gets pi for each
 * role; a board that has settings keeps them, so an update never swaps the agent that runs someone's tasks.
 */
export function piByDefault(env: NodeJS.ProcessEnv = process.env): void {
  const file = join(dataDir(env), "settings.json");
  if (existsSync(file)) return;
  mkdirSync(dataDir(env), { recursive: true });
  writeAtomic(file, `${JSON.stringify({ machine: {}, spaces: {}, everywhere: Object.fromEntries(PI_ROLES.map((k) => [k, "pi"])) }, null, 2)}\n`);
}

/** Starts the server in server/ and stays up until it stops. Installs and builds it on first use. */
export async function serveMain(args: string[], out: (line: string) => void): Promise<number> {
  let port: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const value = a === "--port" ? args[++i] : a.startsWith("--port=") ? a.slice(7) : undefined;
    if (value === undefined || !/^\d+$/.test(value) || Number(value) > 65535) {
      out("usage: lineclear serve [--port <port>]");
      return 2;
    }
    port = value;
  }
  const step = async (cmd: string[]) => (await Bun.spawn(cmd, { cwd: server, stdin: "ignore", stdout: "inherit", stderr: "inherit" }).exited) === 0;
  if (!existsSync(join(server, "node_modules")) && !(await step(["bun", "install", "--frozen-lockfile"]))) return 1;
  if (!(await step(["bun", "run", "build"]))) return 1;
  piByDefault();
  const env = { ...process.env, ...(port === undefined ? {} : { LINECLEAR_PORT: port }) };
  const child = Bun.spawn(["bun", "main.ts"], { cwd: join(server, "server"), env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
  return child.exited;
}

/** The words of the board's command that `lineclear` answers itself. `card` is the board's `ask` under a new name: `ask` is Lineclear's Inbox question. */
const BOARD_COMMANDS = [
  "space",
  "task",
  "show",
  "ready",
  "merge",
  "pr",
  "artifact",
  "secret",
  "checks",
  "alert",
  "automation",
  "restart",
  "set",
  "unset",
  "todo",
  "done",
  "card",
  "alive",
  "room",
  "progress",
  "checkpoint",
  "complete",
];
/** Words both have: the board's job is told by its own arguments, the rest is Lineclear's (`doctor` and a bare `status` are Lineclear's alone). */
const SHARED_WORDS: Record<string, (rest: string[]) => boolean> = {
  status: (rest) => (!rest[0]?.startsWith("-") && rest.length >= 2) || rest.includes("--done") || rest.includes("--left"),
  plan: (rest) => rest.some((a) => a === "--step" || a.startsWith("--step=")),
};
const OWN_LINES = /^ {2}lineclear (doctor|status)\b(?! <id>)/;

/** True when `lineclear <name> <rest>` is the board's job: one of its own commands, or a shared word told by its arguments. */
export const isBoardJob = (name: string, rest: string[]): boolean => BOARD_COMMANDS.includes(name) || SHARED_WORDS[name]?.(rest) === true;

/** The board's help said as Lineclear: `ask` is `card`, and the lines of `doctor` and a bare `status` are Lineclear's own. */
export function brandedHelp(text: string): string {
  const kept: string[] = [];
  let skipping = false;
  for (const l of text.split("\n")) {
    if (OWN_LINES.test(l)) skipping = true;
    else if (skipping && !/^ {4,}/.test(l)) skipping = false;
    if (!skipping) kept.push(l);
  }
  return kept.join("\n").replace(/lineclear ask /g, "lineclear card ");
}

/** Any other answer of the board: the name, and the commands that are Lineclear's too. Data (`--json`) and a command's own output are left as they are. */
export function brandedAnswer(text: string): string {
  const board = new RegExp(`\\blineclear (${[...BOARD_COMMANDS, ...Object.keys(SHARED_WORDS)].join("|")})\\b`, "g");
  return text.replace(/\blineclear ask\b/g, "lineclear card").replace(board, "lineclear $1");
}

/** `lineclear space add`, `lineclear task list` and the rest of the board's commands: run by the board's own command, its words said as Lineclear. */
export async function boardMain(args: string[], out: (line: string) => void): Promise<number> {
  const bin = serverBin();
  const help = args.length === 0 || args.includes("--help") || args[0] === "help";
  // a command that runs another, or answers in data, shows its output live and untouched
  if ((args[0] === "secret" && !help) || args.includes("--json"))
    return Bun.spawn([bin, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited;
  const child = Bun.spawn([bin, ...args], { stdin: "inherit", stdout: "pipe", stderr: "pipe" });
  const [o, e, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const say = help ? brandedHelp : brandedAnswer;
  if (o) out(say(o).replace(/\n$/, ""));
  if (e) process.stderr.write(say(e));
  return code;
}
