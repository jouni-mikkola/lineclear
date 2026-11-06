// lineclear wait, ask, inbox and check on a project of the rules tests (rules-world.ts).
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inboxMain } from "../src/inbox-answer.ts";
import { askMain, readItems } from "../src/inbox.ts";
import { parseUntil } from "../src/waits.ts";
import { run, setup, status, step, waitsOf } from "./rules-world.ts";

test("each wait kind is declared, shows in status and ends with resume", async () => {
  const t = setup();
  for (const kind of ["owner", "login", "checks", "browser"]) {
    const why = kind === "owner" || kind === "login" ? `ZED_TOTP is not stored, why ${kind}` : `why ${kind}`;
    expect((await run(t, "wait", kind === "owner" ? [kind, "--kind", "login", why] : [kind, why])).code).toBe(0);
    expect(waitsOf(t)[0]).toMatchObject({ task: "LIN-9", project: "demo", kind, reason: why });
    expect(await status(t)).toContain(`LIN-9 ${kind === "checks" ? "paused, waits" : "waits"} for ${kind}: ${why}`);
    expect((await run(t, "resume", [])).code).toBe(0);
    expect(waitsOf(t)).toHaveLength(0);
  }
  expect((await run(t, "wait", ["coffee", "x"])).code).toBe(2);
  expect((await run(t, "wait", ["owner", "--kind", "login", ""])).code).toBe(2);
  expect((await run(t, "resume", [])).code).toBe(1);
});

const ask = (t: ReturnType<typeof setup>, args: string[], task = "LIN-9") => {
  const lines: string[] = [];
  const code = askMain(
    args,
    (l) => lines.push(l),
    { ...t.env, LINECLEAR_TASK: task },
    t.repo,
    () => t.now.at,
  );
  return { code, text: lines.join("\n") };
};
const inbox = (t: ReturnType<typeof setup>, args: string[]) => {
  const lines: string[] = [];
  const code = inboxMain(args, (l) => lines.push(l), t.env);
  return { code, text: lines.join("\n") };
};

test("an outward ask for an action on this machine alone reaches no owner: the three asks of L243", () => {
  const t = setup();
  for (const q of [
    "Record a real power cut of the laptop.",
    "Do one real power cut of a machine with lingering on, at a time the owner chooses.",
    "Reboot this machine now, to record the boot.",
  ]) {
    const r = ask(t, [q, "--choice", "Go", "--choice", "Not yet", "--kind", "outward"]);
    expect(r.code).toBe(1);
    expect(r.text).toContain("sends nothing off the machine");
  }
  expect(readItems(t.env)).toHaveLength(0);
  expect(waitsOf(t)).toHaveLength(0);
  // what really leaves the machine still reaches the owner
  expect(ask(t, ["Publish the release after a reboot?", "--choice", "Go", "--choice", "No", "--kind", "outward"]).code).toBe(0);
});

test("ask adds an Inbox item, calls no lineclear alert, and declares a wait; no lineclear ask card", () => {
  const t = setup();
  expect(ask(t, ["Which one?", "--choice", "a", "--choice", "b", "--kind", "outward"]).code).toBe(0);
  expect(t.calls()).toEqual([]);
  expect(readItems(t.env)[0]).toMatchObject({ n: 1, kind: "outward", task: "LIN-9", project: "demo" });
  expect(waitsOf(t)[0]).toMatchObject({ kind: "owner", reason: "asked: Which one?" });
  expect(ask(t, ["Only one?", "--choice", "a"]).code).toBe(2);
  expect(ask(t, ["Q?", "--choice", "a", "--choice", "b", "--kind", "nope"]).code).toBe(2);
  expect(t.calls()).toHaveLength(0);
  // a step question, a plan or a stuck task is never the owner's: the agent gets the written rule
  for (const k of ["step", "plan", "stuck"]) {
    const r = ask(t, ["Merge now or wait?", "--choice", "Merge", "--choice", "Wait", "--kind", k]);
    expect(r.code).toBe(1);
    expect(r.text).toContain("Merge now when your check and your review passed");
  }
  expect(ask(t, ["Which reviewer?", "--choice", "a", "--choice", "b"]).text).toContain("first model of another company");
  expect(ask(t, ["Is the flaky test ok?", "--choice", "a", "--choice", "b"]).text).toContain("Run the test once more");
  expect(t.calls()).toHaveLength(0);
  // The order the brief template gives: flags first, the question after.
  expect(ask(t, ["--kind", "outward", "Push X?", "--choice", "Go", "--choice", "Not yet"], "LIN-8").code).toBe(0);
  expect(readItems(t.env)[1]).toMatchObject({ kind: "outward", question: "Push X?" });
});

test("an agent asks the owner only a login or an outward action, and each shows in the list", () => {
  const t = setup();
  const kinds = ["login", "outward"] as const;
  for (const [i, k] of kinds.entries())
    ask(t, [`Q ${k}?`, "--choice", "Yes", "--choice", "No", "--kind", k, ...(k === "login" ? ["--login", "ZED"] : [])], `LIN-${i + 1}`);
  expect(readItems(t.env).map((i) => i.kind)).toEqual([...kinds]);
  const list = inbox(t, []).text;
  for (const k of kinds) expect(list).toContain(`Q ${k}?`);
  expect(list).toContain("playwright-cli -s=LIN-1 show"); // the login item names the browser session
  expect(readItems(t.env)[0]?.session).toBe("LIN-1");
  expect(inbox(t, []).code).toBe(0);
});

test("an answer reaches its task with task tell, ends its wait, and closes the item", () => {
  const t = setup();
  ask(t, ["Push to the other repo?", "--choice", "Go", "--choice", "Not yet", "--kind", "outward"]);
  expect(inbox(t, ["answer", "1", "maybe"]).code).toBe(2);
  expect(inbox(t, ["answer", "9", "Go"]).code).toBe(1);
  const r = inbox(t, ["answer", "1", "go"]);
  expect(r.code).toBe(0);
  expect(t.calls()[0]).toStartWith('task tell LIN-9 Your answer to "Push to the other repo?": Go');
  expect(waitsOf(t)).toHaveLength(0);
  expect(inbox(t, []).text).toBe("The Inbox is empty.");
  expect(inbox(t, ["answer", "1", "Go"]).code).toBe(1); // already answered
  expect(t.calls()).toHaveLength(1);
});

test("a timed wait: the loop stops the task, holds no slot, and wakes it at the time", async () => {
  const t = setup({ steps: [step("A", "none")], max: 1, tasks: [{ id: "LIN-9", title: "Z z", status: "work" } as never] });
  expect((await run(t, "wait", ["until", "+2h", "trial"])).code).toBe(0);
  expect((parseUntil("+2h", t.now.at)?.getTime() ?? 0) - t.now.at.getTime()).toBe(7_200_000);
  const first = t.doTick();
  expect(first.map((d) => `${d.step}:${d.kind}`)).toEqual(["LIN-9:stop", "A:start"]); // the sleeper holds no slot
  expect(t.calls()).toEqual(["task stop LIN-9"]);
  expect(waitsOf(t)[0]?.stopped).toBe(true);
  t.doTick();
  expect(t.calls()).toHaveLength(1); // not stopped twice
  t.now.at = new Date(t.now.at.getTime() + 3 * 3_600_000);
  const woke = t.doTick();
  expect(woke[0]).toMatchObject({ step: "LIN-9", kind: "wake" });
  expect(t.calls()[1]).toStartWith("task tell LIN-9 [lineclear:resume] Your wait until");
  expect(waitsOf(t)).toHaveLength(0);
  expect((await run(t, "wait", ["until", "nonsense", "x"])).code).toBe(2);
});

test("a task wait: refuses an unknown task, holds while the other works, wakes when it is done", async () => {
  const t = setup({ steps: [], tasks: [{ id: "LIN-21", title: "Pilot", status: "work" } as never] });
  expect((await run(t, "wait", ["task", "LIN-99", "need it"])).code).toBe(2);
  expect(waitsOf(t)).toHaveLength(0);
  expect((await run(t, "wait", ["task", "LIN-21", "need its merge"])).code).toBe(0);
  expect(waitsOf(t)[0]).toMatchObject({ task: "LIN-9", project: "demo", kind: "task", for: "LIN-21", reason: "need its merge" });
  expect(t.doTick().filter((d) => d.kind === "wake")).toHaveLength(0);
  expect(t.calls()).toHaveLength(0);
  expect(waitsOf(t)).toHaveLength(1);
  writeFileSync(join(t.fake, "tasks.json"), JSON.stringify([{ id: "LIN-21", title: "Pilot", status: "done" }]));
  const woke = t.doTick().filter((d) => d.kind === "wake");
  expect(woke).toHaveLength(1);
  expect(woke[0]).toMatchObject({ step: "LIN-9", kind: "wake" });
  expect(t.calls()[0]).toStartWith("task tell LIN-9 [lineclear:resume] Task LIN-21 is done");
  expect(waitsOf(t)).toHaveLength(0);
});

test("a wait for the owner without a kind is refused, and so is a kind that is not one of the three", async () => {
  const t = setup();
  for (const args of [
    ["owner", "should the card show X?"],
    ["owner", "--kind", "design", "x"],
    ["owner", "--kind"],
  ]) {
    const r = await run(t, "wait", args);
    expect(r.code).toBe(2);
    expect(r.text).toContain("a wait for the owner needs a kind: --kind login|money|outward");
    expect(waitsOf(t)).toHaveLength(0);
  }
  for (const k of ["login", "money", "outward"]) {
    expect((await run(t, "wait", ["owner", "--kind", k, "ZED_TOTP is not stored"])).code).toBe(0);
    expect(waitsOf(t)[0]).toMatchObject({ kind: "owner", ownerKind: k });
    await run(t, "resume", []);
  }
});

/** Stores logins where every task of the project can load them. */
function storeLogins(t: ReturnType<typeof setup>, values: Record<string, string>) {
  const home = t.env.LINECLEAR_HOME as string;
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "vault.json"), JSON.stringify({ all: Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value, at: 1 }])) }));
}

test("an ask or a wait about a login with a loadable TOTP is refused, and one without names the missing NAME", () => {
  const t = setup();
  storeLogins(t, { M365_GA_TOTP: "JBSWY3DPEHPK3PXP" });
  expect(ask(t, ["Approve the push for ZZ", "--choice", "Done", "--choice", "No", "--kind", "login", "--login", "ZZ"], "LIN-7").code).toBe(0);
  const push = ["Approve the push, number 65?", "--choice", "Done", "--choice", "No", "--kind", "login"];
  const refused = ask(t, [...push, "--login", "M365_GA"]);
  expect(refused.code).toBe(1);
  expect(refused.text).toContain("M365_GA_TOTP is stored");
  expect(refused.text).not.toContain("JBSWY3DPEHPK3PXP");
  // a push with a TOTP stored anywhere is the agent's to answer, even if it names no login
  expect(ask(t, push).code).toBe(1);
  expect(readItems(t.env)).toHaveLength(1);
  // a login with no stored TOTP may be asked, and the item says which NAME is missing
  // another login's TOTP does not decide this login, and a captcha is the owner's
  expect(ask(t, ["Approve the push for Jira", "--choice", "Done", "--choice", "No", "--kind", "login", "--login", "JIRA"]).code).toBe(0);
  expect(ask(t, ["M365 GA shows a captcha, solve it?", "--choice", "Done", "--choice", "No", "--kind", "login", "--login", "M365_GA"], "LIN-8").code).toBe(0);
  // a TOTP exists and the ask names no login: the agent uses it
  expect(ask(t, ["Sign in to Entra, done?", "--choice", "Done", "--choice", "No", "--kind", "login"]).code).toBe(1);
  expect(ask(t, ["Sign in to Jira, done?", "--choice", "Done", "--choice", "No", "--kind", "login", "--login", "JIRA"]).code).toBe(0);
  expect(readItems(t.env).at(-1)?.question).toBe("JIRA_TOTP is not stored. Sign in to Jira, done?");
});

test("a login wait for the owner is refused when the TOTP is loadable, and must name the missing NAME", async () => {
  const t = setup();
  storeLogins(t, { M365_GA_TOTP: "JBSWY3DPEHPK3PXP" });
  const refused = await run(t, "wait", ["owner", "--kind", "login", "M365_GA_TOTP is not stored"]);
  expect(refused.code).toBe(1);
  expect(refused.text).toContain("lineclear totp M365_GA");
  expect((await run(t, "wait", ["owner", "--kind", "login", "Approve the push, number 65"])).code).toBe(1);
  // no login named and a TOTP stored: sent back to it
  const entra = await run(t, "wait", ["owner", "--kind", "login", "Sign in to Entra"]);
  expect(entra.code).toBe(1);
  expect(entra.text).toContain("lineclear totp M365_GA");
  expect((await run(t, "wait", ["owner", "--kind", "login", "JIRA_TOTP is not stored"])).code).toBe(0);
  // the plain login wait is the same door, and a captcha stays the owner's
  expect((await run(t, "wait", ["login", "Approve the push, number 65"])).code).toBe(1);
  expect((await run(t, "wait", ["login", "M365_GA shows a captcha"])).code).toBe(0);
});

test("a login wait is sent back to a stored USER and PASSWORD login its text names, and reaches the owner when none matches", async () => {
  const t = setup();
  storeLogins(t, { JIRA_USER: "me", JIRA_PASSWORD: "hunter2hunter2" });
  const sent = await run(t, "wait", ["owner", "--kind", "login", "Sign in to Jira"]);
  expect(sent.code).toBe(1);
  expect(sent.text).toContain("a stored login exists: JIRA");
  expect(sent.text).toContain("lineclear secret run");
  expect(sent.text).not.toContain("hunter2");
  expect(sent.text).not.toContain("lineclear totp");
  // no stored login matches the site and no TOTP exists: the wait must say what is missing, and then it stands
  expect((await run(t, "wait", ["owner", "--kind", "login", "Sign in to Entra"])).code).toBe(2);
  expect((await run(t, "wait", ["owner", "--kind", "login", "ENTRA_TOTP is not stored"])).code).toBe(0);
});
