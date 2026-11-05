import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rollbackMain } from "../src/rollback.ts";
import { tmp } from "./helpers.ts";

/** A data folder with builds 1.0 (previous) and 2.0 (current), a systemctl stand-in and a smoke script that exits with `smoke`. */
function world(systemctl: number, smoke: number) {
  const root = tmp("rollback");
  const data = join(root, "data");
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  for (const v of ["1.0", "2.0"]) mkdirSync(join(data, "builds", v, "scripts"), { recursive: true });
  writeFileSync(join(data, "builds", "1.0", "scripts", "smoke.ts"), `console.log("smoke said no"); process.exit(${smoke});\n`);
  symlinkSync(join(data, "builds", "2.0"), join(data, "builds", "current"));
  symlinkSync(join(data, "builds", "1.0"), join(data, "builds", "previous"));
  writeFileSync(
    join(bin, "systemctl"),
    `#!/bin/sh\necho "$@" >> "${join(root, "systemctl.log")}"\n[ "$2" = list-units ] && echo "lineclear-serve-7421.service loaded active running x"\nexit ${systemctl}\n`,
  );
  chmodSync(join(bin, "systemctl"), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, LINECLEAR_HOME: data, LINECLEAR_CONFIG: join(root, "config") };
  const lines: string[] = [];
  return { root, data, env, lines, out: (l: string) => void lines.push(l), decisions: () => readFileSync(join(root, "config", "decisions.jsonl"), "utf8") };
}

test("a rollback goes back to the previous build, restarts the service, passes the smoke check and logs the decision", () => {
  const w = world(0, 0);
  expect(rollbackMain(w.out, w.env)).toBe(0);
  expect(readlinkSync(join(w.data, "builds", "current"))).toEndWith("1.0");
  expect(w.lines.at(-1)).toBe("the smoke check passed");
  expect(w.decisions()).toContain("rolled back 2.0 to 1.0; the smoke check passed");
});

test("a rollback names a service that does not restart, and a smoke check that fails", () => {
  const down = world(1, 0);
  expect(rollbackMain(down.out, down.env)).toBe(1);
  expect(down.lines.at(-1)).toBe("after the rollback: the service did not restart");
  const bad = world(0, 1);
  expect(rollbackMain(bad.out, bad.env)).toBe(1);
  expect(bad.lines.at(-1)).toContain("smoke said no");
});

test("a rollback with nothing older says so and changes nothing", () => {
  const w = world(0, 0);
  const lines: string[] = [];
  expect(rollbackMain((l) => lines.push(l), { ...w.env, LINECLEAR_HOME: join(w.data, "empty") })).toBe(1);
  expect(lines[0]).toStartWith("lineclear release rollback: ");
});

test("a rollback restarts the board's units only and leaves a running task and herdr alone", () => {
  const w = world(0, 0);
  const task = Bun.spawn(["sleep", "300"], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    expect(rollbackMain(w.out, w.env)).toBe(0);
    expect(task.exitCode).toBe(null);
    expect(process.kill(task.pid, 0)).toBe(true);
  } finally {
    task.kill();
  }
  const calls = readFileSync(join(w.root, "systemctl.log"), "utf8").trim().split("\n");
  expect(calls).toContain("--user restart lineclear.service");
  expect(calls).toContain("--user restart lineclear-serve-7421.service");
  expect(calls.filter((c) => c.includes("restart")).every((c) => /lineclear(-serve-\d+)?\.service$/.test(c))).toBe(true);
});
