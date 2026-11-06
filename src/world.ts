import type { Settings } from "./project.ts";
import type { ProveTools, StepProof } from "./doneproof.ts";
import type { Step, Task } from "./roadmap.ts";
import type { Room } from "./spread.ts";
import type { ChatCard, StallCard } from "./stalls.ts";
import type { StartState } from "./starts.ts";

export type TellKind = "resume" | "answer";

/** Everything a tick needs from outside, so a test can fake each part. */
export interface World {
  now(): Date;
  /** A tick starts: what the world read before is read again. */
  newTick?(): void;
  /** Done commits on origin/main, and its head. */
  main(repo: string): { head: string; checkedOut: string; commits: { subject: string; body: string }[] } | string;
  /**
   * How many commits on origin/main are newer than the one that added the roadmap line `line` (a step's `Reopened:`
   * item), or undefined when no commit did.
   */
  commitsSince?(repo: string, line: string): number | undefined;
  /** The checker's records, by step id. A world without it proves nothing: every merged step counts as done. */
  proofs?(repo: string): Record<string, StepProof>;
  /** Has the independent checker read the step's `done when` against the merged tree (head of main) and record it. A text is why it could not. */
  proveStep?(settings: Settings, step: Step, head: string, tools: ProveTools): StepProof | string;
  /** Fetches, then fast-forwards the repo folder when it is clean and on main. */
  fetch(repo: string): void;
  /** The roadmap as origin/main has it, or undefined when it has none. */
  roadmap(repo: string): string | undefined;
  /** The space's tasks; with `archived`, only the archived ones. */
  tasks(space: string, archived?: boolean): Task[] | string;
  maxTasks(space: string): number | undefined;
  /** `provider/model` names pi offers, or undefined when pi cannot say. */
  offered(now: Date): Set<string> | undefined;
  health(repo: string, command: string): { ok: boolean; output: string };
  /** Reverts a commit on origin/main and pushes the revert, as a plain push. Returns an error text, or undefined. */
  revert(repo: string, commit: string): string | undefined;
  addTask(space: string, title: string, brief: string, extra: string[]): string | undefined;
  /** What another machine of the project says about its room and its tasks, or why it cannot be reached. */
  room?(host: string, space: string): Room | string;
  /** The brief of a task as Lineclear holds it, or undefined when it cannot be read. */
  briefOf?(id: string): string | undefined;
  /** Makes a task on another machine (cloning the repo there once). Returns an error text, or undefined. */
  addTaskOn?(host: string, settings: Settings, title: string, brief: string, extra: string[], project?: string): string | undefined;
  /** The machine's one-minute load average. */
  load(): number;
  /** `lineclear task stop`. Returns an error text, or undefined. */
  stopTask(id: string): string | undefined;
  /**
   * `lineclear task tell`, which resumes a stopped agent. `kind` says why: `resume` goes on with the step's own work
   * (a wait is over, a stall, a cut-off), `answer` is a rule answering the agent's own question. Both are marked in
   * the agent's log; a call with no kind is counted. Machine news
   * (load, quota, accounts, status changes) is never a reason to call this. Returns an error text, or undefined.
   */
  tellTask(id: string, text: string, kind?: TellKind): string | undefined;
  /** `lineclear task close`, which keeps a branch with unmerged work. Returns an error text, or undefined. */
  closeTask(id: string): string | undefined;
  /** The `work/<n>-...` branch of a task, if the repo still has it. */
  branchOf(repo: string, task: string): string | undefined;
  pushBranch(repo: string, branch: string): string | undefined;
  commitsAhead(repo: string, branch: string): number;
  /** The "may be stuck" cards of a space, oldest first. */
  stallCards(space: string, repo: string): StallCard[];
  /** How far the task's start got: whether its agent answered its brief (see starts.ts). */
  started(id: string): StartState;
  /** Types a line and Enter into the task's pane. Returns an error text, or undefined. */
  nudge(id: string, text: string): string | undefined;
  /** `reviewer.model` from `lineclear show`, or undefined when it names none. */
  reviewerSetting(space: string): string | undefined;
  /** Chat cards of a space with their text, for reading a reported usage limit. */
  chatCards(space: string, repo: string): ChatCard[];
  /** The error of the task's agent when its last model call failed (its text and time in ms), or undefined. */
  lastError(id: string): { text: string; at: number } | undefined;
  /** True when the owner wrote to the task in its chat after `since` (an ISO time). */
  ownerWrote(task: string, since: string): boolean;
  /** True when the task's worktree has no changes and no commits beyond its base. */
  clean(task: string): boolean;
}

/** The mark of Lineclear's lines in an agent's log: `[lineclear]`, or `[lineclear:resume]` and `[lineclear:answer]`. */
const OWN_LINE = "[lineclear]";
export const ownMark = (kind?: TellKind) => (kind === undefined ? OWN_LINE : `[lineclear:${kind}]`);
