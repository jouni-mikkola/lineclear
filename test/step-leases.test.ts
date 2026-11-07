import { expect, test } from "bun:test";
import { claimWorld } from "../src/claims.ts";
import type { Ran } from "../src/run-all.ts";
import { GRACE_MS, LEASE_MS, openLeases } from "../src/step-leases.ts";
import { scratch } from "./fake-world.ts";

const scratchDir = scratch();
const ok = (out = ""): Ran => ({ code: 0, out, err: "" });

test("two racing loops claim one step 100 times and get 1 win and 1 refusal each time", async () => {
  const dir = scratchDir("race");
  const loops = ["one", "two"].map((owner) => {
    const store = openLeases(dir);
    // No GitHub remote: only the lease decides.
    const world = claimWorld(
      () => ok(),
      () => [],
      () => "origin/main",
      { store, owner },
    );
    return (step: string) => world.claimSteps?.("/r", [step])[0];
  });
  for (let i = 0; i < 100; i++) {
    const answers = await Promise.all(loops.map(async (claim) => claim(`S${i}`)));
    expect(answers.filter((a) => a === undefined)).toHaveLength(1);
    expect(answers.filter((a) => a === "held")).toHaveLength(1);
  }
});

test("a claim whose worker closed its socket is released within 30 s", () => {
  const store = openLeases(scratchDir("socket"));
  const t0 = 1_000_000;
  expect(store.claim("A", "worker", t0)).toBe(true);
  expect(store.claim("A", "other", t0 + 1)).toBe(false);
  store.closeOwner("worker", t0 + 5_000);
  expect(GRACE_MS).toBeLessThan(30_000);
  expect(store.live(t0 + 5_000 + GRACE_MS - 1)).toEqual(["A"]);
  expect(store.claim("A", "other", t0 + 5_000 + GRACE_MS)).toBe(true);
});

test("a quiet owner loses its claim after the lease and a renewal keeps it", () => {
  const store = openLeases(scratchDir("lease"));
  expect(store.claim("A", "a", 0)).toBe(true);
  expect(store.claim("B", "b", 0)).toBe(true);
  store.renew("a", LEASE_MS - 1);
  expect(store.live(LEASE_MS)).toEqual(["A"]);
  store.release("A");
  expect(store.live(LEASE_MS)).toEqual([]);
});

test("a claim whose GitHub claim fails is given back", () => {
  const store = openLeases(scratchDir("gh"));
  const run = (argv: string[]): Ran => (argv.includes("get-url") ? ok("git@github.com:o/r.git\n") : ok("abc\n"));
  const world = claimWorld(
    run,
    (cmds) => cmds.map(() => ({ code: 1, out: "", err: "boom" })),
    () => "origin/main",
    { store, owner: "x" },
  );
  expect(world.claimSteps?.("/r", ["A"])).toEqual(["boom"]);
  expect(store.live()).toEqual([]);
});
