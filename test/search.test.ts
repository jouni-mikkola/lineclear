import { expect, test } from "bun:test";
import type { HomeProject } from "../src/home-data.ts";
import type { RoadmapData } from "../src/roadmap-view.ts";
import { search } from "../src/search.ts";

const projects = [
  {
    tasks: [
      { id: "W-1", title: "W4 Cart totals", last: { at: 1, text: "Fixing the total after a removed line" } },
      { id: "W-2", title: "Pay with a saved card" },
    ],
  },
] as unknown as HomeProject[];
const roadmaps = [{ project: "shop", steps: [{ id: "W5", title: "Coupons", result: "A coupon lowers the cart total." }] }] as unknown as RoadmapData[];

test("every word must be in the text, and tasks come before chats before steps", () => {
  expect(search("cart total", projects, roadmaps).map((h) => `${h.kind}:${h.id}`)).toEqual(["task:W-1", "step:W5"]);
  expect(search("TOTAL line", projects, roadmaps).map((h) => `${h.kind}:${h.id}`)).toEqual(["chat:W-1"]);
});

test("an empty query finds nothing", () => {
  expect(search("  ", projects, roadmaps)).toEqual([]);
});

test("a step names its project and a long text is cut", () => {
  const long = [{ project: "shop", steps: [{ id: "X1", title: "x", result: `word ${"a".repeat(500)}` }] }] as unknown as RoadmapData[];
  const hit = search("word", [], long)[0];
  expect(hit?.project).toBe("shop");
  expect(hit?.text?.length).toBe(140);
});

test("the search and changes routes answer, and a task with no worktree is a 404", async () => {
  const { freshWebApi } = await import("./helpers.ts");
  const { handle } = freshWebApi();
  const get = (path: string) => handle(new Request(`http://127.0.0.1:7420${path}`));
  expect(await (await get("/api/search?q=")).json()).toEqual([]);
  expect((await get("/api/task/NOPE-1/changes")).status).toBe(404);
});
