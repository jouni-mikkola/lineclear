import { expect, test } from "bun:test";
import { DRAWN, foldRepeats, newest } from "../ui/kit/chat-fold.ts";
import type { ThreadItem } from "../ui/kit/chat.tsx";

const say = (i: number, text: string, who: ThreadItem["who"] = "dispatcher"): ThreadItem => ({ key: `m${i}`, who, text });

test("six equal notices in a row fold into one with a count of six", () => {
  const out = foldRepeats(Array.from({ length: 6 }, (_, i) => say(i, "No models are set up yet.")));
  expect(out).toHaveLength(1);
  expect(out[0]?.count).toBe(6);
  expect(out[0]?.key).toBe("m0");
});

test("a different message or a message of yours breaks the run", () => {
  const out = foldRepeats([say(0, "a"), say(1, "a"), say(2, "a", "you"), say(3, "a"), say(4, "b")]);
  expect(out.map((i) => i.count)).toEqual([2, undefined, undefined, undefined]);
});

test("200 messages keep at most 40 rows, the newest", () => {
  const all = Array.from({ length: 200 }, (_, i) => say(i, `m${i}`));
  const { items, hidden } = newest(all);
  expect(items.length).toBeLessThan(DRAWN);
  expect(items.length + 1).toBe(DRAWN);
  expect(items.at(-1)?.key).toBe("m199");
  expect(hidden).toBe(200 - items.length);
});
