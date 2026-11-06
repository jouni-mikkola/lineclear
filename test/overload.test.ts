import { expect, test } from "bun:test";
import { type Candidate, mostRoom } from "../src/spread.ts";
import { lowPriority } from "../src/waits.ts";

const at = (host: string | undefined, load: number, free = 3, slotsFree = 1): Candidate => ({ host, load, loadLimit: 8, free, slotsFree });

test("a new task goes to the machine with the most room, not always home", () => {
  expect(mostRoom([at(undefined, 30), at("elitebook", 2)])?.host).toBe("elitebook");
  expect(mostRoom([at(undefined, 2), at("elitebook", 30)])?.host).toBeUndefined();
  expect(mostRoom([])).toBeUndefined();
});

test("machines with the same load go by free task slots, then check slots, and home first when equal", () => {
  expect(mostRoom([at(undefined, 4, 1), at("b", 4, 5)])?.host).toBe("b");
  expect(mostRoom([at(undefined, 4, 2, 0), at("b", 4, 2, 2)])?.host).toBe("b");
  expect(mostRoom([at(undefined, 4), at("b", 4)])?.host).toBeUndefined();
});

test("a heavy job runs at nice 19 and ionice idle", () => {
  expect(lowPriority("bun test", true)).toEqual(["nice", "-n", "19", "ionice", "-c", "3", "sh", "-c", "bun test"]);
  expect(lowPriority("bun test", false)).toEqual(["nice", "-n", "19", "sh", "-c", "bun test"]);
  const p = Bun.spawnSync([...lowPriority("ps -o ni= -p $$", false)]);
  expect(Number(p.stdout.toString().trim())).toBe(19);
});
