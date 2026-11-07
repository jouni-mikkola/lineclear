import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir } from "../pi/config.ts";
import type { Step } from "./roadmap.ts";

/** One `done when` item and what the checker found: true only with a proof. */
export interface ItemProof {
  item: string;
  ok: boolean;
  proof: string;
}

/** What the checker recorded for a step the last time it read its `done when` against the merged tree. */
export interface StepProof {
  /** The step's items when it was checked: a changed `done when` is asked again. */
  key: string;
  /** The head of main it read. */
  head: string;
  at: string;
  model: string;
  items: ItemProof[];
}

type Proofs = Record<string, StepProof>;

const proofsPath = (repo: string, env: NodeJS.ProcessEnv) =>
  join(configDir(env), "plan-checks", `proofs-${createHash("sha1").update(resolve(repo)).digest("hex").slice(0, 12)}.json`);

export function readProofs(repo: string, env: NodeJS.ProcessEnv = process.env): Proofs {
  const f = proofsPath(repo, env);
  try {
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Proofs) : {};
  } catch {
    return {};
  }
}

export function saveProof(repo: string, step: string, proof: StepProof, env: NodeJS.ProcessEnv) {
  mkdirSync(join(configDir(env), "plan-checks"), { recursive: true });
  writeAtomic(proofsPath(repo, env), `${JSON.stringify({ ...readProofs(repo, env), [step]: proof }, null, 2)}\n`);
}

/** The `done when` items of a step: its bullets, each with its wrapped lines, else its text as one item. A `Reopened:` item is not one to prove. */
export function doneItems(step: Step): string[] {
  const f = step.fields["done when"];
  if (!f) return [];
  const items: string[] = [];
  const lines = [f.value, ...f.more];
  const indentOf = (l: string) => /^\s*/.exec(l)?.[0].length ?? 0;
  const bulletIndents = f.more.filter((l) => /^\s*[-*]\s/.test(l)).map(indentOf);
  const top = bulletIndents.length > 0 ? Math.min(...bulletIndents) : 0;
  for (const l of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(l)?.[1]?.trim();
    if (bullet !== undefined && (l === f.value || indentOf(l) === top)) items.push(bullet);
    else if (items.length > 0 && l.trim() !== "") items[items.length - 1] += ` ${l.trim()}`;
  }
  if (items.length === 0)
    items.push(
      [f.value, ...f.more]
        .map((l) => l.trim())
        .join(" ")
        .trim(),
    );
  return items.filter((i) => i !== "" && !/^(Reopened|Owner only):/i.test(i));
}

/** The step's items as the unproven-step name shows them: the first false one. */
const missingItem = (p: StepProof): string | undefined => p.items.find((i) => !i.ok)?.item;

/** Step id to its first unproven item, for every step whose record has a false item. A step with no record is not in it. */
export function unprovenOf(repo: string, env: NodeJS.ProcessEnv = process.env): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, p] of Object.entries(readProofs(repo, env))) {
    const m = missingItem(p);
    if (m !== undefined) out.set(id, m);
  }
  return out;
}

export const keyOf = (step: Step) => doneItems(step).join("\n");

/** A command that proves an item that is an action outside the repo, and what its output must hold. */
export interface Command {
  argv: string[];
  /** The exit code alone proves it, or the output must also be non-empty (`git ls-remote` exits 0 with nothing). */
  needsOutput: boolean;
}

const VERSION = /\bv?(\d+\.\d+(?:\.\d+)?)\b/;

/** The tag names an item can mean: as written, and with or without the `v`. */
function tagsOf(item: string): string[] {
  const m = VERSION.exec(item);
  if (!m) return [];
  const bare = m[1] as string;
  const full = bare.split(".").length === 2 ? `${bare}.0` : bare;
  return [...new Set([`v${full}`, full, `v${bare}`, bare])];
}

/** The commands that prove an item by asking the world, not the text: a tag, a GitHub release. */
export function commandsFor(item: string): Command[] {
  const tags = tagsOf(item);
  if (tags.length === 0) return [];
  const out: Command[] = [];
  if (/\btag(ged|s)?\b/i.test(item)) out.push({ argv: ["git", "ls-remote", "--tags", "origin", ...tags.map((t) => `refs/tags/${t}`)], needsOutput: true });
  if (/\bgithub release\b|\breleased on github\b|\brelease (page|notes) on github\b/i.test(item)) {
    for (const t of tags) out.push({ argv: ["gh", "release", "view", t], needsOutput: false });
  }
  return out;
}

export type Runner = (argv: string[], cwd: string) => { code: number; out: string };

const READ_ONLY_GIT = new Set(["ls-remote", "ls-tree", "show", "log", "cat-file", "rev-parse", "tag", "describe"]);

/** Whether the checker may run a command: reads only. A write (git push, gh release create) is refused. */
export function readOnly(argv: string[]): boolean {
  const [bin, sub, third] = argv;
  if (bin === "git") return sub !== undefined && READ_ONLY_GIT.has(sub) && !(sub === "tag" && argv.some((a) => /^-[a-z]*[dfa]/.test(a) && a !== "-l"));
  if (bin === "gh") return (sub === "release" || sub === "pr" || sub === "run") && (third === "view" || third === "list");
  if (bin === "bun") return sub === "test" && argv.slice(2).every((a) => /^[\w./-]+$/.test(a));
  return false;
}

/** What the checker borrows from the rules module, passed in so this file stays below it. */
export interface ProveTools {
  available(model: string): boolean;
}

/** The test a step's `done when` names (`bun test <file>`, or a `*.test.ts` path), as a command. */
export function testOf(step: Step): string | undefined {
  const f = step.fields["done when"];
  const text = [f?.value ?? "", ...(f?.more ?? [])].join("\n");
  const cmd = /`(bun test [\w./-]+)`/.exec(text)?.[1];
  const file = /([\w./-]+\.test\.ts)/.exec(text)?.[1];
  return cmd ?? (file ? `bun test ${file}` : undefined);
}
