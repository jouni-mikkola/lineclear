import { expect, test } from "bun:test";
import { type Candidate, mostRoom } from "../src/spread.ts";

const at = (host: string | undefined, load: number, free = 3): Candidate => ({ host, load, loadLimit: 8, free });

test("a new task goes to the machine with the most room, not always home", () => {
  expect(mostRoom([at(undefined, 30), at("elitebook", 2)])?.host).toBe("elitebook");
  expect(mostRoom([at(undefined, 2), at("elitebook", 30)])?.host).toBeUndefined();
  expect(mostRoom([])).toBeUndefined();
});

test("machines with the same load go by free task slots, and home first when equal", () => {
  expect(mostRoom([at(undefined, 4, 1), at("b", 4, 5)])?.host).toBe("b");
  expect(mostRoom([at(undefined, 4), at("b", 4)])?.host).toBeUndefined();
});
