import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface Worker {
  pid: number
  kill(signal?: 'SIGTERM' | 'SIGKILL'): void
  exited: Promise<unknown>
}

/** the server's code: a worker running the same code is kept across a restart of the main server */
let code = ''
export function codeVersion(dir = join(import.meta.dir, '..', '..')) {
  if (code) return code
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const f = join(d, n)
      if (statSync(f).isDirectory()) walk(f)
      else if (/\.(ts|json)$/.test(n)) h.update(relative(dir, f)).update(readFileSync(f))
    }
  }
  for (const d of ['server', 'shared']) if (existsSync(join(dir, d))) walk(join(dir, d))
  for (const f of ['package.json', 'bun.lock']) if (existsSync(join(dir, f))) h.update(f).update(readFileSync(join(dir, f)))
  code = h.digest('hex').slice(0, 16)
  return code
}

/** a process's command line: /proc where there is one (no process is started on the loop for it), else ps */
function commandOf(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ')
  } catch {
    return Bun.spawnSync(['ps', '-o', 'command=', '-p', String(pid)]).stdout.toString()
  }
}

/** a worker from before this server started, still running: its process, if it is one of Lineclear's */
export function running(pid: number | undefined): Worker | undefined {
  if (!pid || pid === process.pid) return undefined
  try {
    process.kill(pid, 0)
  } catch {
    return undefined
  }
  if (!commandOf(pid).includes('server/main.ts')) return undefined
  const exited = new Promise((done) => {
    const t = setInterval(() => {
      try {
        process.kill(pid, 0)
      } catch {
        clearInterval(t)
        done(undefined)
      }
    }, 2000)
  })
  return { pid, kill: (signal = 'SIGTERM') => process.kill(pid, signal), exited }
}
