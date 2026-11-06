import { mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, statfsSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "./time.ts";

type Env = Record<string, string | undefined>;

/** Lineclear's folder under the user's cache: on disk, where /tmp is often RAM. */
export const cacheDir = (env: Env = process.env) => join(env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache"), "lineclear");

/** The temp root for tests and checks. Each run makes a folder in it and removes the folder at the end. */
export function diskTmpRoot(env: Env = process.env): string {
  const dir = join(cacheDir(env), "tmp");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The runtime's compile cache for checks, kept on disk and trimmed to `COMPILE_CACHE_MAX_BYTES`. */
export const compileCacheDir = (env: Env = process.env) => join(cacheDir(env), "node-compile-cache");

const COMPILE_CACHE_MAX_BYTES = 500 * 1024 ** 2;

/** Above this much used in a RAM-backed /tmp, the machine swaps and every task slows. */
export const TMP_STALL_BYTES = 2 * 1024 ** 3;

const TMPFS_MAGIC = 0x01021994;

/** Bytes in use on the filesystem that holds `dir`, when it is RAM (tmpfs); 0 for a disk or when it cannot be read. */
export function ramUsedBytes(dir = tmpdir()): number {
  try {
    const s = statfsSync(dir);
    return Number(s.type) === TMPFS_MAGIC ? (Number(s.blocks) - Number(s.bfree)) * Number(s.bsize) : 0;
  } catch {
    return 0;
  }
}

function filesUnder(dir: string): { path: string; size: number; mtimeMs: number }[] {
  const found: { path: string; size: number; mtimeMs: number }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const path = join(e.parentPath, e.name);
    try {
      const st = statSync(path);
      found.push({ path, size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      // gone while we looked
    }
  }
  return found;
}

/** Deletes the oldest files of a cache folder until it holds at most `maxBytes`. Returns the bytes freed. */
export function trimCache(dir: string, maxBytes = COMPILE_CACHE_MAX_BYTES): number {
  let files: ReturnType<typeof filesUnder>;
  try {
    files = filesUnder(dir);
  } catch {
    return 0;
  }
  let total = files.reduce((n, f) => n + f.size, 0);
  let freed = 0;
  for (const f of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= maxBytes) break;
    rmSync(f.path, { force: true });
    total -= f.size;
    freed += f.size;
  }
  return freed;
}

/** The folders Lineclear's tests (and the browsers they start) make in the temp folder. Folders of live work (the pi extension's `lineclear-notes-` and `lineclear-cut-`, an autopilot's `shep-pilot-gateway-`) are not among them: their own time does not move while they are used. */
const TEST_FOLDER =
  /^(shep-(?!pilot-gateway-)|fake-lineclear-inbox-|lineclear-(?!notes-|cut-)|lc-|lane-config|doctor-old-|playwright_chromiumdev_profile-|playwright-artifacts-)/;

const FINISHED_RUN_MS = 2 * 3_600_000;

/** Each cache folder's last sweep, so the loop looks at /tmp every 10 minutes, not every tick. */
const lastSweep = new Map<string, number>();
const SWEEP_EVERY_MS = 10 * 60_000;

/** The loop's sweep: removes test folders untouched for 2 hours, from /tmp and the disk temp root. Returns what to log. */
export function sweepOldTemp(now: Date, env: Env = process.env): string[] {
  const key = cacheDir(env);
  if (now.getTime() - (lastSweep.get(key) ?? 0) < SWEEP_EVERY_MS) return [];
  lastSweep.set(key, now.getTime());
  let n = 0;
  for (const dir of new Set([env.TMPDIR || "/tmp", join(key, "tmp")])) {
    const old = testFolders(dir, FINISHED_RUN_MS);
    removeFolders(old);
    n += old.length;
  }
  const lines = n === 0 ? [] : [`removed ${n} temp folder${n === 1 ? "" : "s"} of finished runs older than 2 h`];
  // the runtime's default cache lands in /tmp, which is RAM on many machines; the install points it at the disk cache instead
  // node's default is os.tmpdir(), which follows TMPDIR; a cache of another user is not ours to remove
  let ramCache = false;
  const stray = join(env.TMPDIR || "/tmp", "node-compile-cache");
  try {
    if (statSync(stray).uid === process.getuid?.()) {
      rmSync(stray, { recursive: true, force: true });
      ramCache = true;
    }
  } catch {
    // none, or not removable
  }
  if (ramCache) lines.push("removed the compile cache from the temp folder");
  const freed = trimCache(compileCacheDir(env));
  if (freed > 0) lines.push(`trimmed ${Math.ceil(freed / 1024 ** 2)} MB from the compile cache`);
  return lines;
}

/** Test folders in `dir` last touched more than `olderThan` ms ago (every one with 0). */
export function testFolders(dir = tmpdir(), olderThan = DAY, now = Date.now()): string[] {
  const found: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return found;
  }
  for (const n of names) {
    if (!TEST_FOLDER.test(n)) continue;
    try {
      if (now - statSync(join(dir, n)).mtimeMs >= olderThan) found.push(join(dir, n));
    } catch {
      // gone while we looked
    }
  }
  return found;
}

/** Pids of processes (Linux /proc; elsewhere none) that run from inside one of `dirs`: their program or a script argument, their working folder or their TMPDIR lies there. */
function processesIn(dirs: string[]): number[] {
  const inside = (path: string) => dirs.some((d) => path === d || path.startsWith(`${d}/`));
  const found: number[] = [];
  let pids: string[] = [];
  try {
    pids = readdirSync("/proc").filter((n) => /^\d+$/.test(n));
  } catch {
    return found;
  }
  for (const pid of pids) {
    if (Number(pid) === process.pid) continue;
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
      const tmpdir = readFileSync(`/proc/${pid}/environ`, "utf8")
        .split("\0")
        .find((v) => v.startsWith("TMPDIR="));
      if (args.some(inside) || inside(readlinkSync(`/proc/${pid}/cwd`)) || (tmpdir !== undefined && inside(tmpdir.slice(7)))) found.push(Number(pid));
    } catch {
      // gone, or not ours to read
    }
  }
  return found;
}

const STALE_MS = 6 * 3_600_000;

/** Test and check folders (`lc-test-*`, `lc-check-*` and the other test folders) in the temp folders older than 6 h that no process uses: what a killed run left, and what doctor --fix clears. */
export function staleFolders(env: Env = process.env, now = Date.now()): string[] {
  const found = [...new Set([env.TMPDIR || tmpdir(), "/tmp", diskTmpRoot(env)])].flatMap((dir) => testFolders(dir, STALE_MS, now));
  return found.filter((f) => processesIn([f]).length === 0);
}

/** Removes the folders and first ends every process that runs from them: a server a test left would keep its memory and ports for days. Returns the pids it had to end. */
export function removeFolders(paths: string[]): number[] {
  if (paths.length === 0) return []; // the scan of /proc costs tens of ms
  const left = processesIn(paths);
  for (const pid of left) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  for (const p of paths) rmSync(p, { recursive: true, force: true });
  return left;
}
