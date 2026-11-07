// Lineclear's own small files: what herdr can't tell it (projects, modes, update cards, drafts, push devices).
// One folder, ~/.lineclear unless LINECLEAR_HOME says otherwise. `store.sqlite` there is the state, with transactions;
// the JSON helpers below are the old way, which each later step moves into rows with `importOnce`.
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** where the server listens unless LINECLEAR_PORT says otherwise (the web pages and the rule loop run in the same process) */
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
  const f = join(HOME, name)
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
  const tmp = `${f}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: PRIVATE.has(name) ? 0o600 : 0o644 })
  renameSync(tmp, f)
}

const STORE_FILE = join(HOME, 'store.sqlite')

/** The store cannot open: the board stops with this, naming the file, instead of running on an empty store. */
export class StoreError extends Error {
  constructor(file: string, cause: unknown) {
    super(
      `lineclear: the store ${file} cannot be opened (${cause instanceof Error ? cause.message : String(cause)}). Nothing was changed: fix or move the file, then start again.`,
    )
  }
}

/** Opens (and creates) the store file in WAL mode; a file that is not a healthy database throws a StoreError. */
export function openStore(file = STORE_FILE): Database {
  let handle: Database | undefined
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    handle = new Database(file, { create: true })
    handle.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;')
    const check = handle.query('PRAGMA quick_check').all() as { quick_check: string }[]
    if (check.length !== 1 || check[0]?.quick_check !== 'ok') throw new Error(check.map((r) => r.quick_check).join('; '))
    return handle
  } catch (e) {
    handle?.close()
    throw new StoreError(file, e)
  }
}

let opened: Database | undefined

/** The board's store, opened on first use so that main.ts can name a failure before anything else runs. */
export const db: Database = new Proxy({} as Database, {
  get(_, key) {
    opened ??= openStore()
    const value = Reflect.get(opened, key, opened)
    return typeof value === 'function' ? value.bind(opened) : value
  },
})

/** Runs `fn` in one write transaction: it all happens or none of it does. */
export function tx<T>(fn: (store: Database) => T): T {
  return db.transaction(() => fn(db)).immediate()
}

/**
 * Turns an old JSON file of HOME into rows once: `load` gets its parsed content inside the transaction, then the file
 * is renamed `<name>.imported`. A file that does not parse is left in place and the error stops the caller.
 */
export function importOnce<T>(name: string, load: (content: T, store: Database) => void): boolean {
  const file = join(HOME, name)
  if (!existsSync(file)) return false
  let content: T
  try {
    content = JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (e) {
    throw new Error(`lineclear: ${file} cannot be read for import (${e instanceof Error ? e.message : String(e)}). Nothing was changed.`)
  }
  // the import is recorded in the same transaction as its rows, so a crash before the rename never imports it twice
  tx((store) => {
    store.exec('create table if not exists imports (name text primary key)')
    if (store.query('select 1 from imports where name = ?').get(name)) return
    load(content, store)
    store.query('insert into imports (name) values (?)').run(name)
  })
  renameSync(file, `${file}.imported`)
  return true
}
