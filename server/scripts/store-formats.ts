// `bun scripts/store-formats.ts <dir> [--older]` prints one line per store file in <dir> this build cannot read, exits 1 if
// there is one, and reads a copy, so <dir> may be live. A promotion runs stable's copy on the store next wrote (a value stable
// would drop is lost after a rollback), and next's copy with --older on this machine's own store (only a failure to read counts).
import { copyFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Values = Record<string, string>

/** The files the server keeps its settings, spaces and tasks in; the database with its journals. */
const FILES = ['settings.json', 'tasks.json', 'spaces.json', 'task-ids.sqlite', 'task-ids.sqlite-wal', 'task-ids.sqlite-shm']

const dir = process.argv[2] ?? process.exit(console.error('usage: store-formats.ts <dir> [--older]') ?? 2)
const older = process.argv.includes('--older')
const home = mkdtempSync(join(tmpdir(), 'store-formats-'))
for (const f of FILES) if (existsSync(join(dir, f))) copyFileSync(join(dir, f), join(home, f))
if (existsSync(join(dir, 'chatlog'))) cpSync(join(dir, 'chatlog'), join(home, 'chatlog'), { recursive: true })
process.env.LINECLEAR_HOME = home
const { Settings } = await import('../server/live/settings.ts')
const { placeId } = await import('../server/live/places.ts')
const { TaskIds } = await import('../server/live/task-ids.ts')
type TaskRec = import('../server/live/engine/engine.ts').TaskRec
type Space = import('../server/live/places.ts').Space

const json = (name: string): unknown => JSON.parse(readFileSync(join(home, name), 'utf8'))

/** Every value set must be one this build keeps: the server drops a key it does not know when it next saves. */
function settings(): string[] {
  const raw = json('settings.json') as { everywhere?: Values; machine?: Values; spaces?: Record<string, Values> }
  const read = new Settings(structuredClone({ everywhere: raw.everywhere ?? {}, machine: raw.machine ?? {}, spaces: raw.spaces ?? {} }))
  if (older) return []
  const levels: [string, Values, 'all' | 'machine' | { space: string }][] = [
    ['everywhere', raw.everywhere ?? {}, 'all'],
    ['machine', raw.machine ?? {}, 'machine'],
    ...Object.entries(raw.spaces ?? {}).map(([space, v]): [string, Values, { space: string }] => [`space ${space}`, v, { space }]),
  ]
  const lost = levels.flatMap(([name, values, level]) =>
    Object.entries(values)
      .filter(([k, v]) => read.pick(k, level).value !== v)
      .map(([k]) => `${name} ${k}`),
  )
  return lost.length ? [`settings.json: this build would drop ${lost.join(', ')}`] : []
}

// The server reads tasks.json and spaces.json as they are, so these check the fields its code looks tasks and spaces up by.
function tasks(): string[] {
  const d = json('tasks.json') as { next?: unknown; tasks?: Record<string, unknown>[] }
  if (typeof d.next !== 'object' || !Array.isArray(d.tasks)) return ['tasks.json: no next or tasks list']
  const bad = d.tasks.filter((t) => typeof t.id !== 'string' || typeof t.n !== 'number' || typeof t.project !== 'string' || typeof t.title !== 'string')
  return bad.length ? [`tasks.json: ${bad.length} task(s) without an id, number, project or title`] : []
}

function spaces(): string[] {
  const d = json('spaces.json') as Record<string, unknown>[]
  const ok = Array.isArray(d) && d.every((s) => typeof s?.name === 'string' && typeof s?.path === 'string' && typeof s?.key === 'string')
  return ok ? [] : ['spaces.json: not a list of spaces with a name, path and key']
}

/** The task ids each space has used, read with the server's own database code, as an engine starting would. */
function taskIds(): string[] {
  const has = (f: string) => existsSync(join(home, f))
  const list = (has('spaces.json') ? json('spaces.json') : []) as Space[]
  const legacy = (has('tasks.json') ? json('tasks.json') : { next: {}, tasks: [] }) as { next: Record<string, number>; tasks: TaskRec[] }
  const ids = new TaskIds(list, legacy, (name) => placeId.space(name), home)
  ids.keys()
  for (const s of list) ids.get(placeId.space(s.name))
  return []
}

/** Chats and the Inbox live in chatlog/: the server falls back to an empty chat on a file it cannot parse, so a bad one loses its cards. */
function chats(): string[] {
  const dir = join(home, 'chatlog')
  const bad = readdirSync(dir).filter((f) => {
    if (!f.endsWith('.json')) return false
    try {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      return !d || !Array.isArray(d.posted) || typeof d.answers !== 'object' || d.answers === null
    } catch {
      return true
    }
  })
  return bad.length ? [`chatlog: ${bad.join(', ')} not a chat with a posted list and answers`] : []
}

const out: string[] = []
const readers: [string, () => string[]][] = [
  ['settings.json', settings],
  ['tasks.json', tasks],
  ['spaces.json', spaces],
  ['chatlog', chats],
  ['task-ids.sqlite', taskIds],
]
for (const [name, check] of readers) {
  try {
    if (existsSync(join(home, name))) out.push(...check())
  } catch (e) {
    out.push(`${name}: ${(e as Error).message}`)
  }
}
rmSync(home, { recursive: true, force: true })
for (const b of out) console.log(b)
process.exit(out.length ? 1 : 0)
