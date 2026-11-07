// The logs an agent's record names: each one once, by its file name.

/** a log's name (its session id), wherever it lies: one named both by its mirrored path and by its own is one log */
const logName = (f: string) => f.slice(f.lastIndexOf('/') + 1)

/** the logs with each one once, where it first came, by the path it was named by last (a session carried to another
 *  folder goes on there): the same log twice is read twice, and a big one holds up the server */
export function uniqueLogs(logs: string[]): string[] {
  const at = new Map<string, number>()
  const out: string[] = []
  for (const f of logs) {
    const i = at.get(logName(f))
    if (i !== undefined) {
      out[i] = f
      continue
    }
    at.set(logName(f), out.length)
    out.push(f)
  }
  return out
}

/** adds a log the record doesn't have yet; true when it was new */
export function addLog(r: { logs: string[] }, f: string): boolean {
  if (!f) return false
  if (r.logs.some((x) => logName(x) === logName(f))) return false
  r.logs.push(f)
  return true
}
