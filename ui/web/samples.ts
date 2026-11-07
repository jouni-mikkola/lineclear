import type { AccountUse, Detection, InboxItem, Project, Task, TaskState } from "../kit/index.ts";
import { realInbox, realProjects, realUsage } from "./real-samples.ts";

// Sample data for each state of a page (`?state=`): the design page and the views draw it, so their pictures stay
// the same on every machine.

export const STATES = [
  "filled",
  "empty",
  "loading",
  "error",
  "long",
  "many",
  "idle",
  "clear",
  "offline",
  "thirty",
  "one",
  "title",
  "tasks200",
  "real",
] as const;
export type PageState = (typeof STATES)[number];

/** The Chat view has states more than the others: sending, streaming, offline, none, request (a sentence to a plan to approve) and task. */
export const CHAT_STATES = [...STATES, "sending", "streaming", "offline", "none", "request", "task"] as const;
export type ChatState = (typeof CHAT_STATES)[number];

export const QUESTIONS = ["What waits for me?", "How far is web-shop?", "Move Gift cards after Search that forgives typos"];

const LONG = "Move the whole settings page onto the new form parts and keep every saved value, including the ones from before the rename";
const LONG_NAME = "a-project-with-a-very-long-repository-name-that-goes-on-and-on";

/** Exactly 200 characters, to see how a title that long wraps. */
const TITLE_200 =
  "Make the checkout total follow every removed line, keep each saved cart across a reload, show the rounding rule in the order mail and tell the shopper which coupon was dropped and why before they pay.";

const MIN = 60_000;
// a fixed hour, so each picture is the same on every run
const NOW = Date.UTC(2026, 9, 31, 12);

/** A sample task: its stage follows its state unless named, with a step id, a model and a time at its stage. */
const t = (id: string, title: string, state: TaskState, o: Partial<Task> = {}): Task => {
  const stage = o.stage ?? (state === "done" ? "done" : state === "queued" ? "queued" : "work");
  return {
    id,
    title,
    state,
    stage,
    since: NOW - ((id.charCodeAt(1) * 7) % 90) * MIN - 4 * MIN,
    ...(stage === "queued" || stage === "done" ? {} : { model: stage === "review" ? "vendor-a/model-top" : "vendor-b/model-code" }),
    ...(stage === "work" ? { progress: ((((id.charCodeAt(1) + (id.charCodeAt(2) || 0)) * 37) % 70) + 15) / 100 } : {}),
    ...(stage === "queued" || stage === "done"
      ? {}
      : {
          load: { used: ((((id.charCodeAt(1) + (id.charCodeAt(2) || 0)) * 53) % 150) + 25) * 1000, limit: 200_000 },
          account: id.charCodeAt(1) % 2 ? "work-subscription" : "home-subscription",
        }),
    ...(stage === "queued" || stage === "done"
      ? {}
      : {
          last: { text: "Wrote the retry test, running it", at: NOW - (((id.charCodeAt(1) * 3) % 20) + 1) * MIN },
          files: ((id.charCodeAt(1) * 5) % 14) + 1,
          check: id.charCodeAt(1) % 3 ? ("pass" as const) : ("fail" as const),
        }),
    ...(state === "need" ? { text: "Waits for your answer: which payment provider?" } : {}),
    ...(stage === "review" || stage === "ready" || stage === "done"
      ? { result: stage === "done" ? "Merged with 12 files changed and all tests green." : "Ready: 12 files changed and all 24 tests pass." }
      : {}),
    ...o,
  };
};

/** The five sample projects of the plain state. */
const baseProjects = (): Project[] => [
  {
    name: "web-shop",
    project: "web-shop",
    paused: false,
    done: 14,
    total: 30,
    unit: "steps",
    broken: false,
    phase: "Phase 2: Checkout",
    next: "Gift cards",
    blocker: { text: "waits until 3 Nov" },
    finish: Date.UTC(2026, 10, 4, 12),
    tasks: [
      t("w1", "C3 Pay with a saved card", "need", { step: "C3" }),
      t("w2", "C4 Search that forgives typos", "work", { step: "C4" }),
      t("w3", "C5 Order history page", "work", { step: "C5", stage: "review" }),
      t("w4", "C6 Faster product images", "queued", { step: "C6" }),
      t("w5", "C7 Gift cards", "queued", { step: "C7" }),
      t("w6", "C8 Stock alerts by mail", "queued", { step: "C8" }),
      t("w7", "C2 Cart survives a reload", "done", { step: "C2" }),
    ],
    waiting: {
      running: [
        { id: "w2", title: "C4 Search that forgives typos", stage: "work", since: Date.now() - 42 * 60_000 },
        { id: "w3", title: "C5 Order history page", stage: "review", since: Date.now() - 9 * 60_000 },
      ],
      paused: [
        { text: "5 tasks wait for C3 Pay with a saved card", count: 5 },
        { text: "C8 Stock alerts by mail waits: the mail provider is down, wakes 3 Nov", count: 1 },
      ],
      notStarted: [
        { title: "C6 Faster product images", reason: "waits for C4 Search that forgives typos, which works on the same part" },
        { title: "C7 Gift cards", reason: "the machine is too busy to start more" },
      ],
    },
  },
  {
    name: "billing-api",
    done: 41,
    total: 52,
    unit: "tasks",
    broken: false,
    tasks: [
      t("b1", "Retry failed webhooks", "work", { stage: "ready" }),
      t("b2", "Invoices in more currencies", "work", { stalled: true }),
      t("b3", "Rate limit per key", "queued"),
    ],
  },
  {
    name: "mail-queue",
    project: "mail-queue",
    paused: true,
    done: 3,
    total: 10,
    unit: "steps",
    broken: false,
    phase: "Phase 1: Queue",
    blocker: { text: "a question waits for you", href: "/inbox" },
    planning: true,
    tasks: [t("q1", "Q2 Retry with backoff", "queued", { step: "Q2" })],
  },
  {
    name: "mobile-app",
    done: 6,
    total: 15,
    unit: "steps",
    broken: false,
    phase: "Next",
    next: "Offline mode for saved lists",
    finish: Date.UTC(2026, 10, 20, 12),
    tasks: [t("a1", "M7 Offline mode for saved lists", "work", { step: "M7" })],
  },
  {
    name: "docs-site",
    done: 9,
    total: 9,
    unit: "steps",
    broken: false,
    phase: "Phase 1: Pages",
    tasks: [t("d1", "D9 Search box on every page", "done", { step: "D9" })],
  },
];

export function projects(state: PageState): Project[] {
  if (state === "real") return realProjects();
  const base = baseProjects();
  if (state === "long") {
    const [first, ...rest] = base as [Project, ...Project[]];
    return [
      {
        ...first,
        name: LONG_NAME,
        broken: true,
        phase: "Phase 12: Every settings form moves onto the new parts",
        next: "Keep each saved value from before the rename as the settings page moves",
        blocker: { text: "a question waits for you", href: "/inbox" },
        tasks: [t("x1", LONG, "need"), t("x2", `Then ${LONG.toLowerCase()}`, "work", { stage: "review" }), ...first.tasks],
      },
      ...rest,
    ];
  }
  if (state === "title") {
    const [first, ...rest] = base as [Project, ...Project[]];
    return [{ ...first, tasks: [t("x1", TITLE_200, "work"), ...first.tasks] }, ...rest];
  }
  if (state === "many" || state === "tasks200") {
    const words = ["Fix", "Add", "Move", "Check", "Split", "Name", "Test", "Measure", "Drop", "Speed up"];
    const things = ["the login form", "the import", "the merge lane", "the usage chart", "a flaky test", "the inbox card", "the doctor", "the install"];
    const states: TaskState[] = ["queued", "queued", "work", "queued", "need", "queued", "work", "queued"];
    // `many` spreads 200 tasks over the projects, `tasks200` puts them all in one
    const ps = base.map((p, n) => ({ ...p, total: state === "many" || n === 0 ? p.total + 80 : p.total, tasks: [] as Task[] }));
    const into = (i: number) => ps[state === "many" ? i % ps.length : 0];
    for (let i = 0; i < 200; i++) {
      const stage = i % 11 === 0 ? "review" : i % 13 === 0 ? "ready" : undefined;
      into(i)?.tasks.push(
        t(`m${i}`, `S${i} ${words[i % words.length]} ${things[(i * 7) % things.length]}`, states[i % states.length] as TaskState, {
          step: `S${i}`,
          ...(stage && states[i % states.length] === "work" ? { stage } : {}),
        }),
      );
    }
    return ps;
  }
  // nothing at work: the roadmaps wait for their next step
  if (state === "idle") return base.map((p) => ({ ...p, blocker: undefined, waiting: undefined, tasks: p.tasks.filter((x) => x.state === "done") }));
  // line clear: every task merged
  if (state === "clear")
    return base.map((p) => ({
      ...p,
      blocker: undefined,
      waiting: undefined,
      tasks: p.tasks.filter((x) => x.state !== "queued").map((x) => ({ ...x, state: "done" as const, stage: "done" as const, stalled: undefined })),
    }));
  // 30 tasks at work across five projects, for the frame rate of the line
  if (state === "thirty") {
    const stages = ["work", "work", "review", "queued", "ready", "work"] as const;
    return base.map((p, n) => ({
      ...p,
      tasks: Array.from({ length: 6 }, (_, i) => {
        const k = n * 6 + i;
        const stage = stages[k % stages.length]!;
        return t(
          `t${k}`,
          `T${k + 1} ${["Fix", "Add", "Move", "Check", "Split", "Name"][i]} the ${["login form", "import", "merge lane", "usage chart", "inbox card", "doctor"][(k * 5) % 6]}`,
          k % 7 === 3 ? "need" : stage === "queued" ? "queued" : "work",
          { step: `T${k + 1}`, stage },
        );
      }),
    }));
  }
  return base;
}

export function inbox(state: PageState): InboxItem[] {
  if (state === "real") return realInbox();
  if (state === "idle" || state === "clear") return [];
  const base: InboxItem[] = [
    {
      id: "i1",
      project: "web-shop",
      question: "Pay with a saved card needs a payment provider. Which one?",
      choices: ["Stripe", "Adyen", "Decide later"],
      task: "w1",
      title: "Pay with a saved card",
      since: fromNow(-12),
      details: "The step's done-when names card payments but no provider. Both have test keys.",
    },
    {
      id: "i2",
      project: "billing-api",
      task: "BIL-7",
      title: "Release 2.4",
      since: fromNow(-190),
      question: "Release 2.4 to production?",
      choices: ["Release", "Not yet"],
    },
    {
      id: "i4",
      project: "web-shop",
      kind: "plan",
      task: "PLAN-3",
      title: "Plan: gift cards",
      since: fromNow(-30),
      question: "Approve the plan for gift cards? It adds 2 steps.",
      choices: ["Approve", "Reject"],
      needsNote: "Reject",
      stepChecks: [
        { step: "W13", model: "vendor-b/model-review", said: "A shopper buys a gift card with a code and spends it at checkout." },
        { step: "W14", model: "vendor-b/model-review", said: "The shop shows a card's remaining balance on its own page." },
      ],
    },
    // a task that waits with no item: its last card, answered in its chat
    {
      id: "task:WEB-3",
      task: "WEB-3",
      title: "Search by name",
      since: fromNow(-3 * 1440),
      project: "web-shop",
      question: "The search change is ready. Merge it?",
      choices: [],
      waiting: true,
    },
  ];
  if (state === "one") return base.slice(0, 1);
  if (state === "long") {
    return [
      {
        id: "il",
        project: LONG_NAME,
        task: "LONG-12",
        title: LONG,
        since: fromNow(-45),
        question: `${LONG}? It touches every form, so a review by a person may be worth it before the merge.`,
        choices: ["Merge it after the review passes", "Wait for me to read it first", "Drop the step from the roadmap"],
        details: `${LONG}.\n\n${LONG}.`,
      },
      {
        id: "ilp",
        project: LONG_NAME,
        kind: "plan",
        task: "LONG-13",
        title: LONG,
        since: fromNow(-50),
        question: `Approve the plan for ${LONG}?`,
        choices: ["Approve", "Reject"],
        stepChecks: [{ step: "L1234", model: "openai-codex/a-model-with-a-very-long-name-for-the-bar", said: `${LONG}. ${LONG}.` }],
      },
      ...base,
    ];
  }
  if (state === "many") {
    return Array.from({ length: 200 }, (_, i) => ({
      id: `im${i}`,
      project: ["web-shop", "billing-api", "docs-site"][i % 3] as string,
      task: `T${i + 1}`,
      title: `Step ${i + 1}`,
      since: fromNow(-(i + 1) * 7),
      question: `Question ${i + 1}: merge step ${i + 1} now?`,
      choices: ["Merge", "Not yet"],
    }));
  }
  return base;
}

export const spend = Array.from({ length: 14 }, (_, i) => ({
  day: `2026-01-${String(i + 1).padStart(2, "0")}`,
  dollars: [4.2, 6.1, 3.3, 0, 0, 8.4, 7.9, 5.5, 6.6, 12.1, 9.4, 0, 2.2, 7.35][i] as number,
}));

// times from the moment the page draws, so "in 2 h" and "12 min" read the same on every run
const fromNow = (min: number) => new Date(Date.now() + min * MIN).toISOString();

/** Each account's limits: a full session, room left, a long name, one with no limit reported, and 12 accounts. */
export function usage(state: PageState): AccountUse[] {
  if (state === "real") return realUsage();
  const base: AccountUse[] = [
    { account: "work-subscription", session: { percent: 100, resetAt: fromNow(70) }, week: { percent: 81, resetAt: fromNow(2 * 1440 + 300) } },
    { account: "home-subscription", session: { percent: 42, resetAt: fromNow(190) }, week: { percent: 18, resetAt: fromNow(5 * 1440) } },
    { account: "api-key", unreported: true },
  ];
  if (state === "long") return [{ ...base[1]!, account: "an-account-with-a-very-long-provider-name-and-plan" }, ...base];
  if (state === "many")
    return Array.from({ length: 12 }, (_, i) => ({
      account: `account-${i + 1}`,
      session: { percent: Math.max(0, 96 - i * 8), resetAt: fromNow(30 + i * 20) },
      week: { percent: Math.max(0, 70 - i * 5), resetAt: fromNow(1440 + i * 300) },
    }));
  return base;
}

export const moves = [
  {
    time: "2026-10-31T11:02:00.000Z",
    task: "T4",
    step: "T4",
    from: "work-subscription/model-mid",
    to: "home-subscription/model-mid",
    why: "session full",
  },
];

/** The repos Home offers on a sample page. */
export const sampleRepos = [
  { repo: "/home/someone/code/web-shop", name: "web-shop" },
  { repo: "/home/someone/code/notes", name: "notes" },
];

/** What the add form finds in any folder on a sample page. */
export const detected = (repo: string): Detection => ({
  repo,
  name: "web-shop",
  space: "web-shop",
  check: "bun run check",
  roadmap: true,
  models: ["vendor-a/model-top", "vendor-b/model-code", "vendor-a/model-mid"],
});
