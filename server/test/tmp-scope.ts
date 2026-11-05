// Preloaded before every test process (bunfig.toml): the process gets a temp folder of its own and TMPDIR points at it,
// so everything a test makes with os.tmpdir() (and every child process, Playwright profiles included) lands inside it.
// It is removed when the tests end, whether they passed or not.
import { afterAll } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

// Under a check, TMPDIR is already a folder of the run on disk. Alone, the root is on disk too (/tmp is often RAM).
const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lineclear', 'tmp')
const root = tmpdir().startsWith(cache) ? tmpdir() : cache
mkdirSync(root, { recursive: true })
const scope = mkdtempSync(join(root, 'lc-test-'))
process.env.TMPDIR = scope
const remove = () => rmSync(scope, { force: true, recursive: true })
// bun test ends without an exit event, so the end of the tests is what clears it (exit stays for plain bun runs)
afterAll(remove)
process.on('exit', remove)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
  process.on(signal, () => {
    remove()
    process.exit(1)
  })
