// Priority: the Lineclear server, chats and coordinators keep normal priority; a task's agent runs below them, and
// the heavy jobs it starts run lower still (src/waits.ts), so a busy machine keeps its board quick.

/** nice value of a task agent; its heavy jobs get 19 */
export const TASK_NICE = 10

/** a task's agent or reviewer is named `<task>/Agent` or `<task>/Reviewer`; a coordinator is named by its space */
export const isTaskAgent = (env: Record<string, string> | undefined) => /\/(Agent|Reviewer)$/.test(env?.LINECLEAR_CHAT ?? '')

/** `root` and every process below it, from `ps -e -o pid=,ppid=` text */
export function treeOf(root: number, table: string): number[] {
  const kids = new Map<number, number[]>()
  for (const line of table.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!pid || !ppid) continue
    kids.set(ppid, [...(kids.get(ppid) ?? []), pid])
  }
  const out = [root]
  for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i] as number) ?? []))
  return out
}

/** the argv that lowers the priority of `root` and what runs under it; what it starts later inherits it */
export function reniceArgv(root: number, table: string, nice = TASK_NICE): string[] {
  return ['renice', '-n', String(nice), '-p', ...treeOf(root, table).map(String)]
}

/** lowers a task agent's shell and its processes; best effort, an agent that runs at normal priority still works */
export function lowerPriority(root: number | undefined) {
  if (!root) return
  try {
    const table = Bun.spawnSync(['ps', '-e', '-o', 'pid=,ppid='], { stdout: 'pipe', stderr: 'ignore' }).stdout.toString()
    Bun.spawnSync(reniceArgv(root, table), { stdout: 'ignore', stderr: 'ignore' })
  } catch {
    // no ps or renice here
  }
}
