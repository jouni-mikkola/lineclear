// `bun run dispatcher:eval`: asks the configured Dispatcher model each request in cases.ts, with stand-ins for the two
// tools it calls, and prints the share it called right. It spends tokens, so `bun run check` does not run it: run it
// before each release and in U43.
//
//   --prompt <file>   the brief to test, templates/dispatcher.md if not given
//   --model <id>      the model, else LINECLEAR_DISPATCHER_MODEL, else the Dispatcher space's coordinator.model
//   --only <ids>      comma-separated case ids, or a prefix such as `move`
//   --jobs <n>        answers at once, 4 if not given
//   --save <file>     every answer's calls and tokens, as JSON
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serverBin } from "../../src/paths.ts";
import { cases, type Case } from "./cases.ts";
import { fakeBin } from "./fake.ts";
import { score, type Did, type Ran } from "./score.ts";

/** A parsed file or event read as it is: its shape is not ours to promise. */
type Raw = any;

const TIMEOUT_S = 240;
const GOAL = 100;
const FLOOR = 95;
/** Requests the owner makes on a day of 30 tasks or more, with room to spare, and the input tokens that day may cost. */
const BUSY_DAY_REQUESTS = 100;
const DAY_BUDGET = 5_000_000;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** The model the Dispatcher runs on: the flag, the variable, or the coordinator model of its space. */
function dispatcherModel(): string | undefined {
  const given = arg("model") ?? process.env.LINECLEAR_DISPATCHER_MODEL;
  if (given) return given;
  try {
    const p = Bun.spawnSync([serverBin(), "show", "--space", "dispatcher"], { stdin: "ignore" });
    return /^coordinator\.model\s+(\S+)/m.exec(p.stdout.toString())?.[1];
  } catch {
    return undefined;
  }
}

interface Result {
  c: Case;
  why: string | null;
  tokens: number;
  output: number;
  seconds: number;
  did: Did;
}

const READ_ONLY = /^\s*(ls|cat|head|tail|grep|rg|echo|pwd|find|wc|for|while|lineclear)\b/;

/** The environment without the running agent's Lineclear variables, so the model sees only the stand-ins. */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("LINECLEAR_")));
}

function parseEvent(line: string): Raw {
  if (!line.startsWith("{")) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** A call that changes something, which a read-only request must not make. */
function oddCall(e: Raw): string | undefined {
  if (e.type !== "tool_execution_start") return undefined;
  const command: string = e.args?.command ?? "";
  const bare = command.replace(/"[^"]*"|'[^']*'/g, '""').replace(/\d?>&\d|2>\/dev\/null/g, "");
  if (e.toolName === "write" || e.toolName === "edit") return `${e.toolName} ${e.args?.path ?? ""}`;
  if (e.toolName === "bash" && (/\b(git|gh|rm|mv|cp|tee|npm|bun)\b|>/.test(bare) || !READ_ONLY.test(bare))) return `bash ${command.slice(0, 80)}`;
  return undefined;
}

function usedTokens(e: Raw): { all: number; output: number } {
  if (e.type !== "message_end" || e.message?.role !== "assistant" || !e.message.usage) return { all: 0, output: 0 };
  const u = e.message.usage;
  return { all: (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) + (u.output ?? 0), output: u.output ?? 0 };
}

/** Reads what the model ran from the recorded calls and pi's event stream. */
function readDid(log: string, events: string): { did: Did; tokens: number; output: number } {
  const ran: Ran[] = existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\x02")
        .filter(Boolean)
        .map((c) => {
          const [program, ...args] = c.split("\x01").slice(0, -1);
          return { program: program as Ran["program"], args };
        })
    : [];
  const other: string[] = [];
  let tokens = 0;
  let output = 0;
  for (const line of events.split("\n")) {
    const e = parseEvent(line);
    if (!e) continue;
    const odd = oddCall(e);
    if (odd) other.push(odd);
    const used = usedTokens(e);
    tokens += used.all;
    output += used.output;
  }
  return { did: { ran, other }, tokens, output };
}

async function answer(c: Case, root: string, bin: string, prompt: string, model: string | undefined): Promise<Result> {
  const dir = mkdtempSync(join(root, "case-"));
  const log = join(dir, "calls.log");
  const started = performance.now();
  const p = Bun.spawn(
    [
      "timeout",
      "-k",
      "10",
      String(TIMEOUT_S),
      "pi",
      "-p",
      "--no-session",
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--mode",
      "json",
      "--append-system-prompt",
      prompt,
      ...(model ? ["--model", model] : []),
      c.text,
    ],
    {
      cwd: dir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...cleanEnv(), PATH: `${bin}:${process.env.PATH}`, EVAL_LOG: log, LINECLEAR_ROLE: "dispatcher", LINECLEAR_HOME: join(dir, "store") },
    },
  );
  const events = await new Response(p.stdout).text();
  await p.exited;
  const { did, tokens, output } = readDid(log, events);
  const why = events.includes('"role":"assistant"') ? score(c, did) : "the model gave no answer";
  return { c, why, tokens, output, seconds: (performance.now() - started) / 1000, did };
}

const only = arg("only")?.split(",");
const chosen = only ? cases.filter((c) => only.some((o) => c.id === o || c.id.startsWith(o))) : cases;
const jobs = Number(arg("jobs") ?? 4);
const promptFile = arg("prompt") ?? join(import.meta.dir, "..", "..", "templates", "dispatcher.md");
const model = dispatcherModel();
const root = mkdtempSync(join(tmpdir(), "lc-eval-"));
const bin = fakeBin(root);
const words = readFileSync(promptFile, "utf8").split(/\s+/).filter(Boolean).length;

console.log(
  `dispatcher eval: ${chosen.length} requests, model ${model ?? "pi default"}, brief ${promptFile.replace(`${process.cwd()}/`, "")} (${words} words)`,
);
const results: Result[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(jobs, chosen.length) }, async () => {
    while (next < chosen.length) {
      const c = chosen[next++]!;
      const r = await answer(c, root, bin, promptFile, model);
      results.push(r);
      console.log(`${r.why === null ? "right" : "WRONG"}  ${c.id}${r.why === null ? "" : `  ${r.why}`}`);
    }
  }),
);
rmSync(root, { recursive: true, force: true });

if (results.length === 0) console.log("no request matched --only"), process.exit(1);
const wrong = results.filter((r) => r.why !== null);
const share = (100 * (results.length - wrong.length)) / results.length;
const mean = (f: (r: Result) => number) => Math.round(results.reduce((s, r) => s + f(r), 0) / results.length);
console.log("");
console.log(`right: ${results.length - wrong.length} of ${results.length} = ${share.toFixed(1)} % (goal ${GOAL} %, never below ${FLOOR} %)`);
console.log(`tokens per answer: ${mean((r) => r.tokens)} in all, ${mean((r) => r.output)} written; ${mean((r) => r.seconds)} s`);
const day = mean((r) => r.tokens) * BUSY_DAY_REQUESTS;
console.log(`a busy day of ${BUSY_DAY_REQUESTS} requests: ${(day / 1e6).toFixed(1)}M tokens (budget ${DAY_BUDGET / 1e6}M)`);
if (wrong.length > 0) {
  console.log("\nwrong:");
  for (const r of wrong) console.log(`  ${r.c.id}  "${r.c.text}"\n    ${r.why}`);
}
if (arg("save"))
  writeFileSync(
    arg("save")!,
    JSON.stringify(
      results.map((r) => ({ id: r.c.id, why: r.why, tokens: r.tokens, did: r.did })),
      null,
      2,
    ),
  );
process.exit(share < FLOOR || day > DAY_BUDGET ? 1 : 0);
