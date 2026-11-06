// On a fresh machine: installs this commit with install.sh into an empty HOME, then runs scripts/one-name.ts
// there. Exits 1 when a user sees the old product's name.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { diskTmpRoot } from "../src/tmpdirs.ts";

const repoRoot = join(import.meta.dir, "..");
const root = mkdtempSync(join(diskTmpRoot(), "lineclear-one-name-"));
const home = join(root, "home");
mkdirSync(home);
// The commands ask a board for their help; without its own port they would reach this machine's board, an older build.
const port = 18000 + Math.floor(Math.random() * 1000);
const base = [
  "env",
  "-i",
  `HOME=${home}`,
  `LINECLEAR_PORT=${port}`,
  `USER=${process.env.USER ?? ""}`,
  `LANG=${process.env.LANG ?? "C.UTF-8"}`,
  "TERM=xterm-256color",
];
const path = `PATH=${home}/.local/bin:${home}/.bun/bin:/usr/local/bin:/usr/bin:/bin`;
const asNew = (script: string) => Bun.spawnSync([...base, path, "sh", "-c", script], { cwd: home, stdout: "inherit", stderr: "inherit" }).exitCode;

const ref = Bun.spawnSync(["git", "-C", repoRoot, "rev-parse", "HEAD"]).stdout.toString().trim();
let code = asNew(`LINECLEAR_REPO=${repoRoot} LINECLEAR_REF=${ref} sh ${repoRoot}/install.sh`);
let board: ReturnType<typeof Bun.spawn> | undefined;
if (code === 0) {
  board = Bun.spawn([...base, path, "lineclear", "serve", "--port", String(port)], { cwd: home, stdout: "ignore", stderr: "ignore" });
  for (
    let i = 0;
    i < 60 &&
    !(await fetch(`http://127.0.0.1:${port}/`).then(
      () => true,
      () => false,
    ));
    i++
  )
    await Bun.sleep(500);
  code = asNew(`bun ${repoRoot}/scripts/one-name.ts`);
  board.kill();
}
rmSync(root, { recursive: true, force: true });
console.log(code === 0 ? "one name: a clean install shows no old name" : "one name: FAILED");
process.exit(code === 0 ? 0 : 1);
