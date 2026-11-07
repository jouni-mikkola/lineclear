/** Ends a process group: the check and everything it started, whatever it detached from. */
export function killGroup(pgid: number): void {
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // already gone
  }
}

/**
 * Ends the group when `parent` dies, even by SIGKILL, where no handler of ours runs: a watcher of its own group, gone
 * as soon as the group is empty.
 */
export function guardGroup(pgid: number, parent: number): number {
  const watcher = Bun.spawn(
    ["bash", "-c", `while kill -0 ${parent} 2>/dev/null && kill -0 -- -${pgid} 2>/dev/null; do sleep 1; done; kill -KILL -- -${pgid} 2>/dev/null`],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true },
  );
  watcher.unref();
  return watcher.pid;
}
