import { expect, test } from "bun:test";
import { hostOf, splitSessions, whereOf } from "../ui/kit/browsers.tsx";
import { browserSamples } from "../ui/test/browser-samples.ts";

test("the sample sessions split into task browsers and Other sessions, and the two add up to all of them", () => {
  const all = browserSamples("filled");
  const { tasks, other } = splitSessions(all);
  expect(tasks.length + other.length).toBe(all.length);
  expect(other.map((b) => b.session)).toEqual(["docs-preview"]);
  expect(tasks.every((b) => b.task || b.waits)).toBe(true);
});

test("a session that waits for you stays with the task browsers even without a task", () => {
  const { tasks, other } = splitSessions([{ session: "x", title: "x", taken: false, waits: { item: "1", question: "Sign in?" } }]);
  expect(tasks).toHaveLength(1);
  expect(other).toHaveLength(0);
});

test("a card names its task and the page's host, not the page title", () => {
  const b = browserSamples("filled").find((x) => x.session === "WEB-2");
  expect(b?.title).toBe("Search that forgives typos");
  expect(hostOf(b?.page?.url ?? "")).toBe("localhost:5173");
  expect(whereOf(b as NonNullable<typeof b>)).toBe("WEB-2 · web-shop");
});
