// `bun run ui:cold`: the cold look. Fresh models from three companies get only the eight pictures of a first run
// (docs/cold/, in the order of the recording), no docs, and answer who does what, what happens and what waits for the
// user. It spends tokens, so `bun run check` does not run it: run it on each UI release. A wrong answer is a fix to
// the picture, never added text. The answers go to docs/numbers.md under "Cold look".
import { readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "docs", "cold");
const GOAL = 90;
const MODELS = [
  { company: "Anthropic", id: "anthropic/claude-sonnet-5-5" },
  { company: "OpenAI", id: "openai-codex/gpt-6-sol" },
  { company: "Google", id: "opencode-go/gemini-4-argon" },
];

// Each question: its text, its options and the letter that is right. The role questions share one list of jobs.
const JOBS: Record<string, string> = {
  Dispatcher: "Receives what the user types and passes it on",
  Planner: "Breaks a request into steps",
  Rules: "Decides when each step may begin",
  Worker: "Does the building",
  Reviewer: "Looks the finished work over for faults",
  Inbox: "Where questions for a person pile up",
  You: "The human",
};
const letters = "ABCDEFG";
/** The jobs in a fixed shuffled order, so the right letter is not the order of the marks. */
const ORDER = ["Rules", "You", "Reviewer", "Dispatcher", "Inbox", "Worker", "Planner"];
/** The jobs in another order than the names, so one letter never serves both lists. */
const JOB_ORDER = ["Worker", "Dispatcher", "You", "Planner", "Rules", "Inbox", "Reviewer"];
const jobLetter = (role: string) => letters.charAt(JOB_ORDER.indexOf(role));

const QUESTIONS: { key: string; text: string; options?: string[]; right: string }[] = [
  ...Object.keys(JOBS).map((role) => ({
    key: role,
    text: `What does the part named "${role}" do? Answer with one letter from the list of jobs.`,
    right: jobLetter(role),
  })),
  ...[
    [2, "Dispatcher"],
    [5, "Rules"],
    [7, "Reviewer"],
  ].map(([frame, role]) => ({
    key: `lit-${frame}`,
    text: `Which part is lit in frame ${frame}? Answer with one letter from the list of part names.`,
    right: letters.charAt(ORDER.indexOf(String(role))),
  })),
  {
    key: "waits",
    text: "In frame 4, what waits for the user?",
    options: ["Nothing waits", "A decision waits for a person", "The Worker waits for the Reviewer", "The Planner waits for the Rules"],
    right: "B",
  },
  {
    key: "end",
    text: "In frame 8, what has happened?",
    options: ["The request failed", "The request was dropped", "The request was built and joined the main line", "The request waits for the user"],
    right: "C",
  },
];

const prompt = () =>
  [
    "Eight pictures follow, in order: frames 1 to 8 of one recording of an app, used for the first time. You have no other information.",
    "Part names (for the questions about what is lit):",
    ...ORDER.map((r, i) => `${letters[i]}. ${r}`),
    "Jobs (for the questions about what a part does; the letters are another list):",
    ...JOB_ORDER.map((r, i) => `${letters[i]}. ${JOBS[r]}`),
    "",
    "Questions:",
    ...QUESTIONS.map((q, i) => `${i + 1}. [${q.key}] ${q.text}${q.options ? ` ${q.options.map((o, j) => `${letters[j]}. ${o}`).join(" ")}` : ""}`),
    "",
    `Answer with one JSON object only, no other text: keys ${QUESTIONS.map((q) => `"${q.key}"`).join(", ")}, each a single letter or number.`,
  ].join("\n");

async function ask(model: string, frames: string[]): Promise<Record<string, string> | string> {
  const p = Bun.spawn(
    ["timeout", "-k", "10", "300", "pi", "-p", "--no-session", "--no-context-files", "--no-tools", "--model", model, ...frames.map((f) => `@${f}`), prompt()],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  if (code !== 0) return `pi exited with ${code}: ${out.slice(0, 200)}`;
  const json = /\{[^{}]*\}/.exec(out)?.[0];
  try {
    return JSON.parse(json ?? "") as Record<string, string>;
  } catch {
    return `no answer: ${out.slice(0, 200)}`;
  }
}

const frames = readdirSync(DIR)
  .filter((f) => /^first-run-\d\.png$/.test(f))
  .sort()
  .map((f) => join(DIR, f));
if (frames.length !== 8) {
  console.error(`ui:cold: ${frames.length} pictures in docs/cold, 8 expected: run the first run first`);
  process.exit(2);
}
let right = 0;
let total = 0;
const wrong: string[] = [];
const left: string[] = [];
for (const m of MODELS) {
  const a = await ask(m.id, frames);
  if (typeof a === "string") {
    console.log(`${m.company} (${m.id}): left out, ${a}`);
    left.push(m.company);
    continue;
  }
  const mine = QUESTIONS.filter(
    (q) =>
      String(a[q.key] ?? "")
        .trim()
        .toUpperCase() === q.right,
  );
  right += mine.length;
  total += QUESTIONS.length;
  for (const q of QUESTIONS) if (!mine.includes(q)) wrong.push(`${m.company}: ${q.key} answered ${a[q.key] ?? "nothing"}, right is ${q.right}`);
  console.log(`${m.company} (${m.id}): ${mine.length} of ${QUESTIONS.length}`);
}
const share = total === 0 ? 0 : Math.round((right / total) * 100);
console.log(`cold look: ${right} of ${total} right (${share} %, goal ${GOAL} %)`);
for (const w of wrong) console.log(`  wrong: ${w}`);
if (left.length > 0) console.log(`  not a pass: ${left.join(", ")} gave no answer (limit or error), all three companies must answer`);
process.exit(share >= GOAL && left.length === 0 ? 0 : 1);
