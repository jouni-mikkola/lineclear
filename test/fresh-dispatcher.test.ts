import { expect, test } from "bun:test";
import freshDispatcher, { sinceLastRequest } from "../pi/fresh-dispatcher.ts";

const user = (text: string) => ({ role: "user", content: text });
const bot = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
const history = [user("one"), bot("a"), user("two"), bot("b"), { role: "toolResult", content: [] }];

test("the session is cut to the latest request and what came after it", () => {
  expect(sinceLastRequest(history).map((m) => m.role)).toEqual(["user", "assistant", "toolResult"]);
  expect(sinceLastRequest(history)[0]!.content).toBe("two");
});

test("a card answer keeps the request it answers", () => {
  const asked = [
    user("one"),
    bot("a"),
    user("add dark mode"),
    bot("which project?"),
    user('<answer from="Elias" question="Which project?">webshop</answer>'),
    bot("b"),
  ];
  expect(sinceLastRequest(asked)[0]!.content).toBe("add dark mode");
});

test("a session that already starts at its request stays as it is", () => {
  const one = [user("one"), bot("a")];
  expect(sinceLastRequest(one)).toBe(one);
});

function run(env: Record<string, string>, cwd = "/tmp") {
  let handler: any;
  freshDispatcher({ on: (_e, h) => void (handler = h) }, env);
  return handler({ messages: history }, { cwd });
}

test("only the Dispatcher is cut", () => {
  expect(run({ LINECLEAR_ROLE: "dispatcher" }).messages).toHaveLength(3);
  expect(run({ LINECLEAR_ROLE: "worker", HOME: "/nonexistent" })).toBeUndefined();
});
