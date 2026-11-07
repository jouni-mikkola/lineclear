import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVER = join(import.meta.dir, "../ui/test/fake-lineclear-server.ts");
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (ok: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await Bun.sleep(50);
  return ok();
};

// a parent shell starts the fake server and waits; killing the parent orphans the server
function startUnderParent() {
  const dir = mkdtempSync(join(tmpdir(), "reaper-test-"));
  const parent = spawn("sh", ["-c", `bun ${SERVER} ${dir} & wait`], { env: { ...process.env, LINECLEAR_REAPER_MS: "100" }, stdio: "ignore" });
  return { dir, parent };
}
const serverPid = async (dir: string) => {
  expect(await until(() => existsSync(join(dir, "server.json")), 10000)).toBe(true);
  return JSON.parse(readFileSync(join(dir, "server.json"), "utf8")).pid as number;
};

test("a fake server ends after its parent is killed", async () => {
  const { dir, parent } = startUnderParent();
  const pid = await serverPid(dir);
  try {
    parent.kill("SIGKILL");
    expect(await until(() => !alive(pid), 5000)).toBe(true);
  } finally {
    if (alive(pid)) process.kill(pid);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a fake server of a live parent is kept", async () => {
  const { dir, parent } = startUnderParent();
  const pid = await serverPid(dir);
  try {
    await Bun.sleep(600);
    expect(alive(pid)).toBe(true);
  } finally {
    parent.kill("SIGKILL");
    if (alive(pid)) process.kill(pid);
    rmSync(dir, { recursive: true, force: true });
  }
});
