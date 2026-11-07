// A branch's checks as GitHub reports them on its pull request, read with gh. Nothing is recorded on this machine.
import { spawnSync } from "node:child_process";

export interface PrCheck {
  name: string;
  ok: boolean;
  seconds: number;
  /** when it finished, in ms */
  at: number;
}

const FRESH_MS = 60_000;
const cache = new Map<string, { read: number; checks: PrCheck[] }>();

/** The finished checks of `branch`'s pull request, oldest first; none when gh can't tell. Kept a minute: Home asks for every task at each refresh. */
export function prChecks(cwd: string, branch: string, now = Date.now()): PrCheck[] {
  const key = `${cwd}\0${branch}`;
  const kept = cache.get(key);
  if (kept && now - kept.read < FRESH_MS) return kept.checks;
  // gh exits non-zero for a failed or pending check but still prints them
  const r = spawnSync("gh", ["pr", "checks", branch, "--json", "name,bucket,startedAt,completedAt"], { cwd, encoding: "utf8", timeout: 20_000 });
  let list: { name: string; bucket: string; startedAt?: string; completedAt?: string }[] = [];
  try {
    list = JSON.parse(r.stdout ?? "");
  } catch {}
  const checks = list
    .filter((c) => (c.bucket === "pass" || c.bucket === "fail") && c.completedAt && !c.completedAt.startsWith("0001"))
    .map((c) => {
      const at = Date.parse(c.completedAt ?? "");
      const started = Date.parse(c.startedAt ?? "");
      return { name: c.name, ok: c.bucket === "pass", seconds: Number.isNaN(started) ? 0 : Math.max(0, Math.round((at - started) / 1000)), at };
    })
    .sort((a, b) => a.at - b.at);
  cache.set(key, { read: now, checks });
  return checks;
}

const NAMED_FAIL = [
  /^\s*\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/, // bun
  /^\s*not ok \d+ - (.+)$/, // TAP, node --test
  /^\s*[✖✘] (.+?)(?: \([\d.]+m?s\))?$/, // node's spec reporter, Playwright
];

/** bun prints the file of the tests below it on a line of its own. */
const FILE_HEADER = /^(\S+\.(?:test|spec)\.\w+):$/;

/** The tests a job log names as failed, each once, as `<file>: <name>` where the log names the file. */
export function failedTests(output: string): string[] {
  const names = new Set<string>();
  let file: string | undefined;
  for (const line of output.split("\n")) {
    const header = FILE_HEADER.exec(line);
    if (header) file = header[1];
    for (const re of NAMED_FAIL) {
      const m = re.exec(line);
      if (m?.[1]) {
        names.add(file ? `${file}: ${m[1].trim()}` : m[1].trim());
        break;
      }
    }
  }
  return [...names];
}
