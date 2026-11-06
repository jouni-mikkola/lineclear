import { expect, test } from "bun:test";
import { cut, plan } from "../pi/parts/cut-output.ts";

test("a long output is cut at line ends when they are near, and the note names the lines left out", () => {
  const text = Array.from({ length: 200 }, (_, i) => `line ${i}`.padEnd(49, "x")).join("\n");
  const p = plan(text, 2000);
  expect(p).not.toBeNull();
  const cutText = cut(text, p as NonNullable<typeof p>, "/tmp/whole.txt");
  expect(cutText).toContain("Output cut by the token pack");
  expect(cutText).toContain("/tmp/whole.txt");
  expect(cutText.length).toBeLessThan(text.length);
  expect(plan("short", 2000)).toBeNull();
});

test("a cut never splits a surrogate pair at either end", () => {
  const text = "😀".repeat(3000);
  const p = plan(text, 1000);
  expect(p).not.toBeNull();
  const { headEnd, tailStart } = p as NonNullable<typeof p>;
  expect(/[\ud800-\udbff]$/.test(text.slice(0, headEnd))).toBe(false);
  expect(/^[\udc00-\udfff]/.test(text.slice(tailStart))).toBe(false);
});
