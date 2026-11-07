import { stepRule } from "./cards.ts";
import { addItem } from "./inbox.ts";
import { askBefore, readSettings } from "./project.ts";
import { findProject, findTask, writeWait } from "./waits.ts";
import { storedLoginAdvice } from "../server/server/live/secrets.ts";
import { askProjectChat, type CardPoster } from "./project-chat.ts";

/** The kinds an agent may ask the owner. A choice is a product decision the Dispatcher puts to the owner. */
export const askableKinds = ["login", "outward"] as const;

const USAGE = `usage: lineclear ask "<question>" --choice <a> --choice <b> [--choice <c> ...] --kind ${askableKinds.join("|")} [--login <NAME of the login, for a login>] [--about release|spending] [--session <browser session>]`;

/** An action on this machine alone (a power cut, a reboot, a recording): it sends nothing out, so it is not an outward ask. */
const staysOnMachine = (question: string) =>
  /\b(power cuts?|reboot|restart (this|the) machine|unplug|record(ing)? the boot)\b/i.test(question) &&
  !/\b(release|publish|deploy|send|message|email|post|pay|budget|login|captcha)\b/i.test(question);

interface ParsedAsk {
  question: string;
  choices: string[];
  kind: string | undefined;
  about: "release" | "spending" | undefined;
  session: string | undefined;
  login: string | undefined;
}

/** Takes one flag with its value into `found`; false when the flag or its value is not one `lineclear ask` knows. */
function askFlag(flag: string, value: string, found: Omit<ParsedAsk, "question" | "choices">): boolean {
  if (flag === "--kind") found.kind = value;
  else if (flag === "--about" && (value === "release" || value === "spending")) found.about = value;
  else if (flag === "--login" && /^[A-Za-z0-9_]+$/.test(value)) found.login = value.toUpperCase().replace(/_TOTP$/, "");
  else if (flag === "--session" && value.trim()) found.session = value.trim();
  else return false;
  return true;
}

/** The words of `lineclear ask`, or undefined when they do not make a question with two choices. */
function parseAsk(args: string[]): ParsedAsk | undefined {
  let question: string | undefined;
  const choices: string[] = [];
  const found: Omit<ParsedAsk, "question" | "choices"> = { kind: undefined, about: undefined, session: undefined, login: undefined };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (!flag.startsWith("--")) {
      if (question !== undefined) return undefined;
      question = flag;
      continue;
    }
    const value = args[++i];
    if (value === undefined) return undefined;
    if (flag === "--choice") choices.push(value);
    else if (!askFlag(flag, value, found)) return undefined;
  }
  if (!question?.trim() || choices.length < 2) return undefined;
  return { question, choices, ...found };
}

/** Records an outward ask the owner pre-approved in Settings, and says whether it did. Only a call that says what it is can be pre-approved. */
function preApproved(
  ask: { project: string; task: string; question: string; choices: string[]; about: ParsedAsk["about"]; now: () => Date },
  env: NodeJS.ProcessEnv,
): boolean {
  const s = readSettings(ask.project, env);
  const key = ask.about === "spending" ? "spending" : "releases";
  if (ask.about === undefined || typeof s !== "object" || askBefore(s)[key]) return false;
  const at = ask.now().toISOString();
  const { project, task, choices } = ask;
  addItem({ kind: "outward", task, project, question: ask.question.trim(), choices, since: at, answer: choices[0]!, answeredAt: at, auto: true }, env);
  return true;
}

/** `lineclear ask`: puts a question in its project's chat (the Inbox when it has none) and declares an owner wait. The card has a task named in it, which is how the rule loop finds it: an owner matter becomes an Inbox item there and the phone hears of it from the web server (`src/notify.ts`). */
export function askMain(
  args: string[],
  out: (l: string) => void,
  env = process.env,
  cwd = process.cwd(),
  now: () => Date = () => new Date(),
  post?: CardPoster,
): number {
  const fail = (message: string, code = 1) => {
    out(`lineclear ask: ${message}`);
    return code;
  };
  const parsed = parseAsk(args);
  if (parsed === undefined) return (out(USAGE), 2);
  const { question, choices, about, login } = parsed;
  const kind = askableKinds.find((k) => k === parsed.kind);
  let { session } = parsed;
  if (kind === undefined) {
    out(`lineclear ask: the owner is not asked this. ${stepRule(question)}`);
    out(
      "Only a login code or captcha with no stored TOTP, money beyond the budget, and what leaves the machine for the public go to the owner (--kind login, --kind outward).",
    );
    return 1;
  }
  if (kind === "outward" && staysOnMachine(question)) {
    out("lineclear ask: this sends nothing off the machine, so it is not an outward ask and the owner is not asked.");
    out("Do it yourself if you can. If only a person can (a real power cut), file it as a task with the time it needs and carry on without waiting.");
    return 1;
  }
  const task = findTask(cwd, env);
  if (task === undefined) return fail("cannot tell which task this is, run it inside a task's worktree");
  const project = findProject(cwd, env);
  if (kind === "login") {
    const stored = storedLoginAdvice(question, project, env, login);
    if (stored !== undefined) return fail(stored);
    if (login === undefined) return fail("a login ask names the login whose NAME_TOTP is missing: add --login <NAME>", 2);
  }
  if (kind === "outward" && project !== undefined && preApproved({ project, task, question, choices, about, now }, env)) {
    out(`pre-approved by ${project}'s settings (ask me before ${about === "spending" ? "spending" : "releases"} is off): ${choices[0]}. Go on.`);
    return 0;
  }
  // The agent's browser session is named after its task.
  if (kind === "login") session ??= task;
  const since = now().toISOString();
  const text = kind === "login" ? `${login}_TOTP is not stored. ${question.trim()}` : question.trim();
  const item = askProjectChat(project, task, text, choices, env, post)
    ? undefined
    : addItem({ kind, task, project, question: text, choices, ...(session ? { session } : {}), since }, env);
  writeWait(
    {
      task,
      project,
      kind: kind === "login" ? "login" : "owner",
      ...(kind === "outward" ? { ownerKind: about === "spending" ? "money" : "outward" } : {}),
      reason: `asked: ${text}`,
      since,
    },
    env,
  );
  out(
    item
      ? `inbox ${item.n}: ${text}. End your turn; the answer comes as a message.`
      : `asked in ${project}'s chat: ${text}. End your turn; the answer comes as a message.`,
  );
  return 0;
}
