import { ANSWER_MAX_TOKENS, askModel, INPUT_MAX_TOKENS } from "./ask-model.ts";
import { commandsFor, type ProveTools, doneItems, type ItemProof, keyOf, type Runner, readOnly, type StepProof, saveProof } from "./doneproof.ts";
import { stepFiles } from "./parts.ts";
import { company } from "./company.ts";
import { recordWork } from "./task-work.ts";
import type { Step } from "./roadmap.ts";

const spawn: Runner = (argv, cwd) => {
  if (!readOnly(argv)) return { code: 126, out: `refused: ${argv.join(" ")} is not a read-only command` };
  const r = Bun.spawnSync(argv, { cwd, stdin: "ignore", timeout: 60_000 });
  return { code: r.exitCode ?? 1, out: `${r.stdout.toString()}${r.stderr.toString()}`.trim() };
};

/** Runs an item's commands. Any one that passes proves it. Undefined when the item has none. */
function proveByCommand(item: string, repo: string, run: Runner): ItemProof | undefined {
  const cmds = commandsFor(item);
  if (cmds.length === 0) return undefined;
  const results = cmds.map((c) => ({ c, r: run(c.argv, repo) }));
  const hit = results.find(({ c, r }) => r.code === 0 && (!c.needsOutput || r.out !== ""));
  if (hit) return { item, ok: true, proof: `\`${hit.c.argv.join(" ")}\` found it: ${hit.r.out.split("\n")[0]?.slice(0, 120) || "exit 0"}` };
  const first = results[0] as (typeof results)[number];
  return {
    item,
    ok: false,
    proof: `\`${first.c.argv.join(" ")}\` found nothing${first.r.code === 0 ? "" : ` (exit ${first.r.code}: ${first.r.out.split("\n")[0]?.slice(0, 120)})`}`,
  };
}

/** A file cut to `max` characters: whole when it fits, else the lines around the words the items use. */
function excerpt(text: string, words: string[], max: number): string {
  if (text.length <= max) return text;
  const lines = text.split("\n");
  const keep = new Set<number>();
  lines.forEach((l, n) => {
    if (words.some((w) => l.toLowerCase().includes(w))) for (let k = Math.max(0, n - 2); k <= Math.min(lines.length - 1, n + 4); k++) keep.add(k);
  });
  const picked = keep.size === 0 ? lines : [...keep].sort((x, y) => x - y).map((n) => lines[n] as string);
  return picked.join("\n").slice(0, max);
}

/** The text of tracked files an item or the step's `files` line names, each cut to its share of what the checker may read. */
function namedFiles(items: string[], stepPaths: string[], repo: string, ref: string, run: Runner, inputTokens: number): string {
  const named = items.flatMap((i) => [...i.matchAll(/[`\s(]([\w./-]+\.(?:ts|tsx|md|json|sh|css|yml|yaml))\b/g)].map((m) => m[1] as string));
  const paths = [...new Set([...named, ...stepPaths.filter((p) => /\.\w+$/.test(p))])];
  const budget = Math.floor(inputTokens * 4 * NAMED_SHARE);
  const share = Math.max(4000, Math.floor(budget / Math.max(1, paths.length)));
  const words = [...new Set(items.flatMap((i) => i.toLowerCase().match(/[a-z]{5,}/g) ?? []))];
  let text = "";
  for (const p of paths) {
    const r = run(["git", "show", `${ref}:${p}`], repo);
    if (r.code === 0) text += `\n--- ${p}\n${excerpt(r.out, words, share)}\n`;
    if (text.length >= budget) break;
  }
  return text.slice(0, budget);
}

/** The share of the checker's input the named files get; the rest holds the step, the file list and the commits, so nothing the model reads is cut off the end. */
const NAMED_SHARE = 0.6;
const FILE_LIST_CHARS = 3000;

function proofQuestion(step: Step, rest: string[], files: string[], named: string, answerTokens: number): string {
  return [
    "You are an independent checker. A project step was merged. Decide, for each item of its 'done when', whether the merged tree PROVES it.",
    "True only with evidence you can quote from the files below. An intention, a plan or a promise is not proof. If you cannot see the proof, it is false.",
    `For each item write one line: ITEM <n>: TRUE|FALSE - <the proof, or what is missing>. Keep the whole answer under ${answerTokens * 3} characters.`,
    "",
    `STEP ${step.id} ${step.title}`,
    ...rest.map((item, i) => `ITEM ${i + 1}: ${item}`),
    "",
    "Tracked files:",
    ...files.join("\n").slice(0, FILE_LIST_CHARS).split("\n"),
    named ? `\nFiles the items name:${named}` : "",
  ].join("\n");
}

/** Reads `ITEM <n>: TRUE|FALSE - proof` lines. An item with no line is false. */
function readVerdicts(text: string, items: string[], answerTokens: number): ItemProof[] {
  const lines = new Map<number, ItemProof>();
  for (const l of text.split("\n")) {
    const m = /^\s*ITEM\s+(\d+)\s*:\s*(TRUE|FALSE)\b\s*[-:]?\s*(.*)$/i.exec(l);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    if (items[i] !== undefined && !lines.has(i))
      lines.set(i, { item: items[i] as string, ok: m[2]?.toUpperCase() === "TRUE", proof: (m[3] ?? "").trim().slice(0, answerTokens) });
  }
  return items.map((item, i) => lines.get(i) ?? { item, ok: false, proof: "the checker did not judge this item" });
}

/** The checker's models: OpenAI first, else the reviewer list in its order. */
export function checkerModels(reviewers: string[], usable: (m: string) => boolean = () => true): string[] {
  const ok = reviewers.filter(usable);
  return [...ok.filter((m) => company(m) === "openai"), ...ok.filter((m) => company(m) !== "openai")];
}

export interface ProveInput {
  repo: string;
  step: Step;
  /** The ref of the merged tree, such as `origin/main`. */
  ref: string;
  head: string;
  reviewers: string[];
  env: NodeJS.ProcessEnv;
  now: Date;
  tools: ProveTools;
  run?: Runner;
}

/**
 * Reads the step's `done when` items against the merged tree and records each as true or false with its proof. An item
 * that is an action outside the repo is proven by a command the checker runs, never by reading text; the rest goes to a
 * model (an OpenAI model first, else a fresh session of another). Returns the record, or why none was made (nothing is recorded then).
 */
export function proveStep(i: ProveInput): StepProof | string {
  const run = i.run ?? spawn;
  recordWork(i.step.id, "doneproof", i.env);
  const items = doneItems(i.step);
  const byCommand = new Map(items.map((it) => [it, proveByCommand(it, i.repo, run)] as const));
  const rest = items.filter((it) => byCommand.get(it) === undefined);
  let model = "commands";
  let judged: ItemProof[] = [];
  if (rest.length > 0) {
    const models = checkerModels(i.reviewers, i.tools.available);
    if (models.length === 0) return "no checker: no reviewer model has room";
    const files = run(["git", "ls-tree", "-r", "--name-only", i.ref], i.repo).out.split("\n").filter(Boolean);
    const changes = run(["git", "log", i.ref, "-n", "5", "--stat", "--format=%h %s", `--grep=${i.step.id}`], i.repo).out.slice(0, 3000);
    const question = proofQuestion(
      i.step,
      rest,
      files,
      `${namedFiles(rest, stepFiles(i.step), i.repo, i.ref, run, INPUT_MAX_TOKENS)}\n--- commits that name the step\n${changes}\n`,
      ANSWER_MAX_TOKENS,
    );
    let text = "";
    for (const m of models.slice(0, 2)) {
      const p = askModel(question, m, i.env.LINECLEAR_STEPCHECK, "LINECLEAR_STEPCHECK_MODEL", i.env);
      text = p.stdout.toString().trim();
      if (p.exitCode === 0 && /^\s*ITEM\s+\d+\s*:/im.test(text)) {
        model = m;
        break;
      }
      text = "";
    }
    if (text === "") return "the checker did not answer";
    judged = readVerdicts(text, rest, ANSWER_MAX_TOKENS);
  }
  const verdicts = new Map(judged.map((j) => [j.item, j]));
  const proof: StepProof = {
    key: keyOf(i.step),
    head: i.head,
    at: i.now.toISOString(),
    model,
    items: items.map((it) => byCommand.get(it) ?? (verdicts.get(it) as ItemProof)),
  };
  saveProof(i.repo, i.step.id, proof, i.env);
  return proof;
}
