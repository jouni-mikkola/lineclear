// The contract of a harness: every adapter starts, reads a session, names a stall signal and reads usage.
import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Harness } from "../../src/harness.ts";
import { claudeHarness } from "../../src/harness-claude.ts";
import { piHarness } from "../../src/harness-pi.ts";
import type { Usage } from "../../src/session-text.ts";
import { harnesses, readRegistry } from "../../src/models.ts";
import { tmp } from "../helpers.ts";

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const piPath = (w: string) => `--${w.replace(/^\//, "").replace(/\//g, "-")}--`;
const USAGE = { model: "m", provider: "p", input: 10, output: 5, cacheRead: 0, cacheWrite: 0 };

interface Adapter {
  harness: Harness;
  /** The harness's env pointing at a fresh folder, and a way to plant one recorded session for a working folder. */
  setup(): { env: Record<string, string>; plant(worktree: string): void };
  /** What `usage` reads from the planted session. */
  expected: Usage;
}

function write(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const adapters: Adapter[] = [
  {
    harness: piHarness,
    expected: USAGE,
    setup() {
      const home = tmp("contract-pi");
      return {
        env: { PI_CODING_AGENT_DIR: home },
        plant: (w) =>
          write(
            join(piHarness.sessionsRoot(home), piPath(w), "a.jsonl"),
            line({ type: "message", message: { role: "assistant", provider: "p", model: "m", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } } }),
          ),
      };
    },
  },
  {
    harness: claudeHarness,
    expected: { ...USAGE, provider: "anthropic" },
    setup() {
      const home = tmp("contract-claude");
      const msg = {
        id: "msg_1",
        role: "assistant",
        model: "m",
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      };
      return {
        env: { CLAUDE_CONFIG_DIR: home },
        // one message written twice, as Claude Code does per content block
        plant: (w) =>
          write(
            join(claudeHarness.sessionsRoot(home), w.replace(/[^a-zA-Z0-9]/g, "-"), "a.jsonl"),
            line({ type: "assistant", message: msg }) + line({ type: "assistant", message: msg }),
          ),
      };
    },
  },
];

for (const { harness, setup, expected } of adapters) {
  test(`${harness.name} starts an agent`, () => {
    const argv = harness.start("some-model", "do it");
    // a fake binary stands in for the harness: the argv runs and exits clean
    const bin = join(tmp("contract-bin"), "fake");
    writeFileSync(bin, "#!/bin/sh\nexit 0\n");
    chmodSync(bin, 0o755);
    expect(Bun.spawnSync([bin, ...argv.slice(1)]).exitCode).toBe(0);
    expect(argv.length).toBeGreaterThan(0);
    expect(argv.join(" ")).toContain("some-model");
    expect(argv).toContain("do it");
  });

  test(`${harness.name} reads a session by working folder, and none for an unknown one`, () => {
    const { env, plant } = setup();
    expect(harness.readSessions("/w/one", env)).toEqual([]);
    plant("/w/one");
    expect(harness.readSessions("/w/one", env)).toHaveLength(1);
    expect(harness.readSessions("/w/other", env)).toEqual([]);
    expect(harness.sessionFiles("/w/one", env)).toHaveLength(1);
    expect(harness.allSessionFolders(env).flatMap((f) => f.files)).toHaveLength(1);
  });

  test(`${harness.name} reads usage`, () => {
    const { env, plant } = setup();
    plant("/w/two");
    const [text] = harness.readSessions("/w/two", env);
    expect(harness.usage(text as string)).toEqual([expected]);
    expect(harness.usage("")).toEqual([]);
  });

  test(`${harness.name} names a stall signal`, () => {
    expect(harness.stallSignal("You have hit your usage limit")).toBe("usage-limit");
    expect(harness.stallSignal("all fine")).toBeUndefined();
  });
}

test("only the harness-*.ts adapters name a harness's sessions folder", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith(".ts") ? [join(dir, n)] : []));
  const bad = files(join(import.meta.dir, "..", "..", "src"))
    .filter((f) => !/harness-[a-z]+\.ts$/.test(f))
    .filter((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .some((l) => /agent\/sessions|"sessions"/.test(l) && !/herdr/.test(l)),
    );
  expect(bad).toEqual([]);
});

test("a harness that is not installed is left out of the registry and fails nothing", () => {
  const none = { PI_BIN: "/nonexistent/pi" };
  expect(readRegistry(harnesses(none))).toEqual([]);
  for (const { harness, setup } of adapters) expect(harness.readSessions("/w/x", setup().env)).toEqual([]);
});
