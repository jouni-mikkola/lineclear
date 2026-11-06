import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One problem `lineclear doctor` finds, with the command that fixes it. */
export interface DoctorProblem {
  name: string;
  problem: string;
  fix: string;
}

type Vars = Record<string, string | undefined>;

/** Home polls every 1.5 s and the doctor runs commands, so it looks again at most every five minutes. */
const EVERY_MS = 5 * 60_000;
const seen = new Map<string, { at: number; problems: DoctorProblem[] }>();

/** The doctor's own output, read as the CLI prints it: a FAILED line and the fix line under it. */
export function parseDoctor(out: string): DoctorProblem[] {
  const found: DoctorProblem[] = [];
  for (const line of out.split("\n")) {
    const bad = /^FAILED (.+?): (.*)$/.exec(line);
    if (bad) found.push({ name: bad[1] ?? "", problem: bad[2] ?? "", fix: "" });
    const fix = /^\s+fix: (.*)$/.exec(line);
    const last = found[found.length - 1];
    if (fix && last) last.fix = fix[1] ?? "";
  }
  return found;
}

/** Its own process, so the server's loop never waits for the doctor's commands. */
async function look(vars: Vars): Promise<DoctorProblem[]> {
  try {
    const p = Bun.spawn([process.execPath, join(import.meta.dir, "..", "bin", "lineclear"), "doctor", "--here"], {
      env: vars as NodeJS.ProcessEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    return parseDoctor(await new Response(p.stdout).text());
  } catch {
    return [];
  }
}

/** The problems a test or demo run states in its LINECLEAR_DOCTOR_FILE, so a screenshot never shows the host's own findings; undefined when there is no such file. */
function stated(vars: Vars): DoctorProblem[] | undefined {
  if (!vars.LINECLEAR_DOCTOR_FILE) return undefined;
  try {
    return JSON.parse(readFileSync(vars.LINECLEAR_DOCTOR_FILE, "utf8")) as DoctorProblem[];
  } catch {
    return undefined;
  }
}

/** The problems of the last look (none when `LINECLEAR_NO_DOCTOR` is set: a timed test must not leave a doctor running); a look is started after the answer, so a page never waits for the doctor. */
export function doctorProblems(vars: Vars, now = Date.now()): DoctorProblem[] {
  if (vars.LINECLEAR_NO_DOCTOR) return [];
  const fixed = stated(vars);
  if (fixed) return fixed;
  const key = vars.LINECLEAR_CONFIG ?? vars.HOME ?? "";
  const last = seen.get(key);
  if (!last || now - last.at >= EVERY_MS) {
    seen.set(key, { at: now, problems: last?.problems ?? [] });
    void look(vars).then((problems) => seen.set(key, { at: Date.now(), problems }));
  }
  return seen.get(key)?.problems ?? [];
}
