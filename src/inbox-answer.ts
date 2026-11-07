import { writeAtomic } from "../pi/atomic.ts";
import { undoApplied } from "./plan-apply.ts";
import { applyMove } from "./dispatcher.ts";
import { answerCard, isOpen, type Item, itemPath, KIND_LABEL, readAllItems, lineclear, usage, waitReason } from "./inbox.ts";
import { readSettings } from "./project.ts";
import { clearWait } from "./waits.ts";
import { gitText } from "./git.ts";

const describe = (i: Item) =>
  `${i.n}  ${KIND_LABEL[i.kind]}  ${i.task}${i.project ? ` (${i.project})` : ""}\n   ${i.question}\n` +
  (i.diff ? `${i.diff.trimEnd().replace(/^/gm, "   | ")}\n` : "") +
  `   ${i.choices.map((c) => `[${c}]`).join(" ")}` +
  (i.session && isOpen(i) ? `\n   take over the browser: playwright-cli -s=${i.session} show` : "") +
  (i.closed !== undefined ? `\n   closed: ${i.closed}` : i.answer !== undefined ? `\n   answered: ${i.answer}` : "");

/** `lineclear inbox` lists open items, `--all` the closed ones too; `lineclear inbox answer <n> <choice>` answers one. */
export function inboxMain(args: string[], out: (l: string) => void, env = process.env): number {
  const bail = (code: number, line: string) => (out(line), code);
  if (args.length === 0 || (args.length === 1 && args[0] === "--all")) {
    const shown = readAllItems(env).filter((i) => args.length === 1 || isOpen(i));
    out(shown.length === 0 ? "The Inbox is empty." : shown.map(describe).join("\n"));
    return 0;
  }
  const [verb, n, ...tail] = args;
  const noteAt = tail.indexOf("--note");
  const [rest, noted] = noteAt < 0 ? [tail, undefined] : [tail.slice(0, noteAt), tail.slice(noteAt + 1)];
  const note = noted?.join(" ").trim();
  const isUndo = verb === "undo" && tail.length === 0;
  if (!/^\d+$/.test(n ?? "") || !(isUndo || (verb === "answer" && rest.length > 0 && note !== ""))) return bail(2, usage("inbox"));
  const item = readAllItems(env).find((i) => i.n === Number(n));
  if (item === undefined) return bail(1, `lineclear inbox: no item ${n}`);
  if (isUndo) {
    const problem = undoApplied(item, new Date(), env);
    return problem ? bail(1, `lineclear inbox: ${problem}`) : bail(0, `undone: ${item.question} was reverted on main`);
  }
  if (item.answer !== undefined) return bail(1, `lineclear inbox: item ${n} was answered: ${item.answer}`);
  if (item.closed !== undefined) return bail(1, `lineclear inbox: item ${n} was closed: ${item.closed}`);
  const text = rest.join(" ");
  const choice = item.choices.find((c) => c === text) ?? item.choices.find((c) => c.toLowerCase() === text.toLowerCase());
  if (choice === undefined) return bail(2, `lineclear inbox: '${text}' is not a choice, use one of: ${item.choices.join(", ")}`);
  if (note !== undefined && item.kind !== "plan" && item.ownerStep === undefined) return bail(2, "lineclear inbox: --note is only for a plan or an owner step");
  if (item.move) {
    if (note !== undefined) return bail(2, "lineclear inbox: --note is only for a plan");
    const problem = choice === "Approve" ? applyMove(item, env) : undefined;
    if (problem) return bail(1, `lineclear inbox: ${problem}`);
    writeAnswer(item, choice, undefined, env);
    return bail(0, choice === "Approve" ? `${item.move.step} in ${item.project} now comes after ${item.move.after.join(", ")}` : "the move was rejected");
  }
  if (item.ownerStep !== undefined && note === undefined) return bail(2, "lineclear inbox: say the result: answer <n> Done --note <text>");
  const resend = item.kind === "plan" && choice === "Reject" && (item.round ?? 1) < 2;
  if (resend && note === undefined) return bail(2, "lineclear inbox: say why you reject the plan: answer <n> Reject --note <text>");
  const failure = deliverAnswer(item, choice, note, resend, env);
  if (failure) return bail(1, failure);
  writeAnswer(item, choice, note, env);
  if (waitReason(item.task, env) === `asked: ${item.question}`) clearWait(item.task, env);
  return bail(0, answeredLine(item, choice, resend));
}

const writeAnswer = (item: Item, answer: string, note: string | undefined, env: NodeJS.ProcessEnv) =>
  writeAtomic(itemPath(item.n, env), `${JSON.stringify({ ...item, answer, ...(note ? { note } : {}), answeredAt: new Date().toISOString() }, null, 2)}\n`);

/** Carries the answer out: the merge, the close or the word to the task. Returns the line to say when it fails. */
function deliverAnswer(item: Item, choice: string, note: string | undefined, resend: boolean, env: NodeJS.ProcessEnv): string | undefined {
  const run = (...a: string[]) => Bun.spawnSync([lineclear(env), ...a], { stdin: "ignore" });
  const said = (p: { stderr?: Buffer; stdout?: Buffer }) => (p.stderr?.toString() || p.stdout?.toString() || "").trim();
  let message = `Your answer to "${item.question}": ${choice}. Go on.`;
  let p: { exitCode: number; stderr?: Buffer; stdout?: Buffer } = { exitCode: 0 };
  if (item.kind === "plan" && choice === "Approve") {
    const stale = staleBranch(item, env);
    if (stale) return stale;
    p = run("merge", item.task);
  } else if (item.kind === "plan") {
    if (resend) message = `The owner rejected the plan: ${note}. Change docs/ROADMAP.md as the note says, commit, and run \`lineclear plan submit\` once more.`;
    else p = run("task", "close", item.task);
  } else if (item.task !== "-") {
    // An item that belongs to no task (task "-") has nobody to tell.
    p = run("task", "tell", item.task, message);
  }
  const cardError = p.exitCode === 0 && item.card ? answerCard(item.card, choice, env) : undefined;
  if (cardError) return `lineclear inbox: failed: ${cardError}`;
  if (p.exitCode !== 0) return `lineclear inbox: failed: ${said(p)}`;
  if (resend) {
    p = run("task", "tell", item.task, message);
    if (p.exitCode !== 0) return `lineclear inbox: task tell failed: ${said(p)}`;
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
