import { expect, test } from "bun:test";
import { bookRoom, type Candidate, MEM_PER_AGENT_KB, MEM_RESERVE_KB, mostRoom, type Room, roomSlots } from "../src/spread.ts";

const at = (host: string | undefined, load: number, free = 3): Candidate => ({ host, load, loadLimit: 8, free });

test("a new task goes to the machine with the most room, not always home", () => {
  expect(mostRoom([at(undefined, 30), at("elitebook", 2)])?.host).toBe("elitebook");
  expect(mostRoom([at(undefined, 2), at("elitebook", 30)])?.host).toBeUndefined();
  expect(mostRoom([])).toBeUndefined();
});

test("45 starts never pass a machine's slots or memory", () => {
  const room = (host: string, max: number, freeKb: number): Room => ({ host, tasks: [], working: 0, max, load: 0, loadLimit: 1000, freeKb });
  const rooms = [room("a", 10, 8 * 1024 * 1024), room("b", 12, 64 * 1024 * 1024), room("c", 25, 64 * 1024 * 1024)];
  const placed = new Map<string, number>();
  for (let i = 0; i < 45; i++) {
    const candidates = rooms.flatMap((r) => (roomSlots(r) > 0 ? [{ host: r.host, load: r.load, loadLimit: r.loadLimit, free: roomSlots(r) }] : []));
    const host = mostRoom(candidates)?.host;
    if (host === undefined) break;
    bookRoom(rooms.find((r) => r.host === host) as Room);
    placed.set(host, (placed.get(host) ?? 0) + 1);
  }
  const memory = Math.floor((8 * 1024 * 1024 - MEM_RESERVE_KB) / MEM_PER_AGENT_KB);
  expect(placed.get("a")).toBe(Math.min(10, memory));
  expect(placed.get("b")).toBe(12);
  expect(placed.get("c")).toBe(25);
});

test("machines with the same load go by free task slots, and home first when equal", () => {
  expect(mostRoom([at(undefined, 4, 1), at("b", 4, 5)])?.host).toBe("b");
  expect(mostRoom([at(undefined, 4), at("b", 4)])?.host).toBeUndefined();
});
