// Shepherdr's own small files: what herdr can't tell it (projects, modes, update cards, drafts, push devices).
// One folder, ~/.lineclear unless LINECLEAR_HOME says otherwise; each file is plain JSON, written whole.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { held } from './live/loop-lag.ts'

/** where the server listens unless LINECLEAR_PORT says otherwise (7420 is the board's web pages) */
export const DEFAULT_PORT = 7421

export const HOME = process.env.LINECLEAR_HOME || (process.env.NODE_ENV === 'test' ? testHome() : join(homedir(), '.lineclear'))

/** under bun test, never the real ~/.lineclear (however the tests were started): an empty folder of their own */
function testHome() {
  const dir = mkdtempSync(join(tmpdir(), 'shep-test-home-'))
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
  return dir
}

export function readJson<T>(name: string, fallback: T): T {
  const f = join(HOME, name)
  try {
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

/** secrets (keys, push subscriptions) are readable by you only */
const PRIVATE = new Set(['secrets.json', 'vapid.json', 'push.json'])

export function writeJson(name: string, value: unknown) {
  held(`store write ${name}`, () => writeJsonNow(name, value))
}

function writeJsonNow(name: string, value: unknown) {
  const f = join(HOME, name)
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
  const tmp = `${f}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: PRIVATE.has(name) ? 0o600 : 0o644 })
  renameSync(tmp, f)
}
