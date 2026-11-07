import { undoApplied } from "./plan-apply.ts";
import { answerCard, isOpen, type Item, readAllItems, lineclear, saveItem, waitReason } from "./inbox.ts";
import { clearWait } from "./waits.ts";

const USAGE = "usage: lineclear inbox [--all] | lineclear inbox answer <n> <choice> [--note <text>] | lineclear inbox undo <n>";

const describe = (i: Item) =>
  `${i.n}  ${i.kind}  ${i.task}${i.project ? ` (${i.project})` : ""}\n   ${i.question}\n` +
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
  if (!/^\d+$/.test(n ?? "") || !(isUndo || (verb === "answer" && rest.length > 0 && note !== ""))) return bail(2, USAGE);
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
  if (note !== undefined && item.ownerStep === undefined) return bail(2, "lineclear inbox: --note is only for an owner step");
  if (item.ownerStep !== undefined && note === undefined) return bail(2, "lineclear inbox: say the result: answer <n> Done --note <text>");
  const failure = deliverAnswer(item, choice, env);
  if (failure) return bail(1, failure);
  saveItem({ ...item, answer: choice, ...(note ? { note } : {}), answeredAt: new Date().toISOString() }, env);
  if (waitReason(item.task, env) === `asked: ${item.question}`) clearWait(item.task, env);
  return bail(0, item.task === "-" ? `answered: ${choice}` : `${item.task} was told: ${choice}`);
}

/** Carries the answer out: the word to the task, and the answer to its chat card. Returns the line to say when it fails. */
function deliverAnswer(item: Item, choice: string, env: NodeJS.ProcessEnv): string | undefined {
  // An item that belongs to no task (task "-") has nobody to tell.
  const p =
    item.task === "-"
      ? { exitCode: 0, stderr: undefined, stdout: undefined }
      : Bun.spawnSync([lineclear(env), "task", "tell", item.task, `Your answer to "${item.question}": ${choice}. Go on.`], { stdin: "ignore" });
  const cardError = p.exitCode === 0 && item.card ? answerCard(item.card, choice, env) : undefined;
  if (cardError) return `lineclear inbox: failed: ${cardError}`;
  if (p.exitCode !== 0) return `lineclear inbox: failed: ${(p.stderr?.toString() || p.stdout?.toString() || "").trim()}`;
  return undefined;
}
