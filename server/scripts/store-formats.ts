// The store's files as this build reads and writes them:
// - `bun scripts/store-formats.ts read <dir> [--older]` prints one line per file in <dir> this build cannot read, and
//   exits 1 if there is one. It reads a copy, so <dir> may be a live store. A promotion runs stable's copy on the store
//   next wrote, where a value stable would drop is lost after a rollback; and next's copy with --older on this
//   machine's own store, where a value next drops is one of its own upgrades and only a failure to read counts.
// - `bun scripts/store-formats.ts count <dir>` prints the tasks, chats and Inbox items (need cards) of <dir> as JSON, so
//   a rollback can be shown to lose none.
// - `bun scripts/store-formats.ts write <dir>` writes a small store with this build's own code, for the check before a
//   merge: the installed stable build must read it.
import { copyFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type ChatFile = { posted?: { id?: unknown; card?: { id?: unknown; status?: unknown } }[]; answers?: unknown }
type Values = Record<string, string>
type Levels = { everywhere?: Values; machine?: Values; spaces?: Record<string, Values> }

/** The files the server keeps its settings, spaces and tasks in; the database with its journals. */
const FILES = ['settings.json', 'tasks.json', 'spaces.json', 'task-ids.sqlite', 'task-ids.sqlite-wal', 'task-ids.sqlite-shm']

const [verb, dir] = process.argv.slice(2)
const older = process.argv.includes('--older')
if ((verb !== 'read' && verb !== 'write' && verb !== 'count') || !dir) {
  console.error('usage: store-formats.ts read <dir> [--older] | count <dir> | write <dir>')
  process.exit(2)
}
const home = verb !== 'write' ? mkdtempSync(join(tmpdir(), 'store-formats-')) : dir
if (verb !== 'write') {
  for (const f of FILES) if (existsSync(join(dir, f))) copyFileSync(join(dir, f), join(home, f))
  if (existsSync(join(dir, 'chatlog'))) cpSync(join(dir, 'chatlog'), join(home, 'chatlog'), { recursive: true })
}
// the store's folder is read when its module loads
process.env.LINECLEAR_HOME = home
const { writeJson } = await import('../server/store.ts')
const { Settings } = await import('../server/live/settings.ts')
const { Places, placeId } = await import('../server/live/places.ts')
const { TaskIds } = await import('../server/live/task-ids.ts')
type TaskRec = import('../server/live/engine/engine.ts').TaskRec
type Space = import('../server/live/places.ts').Space

const json = (name: string): unknown => JSON.parse(readFileSync(join(home, name), 'utf8'))

/** Every value set must be one this build keeps: the server drops a key it does not know when it next saves. */
function settings(): string[] {
  const raw = json('settings.json') as Levels
  // the reader changes what it is given (old heartbeat keys), so it gets its own copy
  const read = new Settings(structuredClone({ everywhere: raw.everywhere ?? {}, machine: raw.machine ?? {}, spaces: raw.spaces ?? {} }))
  if (older) return []
  const levels: [string, Values, 'all' | 'machine' | { space: string }][] = [
    ['everywhere', raw.everywhere ?? {}, 'all'],
    ['machine', raw.machine ?? {}, 'machine'],
    ...Object.entries(raw.spaces ?? {}).map(([space, v]): [string, Values, { space: string }] => [`space ${space}`, v, { space }]),
  ]
  const lost: string[] = []
  for (const [name, values, level] of levels) {
    for (const [key, value] of Object.entries(values)) if (read.pick(key, level).value !== value) lost.push(`${name} ${key}`)
  }
  return lost.length ? [`settings.json: this build would drop ${lost.join(', ')}`] : []
}

// The server reads tasks.json and spaces.json as they are (engine.ts, places.ts), with no reader of its own to call:
// these checks are the fields its code looks tasks and spaces up by.
function tasks(): string[] {
  const d = json('tasks.json') as { next?: unknown; tasks?: unknown }
  if (typeof d.next !== 'object' || !Array.isArray(d.tasks)) return ['tasks.json: no next or tasks list']
  const bad = (d.tasks as Record<string, unknown>[]).filter(
    (t) => typeof t.id !== 'string' || typeof t.n !== 'number' || typeof t.project !== 'string' || typeof t.title !== 'string',
  )
  return bad.length ? [`tasks.json: ${bad.length} task(s) without an id, number, project or title`] : []
}

function spaces(): string[] {
  const d = json('spaces.json')
  const ok = Array.isArray(d) && d.every((s) => typeof s?.name === 'string' && typeof s?.path === 'string' && typeof s?.key === 'string')
  return ok ? [] : ['spaces.json: not a list of spaces with a name, path and key']
}

/** The task ids each space has used, read with the server's own database code, as an engine starting would. */
function taskIds(): string[] {
  const list = (existsSync(join(home, 'spaces.json')) ? json('spaces.json') : []) as Space[]
  const legacy = (existsSync(join(home, 'tasks.json')) ? json('tasks.json') : { next: {}, tasks: [] }) as { next: Record<string, number>; tasks: TaskRec[] }
  const ids = new TaskIds(list, legacy, (name) => placeId.space(name), home)
  ids.keys()
  for (const s of list) ids.get(placeId.space(s.name))
  return []
}

/** Chats and the Inbox live in chatlog/: the server falls back to an empty chat on a file it cannot parse, so a bad one loses its cards. */
function chats(): string[] {
  const bad = chatFiles().filter(([, d]) => !d || !Array.isArray(d.posted) || typeof d.answers !== 'object' || d.answers === null)
  return bad.length ? [`chatlog: ${bad.map(([f]) => f).join(', ')} not a chat with a posted list and answers`] : []
}

function chatFiles(): [string, ChatFile | null][] {
  const dir = join(home, 'chatlog')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f): [string, ChatFile | null] => {
      try {
        return [f, JSON.parse(readFileSync(join(dir, f), 'utf8'))]
      } catch {
        return [f, null]
      }
    })
}

function count() {
  const files = chatFiles()
  const inbox = new Set<string>()
  for (const [, d] of files) for (const p of d?.posted ?? []) if (p?.card?.status === 'need') inbox.add(String(p.card.id ?? p.id))
  const tasks = existsSync(join(home, 'tasks.json')) ? (json('tasks.json') as { tasks?: unknown[] }).tasks : []
  return { tasks: tasks?.length ?? 0, chats: files.length, inbox: inbox.size }
}

function read(): string[] {
  const out: string[] = []
  const readers: [string, () => string[]][] = [
    ['settings.json', settings],
    ['tasks.json', tasks],
    ['spaces.json', spaces],
    ['chatlog', chats],
    ['task-ids.sqlite', taskIds],
  ]
  for (const [name, check] of readers) {
    if (!existsSync(join(home, name))) continue
    try {
      out.push(...check())
    } catch (e) {
      out.push(`${name}: ${(e as Error).message}`)
    }
  }
  return out
}

function write() {
  const settings = new Settings()
  settings.set('brief.review', 'on', 'all')
  settings.set('brief.review', 'off', 'machine')
  const places = new Places()
  places.spaces.push({ name: 'sample', path: '/tmp/sample', key: 'SAM', github: null, base: 'main', added: 1 })
  places.save()
  const task: TaskRec = { id: 'SAM-1', n: 1, project: placeId.space('sample'), title: 'A sample task', desc: 'Its brief', by: 'sample', created: 1, updated: 1 }
  const store = { next: { SAM: 1 }, tasks: [task] }
  writeJson('tasks.json', store)
  new TaskIds(places.spaces, store, (name) => placeId.space(name), home)
  writeJson('chatlog/SAM-1_Agent.json', { posted: [{ at: 1, id: 'm1', card: { id: 'ask1', status: 'need', task: 'SAM-1' } }], answers: {} })
}

if (verb === 'write') write()
else if (verb === 'count') {
  console.log(JSON.stringify(count()))
  rmSync(home, { recursive: true, force: true })
} else {
  const bad = read()
  rmSync(home, { recursive: true, force: true })
  for (const b of bad) console.log(b)
  process.exit(bad.length ? 1 : 0)
}
