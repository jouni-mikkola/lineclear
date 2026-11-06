import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { OLD_NAME, oldFolderUsers } from "../src/old-install.ts";

test("a process with the old folder in its command or environment is a user of it", () => {
  const proc = mkdtempSync(join(tmpdir(), "proc-"));
  const put = (pid: string, cmd: string, env: string) => {
    mkdirSync(join(proc, pid));
    writeFileSync(join(proc, pid, "cmdline"), cmd);
    writeFileSync(join(proc, pid, "environ"), env);
  };
  const env = { LINECLEAR_OLD_DIR: "/home/x/.old" };
  put("11", "pi\0", `LINECLEAR_COMMAND=/home/x/.old/helper/bin/${OLD_NAME}\0A=b`);
  put("12", "/home/x/.old/helper/bin/agent-browser-bin\0--x", "A=b");
  put("13", "pi\0", `LINECLEAR_COMMAND=/home/x/.lineclear/helper/bin/${OLD_NAME}`);
  expect(
    oldFolderUsers(env, proc)
      .map((u) => u.split(" ")[0])
      .sort(),
  ).toEqual(["11", "12"]);
  expect(oldFolderUsers(env, join(proc, "nothing"))).toEqual([]);
});

function fakeProc(): { proc: string; put: (pid: string, parts?: { cmd?: string; env?: string; cwd?: string; fds?: string[] }) => void } {
  const proc = mkdtempSync(join(tmpdir(), "proc-"));
  const put = (pid: string, { cmd = "pi\0", env = "A=b", cwd = "/", fds = [] }: { cmd?: string; env?: string; cwd?: string; fds?: string[] } = {}) => {
    mkdirSync(join(proc, pid, "fd"), { recursive: true });
    writeFileSync(join(proc, pid, "cmdline"), cmd);
    writeFileSync(join(proc, pid, "environ"), env);
    symlinkSync(cwd, join(proc, pid, "cwd"));
    for (const [i, f] of fds.entries()) symlinkSync(f, join(proc, pid, "fd", String(i)));
  };
  return { proc, put };
}
const users = (proc: string) => oldFolderUsers({ LINECLEAR_OLD_DIR: "/h/.old", LINECLEAR_OLD_PROJECTS_DIR: "/h/.oldp" }, proc).map((u) => u.split(" ")[0]);

test("a file open in either old folder, or a working folder in it, holds it", () => {
  const { proc, put } = fakeProc();
  put("21", { fds: ["/h/.oldp/data/log.txt"] });
  put("22", { cwd: "/h/.old/work" });
  put("23", { fds: ["/h/.lineclear/log.txt"] });
  expect(users(proc).sort()).toEqual(["21", "22"]);
});

test("a PATH or a variable that points into an old folder holds it", () => {
  const { proc, put } = fakeProc();
  put("31", { env: "PATH=/usr/bin:/h/.old/helper/bin:/bin" });
  put("32", { env: "X=/h/.oldp/thing" });
  put("33", { env: "PATH=/usr/bin:/h/.lineclear/helper/bin" });
  expect(users(proc).sort()).toEqual(["31", "32"]);
});

test("a command that points into an old folder holds it", () => {
  const { proc, put } = fakeProc();
  put("41", { cmd: "bash\0/h/.oldp/run.sh\0" });
  put("42", { cmd: "bash\0/h/.lineclear/run.sh\0" });
  expect(users(proc)).toEqual(["41"]);
});

test("a socket bound in an old folder holds it", () => {
  const { proc, put } = fakeProc();
  mkdirSync(join(proc, "net"));
  writeFileSync(
    join(proc, "net", "unix"),
    "Num RefCount Protocol Flags Type St Inode Path\n0: 2 0 10000 1 1 555 /h/.old/helper/main.sock\n0: 2 0 10000 1 1 556 /h/.lineclear/helper/main.sock\n",
  );
  put("51", { fds: ["socket:[555]"] });
  put("52", { fds: ["socket:[556]"] });
  expect(users(proc)).toEqual(["51"]);
});

test("an agent whose command still ends in the old name is named by its chat", async () => {
  const { agentsOnOldName } = await import("../src/helper.ts");
  const proc = mkdtempSync(join(tmpdir(), "proc-"));
  const put = (pid: string, env: string) => {
    mkdirSync(join(proc, pid));
    writeFileSync(join(proc, pid, "environ"), env);
  };
  put("21", `HOME=${homedir()}\0LINECLEAR_CHAT=LINE-1/Agent\0LINECLEAR_COMMAND=/h/.lineclear/helper/bin/${OLD_NAME}\0`);
  put("22", `HOME=${homedir()}\0LINECLEAR_CHAT=LINE-2/Agent\0LINECLEAR_COMMAND=/h/.lineclear/helper/bin/lineclear\0`);
  expect(agentsOnOldName(proc)).toEqual(["LINE-1/Agent"]);
});
