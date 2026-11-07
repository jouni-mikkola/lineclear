import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startHerdr } from "../src/board.ts";
import { tmp } from "./helpers.ts";

test("herdr's server that already runs is left alone", async () => {
  const root = tmp("board");
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "herdr"), "#!/bin/sh\necho 'status: running'\n");
  chmodSync(join(bin, "herdr"), 0o755);
  const lines: string[] = [];
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, LINECLEAR_HOME: join(root, "home") };
  expect(await startHerdr((l) => lines.push(l), env)).toBeUndefined();
  expect(lines).toEqual([]);
});
