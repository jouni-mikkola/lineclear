import type { AccountUse, InboxItem, Project, Task, TaskState } from "../kit/index.ts";

// The `?state=real` board: the shape of a sanitized copy of a real board, made the same on every run. Four spaces and
// about 300 tasks, most of them merged, a few at work or waiting, titles from two words to two lines, full accounts
// and a dispatcher. Names are invented; the shape is what matters.

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 31, 12);
const fromNow = (min: number) => new Date(Date.now() + min * MIN).toISOString();

const VERBS = ["Add", "Fix", "Move", "Split", "Speed up", "Name", "Check", "Drop", "Show", "Keep"];
const THINGS = [
  "the login form",
  "the import",
  "the merge lane",
  "the usage chart",
  "a flaky test",
  "the inbox card",
  "the doctor",
  "the install",
  "saved filters",
  "the retry queue",
  "webhook signatures",
  "the empty state",
];
const LONGER = [
  "Move every settings form onto the shared parts and keep each saved value from before the rename, including the ones set by hand",
  "Retry a failed webhook with backoff, stop after the sixth try and say why in the task's chat instead of the log",
  "Show the account that ran a task on its card, and the one it moved to when the first one was full, with the time of the move",
];

const SPACES: { name: string; prefix: string; total: number; unit: "steps" | "tasks"; phase: string; next: string }[] = [
  { name: "lineclear", prefix: "L", total: 112, unit: "steps", phase: "Phase 9: The UI gate", next: "Taste review on real data" },
  { name: "shop-frontend", prefix: "WEB", total: 84, unit: "tasks", phase: "Phase 3: Checkout", next: "Gift cards" },
  { name: "billing-service", prefix: "BIL", total: 71, unit: "tasks", phase: "Phase 2: Invoices", next: "Credit notes" },
  { name: "infra-notes", prefix: "INF", total: 33, unit: "steps", phase: "Phase 1: Backups", next: "Restore drill" },
];

const ACCOUNTS = ["work-subscription", "home-subscription", "second-work-subscription", "openai-pro"];

const OPEN = [9, 6, 5, 2];
const MODELS = { review: "vendor-a/model-top", work: "vendor-b/model-code" };

/** Where task `i` of a space stands: the last few are open, one in five of them waits for the owner. */
function standing(space: (typeof SPACES)[number], si: number, i: number): { state: TaskState; stage: NonNullable<Task["stage"]> } {
  if (i <= space.total - (OPEN[si] ?? 2)) return { state: "done", stage: "done" };
  const k = i - (space.total - 9);
  const state: TaskState = k % 5 === 4 ? "need" : k % 2 === 0 ? "work" : "queued";
  return { state, stage: state === "queued" ? "queued" : k % 3 === 0 ? "review" : "work" };
}

function titleOf(i: number, si: number): string {
  if (i % 41 === 0) return LONGER[(i / 41) % LONGER.length] as string;
  return `${VERBS[(i * 3 + si) % VERBS.length]} ${THINGS[(i * 7 + si) % THINGS.length]}`;
}

function tasks(space: (typeof SPACES)[number], si: number): Task[] {
  const out: Task[] = [];
  for (let i = 1; i <= space.total; i++) {
    const { state, stage } = standing(space, si, i);
    const model = stage === "review" || stage === "work" ? MODELS[stage] : undefined;
    out.push({
      id: `${space.prefix}-${i}`,
      title: `${space.prefix}${i} ${titleOf(i, si)}`,
      step: `${space.prefix}${i}`,
      state,
      stage,
      since: NOW - ((i * 37) % 600) * MIN - 4 * MIN,
      ...(model ? { model } : {}),
      ...(stage === "work" ? { progress: (((i * 29) % 70) + 15) / 100 } : {}),
      ...(stage === "queued" || stage === "done"
        ? {}
        : { load: { used: (((i * 47) % 150) + 25) * 1000, limit: 200_000 }, account: ACCOUNTS[i % ACCOUNTS.length] as string }),
      ...(stage === "review" ? { result: "Ready: 12 files changed and all 24 tests pass." } : {}),
    });
  }
  return out;
}

export const realProjects = (): Project[] =>
  SPACES.map((s, si) => {
    const ts = tasks(s, si);
    return {
      name: s.name,
      done: ts.filter((t) => t.state === "done").length,
      total: s.total,
      unit: s.unit,
      broken: si === 2,
      phase: s.phase,
      next: s.next,
      ...(si === 0 ? { planning: true } : {}),
      ...(si === 1 ? { blocker: { text: "waits until 3 Nov" }, finish: Date.UTC(2026, 10, 4, 12) } : {}),
      tasks: ts,
    };
  });

export const realInbox = (): InboxItem[] => [
  {
    id: "r1",
    project: "shop-frontend",
    task: "WEB-80",
    title: "Pay with a saved card",
    since: fromNow(-12),
    question: "Pay with a saved card needs a payment provider. Which one?",
    choices: ["Stripe", "Adyen", "Decide later"],
    details: "The step's done-when names card payments but no provider. Both have test keys.",
  },
  {
    id: "r2",
    project: "billing-service",
    task: "BIL-69",
    title: "Release 2.4",
    since: fromNow(-190),
    question: "Release 2.4 to production?",
    choices: ["Release", "Not yet"],
  },
  {
    id: "r3",
    project: "lineclear",
    task: "L-109",
    title: LONGER[0] as string,
    since: fromNow(-2 * 1440),
    question: `${LONGER[0]}? It touches every form, so a review by a person may be worth it before the merge.`,
    choices: ["Merge it after the review passes", "Wait for me to read it first"],
  },
];

export const realUsage = (): AccountUse[] => [
  { account: "work-subscription", session: { percent: 100, resetAt: fromNow(70) }, week: { percent: 81, resetAt: fromNow(2 * 1440 + 300) } },
  { account: "home-subscription", session: { percent: 42, resetAt: fromNow(190) }, week: { percent: 18, resetAt: fromNow(5 * 1440) } },
  { account: "second-work-subscription", session: { percent: 87, resetAt: fromNow(25) }, week: { percent: 64, resetAt: fromNow(3 * 1440) } },
  { account: "openai-pro", session: { percent: 12, resetAt: fromNow(240) }, week: { percent: 9, resetAt: fromNow(6 * 1440) } },
  { account: "api-key", unreported: true },
];
