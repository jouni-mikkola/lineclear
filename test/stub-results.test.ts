import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import stubResults, { AFTER, MIN_CHARS, stubOld } from "../pi/parts/stub-results.ts";
import { tmp } from "./helpers.ts";

const big = `first line\n${"x".repeat(MIN_CHARS)}`;
const call = (id: string, name: string, args: object = {}) => ({ role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] });
const result = (id: string, name: string, text = big, extra: object = {}) => ({
  role: "toolResult",
  toolCallId: id,
  toolName: name,
  content: [{ type: "text", text }],
  ...extra,
});
const filler = (n: number) => Array.from({ length: n }, () => ({ role: "assistant", content: [{ type: "text", text: "ok" }] }));
const textAt = (m: any) => m.content[0].text as string;

test("a big used result is stubbed with its size and first line once enough turns have passed", () => {
  const messages = [call("a", "read"), result("a", "read"), ...filler(AFTER)];
  const out = stubOld(messages);
  expect(textAt(out[1])).toContain(`${big.length} characters`);
  expect(textAt(out[1])).toContain("It began: first line");
  expect(out[1].toolCallId).toBe("a");
  expect(textAt(messages[1])).toBe(big);
});

test("a stub is the same on every later call, so the cache stays", () => {
  const messages = [call("a", "read"), result("a", "read"), ...filler(AFTER)];
  expect(stubOld([...messages, ...filler(1)])[1]).toEqual(stubOld(messages)[1]);
});

test("a result younger than the set turns, or short, stays and nothing is rewritten", () => {
  const young = [call("a", "read"), result("a", "read"), ...filler(AFTER - 2)];
  expect(stubOld(young)).toBe(young);
  const short = [call("a", "read"), result("a", "read", "small"), ...filler(AFTER + 5)];
  expect(stubOld(short)).toBe(short);
});

test("writes, edits, errors, images, the chat and the notes are never stubbed", () => {
  const messages = [
    call("w", "write"),
    result("w", "write"),
    call("e", "bash"),
    result("e", "bash", big, { isError: true }),
    call("i", "read"),
    {
      ...result("i", "read"),
      content: [
        { type: "image", data: "x" },
        { type: "text", text: big },
      ],
    },
    call("c", "bash", { command: "lineclear chat say hi" }),
    result("c", "bash"),
    call("d", "bash", { command: "cd /tmp; lineclear chat read" }),
    result("d", "bash"),
    call("n", "read", { path: "/tmp/lineclear-notes-1000/LINE-1/state.md" }),
    result("n", "read"),
    ...filler(AFTER),
  ];
  expect(stubOld(messages)).toBe(messages);
});

test("a number of your own in pack.json stays and sets the turns", () => {
  const root = tmp("stub");
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "pack.json"), JSON.stringify({ stub: { after: 2 } }));
  let handler: any;
  stubResults({ on: (_e, h) => void (handler = h) }, { HOME: root, LINECLEAR_CONFIG: join(root, "config") });
  const messages = [call("a", "read"), result("a", "read"), ...filler(2)];
  expect(textAt(handler({ messages }).messages[1])).toContain("left out");
  stubResults({ on: (_e, h) => void (handler = h) }, { HOME: root, LINECLEAR_CONFIG: join(root, "none") });
  expect(handler({ messages })).toBeUndefined();
});
