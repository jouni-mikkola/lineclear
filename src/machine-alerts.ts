import { statfsSync } from "node:fs";
import { addItem, closeItem, isOpen, readItems } from "./inbox.ts";
import { dataDir } from "./paths.ts";

type Env = Record<string, string | undefined>;

const MIN_FREE = 0.1;
const MIN_FREE_BYTES = 5 * 1024 ** 3;

/** The data disk's trouble: under a tenth or 5 GB free, or "". */
function diskProblem(env: Env = process.env): string {
  try {
    const f = statfsSync(dataDir(env));
    const free = f.bavail * f.bsize;
    return free / (f.blocks * f.bsize) < MIN_FREE || free < MIN_FREE_BYTES
      ? `only ${(free / 1024 ** 3).toFixed(1)} GB is free on the disk Lineclear's data is on`
      : "";
  } catch {
    return "";
  }
}

/** Each check, the title its Inbox card carries (and the phone shows), and what it found. */
function machineProblems(env: Env = process.env): { alert: string; problem: string }[] {
  return [{ alert: "Disk is nearly full", problem: diskProblem(env) }];
}

/**
 * The rule loop's failure alerts. A trouble puts one card in the Inbox (which the phone is told of), not another while
 * it is open; a card whose trouble is gone closes. Returns the cards it made.
 */
export function watchMachine(env: Env = process.env, now = new Date()): number {
  let made = 0;
  for (const { alert, problem } of machineProblems(env)) {
    const open = readItems(env as NodeJS.ProcessEnv).filter((i) => isOpen(i) && i.kind === "stuck" && i.task === "-" && i.alert === alert);
    if (problem === "") {
      for (const item of open) closeItem(item, "it is fine again", now, env as NodeJS.ProcessEnv);
    } else if (open.length === 0) {
      addItem({ kind: "stuck", task: "-", question: `${problem}.`, choices: ["Ok"], alert, since: now.toISOString() }, env as NodeJS.ProcessEnv);
      made++;
    }
  }
  return made;
}
