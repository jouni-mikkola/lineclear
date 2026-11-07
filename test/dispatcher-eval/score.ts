import { fold, resolveOne } from "../../src/resolve.ts";
import type { Call, Case, Outcome } from "./cases.ts";

export const PROJECTS = ["lineclear", "webshop", "budget", "kauppa"];

/** One command the model ran: the program and its arguments. */
export interface Ran {
  program: "lineclear";
  args: string[];
}

/** What the model did in one answer. `other` lists everything outside the two tools that changes things (a file written, git, gh). */
export interface Did {
  ran: Ran[];
  other: string[];
}

/** The project a command would act on, the way the command resolves a loose name. */
const project = (name: string | undefined) => {
  if (name === undefined) return undefined;
  const r = resolveOne(
    "project",
    name,
    PROJECTS.map((p) => [p]),
  );
  return "error" in r ? `?${name}` : r.name;
};

/** A call of the model in the shape of an expected one, or a line saying what it was. */
export function toCall(r: Ran): Call | string | undefined {
  const [verb, ...rest] = r.args;
  if (r.args.includes("--help") || r.args.includes("-h")) return undefined;
  if (verb === "ask") return { c: "ask" };
  if (verb === "task" && rest[0] === "tell" && rest[1]) return { c: "tell", task: rest[1].toUpperCase() };
  if (verb === "card") return { c: "ask" };
  if (verb === "dispatcher" && rest[0] === "projects") return undefined;
  if (verb === "status" && rest[0] === "--plan") return { c: "status-plan", ...(rest[1] ? { task: rest[1].toUpperCase() } : {}) };
  if (verb === "status") return { c: "status", ...(rest[0] ? { project: project(rest[0])! } : {}) };
  if (verb === "inbox" && rest.length === 0) return { c: "inbox" };
  if (verb === "plan" && rest.length === 2) return { c: "plan", project: project(rest[0])!, goal: [rest[1]!] };
  if (verb === "move" && rest.length === 4 && rest[2] === "--after") {
    return {
      c: "move",
      project: project(rest[0])!,
      step: rest[1]!.toUpperCase(),
      after: rest[3]!.split(",").map((s) =>
        s
          .trim()
          .toUpperCase()
          .replace(/^NONE$/, "none"),
      ),
    };
  }
  return `lineclear ${r.args.join(" ")}`;
}

const READS = new Set(["status", "status-plan", "inbox"]);
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Does this call of the model do what the expected one asks? */
function matches(got: Call, want: Call): boolean {
  if (got.c !== want.c) return false;
  switch (want.c) {
    case "status":
      return (got as typeof want).project === want.project;
    case "tell":
    case "status-plan":
      return want.task === undefined || (got as typeof want).task === want.task;
    case "plan": {
      const g = got as typeof want;
      const goal = g.goal.join(" ").toLowerCase();
      return g.project === want.project && want.goal.some((w) => goal.includes(w.toLowerCase()));
    }
    case "move": {
      const g = got as typeof want;
      return g.project === want.project && fold(g.step) === fold(want.step) && same(g.after.map(fold), want.after.map(fold));
    }
    default:
      return true;
  }
}

/** Why an answer is wrong for one outcome, or undefined when it is right. */
function against(did: Did, outcome: Outcome): string | undefined {
  const calls = did.ran.map(toCall).filter((c): c is Call | string => c !== undefined);
  const stray = [...did.other, ...calls.filter((c): c is string => typeof c === "string")];
  if (stray.length > 0) return `ran ${stray.join("; ")}`;
  const got = calls as Call[];
  const wantsRead = outcome.calls.some((c) => READS.has(c.c));
  // A read is free next to a change (the model may look first), but a read asked for must be there and nothing may change.
  const changes = got.filter((c) => !READS.has(c.c));
  if (wantsRead) {
    if (changes.length > 0) return `changed something: ${describe(changes)}`;
    const missing = outcome.calls.filter((w) => !got.some((g) => matches(g, w)));
    return missing.length > 0 ? `did not call ${describe(missing)}; called ${describe(got) || "nothing"}` : undefined;
  }
  // Refusing may come with a question, which changes nothing.
  const wantChanges = outcome.calls;
  const pool = wantChanges.length === 0 ? changes.filter((c) => c.c !== "ask") : changes;
  if (pool.length !== wantChanges.length) return `called ${describe(pool) || "nothing"}`;
  const left = [...pool];
  for (const w of wantChanges) {
    const i = left.findIndex((g) => matches(g, w));
    if (i < 0) return `called ${describe(pool)}`;
    left.splice(i, 1);
  }
  return undefined;
}

/** Null when the model was right, else why it was wrong. */
export function score(c: Case, did: Did): string | null {
  const reasons = c.expect.map((o) => against(did, o));
  return reasons.some((r) => r === undefined) ? null : reasons[0]!;
}

function describe(calls: Call[]): string {
  return calls
    .map((c) => {
      switch (c.c) {
        case "status":
          return `status${c.project ? ` ${c.project}` : ""}`;
        case "status-plan":
          return `status --plan${c.task ? ` ${c.task}` : ""}`;
        case "inbox":
          return "inbox";
        case "plan":
          return `plan ${c.project} "${c.goal.join(" ")}"`;
        case "move":
          return `move ${c.project} ${c.step} --after ${c.after.join(",")}`;
        case "tell":
          return `task tell${c.task ? ` ${c.task}` : ""}`;
        case "ask":
          return "lineclear ask";
      }
    })
    .join("; ");
}
