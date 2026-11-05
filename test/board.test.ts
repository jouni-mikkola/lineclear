import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startBoard } from "../src/board.ts";
import { tmp } from "./helpers.ts";

/** An env whose herdr says its server runs, so nothing real starts. */
function env() {
  const root = tmp("board");
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "herdr"), "#!/bin/sh\necho 'status: running'\n");
  chmodSync(join(bin, "herdr"), 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH}`, LINECLEAR_HOME: join(root, "home") };
}

test("--board refuses a port that is not one", async () => {
  expect(await startBoard(0, () => undefined, env())).toEqual({ error: "--board needs a port" });
  expect(await startBoard(70000, () => undefined, env())).toEqual({ error: "--board needs a port" });
});

test("a board that already answers on the port is left alone, and stopping it does nothing", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("{}") });
  try {
    const lines: string[] = [];
    const started = await startBoard(server.port as number, (l) => lines.push(l), env());
    expect("stop" in started).toBe(true);
    if ("stop" in started) started.stop();
    expect(lines).toEqual([]);
    expect(server.port).toBeGreaterThan(0);
  } finally {
    server.stop(true);
  }
});
