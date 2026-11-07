import { writeAtomic } from "../pi/atomic.ts";
import { undoApplied } from "./plan-apply.ts";
import { applyMove } from "./dispatcher.ts";
import { answerCard, isOpen, type Item, itemPath, KIND_LABEL, readItems, lineclear, usage, waitReason } from "./inbox.ts";
import { readSettings } from "./project.ts";
import { clearWait } from "./waits.ts";
import { gitText } from "./git.ts";

const describe = (i: Item) =>
  `${i.n}  ${KIND_LABEL[i.kind]}  ${i.task}${i.project ? ` (${i.project})` : ""}\n   ${i.question}\n` +
  (i.diff
    ? `${i.diff
        .trimEnd()
        .split("\n")
        .map((l) => `   | ${l}`)
        .join("\n")}\n`
    : "") +
  `   ${i.choices.map((c) => `[${c}]`).join(" ")}` +
  (i.session && isOpen(i) ? `\n   take over the browser: playwright-cli -s=${i.session} show` : "") +
  (i.closed !== undefined ? `\n   closed: ${i.closed}` : i.answer !== undefined ? `\n   answered: ${i.answer}` : "");

/** `lineclear inbox` lists open items, `--all` the closed ones too; `lineclear inbox answer <n> <choice>` answers one. */
export function inboxMain(args: string[], out: (l: string) => void, env = process.env): number {
  if (args.length === 0 || (args.length === 1 && args[0] === "--all")) {
    const shown = readItems(env).filter((i) => args.length === 1 || isOpen(i));
    out(shown.length === 0 ? "The Inbox is empty." : shown.map(describe).join("\n"));
    return 0;
  }
  const [verb, n, ...tail] = args;
  const noteAt = tail.indexOf("--note");
  const note =
    noteAt >= 0
      ? tail
          .slice(noteAt + 1)
          .join(" ")
          .trim()
      : undefined;
  const rest = noteAt >= 0 ? tail.slice(0, noteAt) : tail;
  if (verb === "undo" && /^\d+$/.test(n ?? "") && tail.length === 0) {
    const item = readItems(env).find((i) => i.n === Number(n));
    if (item === undefined) return (out(`lineclear inbox: no item ${n}`), 1);
    const problem = undoApplied(item, new Date(), env);
    return problem ? (out(`lineclear inbox: ${problem}`), 1) : (out(`undone: ${item.question} was reverted on main`), 0);
  }
  if (verb !== "answer" || !/^\d+$/.test(n ?? "") || rest.length === 0 || note === "") return (out(usage("inbox")), 2);
  const item = readItems(env).find((i) => i.n === Number(n));
  if (item === undefined) return (out(`lineclear inbox: no item ${n}`), 1);
  if (item.answer !== undefined) return (out(`lineclear inbox: item ${n} was answered: ${item.answer}`), 1);
  if (item.closed !== undefined) return (out(`lineclear inbox: item ${n} was closed: ${item.closed}`), 1);
  return answerItem(item, rest.join(" "), note, out, env);
}

/** Answers one open item with the choice written in `text`. */
function answerItem(item: Item, text: string, note: string | undefined, out: (l: string) => void, env: NodeJS.ProcessEnv): number {
  const choice = item.choices.find((c) => c === text) ?? item.choices.find((c) => c.toLowerCase() === text.toLowerCase());
  if (choice === undefined) return (out(`lineclear inbox: '${text}' is not a choice, use one of: ${item.choices.join(", ")}`), 2);
  if (note !== undefined && item.kind !== "plan" && item.ownerStep === undefined)
    return (out("lineclear inbox: --note is only for a plan or an owner step"), 2);
  if (item.ownerStep !== undefined && note === undefined) return (out("lineclear inbox: say the result: answer <n> Done --note <text>"), 2);
  if (item.move) return answerMove(item, item.move, choice, note, out, env);
  const resend = item.kind === "plan" && choice === "Reject" && (item.round ?? 1) < 2;
  if (resend && note === undefined) return (out("lineclear inbox: say why you reject the plan: answer <n> Reject --note <text>"), 2);
  const failure = deliverAnswer(item, choice, note, resend, env);
  if (failure) return (out(failure.line), failure.code);
  writeAtomic(
    itemPath(item.n, env),
    `${JSON.stringify({ ...item, answer: choice, ...(note ? { note } : {}), answeredAt: new Date().toISOString() }, null, 2)}\n`,
  );
  if (waitReason(item.task, env) === `asked: ${item.question}`) clearWait(item.task, env);
  out(answeredLine(item, choice, resend));
  return 0;
}

/** Carries the answer out: the merge, the close or the word to the task. Returns the line to say when it fails. */
function deliverAnswer(
  item: Item,
  choice: string,
  note: string | undefined,
  resend: boolean,
  env: NodeJS.ProcessEnv,
): { line: string; code: number } | undefined {
  const run = (...a: string[]) => Bun.spawnSync([lineclear(env), ...a], { stdin: "ignore" });
  const said = (p: { stderr?: Buffer; stdout?: Buffer }) => (p.stderr?.toString() || p.stdout?.toString() || "").trim();
  let message = `Your answer to "${item.question}": ${choice}. Go on.`;
  let p: { exitCode: number; stderr?: Buffer; stdout?: Buffer } = { exitCode: 0 };
  if (item.kind === "plan" && choice === "Approve") {
    const stale = staleBranch(item, env);
    if (stale) return { line: stale, code: 1 };
    p = run("merge", item.task);
  } else if (item.kind === "plan") {
    if (resend) message = `The owner rejected the plan: ${note}. Change docs/ROADMAP.md as the note says, commit, and run \`lineclear plan submit\` once more.`;
    else p = run("task", "close", item.task);
  } else if (item.task !== "-") {
    // An item that belongs to no task (task "-") has nobody to tell.
    p = run("task", "tell", item.task, message);
  }
  const cardError = p.exitCode === 0 && item.card ? answerCard(item.card, choice, env) : undefined;
  if (cardError) return { line: `lineclear inbox: failed: ${cardError}`, code: 1 };
  if (p.exitCode !== 0) return { line: `lineclear inbox: failed: ${said(p)}`, code: 1 };
  if (resend) {
    p = run("task", "tell", item.task, message);
    if (p.exitCode !== 0) return { line: `lineclear inbox: task tell failed: ${said(p)}`, code: 1 };
  }
  return undefined;
}

/** The line that says what the answer did. */
function answeredLine(item: Item, choice: string, resend: boolean): string {
  if (item.kind !== "plan") return item.task === "-" ? `answered: ${choice}` : `${item.task} was told: ${choice}`;
  if (choice === "Approve") return `${item.task} was merged`;
  return resend ? `${item.task} was told to change the plan` : `${item.task} was closed`;
}

/** Approving a plan merges it only if the branch is still what the owner saw: the line to say when it is not. */
function staleBranch(item: Item, env: NodeJS.ProcessEnv): string | undefined {
  const repo = item.project ? readSettings(item.project, env) : undefined;
  const n = /-(\d+)$/.exec(item.task)?.[1];
  if (!item.head || typeof repo !== "object" || !n) return undefined;
  const now = gitText(repo.repo, "for-each-ref", "--format=%(objectname)", `refs/heads/work/${n}-*`) ?? "";
  return now === item.head ? undefined : "lineclear inbox: the branch changed after the plan was sent, ask the planner to run 'lineclear plan submit' again";
}

/** Answers a move of a step's `after`: Approve commits it on main. */
function answerMove(
  item: Item,
  move: { step: string; after: string[] },
  choice: string,
  note: string | undefined,
  out: (l: string) => void,
  env: NodeJS.ProcessEnv,
): number {
  if (note !== undefined) return (out("lineclear inbox: --note is only for a plan"), 2);
  if (choice === "Approve") {
    const problem = applyMove(item, env);
    if (problem) return (out(`lineclear inbox: ${problem}`), 1);
  }
  writeAtomic(itemPath(item.n, env), `${JSON.stringify({ ...item, answer: choice, answeredAt: new Date().toISOString() }, null, 2)}\n`);
  out(choice === "Approve" ? `${move.step} in ${item.project} now comes after ${move.after.join(", ")}` : "the move was rejected");
  return 0;
}
