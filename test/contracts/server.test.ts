// The contract of server: what the CLI uses of the check line in server/server/live/engine/check-queue.ts.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Q from "../../server/server/live/engine/check-queue.ts";
import { tmp } from "../helpers.ts";

const GONE = 2 ** 22 + 12345;

function box(machine = "boxa", machineJson?: object) {
  const dir = tmp("contract-server");
  if (machineJson) writeFileSync(join(dir, "machine.json"), JSON.stringify(machineJson));
  return { dir, env: { LINECLEAR_CONFIG: dir, LINECLEAR_MACHINE: machine } };
}

test("a check joins its line, waits behind the one before it and leaves it", () => {
  const { env } = box();
  const line = Q.lineOf(tmp("contract-repo"), env);
  const first = Q.joinLine("LIN-1", line, env, 1000);
  const second = Q.joinLine("LIN-2", line, env, 2000);
  expect(Q.checkLine(line, env).map((t) => t.who)).toEqual(["LIN-1", "LIN-2"]);
  expect(Q.ahead(first, env)).toBe(0);
  expect(Q.ahead(second, env)).toBe(1);
  Q.leaveLine(first, env);
  expect(Q.ahead(second, env)).toBe(0);
  Q.leaveLine(second, env);
  expect(Q.checkLine(line, env)).toEqual([]);
  expect(Q.lineState(line, env)).toBe("");
});

test("a merge turn goes before task checks, and a running head goes before both", () => {
  const { env } = box();
  const line = Q.lineOf(tmp("contract-repo"), env);
  Q.joinLine("LIN-1", line, env, 1000);
  Q.joinLine("lane", line, env, 2000, true);
  expect(Q.laneInLine(line, env)).toBe(true);
  expect(Q.checkLine(line, env).map((t) => t.who)).toEqual(["lane", "LIN-1"]);
  const running = Q.joinLine("LIN-3", line, env, 3000);
  Q.startTurn(running, env);
  expect(Q.checkLine(line, env).map((t) => t.who)).toEqual(["LIN-3", "lane", "LIN-1"]);
  expect(Q.lineState(line, env)).toBe("the check line of boxa: LIN-3 runs, 2 wait");
});

test("a turn of a process that is gone leaves the line by itself", () => {
  const { dir, env } = box();
  const line = "boxa@repo";
  mkdirSync(join(dir, "check-queue", line), { recursive: true });
  writeFileSync(join(dir, "check-queue", line, "000000000000001-x.json"), JSON.stringify({ pid: GONE, who: "dead", since: 1 }));
  expect(Q.checkLine(line, env)).toEqual([]);
  expect(readdirSync(join(dir, "check-queue", line))).toEqual([]);
});

test("the line of a repo is named by its machine and real path; linesOf lists this machine first", () => {
  const repo = tmp("contract-repo");
  const a = box("boxa");
  const line = Q.lineOf(repo, a.env);
  expect(line.startsWith("boxa@")).toBe(true);
  expect(Q.machineOfLine(line)).toBe("boxa");
  expect(Q.machineOf({ LINECLEAR_MACHINE: "boxa.local" })).toBe("boxa");
  const otherEnv = { ...a.env, LINECLEAR_MACHINE: "boxb" };
  const other = Q.lineOf(repo, otherEnv);
  Q.joinLine("LIN-1", other, a.env);
  Q.joinLine("LIN-2", line, a.env);
  expect(Q.linesOf(repo, a.env)).toEqual([line, other]);
  expect(Q.linesOf(repo, otherEnv)).toEqual([other, line]);
});

test("check slots: a machine has one per 4 cores unless set, costs are taken together or not at all, and a gone holder's slot is taken over", () => {
  expect(Q.machineLimits({ ...box("boxa").env, LINECLEAR_CORES: "8" }).slots).toBe(2);
  expect(Q.machineLimits({ ...box("boxa").env, LINECLEAR_CORES: "12" }).slots).toBe(3);
  expect(Q.machineLimits({ ...box("boxa").env, LINECLEAR_CORES: "1" }).slots).toBe(1);
  expect(Q.machineLimits({ ...box("boxa", { slotsPerCore: 1 }).env, LINECLEAR_CORES: "8" }).slots).toBe(8);
  // a load limit no machine reaches, so the test does not depend on how busy this one is
  const { env } = box("boxa", { checkSlots: 2, loadPerCore: 1e6 });
  const one = Q.takeSlots(1, env) as string[];
  expect(one).toHaveLength(1);
  expect(Q.takeSlots(2, env)).toBeUndefined();
  expect(Q.takeSlots(1, env)).toHaveLength(1);
  expect(Q.takeSlots(1, env)).toBeUndefined();
  writeFileSync(one[0] as string, String(GONE));
  expect(Q.takeSlots(1, env)).toHaveLength(1);
});

test("machine.json sets the slots and the load limit", () => {
  const { env } = box("boxa", { checkSlots: 3, loadPerCore: 0.5 });
  expect(Q.machineLimits(env).slots).toBe(3);
  expect(Q.limitOf({ loadPerCore: 0.5 }, 8)).toBe(4);
  expect(Q.limitOf(null, 8)).toBe(8);
});

test("a head that shows no progress while a lane turn waits is stuck, and releasing it frees the line", () => {
  const { dir, env } = box();
  const line = Q.lineOf(tmp("contract-repo"), env);
  const now = 10_000_000_000;
  const head = Q.joinLine("LIN-1", line, env, now - 2 * Q.STUCK_MS);
  const file = join(dir, "check-queue", head);
  const turn = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...turn, run: true, work: process.pid, cpu: 1, seen: now, moved: now - 2 * Q.STUCK_MS }));
  expect(Q.stuckHeads(line, env, now)).toEqual([]);
  Q.joinLine("lane", line, env, now - 1000, true);
  const stuck = Q.stuckHeads(line, env, now);
  expect(stuck).toHaveLength(1);
  expect(stuck[0]?.who).toBe("LIN-1");
  expect(Q.stuckLine(stuck[0] as Q.StuckHead, line)).toContain("the check line of boxa is stuck: LIN-1's check shows no progress for 20 min");
  Q.releaseTurn(line, "LIN-1", env);
  expect(Q.checkLine(line, env).map((t) => t.who)).toEqual(["lane"]);
  expect(Q.stuckHeads(line, env, now)).toEqual([]);
});
