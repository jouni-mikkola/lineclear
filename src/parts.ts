// What a roadmap step's `parts`, `locks` and `files` lines hold, and which locks a running step holds.
import type { Step } from "./roadmap.ts";

/** The parts a step names on its `parts` line. */
export function stepParts(step: Step): { names: string[] } {
  const f = step.fields.parts;
  const names = (f ? [f.value, ...f.more].join(",") : "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && s !== "none");
  return { names };
}

const ownLocks = (step: Step) => (step.fields.locks?.value ?? "").split(/[,\s]+/).filter((l) => l !== "" && l !== "none");

/** What a step needs free to start: its own locks when it names any, else each of its parts whole. */
export function stepLocks(step: Step): string[] {
  const locks = ownLocks(step);
  return [...new Set(locks.length > 0 ? locks : stepParts(step).names)];
}

/** A step that locks by its files: it names some, and has no locks of its own. */
const byFiles = (step: Step) => ownLocks(step).length === 0 && stepFiles(step).length > 0;

const FILE = "file:";
const someKey = (part: string) => `~${part}`;

/** The parts a step holds or needs whole: all of them without locks of its own, else those a lock is named after. */
function wholeParts(step: Step): string[] {
  const { names } = stepParts(step);
  const locks = ownLocks(step);
  return locks.length === 0 ? names : names.filter((n) => locks.includes(n));
}

/**
 * What a running step holds: its locks (else its parts), and `=part` for each part it holds whole.
 * A part it holds not whole is held as `~part` (some of it), as is every part of a step that names files, which also
 * holds `file:path` for each file.
 */
export function stepHeld(step: Step): string[] {
  const { names } = stepParts(step);
  if (byFiles(step)) return [...new Set([...names.map(someKey), ...stepFiles(step).map((f) => FILE + f)])];
  const whole = wholeParts(step);
  const some = names.filter((n) => !whole.includes(n)).map(someKey);
  return [...new Set([...stepLocks(step), ...whole.map(wholeKey), ...some])];
}

/**
 * What a step needs free to start: its locks (else its parts), `~part` of each part it needs whole, and `=part` of
 * each other part. A step that names files needs only the whole-part holds free (`part`); its files go through `fileClash`.
 */
export function stepNeeds(step: Step): string[] {
  const { names } = stepParts(step);
  if (byFiles(step)) return [...new Set(names)];
  const whole = wholeParts(step);
  return [...new Set([...stepLocks(step), ...whole.map(someKey), ...names.filter((n) => !whole.includes(n)).map(wholeKey)])];
}

/** A held file of another step that overlaps one of this step's files (a directory prefix counts), as `file:path`. */
export function fileClash(step: Step, held: Iterable<string>): string | undefined {
  if (!byFiles(step)) return undefined;
  const mine = stepFiles(step);
  const overlap = (a: string, b: string) => {
    const dir = (p: string) => (p.endsWith("/") ? p : `${p}/`);
    return a === b || dir(a).startsWith(dir(b)) || dir(b).startsWith(dir(a));
  };
  for (const k of held) if (k.startsWith(FILE) && mine.some((f) => overlap(f, k.slice(FILE.length)))) return k;
  return undefined;
}

/** The ready steps that file locks let start now, which the old whole-part locks held back behind a running step. */
export function unblockedByFiles(ready: Step[], running: Step[]): Step[] {
  const heldNow = new Map<string, string>();
  const heldOld = new Set<string>();
  for (const r of running) {
    for (const l of stepHeld(r)) heldNow.set(l, r.id);
    for (const l of [...stepParts(r).names, ...ownLocks(r)]) heldOld.add(l);
  }
  const blockedNow = (s: Step) => stepNeeds(s).some((l) => heldNow.has(l)) || fileClash(s, heldNow.keys()) !== undefined;
  return ready.filter((s) => stepLocks(s).some((l) => heldOld.has(l)) && !blockedNow(s));
}

const wholeKey = (part: string) => `=${part}`;

/** The paths of a step's `files` line, backticks or not. */
export function stepFiles(step: Step): string[] {
  const f = step.fields.files;
  if (!f) return [];
  return [f.value, ...f.more]
    .join(",")
    .split(",")
    .map((s) => s.trim().replace(/^`|`$/g, ""))
    .filter((s) => s !== "" && s !== "none");
}
