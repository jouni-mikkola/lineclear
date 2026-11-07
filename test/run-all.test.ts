import { expect, test } from "bun:test";
import { runAll } from "../src/run-all.ts";

test("commands run at once: three of 0.5 s end in well under their sum, each result in order", () => {
  const at = Date.now();
  const r = runAll(
    [
      { argv: ["sh", "-c", "sleep 0.5; cat"], stdin: "one", timeoutMs: 5000 },
      { argv: ["sh", "-c", "sleep 0.5; echo two >&2; exit 3"], timeoutMs: 5000 },
      { argv: ["sh", "-c", "sleep 0.5; echo three"], timeoutMs: 5000 },
    ],
    process.env,
  );
  expect(Date.now() - at).toBeLessThan(1400);
  expect(r).toEqual([
    { code: 0, out: "one", err: "" },
    { code: 3, out: "", err: "two\n" },
    { code: 0, out: "three\n", err: "" },
  ]);
});

test("a command that cannot start fails alone", () => {
  const [missing, fine] = runAll(
    [
      { argv: ["no-such-command-lineclear"], timeoutMs: 5000 },
      { argv: ["true"], timeoutMs: 5000 },
    ],
    process.env,
  );
  expect(missing?.code).not.toBe(0);
  expect(fine?.code).toBe(0);
});
