import { expect, test } from "bun:test";
import { setup, step } from "./rules-world.ts";

test("the same step added twice starts once and is refused once", () => {
  const t = setup({ steps: [step("A", "none")] });
  t.doTick();
  const second = t.doTick();
  expect(t.adds().length).toBe(1);
  expect(second.some((x) => x.step === "A" && x.reason.includes("does not start twice"))).toBe(true);
});

test("a landed step starts no agent", () => {
  const t = setup({ steps: [step("A", "none")], commits: ["LIN-9: A Title A"] });
  t.doTick();
  expect(t.adds()).toEqual([]);
});
