/** Ends this process when the process that started it is gone, so a killed run leaves no test server behind. */
export function exitWhenParentGone(parent: number, everyMs = 5000): () => void {
  const timer = setInterval(() => {
    if (process.ppid !== parent || !isRunning(parent)) process.exit(0);
  }, everyMs);
  return () => clearInterval(timer);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
