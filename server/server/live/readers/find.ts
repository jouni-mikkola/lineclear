// Where pi keeps an agent's log file. The home follows pi's own setting PI_CODING_AGENT_DIR (tests point it at fixtures).
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const piHome = () => process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent')

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/[/\\]+$/, '') : p)

/** newest .jsonl in a folder changed at or after sinceMs */
function newestLog(dir: string, sinceMs = 0): string | undefined {
  let best: { f: string; m: number } | undefined
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return undefined
  }
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue
    const f = join(dir, n)
    try {
      const m = statSync(f).mtimeMs
      if (m >= sinceMs && (!best || m > best.m)) best = { f, m }
    } catch {}
  }
  return best?.f
}

/** pi names a session folder "--<cwd without its leading slash, / \ and : turned into ->--" */
export function piSessionDir(cwd: string): string {
  const name = trimSlash(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')
  return join(piHome(), 'sessions', `--${name}--`)
}

/** the newest pi session log for this cwd, changed at or after sinceMs */
export const findPiLog = (cwd: string, sinceMs?: number) => newestLog(piSessionDir(cwd), sinceMs)
