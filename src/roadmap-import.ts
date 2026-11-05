import { checkRoadmap } from "./roadmap.ts";

const KNOWN = ["id", "title", "phase", "state", "result", "why", "done_when", "locks", "after", "reason"];
const STATES = ["open", "done", "dropped"];

export interface Imported {
  /** The text of docs/ROADMAP.md. */
  text: string;
  /** The ids whose state is done, in file order. */
  done: string[];
}

/** One-line text: a value that runs over a line would break the roadmap format. */
function line(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" || /[\r\n]/.test(t) ? undefined : t;
}

interface ImportedStep {
  id: string;
  title: string;
  phase: string;
  state: string;
  result: string;
  why: string;
  done: string[];
  locks: string;
  after: string[];
  reason: string;
}

/** A field of one line or a list of lines, as lines; an empty list when it is neither. */
function lines(v: unknown): (string | undefined)[] {
  const list = typeof v === "string" ? [v] : v;
  return Array.isArray(list) ? list.map(line) : [];
}

/** The reason of a dropped step. */
function reasonOf(v: unknown, state: string | undefined, bad: (field: string, why: string) => void): string {
  if (v === undefined) return "imported as dropped";
  const r = line(v);
  if (state !== undefined && state !== "dropped") bad("reason", "only a dropped step has a reason");
  else if (r === undefined) bad("reason", "needs one line of text");
  else return r;
  return "imported as dropped";
}

/** One step of the list, or undefined when a field cannot be placed (each is added to `errors`). */
function readStep(raw: unknown, i: number, seen: Set<string>, errors: string[]): ImportedStep | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`step #${i + 1}: not an object`);
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && /^[^\s,]+$/.test(o.id) && o.id !== "none" ? o.id : undefined;
  const name = id ?? `#${i + 1}`;
  const bad = (field: string, why: string) => errors.push(`step ${name}, field ${field}: ${why}`);
  if (id === undefined) bad("id", "needs one word with no spaces or commas, and not 'none'");
  else if (seen.has(id)) bad("id", "used twice");
  else seen.add(id);
  for (const k of Object.keys(o)) if (!KNOWN.includes(k)) bad(k, "unknown field");

  const text = (field: string) => {
    const v = line(o[field]);
    if (v === undefined) bad(field, "needs one line of text");
    return v;
  };
  const title = text("title");
  const phase = text("phase");
  const result = text("result");
  const why = text("why");
  const locks = text("locks");

  const items = lines(o.done_when);
  if (items.length === 0 || items.some((x) => x === undefined)) bad("done_when", "needs one line or a list of lines");
  const after = lines(o.after);
  if (after.length === 0 || after.some((x) => x === undefined || /[\s,]/.test(x))) bad("after", 'needs a list of ids, or ["none"]');

  const state = typeof o.state === "string" && STATES.includes(o.state) ? o.state : undefined;
  if (state === undefined) bad("state", "must be open, done or dropped");
  const reason = reasonOf(o.reason, state, bad);

  if (id && title && phase && result && why && locks && state) {
    return { id, title, phase, state, result, why, done: items as string[], locks, after: after as string[], reason };
  }
  return undefined;
}

/** The roadmap text of the steps, in the order given. */
function render(steps: ImportedStep[]): string {
  const out = ["# Roadmap", "", "Imported with `lineclear roadmap import`.", ""];
  let phase: string | undefined;
  for (const s of steps) {
    if (s.phase !== phase) {
      out.push(`## ${s.phase}`, "");
      phase = s.phase;
    }
    out.push(`### ${s.id} ${s.title}`, `Result: ${s.result}`, `- why: ${s.why}`, "- done when:", ...s.done.map((d) => `  - ${d}`));
    out.push(`- locks: ${s.locks}`, `- after: ${s.after.join(", ")}`);
    if (s.state === "dropped") out.push(`- dropped: ${s.reason}`);
    out.push("");
  }
  return out.join("\n");
}

/**
 * Turns the JSON list of steps into the roadmap format. Returns the problems instead when any field cannot be
 * placed, each naming the step id and the field, so the caller can write nothing.
 */
export function importRoadmap(json: string): Imported | { errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { errors: [`not JSON: ${(e as Error).message}`] };
  }
  const list = Array.isArray(data) ? data : (data as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(list) || list.length === 0) return { errors: ["expected a non-empty list of steps"] };

  const errors: string[] = [];
  const steps: ImportedStep[] = [];
  const seen = new Set<string>();
  list.forEach((raw, i) => {
    const step = readStep(raw, i, seen, errors);
    if (step) steps.push(step);
  });
  if (errors.length > 0) return { errors };

  const text = render(steps);

  // The file must pass the same check as any roadmap: unknown or circular `after`, and so on.
  const checked = checkRoadmap(text);
  if (checked.errors.length > 0) return { errors: checked.errors.map((e) => `${e.message} (line ${e.line} of the result)`) };
  return { text, done: steps.filter((s) => s.state === "done").map((s) => s.id) };
}
