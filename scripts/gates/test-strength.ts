// A fix never weakens a test: the branch's diff of test files may not raise a time limit or sleep, add a retry,
// drop an `expect` or add a skip, unless a commit message names the cause in a line `Cause: <test>: <what it waited on and what changed>`.
// A longer wait or a retry hides the cause of a flaky test, which returns as a slower check or a real bug that passes.

const TEST_FILE = /(^|\/)(test|tests|ui\/test)\/|\.(test|spec|pw)\.[cm]?[jt]sx?$/;
const CAUSE_LINE = /^Cause: [^:\n]+: \S.*$/m;
const TIME_WORD = /(timeout|sleep|delay|waitfor|wait)\w*\W{0,6}?(\d[\d_]*)/i;
const TEST_LIMIT = /^\s*\}?\s*,\s*(\d[\d_]*)\s*\)\s*;?\s*$/;
const RETRY = /--rerun|\bretry|\bretries|\brerun/i;
const SKIP = /\b(test|it|describe)\.skip\(|\bx(it|describe)\(|\.skipIf\(/;
const LOOP = /^\s*(for|while)\b|\bdo\s*\{/;
const LOOP_REACH = 4;

interface Change {
  file: string;
  line: number;
  removed: string[];
  added: string[];
}

/** The hunks of a unified diff, test files only, with the new file's first line number of each. */
function parseDiff(diff: string): Change[] {
  const out: Change[] = [];
  let file = "";
  let cur: Change | undefined;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ ")) file = l.slice(4).replace(/^b\//, "");
    else if (l.startsWith("--- ")) cur = undefined;
    else if (l.startsWith("@@")) {
      cur = TEST_FILE.test(file) ? { file, line: Number(/\+(\d+)/.exec(l)?.[1] ?? 0), removed: [], added: [] } : undefined;
      if (cur) out.push(cur);
    } else if (cur && l.startsWith("-")) cur.removed.push(l.slice(1));
    else if (cur && l.startsWith("+")) cur.added.push(l.slice(1));
  }
  return out;
}

const num = (s: string): number => Number(s.replace(/_/g, ""));
const count = (lines: string[], re: RegExp): number => lines.filter((l) => re.test(l)).length;

function raisedLimit(c: Change): boolean {
  const before = c.removed.map((l) => TIME_WORD.exec(l)?.[2] ?? TEST_LIMIT.exec(l)?.[1]).filter((n): n is string => n !== undefined);
  const after = c.added.map((l) => TIME_WORD.exec(l)?.[2] ?? TEST_LIMIT.exec(l)?.[1]).filter((n): n is string => n !== undefined);
  return before.length > 0 && after.some((a) => before.every((b) => num(a) > num(b)));
}

function loopAroundAssertion(added: string[]): boolean {
  return added.some((l, i) => LOOP.test(l) && added.slice(i + 1, i + 1 + LOOP_REACH).some((n) => /\bexpect\(/.test(n)));
}

/** The faults the changes make, each with its file and line. */
function weakenings(changes: Change[]): string[] {
  const faults: string[] = [];
  const byFile = new Map<string, Change[]>();
  for (const c of changes) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  for (const c of changes) {
    const at = `${c.file}:${c.line}`;
    if (raisedLimit(c)) faults.push(`${at} raises a time limit or sleep`);
    if (c.added.some((l) => RETRY.test(l)) || loopAroundAssertion(c.added)) faults.push(`${at} adds a retry`);
    if (c.added.some((l) => SKIP.test(l))) faults.push(`${at} adds a skip`);
  }
  for (const [file, cs] of byFile) {
    const dropped = cs.reduce((n, c) => n + count(c.removed, /\bexpect\(/) - count(c.added, /\bexpect\(/), 0);
    if (dropped > 0) faults.push(`${file} removes ${dropped} expect${dropped === 1 ? "" : "s"}`);
  }
  return faults;
}

/** Faults of a diff given the commit messages of the branch; none when a message names the cause. */
export function testStrengthFaults(diff: string, messages: string[]): string[] {
  const faults = weakenings(parseDiff(diff));
  if (faults.length === 0 || messages.some((m) => CAUSE_LINE.test(m))) return [];
  return faults.map((f) => `${f}; add a commit line "Cause: <test>: <what it waited on and what changed>"`);
}

async function git(root: string, args: string[]): Promise<string | undefined> {
  const p = Bun.spawn(["git", ...args], { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return code === 0 ? out : undefined;
}

export async function testStrength(root: string): Promise<string[]> {
  let base: string | undefined;
  for (const ref of ["origin/main", "main"]) {
    base = (await git(root, ["merge-base", "HEAD", ref]))?.trim();
    if (base) break;
  }
  if (!base) return [];
  const [diff, log] = await Promise.all([git(root, ["diff", "--no-color", "-U0", `${base}...HEAD`]), git(root, ["log", "--format=%B%x00", `${base}..HEAD`])]);
  return testStrengthFaults(diff ?? "", (log ?? "").split("\0"));
}
