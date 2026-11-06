// Why GitHub's checks go red: each red run of the project's `check` workflow is sorted by its first cause, read from the
// log of its failed steps (`gh run view --log-failed`). A test that failed and passed on the same commit, or on main
// with no fix commit before the next run, is flaky. The sort is pure; only `readRuns` talks to gh and git.
import { DAY } from "./time.ts";

type Cause = "flaky test" | "real break" | "gate" | "setup" | "time limit";

export interface GhRun {
  id: number;
  event: string;
  branch: string;
  sha: string;
  conclusion: string;
  at: number;
  /** the output of its failed steps, empty for a run that was not red */
  log: string;
}

interface FailedTest {
  name: string;
  ms: number;
}

interface FirstCause {
  kind: "test" | "gate" | "setup" | "time limit" | "unknown";
  tests: FailedTest[];
}

const ANSI = /\x1b\[[0-9;]*m/g;
/** A `gh run view --log-failed` line is `job<TAB>step<TAB>timestamp text`. */
const LOG_LINE = /^([^\t]*)\t([^\t]*)\t\S+Z (.*)$/;
const CHECK_STEP = /^Run bun scripts\/check\.ts/;

/** The first thing that went wrong in a red run's log. The aggregate job `check` only repeats the others and is skipped. */
export function firstCause(log: string): FirstCause {
  const tests = new Map<string, number>();
  let kind: FirstCause["kind"] | undefined;
  for (const raw of log.replace(ANSI, "").split("\n")) {
    const m = LOG_LINE.exec(raw.replace(/^\uFEFF/, ""));
    if (!m || m[1] === "check") continue;
    const [, , step, text] = m as unknown as [string, string, string, string];
    const fail = /^\(fail\) (.*?) \[([\d.]+)(ms|s)\]$/.exec(text);
    if (fail) {
      tests.set(fail[1]!, Math.max(tests.get(fail[1]!) ?? 0, Number(fail[2]) * (fail[3] === "s" ? 1000 : 1)));
      kind ??= "test";
    } else if (/exceeded the maximum execution time|The job was canceled because|The operation was canceled/.test(text)) {
      kind ??= "time limit";
    } else if (/^check: (.+?) failed/.test(text)) {
      if (!/tests?$/.test(/^check: (.+?) failed/.exec(text)![1]!)) kind ??= "gate";
    } else if (/^##\[error\]/.test(text) && !CHECK_STEP.test(step) && step !== "UNKNOWN STEP") {
      kind ??= "setup";
    }
  }
  return { kind: kind ?? "unknown", tests: [...tests].map(([name, ms]) => ({ name, ms })) };
}

/** Whether a red run is a pull request's (a merge queue run is one too) or main's. */
const side = (r: GhRun): "main" | "pull requests" => (r.event === "push" && r.branch === "main" ? "main" : "pull requests");

interface Tally {
  runs: number;
  green: number;
  red: number;
  cancelled: number;
  causes: Record<Cause, number>;
}

export interface Report {
  main: Tally;
  pullRequests: Tally;
  tests: { name: string; runs: number; cause: "flaky test" | "real break"; longestMs: number }[];
}

const emptyTally = (): Tally => ({ runs: 0, green: 0, red: 0, cancelled: 0, causes: { "flaky test": 0, "real break": 0, gate: 0, setup: 0, "time limit": 0 } });

/** `fixBetween(a, b)`: a commit between the two main commits fixes something. */
export function sortRuns(runs: GhRun[], fixBetween: (from: string, to: string) => boolean = () => false): Report {
  const ordered = [...runs].sort((a, b) => a.at - b.at);
  const report: Report = { main: emptyTally(), pullRequests: emptyTally(), tests: [] };
  const tests = new Map<string, { runs: number; flaky: boolean; longestMs: number }>();
  ordered.forEach((run, i) => {
    const tally = side(run) === "main" ? report.main : report.pullRequests;
    tally.runs++;
    if (run.conclusion === "success") return void tally.green++;
    if (run.conclusion === "cancelled" && !/maximum execution time/.test(run.log)) return void tally.cancelled++;
    if (run.conclusion !== "failure" && run.conclusion !== "cancelled" && run.conclusion !== "timed_out") return;
    tally.red++;
    const first = firstCause(run.log);
    const sameSha = ordered.some((o) => o !== run && o.sha === run.sha && o.event === run.event && o.conclusion === "success");
    const next = side(run) === "main" ? ordered.slice(i + 1).find((o) => side(o) === "main") : undefined;
    const recovered = sameSha || (next?.conclusion === "success" && next.sha !== run.sha && !fixBetween(run.sha, next.sha));
    const flaky = first.kind === "test" && recovered;
    const cause: Cause = first.kind === "test" ? (flaky ? "flaky test" : "real break") : first.kind === "unknown" ? "real break" : first.kind;
    tally.causes[cause]++;
    for (const t of first.tests) {
      const seen = tests.get(t.name) ?? { runs: 0, flaky: false, longestMs: 0 };
      tests.set(t.name, { runs: seen.runs + 1, flaky: seen.flaky || flaky, longestMs: Math.max(seen.longestMs, t.ms) });
    }
  });
  report.tests = [...tests]
    .map(([name, t]) => ({ name, runs: t.runs, cause: t.flaky ? ("flaky test" as const) : ("real break" as const), longestMs: t.longestMs }))
    .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name));
  return report;
}

const CAUSES: Cause[] = ["flaky test", "real break", "gate", "setup", "time limit"];

export function renderReport(report: Report, days: number): string[] {
  const row = (label: string, t: Tally) => `| ${label} | ${t.runs} | ${t.green} | ${t.red} | ${t.cancelled} | ${CAUSES.map((c) => t.causes[c]).join(" | ")} |`;
  const lines = [
    `Check failures, the last ${days} days`,
    "",
    `| | runs | green | red | cancelled | ${CAUSES.join(" | ")} |`,
    `|---|---|---|---|---|${CAUSES.map(() => "---").join("|")}|`,
    row("main", report.main),
    row("pull requests", report.pullRequests),
    "",
  ];
  if (report.tests.length === 0) return [...lines, "No failing test."];
  lines.push("| failing test | runs | cause | longest |", "|---|---|---|---|");
  for (const t of report.tests) lines.push(`| ${t.name} | ${t.runs} | ${t.cause} | ${(t.longestMs / 1000).toFixed(1)} s |`);
  return lines;
}

const gh = (args: string[]): string => {
  const p = Bun.spawnSync(["gh", ...args], { stdin: "ignore", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${p.stderr.toString().trim()}`);
  return p.stdout.toString();
};

/** The runs of the `check` workflow in the last `days` days, with the log of each red one. */
function readRuns(days: number, now = Date.now()): GhRun[] {
  const since = new Date(now - days * DAY).toISOString();
  const list: any[] = JSON.parse(
    gh(["run", "list", "--workflow", "check", "--limit", "500", "--json", "databaseId,event,headBranch,headSha,conclusion,createdAt"]),
  );
  return list
    .filter((r) => r.createdAt >= since)
    .map((r) => {
      const red = r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "cancelled";
      let log = "";
      if (red) {
        try {
          log = gh(["run", "view", String(r.databaseId), "--log-failed"]);
        } catch {
          log = "";
        }
      }
      return { id: r.databaseId, event: r.event, branch: r.headBranch, sha: r.headSha, conclusion: r.conclusion, at: Date.parse(r.createdAt), log };
    });
}

/** A commit between two main commits has a subject that starts with "fix". */
function fixBetweenGit(from: string, to: string): boolean {
  const p = Bun.spawnSync(["git", "log", "--format=%s", `${from}..${to}`], { stdin: "ignore", stderr: "ignore" });
  return (
    p.exitCode === 0 &&
    p.stdout
      .toString()
      .split("\n")
      .some((s) => /^fix/i.test(s))
  );
}

export function checksMain(args: string[], out: (l: string) => void): number {
  let days = 2;
  if (args.length === 2 && args[0] === "--days" && /^[1-9]\d*$/.test(args[1]!)) days = Number(args[1]);
  else if (args.length > 0) return (out("usage: lineclear measure checks [--days N]"), 2);
  try {
    for (const l of renderReport(sortRuns(readRuns(days), fixBetweenGit), days)) out(l);
  } catch (e) {
    return (out(`lineclear: ${(e as Error).message}`), 1);
  }
  return 0;
}
