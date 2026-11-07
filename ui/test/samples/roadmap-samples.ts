import type { ReleaseView } from "../../../src/release-view.ts";
import type { RoadmapData, RoadmapStep } from "../../../src/roadmap-view.ts";
import { whereTo } from "../../../src/progress.ts";
import { roadmapLine } from "../../../src/roadmap-line.ts";
import type { StepRecord } from "../../../src/step-page.ts";
import type { PageState } from "../../web/states.ts";

// Sample roadmaps for each state of the Roadmap view (`?state=`), the same on every machine.

const AT = Date.UTC(2026, 0, 12, 9, 0);
const HOUR = 3_600_000;
const SAMPLE_NOW = Date.UTC(2026, 0, 14, 12, 0);

type Seed = [id: string, title: string, after: string[], state: RoadmapStep["state"], extra?: Partial<RoadmapStep>];

function build(project: string, phases: [string, Seed[]][]): RoadmapData {
  const steps: RoadmapStep[] = [];
  const history: RoadmapData["history"] = [];
  let n = 0;
  for (const [phase, seeds] of phases) {
    for (const [id, title, after, state, extra] of seeds) {
      const commits =
        state === "done"
          ? [{ commit: `${(n * 7919 + 4096).toString(16).padStart(7, "0")}a1b2c3`, subject: `T-${n + 1}: ${id} ${title}`, at: AT - (200 - n) * 5 * HOUR }]
          : [];
      for (const c of commits) history.push({ step: id, ...c });
      n += 1;
      steps.push({
        id,
        title,
        result: `A customer can ${title.toLowerCase()} and it just works.`,
        phase,
        state,
        why: `People expect ${title.toLowerCase()} to just work, and the steps after it build on it.`,
        doneWhen: `- ${title} works in the shop for a signed in customer.\n- A test covers it, and the check passes.`,
        locks: after.length % 2 ? ["checkout"] : [],
        parts: [n % 2 ? "cart" : "search"],
        after,
        commits,
        ...(state === "work" ? { task: { id: `T-${n}`, status: "work", sub: "Writing the tests" } } : {}),
        ...(state === "done" ? { task: { id: `T-${n}`, status: "done", sub: "Merged" } } : {}),
        ...extra,
      });
    }
  }
  history.sort((a, b) => b.at - a.at);
  const open = steps.filter((x) => x.state !== "done" && x.state !== "dropped");
  const live = steps.filter((x) => x.state !== "dropped");
  const plan = { steps: live.map((x) => ({ id: x.id, title: x.title, phase: x.phase, done: x.state === "done", after: x.after, locks: x.locks })) };
  const marks = new Map(live.flatMap((x) => (x.state === "work" ? [[x.id, x.task?.status === "need" ? ("need" as const) : ("work" as const)] as const] : [])));
  const where = whereTo(plan, [], 7, SAMPLE_NOW);
  return {
    project,
    phases: phases.map(([p]) => p),
    steps,
    parts: [
      { name: "cart", score: 0 },
      { name: "search", score: 4 },
    ],
    done: live.length - open.length,
    total: live.length,
    line: roadmapLine(plan, marks, where, 7),
    phase: open[0]?.phase,
    history,
    rounds: 2,
  };
}

const LONG = "Move the whole settings page onto the new form parts and keep every saved value, including the ones from before the rename";

function filled(project: string, long = false): RoadmapData {
  const L = (s: string) => (long ? `${s}: ${LONG.toLowerCase()}` : s);
  return build(project, [
    [
      long ? "Phase 0: A base that anyone can run, with one check that keeps the repo clean on every machine" : "Phase 0: Base",
      [
        ["W0", "Repo and check", [], "done"],
        ["W1", "Product pages", ["W0"], "done"],
        ["W2", "Cart", ["W1"], "done"],
      ],
    ],
    [
      long ? "Phase 1: Checkout that takes every card and keeps the cart through a reload, a crash and a new device" : "Phase 1: Checkout",
      [
        ["W3", L("Pay with a saved card"), ["W2"], "work", { task: { id: "T-4", status: "need", sub: long ? `Pick A or B: ${LONG}` : "Pick A or B" } }],
        ["W4", "Order history page", ["W2"], "done"],
        ["W5", L("Search that forgives typos"), ["W1"], "work"],
        ["W6", "Gift cards", ["W3"], "waiting"],
        ["W7", "Stock alerts by mail", ["W2"], "ready"],
        ["W8", "Faster product images", ["W1"], "ready", long ? { why: `${LONG}. ${LONG}.`, doneWhen: `- ${LONG}.\n- ${LONG}.\n  - ${LONG}.` } : {}],
      ],
    ],
    [
      "Phase 2: Growth",
      [
        ["W9", "Reviews on product pages", ["W4"], "ready"],
        ["W10", "Wish lists", ["W9"], "waiting"],
        ["W11", L("Mail campaigns"), ["W7", "W10"], "waiting"],
        ["W12", "Referral codes", long ? ["W3", "W5", "W6", "W7", "W8", "W9", "W10", "W11"] : ["W6", "W11"], "waiting"],
        ["W13", "Live chat", [], "dropped", { dropped: "a support tool covers it" }],
      ],
    ],
  ]);
}

/** What a generated step waits for: the one before it, sometimes one five back, and the last one waits for `wide` others. */
function generatedAfter(i: number, count: number, wide: number): string[] {
  if (i === count - 1) return Array.from({ length: wide }, (_, k) => `S${k + 1}`);
  if (i === 0) return [];
  return [`S${i}`].concat(i > 5 && i % 3 === 0 ? [`S${i - 5}`] : []);
}

const generatedState = (i: number, count: number, doneUpTo: number): RoadmapStep["state"] => {
  if (i < doneUpTo) return "done";
  if (i === count - 1) return "waiting";
  if (i < doneUpTo + 6) return i % 2 ? "work" : "ready";
  return i % 41 === 0 ? "dropped" : "waiting";
};

/** A generated roadmap: `count` steps over `phases` phases, the first third done, and one step waits for `wide` others. */
function generatedRoadmap(project: string, count = 400, phases = 12, wide = 250): RoadmapData {
  const per = Math.ceil(count / phases);
  const words = ["Fix", "Add", "Move", "Check", "Split", "Name", "Test", "Measure", "Drop", "Speed up"];
  const things = ["the login form", "the import", "the merge lane", "the usage chart", "a flaky test", "the inbox card", "the doctor", "the install"];
  const doneUpTo = Math.floor(count / 3);
  const out: [string, Seed[]][] = [];
  for (let p = 0; p < phases; p++) {
    const seeds: Seed[] = [];
    for (let i = p * per; i < Math.min(count, (p + 1) * per); i++) {
      const id = `S${i + 1}`;
      const state = generatedState(i, count, doneUpTo);
      seeds.push([id, `${words[i % words.length]} ${things[(i * 7) % things.length]}`, generatedAfter(i, count, wide), state]);
    }
    out.push([
      `Phase ${p}: ${["Base", "Read the plan", "Rules", "Safety", "Inbox", "Fork", "Planner", "Settings", "Machines", "Accounts", "Polish", "Release"][p % 12]}`,
      seeds,
    ]);
  }
  return build(project, out);
}

/** `length` steps in a row, the first at work, sharing no lock; "fork" is 4 in a row and one side step after the first. */
function chainRoadmap(project: string, length: number, fork = false): RoadmapData {
  const seeds: Seed[] = Array.from(
    { length },
    (_, i): Seed => [`C${i + 1}`, `Step ${i + 1} of the chain`, i ? [`C${i}`] : [], i === 0 ? "work" : "waiting", { locks: [] }],
  );
  if (fork) seeds.push(["S1", "A side step", ["C1"], "waiting", { locks: [] }]);
  return build(project, [["Phase 0: The chain", seeds]]);
}

/** A release with a part in each state: done, part done, none started, and checks that hold, fail and wait for a meter. */
function sampleRelease(d: RoadmapData, long: boolean): ReleaseView {
  const step = (id: string) => d.steps.find((s) => s.id === id) as RoadmapStep;
  const must = (s: string) => (long ? `${s}, ${LONG.toLowerCase()}` : s);
  return {
    version: "v1.0",
    parts: [
      { rank: "P1", name: "the base works", done: 3, total: 3 },
      { rank: "P2", name: long ? "checkout that takes every card and keeps the cart through a reload" : "checkout", done: 1, total: 6 },
      { rank: "P3", name: "growth", done: 0, total: 4 },
    ],
    unranked: { done: 0, total: 0 },
    checks: [
      { id: "R1", part: "the base works", must: must("A page opens in 1 s or less at p90"), state: "holds", today: "0.6 s" },
      { id: "R2", part: "checkout", must: must("9 in 10 checkouts end in an order"), state: "fails", today: "7 in 10" },
      { id: "R3", part: "growth", must: must("A review shows within a minute"), state: "unmeasured" },
    ],
    now: [step("W3"), step("W5")],
    next: [step("W7"), step("W8"), step("W6")],
  };
}

export function roadmapSample(state: PageState, project: string): RoadmapData {
  const chain = /^chain-(\d+|fork)$/.exec(project);
  if (chain) return chainRoadmap(project, chain[1] === "fork" ? 4 : Number(chain[1]), chain[1] === "fork");
  if (state === "many" || state === "real") return generatedRoadmap(project);
  const d = filled(project, state === "long");
  return { ...d, release: sampleRelease(d, state === "long") };
}

/** What a sample step's page adds: a checklist ticked by state, what holds it up, and a history where a task exists. */
export function stepSample(d: RoadmapData, id: string): StepRecord {
  const s = d.steps.find((x) => x.id === id);
  if (!s) return { step: id, checklist: [], waits: [], read: [] };
  const page = (x: string) => `/${d.project}/roadmap/${x}`;
  const named = (x: RoadmapStep) => `${x.id} ${x.title}`;
  const items = s.doneWhen
    .split("\n")
    .filter((l) => l.trim().startsWith("- "))
    .map((l) => l.trim().slice(2));
  const merge = s.commits[0];
  const checklist = items.map((text, i) => {
    if (merge) return { text, evidence: `merge commit ${merge.commit.slice(0, 7)}` };
    return s.state === "work" && i === 0 ? { text, evidence: `named in the facts of its task` } : { text };
  });
  const waits: StepRecord["waits"] = [];
  for (const a of s.after) {
    const x = d.steps.find((o) => o.id === a);
    if (x && x.state !== "done" && x.state !== "dropped") waits.push({ kind: "step", text: `waits for ${named(x)}`, href: page(x.id) });
  }
  for (const lock of s.state === "work" || s.state === "done" ? [] : s.locks) {
    const holder = d.steps.find((x) => x.id !== s.id && x.state === "work" && x.locks.includes(lock));
    if (holder) waits.push({ kind: "lock", text: `uses the same part as ${named(holder)}, which is at work`, href: page(holder.id) });
  }
  if (s.task?.status === "need") waits.push({ kind: "you", text: s.task.sub ?? "waits for you", href: "/inbox" });
  const read: StepRecord["read"] =
    id === "W7"
      ? [
          {
            model: "vendor-b/model-review",
            go: false,
            said: "The step sends a mail when an item is back in stock.",
            missing: "who gets the mail is not said",
          },
          { model: "vendor-b/model-review", go: true, said: "A shopper who asked for an item gets one mail when it is back in stock.", missing: "" },
        ]
      : s.state === "done" || s.task
        ? [{ model: "vendor-b/model-review", go: true, said: `${s.result}`, missing: "" }]
        : [];
  if (!s.task) return { step: id, checklist, waits, read };
  const done = s.state === "done";
  return {
    step: id,
    checklist,
    waits,
    read,
    history: {
      task: s.task.id ?? "",
      branch: `work/${(s.task.id ?? "").toLowerCase()}-${s.id.toLowerCase()}`,
      ...(done ? { pr: { number: 41, url: "https://example.com/pull/41" } } : {}),
      review: [
        { round: 1, findings: "1 major, fixed" },
        { round: 2, findings: "1 minor left: a name could be shorter" },
      ],
      checks: [
        { at: AT + 4 * HOUR, tier: "inner", ok: false, seconds: 38, failed: ["cart total rounds up"] },
        { at: AT + 5 * HOUR, tier: "inner", ok: true, seconds: 41, failed: [] },
      ],
      readyToStart: 25 * 60_000,
      ...(done ? { startToMerge: 52 * 60_000, cost: 3.42 } : {}),
    },
  };
}
