import { expect, test } from "bun:test";
import { cutLongResults, MAX_RESULT_LINES } from "../pi/extension.ts";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");
const bot = { role: "assistant", content: [{ type: "text", text: "ok" }] };
const result = (text: string) => ({ role: "toolResult", content: [{ type: "text", text }] });

function context(messages: unknown[], env: Record<string, string> = { LINECLEAR_CHAT: "LE-1/Agent" }) {
  let handler: ((ev: unknown, ctx: unknown) => any) | undefined;
  cutLongResults({ on: (name, fn) => name === "context" && (handler = fn) }, env);
  return handler?.({ messages }, {});
}

test("a 200-line tool result is cut before the next turn", () => {
  const out = context([result(lines(200)), bot]);
  const text: string = out.messages[0].content[0].text;
  expect(text.split("\n").length).toBeLessThan(MAX_RESULT_LINES);
  expect(text).toContain("line 1\n");
  expect(text).toContain("line 200");
  expect(text).not.toContain("line 100\n");
  expect(text).toContain("lines cut");
});

test("a short result stays as it is", () => {
  expect(context([result(lines(50)), bot])).toBeUndefined();
});

test("outside a Lineclear agent nothing is cut", () => {
  expect(context([result(lines(200)), bot], { LINECLEAR_CHAT: "LE-1/Reviewer" })).toBeUndefined();
});

test("a result the model has not read yet is kept whole", () => {
  expect(context([bot, result(lines(200))])).toBeUndefined();
});

test("a long result on a few lines is cut too", () => {
  const out = context([result("x".repeat(20000)), bot]);
  expect(out.messages[0].content[0].text.length).toBeLessThan(8000);
});
