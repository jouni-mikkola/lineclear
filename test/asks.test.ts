import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisesNext } from "../pi/nudge.ts";
import { saysDone, closedReports, openNeedCards, routeAsks, ruleFor } from "../src/asks.ts";
import { askKind, type Card, isIdle } from "../src/cards.ts";
import { inboxMain } from "../src/inbox-answer.ts";
import { addItem, closeItem, isOpen, readItems } from "../src/inbox.ts";
import { storedLogin } from "../server/server/live/secrets.ts";
import { allowanceReset } from "../src/zone.ts";
import { readWaits } from "../src/waits.ts";
import { tmp } from "./helpers.ts";

const temps: string[] = [];
afterEach(() => mock.restore());
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const limit: Card = {
  id: "a",
  task: "T-1",
  status: "need",
  text: "needs you: Waits for your reply",
  ask: { reply: { text: "You've hit your session limit · resets 8pm (Europe/Helsinki)" } },
};
const allowance: Card = { id: "b", task: "T-2", status: "need", text: "needs you: Out of allowance until 8:00:00 PM" };
const mergeChat: Card = {
  id: "c",
  task: "T-3",
  status: "need",
  text: "needs you: Waits for your reply",
  ask: { reply: { text: "`lineclear merge T-3` says each time that there is a new message in the chat." } },
};
const login = (q: string): Card => ({ id: "d", task: "T-4", status: "need", text: "needs you: x", ask: { questions: [{ title: q, kind: "Form" }] } });
const plan: Card = { id: "e", task: "T-5", status: "need", text: "x", ask: { questions: [{ title: "Plan for T-5", kind: "Plan" }] } };
const permission: Card = { id: "f", task: "T-6", status: "need", text: "x", ask: { questions: [{ title: "The terminal is waiting for you" }] } };
const question: Card = { id: "g", task: "T-7", status: "need", text: "x", ask: { questions: [{ title: "Which logo?", kind: "Question" }] } };
const report: Card = {
  id: "h",
  task: "T-8",
  status: "need",
  text: "needs you: Waits for your reply",
  ask: { reply: { text: "I stopped, the base is missing." } },
};

test("each card falls in one kind", () => {
  expect([limit, allowance, mergeChat, login("Log in to GitHub, done?"), plan, permission, question, report].map(askKind)).toEqual([
    "allowance",
    "allowance",
    "merge-chat",
    "login",
    "plan",
    "permission",
    "question",
    "report",
  ]);
});

test("a card with a question is not an allowance notice", () => {
  const q: Card = {
    id: "q",
    task: "T-9",
    status: "need",
    text: "x",
    ask: { questions: [{ title: "Plan: wait for the usage limit at 5pm?", kind: "Plan" }], reply: { text: "You've hit your session limit" } },
  };
  expect(askKind(q)).toBe("plan");
});

test("an allowance reset is the next such time, in the named zone or else the machine's", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  expect(allowanceReset("resets 8pm (Europe/Helsinki)", now)?.toISOString()).toBe("2026-10-30T18:00:00.000Z");
  expect(allowanceReset("resets 8pm (Europe/Helsinki)", new Date("2026-10-30T18:00:00Z"))?.toISOString()).toBe("2026-10-31T18:00:00.000Z");
  const local = allowanceReset("until 8:30:00 AM", now)!;
  expect([local.getHours(), local.getMinutes()]).toEqual([8, 30]);
  expect(local > now).toBe(true);
  expect(allowanceReset("no time here", now)).toBeUndefined();
  expect(allowanceReset("until 13pm", now)).toBeUndefined();
});

test("a login rule needs a stored pair that the question names", () => {
  const names = ["GITHUB_USER", "GITHUB_PASSWORD", "NPM_USER"];
  expect(storedLogin("Log in to GitHub in the browser", names)).toBe("GITHUB");
  expect(storedLogin("Log in to npm", names)).toBeUndefined();
  expect(storedLogin("Log in to Jira", names)).toBeUndefined();
  expect(storedLogin("Go on and log in", ["GO_USER", "GO_PASSWORD"])).toBeUndefined();
  expect(storedLogin("Log in to github or gitlab", [...names, "GITLAB_USER", "GITLAB_PASSWORD"])).toBeUndefined();
});

test("an open card is not one its task has spoken after", () => {
  const files = [
    {
      posted: [
        { at: 1, card: { id: "x", task: "T", status: "need" } },
        { at: 2, card: { id: "y", task: "T", status: "work" } },
        { at: 3, card: { id: "z", task: "U", status: "need" } },
      ],
    },
  ];
  expect(openNeedCards(files).map((n) => n.card.id)).toEqual(["z"]);
});

/** A config, a project and a Lineclear folder with one space and the given cards. */
function world(cards: Card[], secrets = "", postedAt = 1000) {
  const dir = tmp("asks");
  temps.push(dir);
  const config = join(dir, "config");
  const shep = join(dir, "lineclear");
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  mkdirSync(join(shep, "chatlog"), { recursive: true });
  writeFileSync(
    join(config, "projects", "demo", "settings.json"),
    JSON.stringify({ repo: dir, space: "Demo", check: "true", models: { worker: [], reviewer: [] } }),
  );
  if (secrets) {
    mkdirSync(join(dir, "main"), { recursive: true });
    const all = Object.fromEntries([...secrets.matchAll(/^(\w+)='(.*)'$/gm)].map(([, name, value]) => [name, { value, at: 1 }]));
    writeFileSync(join(dir, "main", "vault.json"), JSON.stringify({ all }));
  }
  writeFileSync(join(shep, "spaces.json"), JSON.stringify([{ name: "Demo", key: "T", path: dir }]));
  cards.forEach((card, i) =>
    writeFileSync(join(shep, "chatlog", `${card.task}_Agent.json`), JSON.stringify({ posted: [{ at: postedAt + i, id: card.id, card }] })),
  );
  // dataDir prefers LINECLEAR_HOME, which another test file may have set for a moment: pin it to this world
  const env = {
    ...process.env,
    LINECLEAR_CONFIG: config,
    LINECLEAR_HOME: shep,
    LINECLEAR_MAIN_HOME: join(dir, "main"),
  };
  const told: string[] = [];
  const tell = (task: string, text: string) => (told.push(`${task}: ${text}`), undefined);
  const route = (idle?: Parameters<typeof routeAsks>[6], now = new Date()) => routeAsks("demo", "Demo", tell, now, false, env, idle);
  return { env, told, tell, config, route };
}

test("an allowance card becomes an until wait, once", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const w = world([limit], "", now.getTime() - 60_000);
  const first = routeAsks("demo", "Demo", w.tell, now, false, w.env);
  expect(first).toEqual(["T-1 waits until 2026-10-30T18:00:00.000Z: out of allowance"]);
  const wait = readWaits(w.env).find((x) => x.task === "T-1")!;
  expect([wait.kind, wait.project, wait.until]).toEqual(["until", "demo", "2026-10-30T18:00:00.000Z"]);
  expect(routeAsks("demo", "Demo", w.tell, now, false, w.env)).toEqual([]);
});

test("an allowance card read after its reset makes no wait: the reset is read from when it was posted", () => {
  const posted = new Date("2026-10-30T17:57:00Z");
  const w = world([limit], "", posted.getTime());
  expect(routeAsks("demo", "Demo", w.tell, new Date("2026-10-30T18:00:30Z"), false, w.env)).toEqual([]);
  expect(readWaits(w.env).find((x) => x.task === "T-1")).toBeUndefined();
  expect(w.told).toEqual([]);
});

test("a merge card is told to read its chat and merge again", () => {
  const w = world([mergeChat]);
  expect(routeAsks("demo", "Demo", w.tell, new Date("2026-10-30T12:00:00Z"), false, w.env)).toEqual(["T-3 was told how to go on (merge-chat)"]);
  expect(w.told[0]).toContain("lineclear merge");
});

test("a login card is told the stored login, and goes to the Inbox when there is none", () => {
  const w = world([login("Log in to GitHub, done?")], "GITHUB_USER='u'\nGITHUB_PASSWORD='hunter2'\n");
  expect(routeAsks("demo", "Demo", w.tell, new Date(), false, w.env)).toEqual(["T-4 was told how to go on (login)"]);
  expect(w.told[0]).toContain("GITHUB_USER");
  expect(w.told[0]).not.toContain("hunter2");
  expect(w.told[0]).not.toContain("lineclear totp");
  const coded = world([login("Log in to GitHub, done?")], "GITHUB_USER='u'\nGITHUB_PASSWORD='p'\nGITHUB_TOTP='k'\n");
  routeAsks("demo", "Demo", coded.tell, new Date(), false, coded.env);
  expect(coded.told[0]).toContain("lineclear totp GITHUB");
  const none = world([login("Log in to GitHub, done?")]);
  expect(routeAsks("demo", "Demo", none.tell, new Date(), false, none.env)).toEqual([]);
  expect(ruleFor(plan, "demo", new Date(), none.env)).toMatchObject({ kind: "tell" });
  expect(ruleFor(permission, "demo", new Date(), none.env)).toBeUndefined();
});

test("a dry run changes nothing, and a failed tell is tried again", () => {
  const w = world([mergeChat]);
  expect(routeAsks("demo", "Demo", w.tell, new Date(), true, w.env)).toEqual(["would answer T-3 (merge-chat) by a rule"]);
  expect(w.told).toEqual([]);
  expect(routeAsks("demo", "Demo", () => "boom", new Date(), false, w.env)[0]).toContain("could not answer T-3: boom");
  expect(existsSync(join(w.config, "projects", "demo", "asks-told.json"))).toBe(false);
  expect(routeAsks("demo", "Demo", w.tell, new Date(), false, w.env)).toHaveLength(1);
});

test("a tick reads no archived chat, parses an unchanged live chat 0 times and rewrites nothing", () => {
  const w = world([mergeChat]);
  const shep = w.env.LINECLEAR_HOME ?? "";
  mkdirSync(join(shep, "archive", "chatlog"), { recursive: true });
  for (let i = 0; i < 200; i++) {
    const card = { ...mergeChat, id: `old${i}`, task: `T-${100 + i}` };
    writeFileSync(join(shep, "archive", "chatlog", `T-${100 + i}_Agent.json`), JSON.stringify({ posted: [{ at: 1, id: card.id, card }] }));
  }
  const now = new Date("2026-10-30T12:00:00Z");
  expect(routeAsks("demo", "Demo", w.tell, now, false, w.env)).toEqual(["T-3 was told how to go on (merge-chat)"]);
  expect(w.told).toHaveLength(1); // the 200 archived cards were not answered
  const told = join(w.config, "projects", "demo", "asks-told.json");
  const wrote = readFileSync(told, "utf8");
  const parse = JSON.parse;
  let parses = 0;
  const spy = spyOn(JSON, "parse").mockImplementation(((text: string, ...rest: []) => {
    if (String(text).includes("merge-chat") || String(text).includes("Waits for your")) parses++;
    return parse(text, ...rest);
  }) as typeof JSON.parse);
  try {
    expect(routeAsks("demo", "Demo", w.tell, now, false, w.env)).toEqual([]);
  } finally {
    spy.mockRestore();
  }
  expect(parses).toBe(0);
  expect(readFileSync(told, "utf8")).toBe(wrote);
});

test("a report of a done task closes by a rule and a question is answered by a rule", () => {
  const w = world([report, question]);
  const done: Card = { id: "d8", task: "T-8", status: "done", text: "done" };
  writeFileSync(join(w.env.LINECLEAR_HOME!, "chatlog", "T-8_Done.json"), JSON.stringify({ posted: [{ at: 5000, id: "d8", card: done }] }));
  const files = [
    {
      posted: [
        { at: 1007, card: report },
        { at: 1008, card: question },
        { at: 5000, card: done },
      ],
    },
  ];
  expect(closedReports(files).map((n) => n.card.id)).toEqual(["h"]);
  // a step question is answered by a written rule, never left for the owner
  expect(routeAsks("demo", "Demo", w.tell, new Date(), false, w.env)).toEqual([
    "closed the report of T-8: its task is done",
    "T-7 was told how to go on (question)",
  ]);
  expect(w.told[0]).toContain("The owner is not asked a step question.");
  expect(routeAsks("demo", "Demo", w.tell, new Date(), false, w.env)).toEqual([]);
});

const idleCard = (task: string, id: string, reply: string): Card => ({
  id,
  task,
  status: "need",
  text: "needs you: Waits for your reply",
  ask: { reply: { text: reply } },
});

test("an idle task that says it is done with nothing changed goes to Done", () => {
  const w = world([idleCard("T-1", "i1", "Released 1.0. Nothing more to do.")]);
  const closed: string[] = [];
  const idle = { clean: () => true, close: (t: string) => (closed.push(t), undefined) };
  expect(w.route(idle)).toEqual(["T-1 is Done, nothing to merge: its agent finished with no changes"]);
  expect(closed).toEqual(["T-1"]);
  expect(w.told).toEqual([]);
});

test("an idle task with changes, or with no sign it is done, is nudged", () => {
  const w = world([idleCard("T-1", "i1", "Released 1.0."), idleCard("T-2", "i2", "Hmm, ok.")]);
  const closed: string[] = [];
  const idle = { clean: (t: string) => t === "T-2", close: (t: string) => (closed.push(t), undefined) };
  const out = w.route(idle);
  expect(out).toHaveLength(2);
  expect(w.told.map((l) => l.split(":")[0])).toEqual(["T-1", "T-2"]);
  expect(w.told[0]).toContain("lineclear wait owner");
  expect(closed).toEqual([]);
});

test("each quiet turn is nudged, three an hour, then the next is left alone", () => {
  const w = world([idleCard("T-1", "i1", "Hmm, ok.")]);
  const idle = { clean: () => false, close: () => undefined };
  const turn = (n: number) => {
    writeFileSync(
      join(w.env.LINECLEAR_HOME!, "chatlog", `T-1_${n}.json`),
      JSON.stringify({ posted: [{ at: 2000 + n, id: `q${n}`, card: idleCard("T-1", `q${n}`, "Still here.") }] }),
    );
    return w.route(idle, new Date(start + n * 60_000));
  };
  // a fixed clock: nudges are keyed by the millisecond, so real time would make same-ms rounds collapse into one
  const start = Date.now();
  w.route(idle, new Date(start));
  expect(turn(1)).toHaveLength(1);
  expect(turn(2)).toHaveLength(1);
  expect(w.told).toHaveLength(3);
  expect(turn(3)).toHaveLength(0);
  expect(w.told).toHaveLength(3);
  expect(turn(4)).toHaveLength(0);
  expect(w.told).toHaveLength(3);
});

test("a quiet turn in Merging is told to merge again, the second is left alone", () => {
  const w = world([idleCard("T-1", "i1", "Merged. Nothing more to do.")]);
  const shep = w.env.LINECLEAR_HOME ?? "";
  writeFileSync(join(shep, "tasks.json"), JSON.stringify({ tasks: [{ id: "T-1", status: "merging" }] }));
  // a nudge from Work earlier in the hour does not count against the merge
  writeFileSync(join(w.config, "projects", "demo", "asks-told.json"), JSON.stringify([`nudge:T-1@${Date.now() - 60_000}`]));
  const idle = { clean: () => true, close: () => undefined };
  // a fixed clock: nudges are keyed by the millisecond, so real time would let the rounds depend on the machine's speed
  const start = Date.now();
  // a clean worktree and a reply that says merged is still not Done while the merge runs
  expect(w.route(idle, new Date(start))[0]).toContain("nudged");
  expect(w.told).toHaveLength(1);
  expect(w.told[0]).toContain("`lineclear merge T-1` again");
  writeFileSync(join(shep, "chatlog", "T-1_2.json"), JSON.stringify({ posted: [{ at: 2000, id: "q2", card: idleCard("T-1", "q2", "Still merging.") }] }));
  expect(w.route(idle, new Date(start + 60_000))).toEqual([]);
  expect(w.told).toHaveLength(1);
});

test("a quiet turn after a nudge is answered in each of three ways", () => {
  const replies = ["", "I'll keep calling `lineclear merge T-2` until it goes through.", "I set a wait on it."];
  const w = world(replies.map((r, i) => idleCard(`T-${i + 1}`, `q${i}`, r)));
  const earlier = (i: number) => `nudge:T-${i + 1}@${Date.now() - 600_000}`;
  writeFileSync(join(w.config, "projects", "demo", "asks-told.json"), JSON.stringify(replies.map((_, i) => earlier(i))));
  const out = w.route({ clean: () => true, close: () => undefined });
  expect(out).toHaveLength(3);
  expect(w.told.map((l) => l.split(":")[0])).toEqual(["T-1", "T-2", "T-3"]);
  expect(w.told[1]).toContain("Run that action now");
  expect(out.every((l) => l.includes("2 of 3"))).toBe(true);
  expect(promisesNext("I'll check again.")).toBe(true);
  expect(promisesNext("Merged.")).toBe(false);
  expect(promisesNext("Done. CI will run on main.")).toBe(false);
});

test("a question in plain text is not idle, and a negated done is not done", () => {
  expect(isIdle(idleCard("T-1", "q", "Keep the old API around?"))).toBe(false);
  expect(isIdle(idleCard("T-1", "q", "All done."))).toBe(true);
  expect(saysDone("It is not done yet.")).toBe(false);
  expect(saysDone("Released 1.0.")).toBe(true);
});

test("an ordinary question at the end of a turn is bounced back once, and never reaches the Inbox", () => {
  const w = world([idleCard("T-1", "q1", "Tests fail on main. Merge despite failing tests?"), idleCard("T-2", "q2", "Should the card show the date?")]);
  const idle = { clean: () => false, close: () => undefined };
  const out = w.route(idle);
  expect(out).toHaveLength(2);
  expect(w.told).toHaveLength(2);
  expect(w.told[0]).toContain("Decide yourself by the brief");
  expect(w.told.map((l) => l.split(":")[0])).toEqual(["T-1", "T-2"]);
  expect(w.route(idle)).toEqual([]);
  expect(w.told).toHaveLength(2);
});

test("a question about a login code, money or something that leaves is not bounced back", () => {
  const w = world([
    idleCard("T-1", "q1", "The site wants a verification code. What is it?"),
    idleCard("T-2", "q2", "Publish the release now?"),
    idleCard("T-3", "q3", "May I pay for more credit beyond the budget?"),
  ]);
  expect(w.route({ clean: () => false, close: () => undefined })).toEqual([]);
  expect(w.told).toEqual([]);
});

test("a task's two cards in the coordinator chat: the kept merge is an Inbox item, the other is answered by rule and closes", () => {
  const w = world([]);
  const shep = w.env.LINECLEAR_HOME as string;
  const ask = (id: string, title: string) => ({ at: 1000, id, question: { id, title, kind: "Form", choices: [{ label: "Merge it" }, { label: "Not yet" }] } });
  writeFileSync(
    join(shep, "chatlog", "p_host_Demo.json"),
    JSON.stringify({ posted: [ask("ask:m", "Merge T-3?"), ask("ask:w", "Why has T-3's merge not gone through?")], answers: {} }),
  );
  const tasks = [
    { id: "T-3", desc: "Do it.\n\nSettings:\n- Merge: ask me first. Ask the human first." },
    { id: "T-4", desc: "- Merge: on its own." },
  ];
  writeFileSync(join(shep, "tasks.json"), JSON.stringify({ tasks }));
  const closed: string[] = [];
  const close = (space: string, id: string, text: string) => {
    closed.push(`${space} ${id}: ${text}`);
    return undefined;
  };
  const route = () => routeAsks("demo", "Demo", w.tell, new Date(), false, w.env, undefined, close);
  expect(route()).toEqual(["T-3's coordinator card is in the Inbox: Merge T-3?", "T-3's coordinator card was answered by a rule (question)"]);
  const open = readItems(w.env).filter(isOpen);
  expect(open).toMatchObject([{ kind: "choice", task: "T-3", question: "Merge T-3?", choices: ["Merge it", "Not yet"], card: { space: "Demo", id: "ask:m" } }]);
  expect(w.told).toHaveLength(1);
  expect(closed).toHaveLength(1);
  expect(closed[0]).toStartWith("Demo ask:w: ");
  // neither is routed twice
  expect(route()).toEqual([]);
  expect(readItems(w.env)).toHaveLength(1);
  // reworded asks for a go, and a question about leaving the machine, are the owner's too
  writeFileSync(
    join(shep, "chatlog", "p_host_Demo.json"),
    JSON.stringify({ posted: [ask("ask:a", "Approve T-3's merge?"), ask("ask:p", "Publish T-3's release to npm?")], answers: { "ask:m": -1 } }),
  );
  expect(route()).toEqual([
    "T-3's coordinator card is in the Inbox: Approve T-3's merge?",
    "T-3's coordinator card is in the Inbox: Publish T-3's release to npm?",
  ]);
  expect(readItems(w.env).map((i) => i.kind)).toEqual(["choice", "choice", "outward"]);
  // a card in a task's own chat is not a coordinator card
  writeFileSync(join(shep, "chatlog", "T-3_Agent.json"), JSON.stringify({ posted: [ask("ask:own", "Merge T-3?")], answers: {} }));
  expect(route()).toEqual([]);
  // a reworded ask for a merge is still the owner's
  writeFileSync(join(shep, "chatlog", "p_host_Demo.json"), JSON.stringify({ posted: [ask("ask:r", "Ready to merge T-3?")], answers: { "ask:m": -1 } }));
  expect(route()).toEqual(["T-3's coordinator card is in the Inbox: Ready to merge T-3?"]);
  // a failed close is tried again, and the task is not told twice
  const again = world([]);
  const againDir = again.env.LINECLEAR_HOME as string;
  writeFileSync(
    join(againDir, "chatlog", "p_host_Demo.json"),
    JSON.stringify({ posted: [ask("ask:w", "Why has T-4's merge not gone through?")], answers: {} }),
  );
  writeFileSync(join(againDir, "tasks.json"), JSON.stringify({ tasks }));
  const failing = () => routeAsks("demo", "Demo", again.tell, new Date(), false, again.env, undefined, () => "boom");
  expect(failing()).toEqual(["could not answer T-4: boom"]);
  expect(failing()).toEqual(["could not answer T-4: boom"]);
  expect(again.told).toHaveLength(1);
});

test("answering the Inbox item answers its card, and closing the item closes it too", () => {
  const w = world([]);
  const log = join(w.config, "lineclear-calls");
  const bin = join(w.config, "lineclear");
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${log}"\n`);
  chmodSync(bin, 0o755);
  const env = { ...w.env, LINECLEAR_SERVER_BIN: bin };
  const item = (question: string, id: string) =>
    addItem(
      {
        kind: "choice",
        task: "T-3",
        project: "demo",
        question,
        choices: ["Merge it", "Not yet"],
        card: { space: "Demo", id },
        since: new Date().toISOString(),
      },
      env,
    );
  const first = item("Merge T-3?", "ask:m");
  expect(inboxMain(["answer", String(first.n), "Merge it"], () => {}, env)).toBe(0);
  const second = item("Merge T-3 now?", "ask:n");
  closeItem(second, "its task is done", new Date(), env);
  expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
    `task tell T-3 Your answer to "Merge T-3?": Merge it. Go on.`,
    "answer ask:m Merge it --space Demo",
    "answer ask:n Closed: its task is done. --space Demo",
  ]);
});

test("a push to approve is not the owner's when any login has a stored TOTP", () => {
  const push = login("Approve the Microsoft sign-in on your phone, number 65");
  const w = world([push], "M365_GA_TOTP='k'\n");
  expect(routeAsks("demo", "Demo", w.tell, new Date(), false, w.env)).toEqual(["T-4 was told how to go on (login)"]);
  expect(w.told[0]).toContain("M365_GA_TOTP is stored");
  expect(w.told[0]).toContain("lineclear totp M365_GA");
  expect(w.told[0]).toContain("verification code");
  const mixed = world([login("Log in to GitHub, done?")], "GITHUB_USER='u'\nGITHUB_PASSWORD='p'\nGITHUB_TOTP='k'\n");
  routeAsks("demo", "Demo", mixed.tell, new Date(), false, mixed.env);
  expect(mixed.told[0]).toContain("lineclear totp GITHUB");
  const none = world([push]);
  expect(routeAsks("demo", "Demo", none.tell, new Date(), false, none.env)).toEqual([]);
});
