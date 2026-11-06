import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Step } from "./roadmap.ts";
import { company } from "./company.ts";
import type { Settings } from "./project.ts";
import { ownerDirection } from "./direction.ts";
import { readParts, stepFiles, stepParts } from "./parts.ts";
import { mainRefs } from "./main-branch.ts";
import { READER_ASK } from "./reader-ask.ts";
import { gitText } from "./git.ts";

/** The most characters a step's brief may have. The rules give way first, then the part pages, then the file list. */
export const BRIEF_MAX = 12_000;
const FILES_MAX = 25;

/** The lines of one step in the roadmap text: its heading up to the next heading. */
export function stepText(text: string, step: Step): string {
  const lines = text.split("\n");
  let end = step.line;
  while (end < lines.length && !/^#{1,3} /.test(lines[end] as string)) end++;
  return lines
    .slice(step.line - 1, end)
    .join("\n")
    .trimEnd();
}

/** The paths on a step's `files` line that a brief may name: inside the repo, with no trailing slash. */
function declaredFiles(step: Step): string[] {
  return stepFiles(step)
    .map((f) => f.replace(/\/+$/, ""))
    .filter((f) => f !== "" && !f.startsWith("-") && !f.startsWith("/") && !f.includes(".."));
}

/** Files a step's text names in backticks that exist in the repo. */
function namedFiles(repo: string, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    const p = (m[1] as string).replace(/[.,:;]+$/, "");
    if (/^[\w./-]+$/.test(p) && /[./]/.test(p) && !p.startsWith("-") && !p.includes("..") && existsSync(join(repo, p))) out.push(p);
  }
  return out;
}

/** Files the commits of the `after` steps changed on main. */
function afterFiles(repo: string, after: string[]): string[] {
  const out: string[] = [];
  if (after.length === 0) return out;
  const [origin] = mainRefs(repo);
  for (const id of after) {
    const esc = id.replace(/[^\w-]/g, "");
    if (esc === "") continue;
    const names = gitText(
      repo,
      "log",
      origin,
      "--extended-regexp",
      `--grep=^[A-Za-z][A-Za-z0-9]*-[0-9]+: ${esc}( |$)`,
      `--grep=^Step: ${esc}$`,
      "--name-only",
      "--format=",
    );
    out.push(...(names ?? "").split("\n").filter((n) => n !== ""));
  }
  return out;
}

/** The files the step is likely to touch: those its `files` line gives, then those it names, then those its `after` steps changed. */
function briefFiles(repo: string, step: Step, text: string): string[] {
  const seen = new Set<string>();
  const skip = (f: string) => f === "docs/ROADMAP.md" || !existsSync(join(repo, f));
  const changed = afterFiles(repo, step.after).filter((f) => f !== "docs/numbers.md"); // every step adds its numbers: not a hint
  for (const f of [...declaredFiles(step), ...namedFiles(repo, text), ...changed]) if (!skip(f)) seen.add(f);
  return [...seen].slice(0, FILES_MAX);
}

/** True when every file is under docs/ (the roadmap too), so a change to them needs no review. An empty list is not docs only. */
function docsOnly(files: string[]): boolean {
  return files.length > 0 && files.every((f) => f.startsWith("docs/"));
}

/** The review paragraph of a brief: none when the step's declared files are docs only. */
function reviewBlock(step: Step, values: Record<string, string>): string {
  if (docsOnly(declaredFiles(step)))
    return "No review while your change touches only files under docs/ (a roadmap file too) and passed the check: merge it. If it touches anything else, have it reviewed by fresh eyes first.\n";
  return `${fill(template("brief-review.md"), values).trimEnd()}\n`;
}

/** The project's rules: its AGENTS.md, or none. */
function briefRules(repo: string): string {
  const file = join(repo, "AGENTS.md");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

/** The pages of the parts a step names: what its worker keeps true, like a team member who knows the part. */
export function briefParts(repo: string, step: Step): string {
  const names = stepParts(step).names;
  return readParts(repo)
    .filter((p) => names.includes(p.name))
    .map((p) => p.text.trim())
    .join("\n\n");
}

const cutTo = (text: string, room: number, note: string) =>
  text.length <= room ? text : room > 0 ? `${text.slice(0, room).replace(/\n[^\n]*$/, "")}\n(cut: ${note})` : "";

/** The sections a brief adds to the step's own words, cut so that the whole brief fits `BRIEF_MAX`. */
export function fitSections(base: number, files: string[], rules: string, parts = ""): { files: string; rules: string; parts: string } {
  const fileBlock = (list: string[]) => (list.length === 0 ? "" : `\nFiles this step is likely to touch:\n${list.map((f) => `- ${f}`).join("\n")}\n`);
  const ruleBlock = (r: string) => (r === "" ? "" : `\nThe project's rules (AGENTS.md):\n\n${r}\n`);
  const partBlock = (r: string) =>
    r === "" ? "" : `\nThe parts this step changes. Keep their invariants and interfaces; a change to one updates its page in the same change:\n\n${r}\n`;
  let list = files;
  let f = fileBlock(list);
  while (base + f.length > BRIEF_MAX && list.length > 0) f = fileBlock((list = list.slice(0, -1)));
  const p = partBlock(cutTo(parts, BRIEF_MAX - base - f.length - 200, "read the pages in docs/parts/ for the rest"));
  const cut = cutTo(rules, BRIEF_MAX - base - f.length - p.length - 80, "read AGENTS.md for the rest");
  return { files: f, rules: ruleBlock(cut), parts: p };
}

/** Review rounds when the project sets none. */
export const DEFAULT_ROUNDS = 2;

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? "");
}

/** A template of `templates/` with the direction of `repo`, else the general one. */
export const template = (name: string, repo?: string) =>
  readFileSync(join(import.meta.dir, "..", "templates", name), "utf8").replace("{{direction}}", ownerDirection(repo));

const doneWhen = (s: Step) => {
  const f = s.fields["done when"];
  return [f?.value ? `  ${f.value}` : "", ...(f?.more ?? [])].filter((l) => l !== "").join("\n");
};

/** The step's brief. `ctx` is the repo and its roadmap text: with it the brief lists the likely files and the rules. */
export function stepBrief(
  step: Step,
  settings: Settings,
  reviewer: string,
  worker?: string,
  ctx?: { repo: string; roadmap: string },
  unproven?: string,
): string {
  const same = worker !== undefined && company(reviewer) === company(worker);
  const values: Record<string, string> = {
    id: step.id,
    title: step.title,
    why: [step.fields.why?.value ?? "", ...(step.fields.why?.more ?? [])].join("\n").trim(),
    done_when: doneWhen(step),
    check: settings.check,
    reviewer,
    reviewer_note: same
      ? "which is from your own company because no other company has room: a different model, with a fresh context. Say so in the pull request"
      : "which comes from another company than yours",
    rounds: String(settings.reviewRounds ?? DEFAULT_ROUNDS),
    reader_ask: READER_ASK,
    review: "",
    files: "",
    rules: "",
    parts: "",
    reopened: unproven
      ? `\nThis step was merged, but the independent checker could not prove this item of its "done when": ${unproven}\nDo that item, and only that item. A tag, a release or a recorded run is proven by a command the checker runs (\`git ls-remote --tags origin\`, \`gh release view\`), not by text.\n`
      : step.reopened
        ? `\nThis step is reopened: its "done when" has a \`Reopened:\` item. Once the missing proof is in docs/numbers.md, delete that Reopened line from docs/ROADMAP.md in the same commit. The merge is refused while both stay.\n`
        : "",
  };
  values.review = reviewBlock(step, values);
  if (!ctx) return fill(template("brief.md", settings.repo), values);
  const base = fill(template("brief.md", settings.repo), values).length;
  const sections = fitSections(base, briefFiles(ctx.repo, step, stepText(ctx.roadmap, step)), briefRules(ctx.repo), briefParts(ctx.repo, step));
  return fill(template("brief.md", settings.repo), { ...values, ...sections });
}
