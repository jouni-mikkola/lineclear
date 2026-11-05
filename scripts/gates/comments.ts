// Comments that are noise: code left in a comment, and a to-do note with no task to own it. A comment that only
// retells the code or its history needs a reader to judge, so the reviewer looks for those.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fault, Gate } from "./ratchet.ts";
import { trackedFiles } from "./tools.ts";

const TODO = /\b(TODO|FIXME|XXX|HACK)\b/;
const TASK_ID = /\b[A-Z][A-Z0-9]*-\d+\b/;
// where a comment speaks to a tool, not to a reader
const DIRECTIVE = /^(biome-ignore|eslint|@ts-|prettier-ignore|istanbul|c8|#region|#endregion|<reference)/;
// a token prose seldom has and code nearly always does
const CODE_MARK = /[;{}=]|\w\(.*\)|=>/;

const transpiler = new Bun.Transpiler({ loader: "ts" });

/** True when `text` reads as code: it parses, and it has a token prose does not. */
function isCode(text: string): boolean {
  const t = text.trim();
  if (!CODE_MARK.test(t) || /^https?:\/\//.test(t)) return false;
  try {
    transpiler.transformSync(t);
    return true;
  } catch {
    return false;
  }
}

/** A run of whole-line `//` comments: the code it hides parses as one block, so the run is checked whole first. */
interface Run {
  line: number;
  texts: string[];
}

function commentRuns(source: string): Run[] {
  const runs: Run[] = [];
  let run: Run | undefined;
  source.split("\n").forEach((raw, i) => {
    const m = /^\s*\/\/(?!\/)\s?(.*)$/.exec(raw);
    if (!m) {
      run = undefined;
      return;
    }
    if (!run) {
      run = { line: i + 1, texts: [] };
      runs.push(run);
    }
    run.texts.push(m[1] ?? "");
  });
  return runs;
}

/** Where a comment starts on the line, or -1. A `//` inside a string on the line is not one: an odd count of a
 * quote before it means a string is open. */
function commentStart(line: string): number {
  if (/^\s*\*/.test(line)) return line.search(/\*/);
  for (const m of line.matchAll(/\/\/|\/\*/g)) {
    const before = line.slice(0, m.index).replace(/\\./g, "");
    if (['"', "'", "`"].every((q) => before.split(q).length % 2 === 1)) return m.index;
  }
  return -1;
}

export function findCommentFaults(file: string, source: string): Fault[] {
  const faults: Fault[] = [];
  for (const run of commentRuns(source)) {
    // an example set in by two spaces is shown on purpose, as in Markdown
    const texts = run.texts.filter((t) => !DIRECTIVE.test(t.trim()) && !/^ {2}/.test(t));
    if (texts.length === 0) continue;
    if (isCode(texts.join("\n")) || texts.some(isCode)) {
      faults.push({ key: `${file} commented-out-code`, text: `${file}:${run.line} commented-out code: ${texts[0]?.trim()}` });
    }
  }
  source.split("\n").forEach((line, i) => {
    const at = commentStart(line);
    if (at < 0) return;
    const comment = line.slice(at);
    if (TODO.test(comment) && !TASK_ID.test(comment)) {
      faults.push({ key: `${file} bare-todo`, text: `${file}:${i + 1} a TODO with no task id: ${comment.trim()}` });
    }
  });
  return faults;
}

export const comments: Gate = {
  name: "comments",
  async find(root) {
    return trackedFiles(root).flatMap((file) => findCommentFaults(file, readFileSync(join(root, file), "utf8")));
  },
};
