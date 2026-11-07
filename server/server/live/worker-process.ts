import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

/** a worker prints its address when it serves: the port is found in its output, which goes on to its log */
export async function readAddress(stdout: ReadableStream<Uint8Array>, logFile: string, found: (port: number) => void) {
  const decoder = new TextDecoder()
  const reader = stdout.getReader()
  let line = ''
  let seen = false
  try {
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      const text = decoder.decode(r.value, { stream: true })
      appendFileSync(logFile, text)
      if (seen) continue
      line += text
      const port = line.match(/lineclear on http:\/\/127\.0\.0\.1:(\d+)/)?.[1]
      if (port) {
        seen = true
        found(Number(port))
      } else line = line.slice(line.lastIndexOf('\n') + 1)
    }
  } catch {
    /* the worker is gone */
  }
}

/** the token a process was started with: a reused pid has none, or another */
function tokenOf(pid: number): string | undefined {
  try {
    const env = readFileSync(`/proc/${pid}/environ`, 'utf8')
    return env
      .split('\0')
      .find((e) => e.startsWith('LINECLEAR_TOKEN='))
      ?.slice(16)
  } catch {
    // no /proc (macOS): ps prints the environment after the command
    const out = Bun.spawnSync(['ps', 'eww', '-o', 'command=', '-p', String(pid)]).stdout.toString()
    return out.match(/(?:^|\s)LINECLEAR_TOKEN=(\S+)/)?.[1]
  }
}

/** a worker from before this server started, still running: adopted only when it was started with this token */
export function running(pid: number | undefined, token: string | undefined): Worker | undefined {
  if (!pid || !token || pid === process.pid) return undefined
  try {
    process.kill(pid, 0)
  } catch {
    return undefined
  }
  if (tokenOf(pid) !== token) return undefined
  // not our child, so no exit event: a small child process waits for it, and the loop is not touched
  const exited = Bun.spawn(['sh', '-c', 'while kill -0 "$0" 2>/dev/null; do sleep 1; done', String(pid)], { stdout: 'ignore', stderr: 'ignore' }).exited
  return { pid, kill: (signal = 'SIGTERM') => process.kill(pid, signal), exited }
}
