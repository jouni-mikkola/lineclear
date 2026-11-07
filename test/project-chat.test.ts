// A task's ask and owner wait land in its project's chat; a question the roadmap answers gets a rule's answer and no owner push.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { routeAsks } from "../src/asks.ts";
import { askMain, readItems } from "../src/inbox.ts";
import { waitsMain } from "../src/waits.ts";
import { setup } from "./rules-world.ts";

test("ask and wait owner post a card in the project's chat, and a question the roadmap answers reaches no owner", async () => {
  const t = setup();
  const home = t.env.LINECLEAR_HOME;
  mkdirSync(join(home, "chatlog"), { recursive: true });
  writeFileSync(join(home, "spaces.json"), JSON.stringify([{ name: "demo", key: "LIN" }]));
  writeFileSync(join(home, "tasks.json"), JSON.stringify({ tasks: [{ id: "LIN-8" }, { id: "LIN-9" }] }));
  writeFileSync(join(home, "chatlog", "p_host_demo.json"), JSON.stringify({ posted: [], answers: {} }));
  const posted: { at: number; id: string; question: object }[] = [];
  const post = (chat: string, title: string, choices: string[]) => {
    expect(chat).toBe("p_host_demo");
    const id = `ask:${posted.length}`;
    posted.push({ at: 1000 + posted.length, id, question: { id, title, kind: "Form", choices: choices.map((label) => ({ label })) } });
    writeFileSync(join(home, "chatlog", "p_host_demo.json"), JSON.stringify({ posted, answers: {} }));
    return undefined;
  };
  const env = { ...t.env, LINECLEAR_TASK: "LIN-9" };
  const at = () => t.now.at;
  expect(askMain(["Push X?", "--choice", "Go", "--choice", "Not yet", "--kind", "outward"], () => {}, env, t.repo, at, post)).toBe(0);
  expect(await waitsMain("wait", ["owner", "--kind", "login", "A captcha waits"], () => {}, env, t.repo, at, post)).toBe(0);
  expect(readItems(t.env)).toEqual([]);

  // a question the roadmap answers is refused by `lineclear ask`: no card, no item, no wait
  const lines: string[] = [];
  expect(askMain(["Which reviewer?", "--choice", "a", "--choice", "b"], (l) => lines.push(l), { ...t.env, LINECLEAR_TASK: "LIN-8" }, t.repo, at, post)).toBe(1);
  expect(lines.join("\n")).toContain("first model of another company");
  expect(posted).toHaveLength(2);
  // the same question from a task that declared no owner wait, asked in the chat by hand
  post("p_host_demo", "LIN-8: Which reviewer should I use?", ["a", "b"]);
  const told: string[] = [];
  const tell = (task: string, text: string) => (told.push(`${task}: ${text}`), undefined);
  routeAsks("demo", "demo", tell, new Date(), false, t.env, undefined, () => undefined);
  expect(told).toHaveLength(1);
  expect(told[0]).toStartWith("LIN-8: The owner is not asked a step question.");
  // only LIN-9's two owner matters became Inbox items, which is the owner's push
  expect(readItems(t.env).map((i) => i.task)).toEqual(["LIN-9", "LIN-9"]);
});
