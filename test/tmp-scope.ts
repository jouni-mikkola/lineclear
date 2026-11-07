// Preloaded before every test process (bunfig.toml): the process gets a temp folder of its own and TMPDIR points at it,
// on disk (~/.cache/lineclear/tmp, not RAM), so everything a test makes with os.tmpdir() (and every child process,
// Playwright profiles included) lands inside it.
// Processes that run from it end first.
// It is removed when the tests end, whether they passed or not.
import { afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diskTmpRoot, removeFolders } from "../src/tmpdirs.ts";

// inside the check's folder when the check set TMPDIR there, so a folder a test leaves fails the check
const root = tmpdir().startsWith(diskTmpRoot()) ? tmpdir() : diskTmpRoot();
const scope = mkdtempSync(join(root, "lc-test-"));
process.env.TMPDIR = scope;
const remove = () => removeFolders([scope]);
// bun test ends without an exit event, so the end of the tests is what clears it (exit stays for plain bun runs)
// a test that starts a server or a herdr session ends it itself: one left fails the run
afterAll(() => {
  const left = removeFolders([scope]);
  if (left.length > 0)
    throw new Error(
      `the tests left ${left.length} process${left.length === 1 ? "" : "es"} running (pids ${left.join(" ")}); a test that starts a server or a herdr session stops it in afterAll`,
    );
});
process.on("exit", remove);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => {
    remove();
    process.exit(1);
  });
// No test reaches the Lineclear that runs on this machine: a lineclear command a test starts without a server of its own
// fails at once on a closed port, where the live one would answer as slowly as the machine is busy.
process.env.LINECLEAR_URL = "http://127.0.0.1:9";
// the folders, port and name of the board's server that runs a check are not the tests'; a command a test runs would refuse them as the stable ones
for (const k of ["LINECLEAR_CHAT", "LINECLEAR_COMMAND", "LINECLEAR_CHAT", "LINECLEAR_TASK", "LINECLEAR_PORT", "LINECLEAR_WEB_PORT", "LINECLEAR_BOX"])
  delete process.env[k];
for (const k of ["LINECLEAR_HOME", "LINECLEAR_MACHINE", "LINECLEAR_SHARED_HOME"]) delete process.env[k];
// the secrets vault the CLI reads (server/server/live/secrets.ts): never the owner's real one
process.env.LINECLEAR_MAIN_HOME = join(scope, "main-home");
// A git a test starts never waits on fsync: a throwaway repo needs no durability, and under disk load every
// commit and clone would stretch the test.
process.env.GIT_CONFIG_COUNT = "1";
process.env.GIT_CONFIG_KEY_0 = "core.fsync";
process.env.GIT_CONFIG_VALUE_0 = "none";
// The same for the state files the code writes atomically (pi/atomic.ts): no fsync, so disk load cannot stretch a test.
process.env.LINECLEAR_NO_FSYNC = "1";
