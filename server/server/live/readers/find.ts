// Where pi keeps an agent's log file. The home follows pi's own setting, PI_CODING_AGENT_DIR (tests point it at fixtures).
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const piHome = () => process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent')

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/[/\\]+$/, '') : p)

/** pi names a session folder "--<cwd without its leading slash, / \ and : turned into ->--" */
export function piSessionDir(cwd: string): string {
  const name = `--${trimSlash(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  return join(piHome(), 'sessions', name)
}

/** the newest pi session log for this cwd, changed at or after sinceMs */
export function findPiLog(cwd: string, sinceMs = 0): string | undefined {
  const dir = piSessionDir(cwd)
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

/** which CLI wrote this log, by where it lies: an agent a backup took over from may have older logs of another */
export function logKind(file: string): string | undefined {
  return file.startsWith(`${trimSlash(join(piHome(), 'sessions'))}/`) ? 'pi' : undefined
}
