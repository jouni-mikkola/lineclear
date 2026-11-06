import { appendFileSync } from "node:fs";
import { resolveOne, resolveStep } from "../../src/resolve.ts";
import { PROJECTS } from "./score.ts";

// The stand-in for `lineclear` in the eval: it records the call, resolves names with the real resolvers and answers
// with fixed text. Nothing else happens.

const args = process.argv.slice(2);
const [verb, ...rest] = args;
// the pi extension asks these on every start: they are not the model's calls
if (["secrets", "slot", "wait", "resume", "check"].includes(verb ?? "")) process.exit(0);
appendFileSync(process.env.EVAL_LOG!, `${["lineclear", ...args].join("\x01")}\x01\x02`);

const STEPS: Record<string, [string, string][]> = {
  lineclear: [
    ["U12", "Home and the Inbox"],
    ["U39", "The board review"],
    ["U40", "Motion from one source"],
    ["U41", "The film"],
    ["U42", "Shots"],
    ["U43", "Release gate"],
    ["U44", "Usage view"],
    ["L57", "Slots"],
    ["L58", "The CLI says its version"],
  ],
  webshop: [
    ["O1", "Exercise one"],
    ["O2", "Exercise two"],
    ["O3", "Exercise three"],
  ],
  budget: [
    ["B1", "Accounts"],
    ["B2", "Categories"],
    ["B3", "Charts"],
  ],
  kauppa: [
    ["K1", "Products"],
    ["K2", "Cart"],
    ["K3", "Checkout"],
  ],
};
const say = (...lines: string[]): never => {
  lines.forEach((l) => console.log(l));
  process.exit(0);
};
const fail = (m: string, code = 1): never => {
  console.log(`lineclear ${verb}: ${m}`);
  process.exit(code);
};
const project = (name: string) => {
  const r = resolveOne(
    "project",
    name,
    PROJECTS.map((p) => [p]),
  );
  return "error" in r ? fail(r.error) : r.name;
};

if (args.includes("--help") || args.includes("-h")) {
  const usage: Record<string, string> = {
    plan: 'usage: lineclear plan <project> "<goal>"',
    move: "usage: lineclear move <project> <step> --after <ids|none>",
    status: "usage: lineclear status [<project>] | lineclear status --plan [<task>]",
    inbox: "usage: lineclear inbox [--all] | lineclear inbox answer <n> <choice> [--note <text>]",
  };
  say(usage[verb ?? ""] ?? "usage: lineclear <command>, commands: status plan move inbox dispatcher");
}

if (verb === "dispatcher" && rest[0] === "projects") {
  say(
    "lineclear  /home/user/code/lineclear",
    "  Lineclear runs many software projects through an automated pipeline: a planner, workers and reviewers.",
    "  It only asks the owner for real decisions.",
    "webshop  /home/user/code/webshop",
    "  Webshop on suomenkielinen IT-laboratorion opas: harjoitukset, ohjeet ja sivut opiskelijoille.",
    "budget  /home/user/code/budget",
    "  Budget tracks household spending: accounts, categories, charts and a monthly report.",
    "kauppa  /home/user/code/kauppa",
    "  Kauppa on verkkokauppa: tuotteet, ostoskori, kassa, haku, asiakkaan tili ja tilaukset.",
  );
}
if (verb === "status" && rest[0] === "--plan") {
  const all = [
    'LIN-90  budget  "Add CSV export": the steps wait for your approval (Inbox 4). Live: /budget/roadmap/track?plan=LIN-90',
    'LIN-85  lineclear  "print the version": approved, the steps are in the roadmap. Live: /lineclear/roadmap/track?plan=LIN-85',
  ];
  const task = rest[1]?.toUpperCase();
  if (task === undefined) say(...all);
  const hit = all.filter((l) => l.startsWith(task!));
  if (hit.length === 0) fail(`no plan from task '${rest[1]}', nearest: 'LIN-90' and 'LIN-85'`);
  say(...hit);
}
if (verb === "status") {
  if (rest[0] === undefined)
    say(
      "2 things wait for you",
      "ok: webshop budget",
      "lineclear  L58 waits for U41; U41 at work (LIN-77)",
      "kauppa  roadmap broken, nothing starts: duplicate step K3",
    );
  const p = project(rest[0]!);
  say(`${p}  L58 waits for U41; U41 at work (LIN-77)`);
}
if (verb === "inbox" && rest.length === 0)
  say("1: Approve this roadmap change for budget? (Approve / Reject) from task LIN-90", "2: Merge LIN-85? (Merge / Not yet) from task LIN-85");
if (verb === "inbox") fail("only the owner answers the Inbox", 2);
if (verb === "plan") {
  if (rest.length !== 2) console.log('usage: lineclear plan <project> "<goal>"'), process.exit(2);
  const p = project(rest[0]!);
  say(
    `planning task LIN-91 started for ${p}; its steps come to the owner as one approval, in the chat and the Inbox.`,
    `live: /${p}/roadmap/track?plan=LIN-91`,
    "where it stands: lineclear status --plan LIN-91",
  );
}
if (verb === "move") {
  if (rest.length !== 4 || rest[2] !== "--after") console.log("usage: lineclear move <project> <step> --after <ids|none>"), process.exit(2);
  const p = project(rest[0]!);
  const steps = (STEPS[p] ?? []).map(([id, title]) => ({ id, title }));
  const step = resolveStep(rest[1]!, steps);
  if ("error" in step) fail(step.error);
  const after = rest[3]!.split(",").map((s) => (s.trim() === "none" ? { name: "none", loose: false } : resolveStep(s.trim(), steps)));
  for (const a of after) if ("error" in a) fail(a.error);
  const names = after.map((a) => ("name" in a ? a.name : ""));
  say(`inbox 7: Move ${"name" in step ? step.name : ""} in ${p} to come after ${names.join(", ")}? Nothing changes until the owner approves.`);
}
fail(`unknown command '${verb}', try 'lineclear --help'`, 2);
