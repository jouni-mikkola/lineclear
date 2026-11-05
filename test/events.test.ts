import { afterAll, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readItems } from "../src/inbox.ts";
import { eventMain, readEvents, recordEvent } from "../src/events.ts";
import { webApi } from "../src/web.ts";

const dir = mkdtempSync(join(tmpdir(), "lc-events-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
mkdirSync(join(dir, "config", "inbox"), { recursive: true });
mkdirSync(join(dir, "shepherdr"), { recursive: true });
const world = { LINECLEAR_CONFIG: join(dir, "config"), LINECLEAR_STATE: join(dir, "state"), LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"), HOME: dir };
const NOW = Date.parse("2026-01-10T12:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const line = (file: string, o: object) => {
  mkdirSync(join(file, ".."), { recursive: true });
  appendFileSync(file, `${JSON.stringify(o)}\n`);
};

test("each part's events come from the logs that exist, in time order, with their numbers", () => {
  line(join(world.LINECLEAR_STATE, "pack", "compaction-notes.jsonl"), { t: ago(50), task: "LIN-139", ev: "used", tokensBefore: 152_000, notesTokens: 41_000 });
  line(join(world.LINECLEAR_CONFIG, "moves.jsonl"), {
    time: ago(40),
    task: "LIN-139",
    step: "S1",
    from: "claude-a",
    to: "claude-bridge",
    why: "account full until 16:00",
  });
  line(join(world.LINECLEAR_CONFIG, "decisions.jsonl"), {
    time: ago(30),
    project: "web",
    step: "LIN-151",
    kind: "skip",
    reason: "a step it waits for is not merged",
  });
  line(join(world.LINECLEAR_CONFIG, "decisions.jsonl"), {
    time: ago(25),
    project: "web",
    step: "LIN-120",
    kind: "skip",
    reason: "plan sent back, a step is not whole: W4",
  });
  line(join(world.LINECLEAR_CONFIG, "decisions.jsonl"), { time: ago(20), project: "web", step: "LIN-146", kind: "start", reason: "started" });
  recordEvent({ part: "reviewers", kind: "start", text: "round 2 of 2", task: "LIN-146", t: ago(10) }, world);
  recordEvent({ part: "updates", kind: "end", text: "The new version works (check 3m12s)", t: ago(5) }, world);
  const got = readEvents(world, readItems(world), NOW).map((e) => [e.part, e.kind, e.text]);
  expect(got).toEqual([
    ["workers", "end", "LIN-139: compacted 152k into 41k of notes"],
    ["workers", "switch", "LIN-139: claude-a to claude-bridge, account full until 16:00"],
    ["rules", "skip", "LIN-151: held, a step it waits for is not merged"],
    ["planner", "skip", "LIN-120: plan sent back, a step is not whole: W4"],
    ["rules", "start", "LIN-146: started"],
    ["workers", "start", "LIN-146: started"],
    ["reviewers", "start", "round 2 of 2"],
    ["updates", "end", "The new version works (check 3m12s)"],
  ]);
});

test("events older than seven days are not kept", () => {
  recordEvent({ part: "updates", kind: "fail", text: "old", t: new Date(NOW - 8 * 86_400_000).toISOString() }, world);
  expect(readEvents(world, readItems(world), NOW).some((e) => e.text === "old")).toBe(false);
});

test("a new event shows in /api/events at the next read, well inside 2 s", async () => {
  const handle = webApi(world);
  const read = async () => ((await (await handle(new Request("http://127.0.0.1:7420/api/events"))).json()) as { events: { text: string }[] }).events;
  await read();
  const began = Date.now();
  recordEvent({ part: "workers", kind: "end", text: "LIN-9: compacted 90k into 30k of notes" }, world);
  expect((await read()).some((e) => e.text.includes("90k into 30k"))).toBe(true);
  expect(Date.now() - began).toBeLessThan(2000);
});

test("lineclear event writes one, and refuses a part or kind that does not exist", () => {
  const said: string[] = [];
  expect(eventMain(["reviewers", "end", "round 1 passed", "--task", "LIN-1"], (l) => said.push(l), world)).toBe(0);
  expect(readEvents(world, readItems(world)).some((e) => e.part === "reviewers" && e.task === "LIN-1" && e.text === "round 1 passed")).toBe(true);
  expect(eventMain(["nobody", "end", "x"], (l) => said.push(l), world)).toBe(2);
  expect(said[0]).toContain("usage");
  writeFileSync(join(world.LINECLEAR_CONFIG, "events.jsonl"), "{half");
  expect(() => readEvents(world, readItems(world))).not.toThrow();
});

test("events.jsonl is cut to seven days once it is large", () => {
  const file = join(world.LINECLEAR_CONFIG, "events.jsonl");
  const old = JSON.stringify({ t: new Date(NOW - 9 * 86_400_000).toISOString(), part: "updates", kind: "end", text: "x".repeat(1000) });
  writeFileSync(file, `${Array(300).fill(old).join("\n")}\n`);
  recordEvent({ part: "updates", kind: "end", text: "fresh", t: new Date(NOW).toISOString() }, world, () => new Date(NOW));
  const left = readFileSync(file, "utf8").trim().split("\n");
  expect(left.map((l) => JSON.parse(l).text)).toEqual(["fresh"]);
});
