// The merge lane's smoke check: a checkout whose service stops at once is named, with free ports and a scratch folder.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBranch } from "../scripts/smoke.ts";

test("a checkout whose service does not start fails the branch check and names the service", async () => {
  const root = mkdtempSync(join(tmpdir(), "smoke-branch-"));
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "lineclear"), "process.exit(3)\n");
  const failed = await checkBranch(root, 20);
  expect(failed.join("\n")).toMatch(/service stopped with exit code 3/);
});

test("a checkout whose service answers passes", async () => {
  const root = mkdtempSync(join(tmpdir(), "smoke-branch-"));
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "lineclear"), `Bun.serve({ port: Number(process.env.LINECLEAR_PORT), fetch: () => Response.json({ places: [] }) });\n`);
  expect(await checkBranch(root, 20)).toEqual([]);
});

test("a service that answers pages but not the API is named", async () => {
  const root = mkdtempSync(join(tmpdir(), "smoke-branch-"));
  mkdirSync(join(root, "bin"));
  writeFileSync(
    join(root, "bin", "lineclear"),
    `if (process.argv[2] === "run") Bun.serve({ port: Number(process.env.LINECLEAR_PORT), fetch: () => new Response("ok") });\nelse setInterval(() => {}, 1000);\n`,
  );
  expect((await checkBranch(root, 4)).join("\n")).toContain("the board API does not answer");
});

test("an idle coordinator is not a failed chat", async () => {
  const { IDLE_COORDINATOR } = await import("../scripts/smoke.ts");
  expect(IDLE_COORDINATOR.test("The agent isn't running.")).toBe(true);
  expect(IDLE_COORDINATOR.test("a coordinator chat is gone")).toBe(false);
});
