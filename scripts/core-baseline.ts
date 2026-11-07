// Core speed baseline numbers (docs/numbers.md, "Core baseline"): one mode per measure, each prints median, p90 and worst.
// Usage: bun scripts/core-baseline.ts <start|tokens|stalls|gh|time|snapshot|chat-tokens> [args]
//   start  [n=20]       task add to the agent's first tool call, from the last n done tasks' session files
//   tokens [n=20]       tokens per task by role (agent, reviewer), from the last n done tasks' session files
//   stalls              stalls per hour and failed starts per machine, from the board's task history
//   gh     [n=20]       GitHub check time on main per job, from the last n runs of check.yml
//   time <n> <cmd...>   wall time of a command, n runs
//   snapshot <url> [n=7]  wall time and size of GET <url>/api/snapshot, n runs
//   chat-tokens [n=20]  tokens per session of the coordinator and the Dispatcher, from their last n session files
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Task = {
  id: string;
  project: string;
  created: number;
  doneAt?: number;
  worktree: string;
  startMs?: { worktree: number; install: number; session: number };
  briefResent?: unknown;
  mergeStopped?: unknown;
};
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
type Session = { role: "agent" | "reviewer"; firstToolCallAt?: number; usage: Usage };

const SESSIONS = join(homedir(), ".pi/agent/sessions");
const BOARD = join(homedir(), ".lineclear");

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const p90 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.9) - 1] ?? 0;
const worst = (xs: number[]): number => Math.max(...xs);
const line = (label: string, xs: number[], unit: string, digits = 1): void =>
  console.log(
    `${label}: median ${median(xs).toFixed(digits)} ${unit}, p90 ${p90(xs).toFixed(digits)} ${unit}, worst ${worst(xs).toFixed(digits)} ${unit} (${xs.length} runs)`,
  );

function doneTasks(n: number): Task[] {
  const all = (JSON.parse(readFileSync(join(BOARD, "tasks.json"), "utf8")) as { tasks: Task[] }).tasks;
  return all
    .filter((t) => t.doneAt && t.worktree)
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
    .slice(0, n);
}

/** A pi session folder name is the worktree path with "/" as "-" between "--" marks. */
function sessionsOf(task: Task): Session[] {
  const dir = join(SESSIONS, `--${task.worktree.slice(1).replaceAll("/", "-").replaceAll("_", "-")}--`);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => {
      const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      let role: Session["role"] = "reviewer";
      let firstToolCallAt: number | undefined;
      let seenUser = false;
      for (const raw of readFileSync(join(dir, f), "utf8").split("\n")) {
        if (!raw) continue;
        const e = JSON.parse(raw) as { type: string; timestamp?: string; message?: { role: string; content: unknown; usage?: Usage } };
        const m = e.message;
        if (e.type !== "message" || !m) continue;
        if (m.role === "user" && !seenUser) {
          seenUser = true;
          if (JSON.stringify(m.content).includes("Settings: (from lineclear show")) role = "agent";
        }
        if (m.role !== "assistant") continue;
        if (!firstToolCallAt && Array.isArray(m.content) && m.content.some((c: { type: string }) => c.type === "toolCall"))
          firstToolCallAt = Date.parse(e.timestamp ?? "");
        for (const k of Object.keys(usage) as (keyof Usage)[]) usage[k] += m.usage?.[k] ?? 0;
      }
      return { role, firstToolCallAt, usage };
    });
}

function start(n: number): void {
  const secs: number[] = [];
  const phases: Record<string, number[]> = { worktree: [], install: [], session: [], "first call": [] };
  let resent = 0;
  for (const t of doneTasks(n)) {
    const first = sessionsOf(t).find((s) => s.role === "agent")?.firstToolCallAt;
    if (first) secs.push((first - t.created) / 1000);
    if (first && t.startMs) {
      const { worktree, install, session } = t.startMs;
      phases.worktree?.push(worktree / 1000);
      phases.install?.push(install / 1000);
      phases.session?.push(session / 1000);
      phases["first call"]?.push((first - t.created - worktree - install - session) / 1000);
    }
    if (t.briefResent) resent++;
  }
  line("task add to first tool call", secs, "s");
  for (const [name, xs] of Object.entries(phases)) if (xs.length) line(`  phase ${name}`, xs, "s");
  console.log(`tasks whose brief was sent again: ${resent}`);
}

function tokens(n: number): void {
  const tasks = doneTasks(n);
  for (const role of ["agent", "reviewer"] as const) {
    const per = tasks
      .map((t) => {
        const u = sessionsOf(t)
          .filter((s) => s.role === role)
          .map((s) => s.usage);
        return {
          fresh: u.reduce((a, x) => a + x.input + x.cacheWrite, 0),
          cached: u.reduce((a, x) => a + x.cacheRead, 0),
          out: u.reduce((a, x) => a + x.output, 0),
          has: u.length > 0,
        };
      })
      .filter((p) => p.has);
    const k = (xs: number[]) => xs.map((x) => x / 1000);
    line(`${role} input (new, cache writes), k tokens per task`, k(per.map((p) => p.fresh)), "k", 0);
    line(`${role} input (cache reads), k tokens per task`, k(per.map((p) => p.cached)), "k", 0);
    line(`${role} output, k tokens per task`, k(per.map((p) => p.out)), "k", 0);
  }
}

function stallLines(): void {
  const file = join(homedir(), ".config/lineclear/decisions.jsonl");
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.includes('"kind":"stall"'));
  const times = lines.map((l) => Date.parse((JSON.parse(l) as { time: string }).time));
  const hours = (Math.max(...times) - Math.min(...times)) / 3.6e6;
  const byClass = Object.entries(Object.groupBy(lines, (l) => /"reason":"stall ([a-z-]+)/.exec(l)?.[1] ?? "ladder step"));
  console.log(`decisions.jsonl: ${lines.length} stall-kind lines over ${hours.toFixed(0)} h (${(lines.length / hours).toFixed(1)} per h)`);
  for (const [cls, ls] of byClass.sort((x, y) => (y[1]?.length ?? 0) - (x[1]?.length ?? 0))) console.log(`  ${cls}: ${ls?.length}`);
}

function stalls(): void {
  stallLines();
  const tasks = (JSON.parse(readFileSync(join(BOARD, "tasks.json"), "utf8")) as { tasks: Task[] }).tasks;
  const chat = readdirSync(join(BOARD, "chatlog"))
    .filter((f) => f.startsWith("p_"))
    .map((f) => readFileSync(join(BOARD, "chatlog", f), "utf8"))
    .join("\n");
  const stalled = (chat.match(/may be stuck|may have stalled/g) ?? []).length;
  for (const [machine, ts] of Object.entries(Object.groupBy(tasks, (t) => t.project.split(":")[1] ?? "?"))) {
    const list = ts ?? [];
    const first = Math.min(...list.map((t) => t.created));
    const last = Math.max(...list.map((t) => t.doneAt ?? t.created));
    const hours = (last - first) / 3.6e6;
    const retried = list.filter((t) => t.briefResent).length;
    console.log(
      `${machine}: ${list.length} tasks over ${hours.toFixed(1)} h; stall cards in chat ${stalled} total (${(stalled / hours).toFixed(2)} per h); starts that needed the brief sent again ${retried}`,
    );
  }
}

function gh(n: number): void {
  const out = spawnSync(
    "gh",
    ["run", "list", "--workflow", "check.yml", "--branch", "main", "--limit", String(n), "--json", "databaseId,startedAt,updatedAt"],
    { encoding: "utf8" },
  );
  const runs = JSON.parse(out.stdout) as { databaseId: number; startedAt: string; updatedAt: string }[];
  const byJob = new Map<string, number[]>();
  const whole: number[] = [];
  for (const r of runs) {
    whole.push((Date.parse(r.updatedAt) - Date.parse(r.startedAt)) / 1000);
    const j = spawnSync("gh", ["run", "view", String(r.databaseId), "--json", "jobs"], { encoding: "utf8" });
    for (const job of (JSON.parse(j.stdout) as { jobs: { name: string; startedAt: string; completedAt: string; conclusion: string }[] }).jobs) {
      if (job.conclusion === "skipped") continue;
      const s = (Date.parse(job.completedAt) - Date.parse(job.startedAt)) / 1000;
      byJob.set(job.name, [...(byJob.get(job.name) ?? []), s]);
    }
  }
  line("check.yml run, start to last job", whole, "s", 0);
  for (const [name, xs] of byJob) line(`job ${name}`, xs, "s", 0);
}

function time(n: number, cmd: string[]): void {
  const secs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    spawnSync(cmd[0] ?? "", cmd.slice(1), { stdio: "ignore" });
    secs.push((performance.now() - t0) / 1000);
  }
  line(cmd.join(" "), secs, "s", 2);
}

async function snapshot(url: string, n: number): Promise<void> {
  const secs: number[] = [];
  let bytes = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    bytes = (await (await fetch(`${url}/api/snapshot`)).arrayBuffer()).byteLength;
    secs.push((performance.now() - t0) / 1000);
  }
  line(`GET /api/snapshot (${(bytes / 1e6).toFixed(1)} MB)`, secs, "s", 2);
}

function chatTokens(n: number): void {
  const dirOf = (cwd: string) => join(SESSIONS, `--${cwd.slice(1).replaceAll("/", "-")}--`);
  const roles: [string, string][] = [
    ["coordinator", dirOf(join(homedir(), ".herdr-projects/data/coordinator-default-chat"))],
    ["Dispatcher", dirOf(join(homedir(), ".config/lineclear/dispatcher"))],
  ];
  for (const [role, dir] of roles) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .slice(-n);
    const per = files.map((f) => {
      const u: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      for (const raw of readFileSync(join(dir, f), "utf8").split("\n")) {
        if (!raw) continue;
        const m = (JSON.parse(raw) as { message?: { role: string; usage?: Usage } }).message;
        if (m?.role !== "assistant") continue;
        for (const k of Object.keys(u) as (keyof Usage)[]) u[k] += m.usage?.[k] ?? 0;
      }
      return u;
    });
    line(
      `${role} input (new), k tokens per session`,
      per.map((u) => (u.input + u.cacheWrite) / 1000),
      "k",
      0,
    );
    line(
      `${role} input (cache reads), k tokens per session`,
      per.map((u) => u.cacheRead / 1000),
      "k",
      0,
    );
    line(
      `${role} output, k tokens per session`,
      per.map((u) => u.output / 1000),
      "k",
      0,
    );
  }
}

const [mode, a, ...rest] = process.argv.slice(2);
if (mode === "start") start(Number(a ?? 20));
else if (mode === "tokens") tokens(Number(a ?? 20));
else if (mode === "stalls") stalls();
else if (mode === "gh") gh(Number(a ?? 20));
else if (mode === "time") time(Number(a), rest);
else if (mode === "snapshot") await snapshot(a ?? "", Number(rest[0] ?? 7));
else if (mode === "chat-tokens") chatTokens(Number(a ?? 20));
else console.log("usage: bun scripts/core-baseline.ts <start|tokens|stalls|gh|time|snapshot|chat-tokens> [args]");
