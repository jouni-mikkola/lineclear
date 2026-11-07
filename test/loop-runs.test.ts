// The one server with its real supervisor: the rule loop it starts must tick, not start a second server that the
// store's lock refuses every few seconds while the board still answers.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readLoopBeat } from "../src/loop-beat.ts";
import { tmp, waitFor } from "./helpers.ts";

const root = join(import.meta.dir, "..");

/** Collects a stream's text as it comes. */
function collect(stream: ReadableStream<Uint8Array>, into: string[]) {
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) into.push(decoder.decode(chunk, { stream: true }));
  })();
}

test("lineclear run starts the server, and the loop it supervises ticks without a second server", async () => {
  const dir = tmp("loop-runs");
  const config = join(dir, "config");
  // a project whose settings do not parse: each tick says so in one decision line, with nothing else to set up
  mkdirSync(join(config, "projects", "broken"), { recursive: true });
  writeFileSync(join(config, "projects", "broken", "settings.json"), "{");
  mkdirSync(join(dir, "home"));
  mkdirSync(join(dir, "dist"));
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port as number;
  probe.stop(true);
  const env = {
    ...process.env,
    HOME: join(dir, "home"),
    // no browser tool on the path: the server's read of the agents' browsers would leave a process behind
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    XDG_RUNTIME_DIR: join(dir, "run"),
    XDG_DATA_HOME: join(dir, "data"),
    HERDR_SOCKET_PATH: join(dir, "no-herdr.sock"),
    LINECLEAR_SCRATCH: "1",
    LINECLEAR_HOME: join(dir, "data-home"),
    LINECLEAR_CONFIG: config,
    LINECLEAR_WEB_DIST: join(dir, "dist"),
    LINECLEAR_NIGHT_WATCH: "off",
  };
  const service = Bun.spawn([process.execPath, join(root, "bin", "lineclear"), "run", "--port", String(port)], {
    cwd: root,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const said: string[] = [];
  collect(service.stdout, said);
  collect(service.stderr, said);
  try {
    await waitFor(() => /^broken {2}- {2}skip {2}settings of 'broken' are not valid JSON/m.test(said.join("")), "a decision line of the loop", 15_000);
    expect(said.join("")).not.toContain("another server");
    expect(readLoopBeat(env)?.at).toBeGreaterThan(Date.now() - 15_000);
  } finally {
    service.kill("SIGTERM");
    await service.exited;
  }
}, 20_000);
