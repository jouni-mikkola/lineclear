// Lineclear's own log per chat as rows of store.sqlite: a row per posted card, per answer and per spoken answer, so a
// post or an answer writes one row, not the whole log of that chat. The old chatlog/ and archive/chatlog/ folders are
// imported once, then renamed. `n` keeps the order the cards were first posted in. Saves made in the same tick go
// out in one transaction, so a burst of posts costs one commit.
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { db, HOME, tx } from '../store.ts'
import type { ChatLog } from './chats-helpers.ts'

const SCHEMA = `
create table if not exists chatlog (n integer primary key, chat text not null, kind text not null, id text not null, json text not null, archived integer not null default 0, unique (chat, kind, id))`

type Row = { kind: string; id: string; json: string }

/** the rows a log is made of, by `kind:id` */
function rowsOf(log: ChatLog): Map<string, Row> {
  const rows = new Map<string, Row>()
  const add = (kind: string, id: string, value: unknown) => rows.set(`${kind}:${id}`, { kind, id, json: JSON.stringify(value) })
  for (const p of log.posted) add('posted', p.id, p)
  for (const [id, choice] of Object.entries(log.answers)) add('answer', id, choice)
  for (const [id, said] of Object.entries(log.said ?? {})) add('said', id, said)
  return rows
}

/** the chats of an old folder, turned into rows once; a file that does not parse is skipped and said */
function importFolder(dir: string, archived: number) {
  if (!existsSync(dir)) return
  tx((s) => {
    const put = s.query('insert or ignore into chatlog (chat, kind, id, json, archived) values (?, ?, ?, ?, ?)')
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try {
        const log = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ChatLog
        const chat = f.slice(0, -5)
        for (const r of rowsOf({ posted: log.posted ?? [], answers: log.answers ?? {}, said: log.said }).values()) put.run(chat, r.kind, r.id, r.json, archived)
      } catch (e) {
        console.error(`lineclear: ${join(dir, f)} cannot be imported: ${(e as Error).message}`)
      }
    }
  })
  renameSync(dir, `${dir}.imported`)
}

const open = new Set<ChatRows>()
process.on('exit', () => {
  for (const rows of open) rows.flush()
})

export class ChatRows {
  /** the row texts last read or written, by chat and `kind:id`: a save writes only what differs */
  private known = new Map<string, Map<string, string>>()
  /** chat rows written since this was made */
  rowWrites = 0
  private pending = new Map<string, ChatLog>()

  constructor() {
    open.add(this)
    db.exec(SCHEMA)
    importFolder(join(HOME, 'chatlog'), 0)
    importFolder(join(HOME, 'archive', 'chatlog'), 1)
  }

  load(chat: string): ChatLog {
    const log: ChatLog = { posted: [], answers: {} }
    const known = new Map<string, string>()
    const rows = db.query('select kind, id, json from chatlog where chat = ? and archived = 0 order by n').all(chat) as Row[]
    for (const r of rows) {
      known.set(`${r.kind}:${r.id}`, r.json)
      const value = JSON.parse(r.json)
      if (r.kind === 'posted') log.posted.push(value)
      else if (r.kind === 'answer') log.answers[r.id] = value
      else (log.said ??= {})[r.id] = value
    }
    this.known.set(chat, known)
    return log
  }

  /** the rows of `log` that differ from what is stored are written by the end of this tick */
  save(chat: string, log: ChatLog) {
    if (!this.pending.size) queueMicrotask(() => this.flush())
    this.pending.set(chat, log)
  }

  /** writes what `save` was given, in one transaction */
  flush() {
    const work = [...this.pending]
    this.pending.clear()
    const changes = work.map(([chat, log]) => {
      const known = this.known.get(chat) ?? new Map<string, string>()
      const now = rowsOf(log)
      return {
        chat,
        known,
        put: [...now].filter(([k, r]) => known.get(k) !== r.json),
        gone: [...known.keys()].filter((k) => !now.has(k)),
      }
    })
    if (changes.every((c) => !c.put.length && !c.gone.length)) return
    tx((s) => {
      for (const c of changes) {
        for (const [, r] of c.put) {
          s.query(
            'insert into chatlog (chat, kind, id, json) values (?, ?, ?, ?) on conflict(chat, kind, id) do update set json = excluded.json, archived = 0',
          ).run(c.chat, r.kind, r.id, r.json)
        }
        for (const k of c.gone) {
          const at = k.indexOf(':')
          s.query('delete from chatlog where chat = ? and kind = ? and id = ?').run(c.chat, k.slice(0, at), k.slice(at + 1))
        }
      }
    })
    for (const c of changes) {
      for (const [k, r] of c.put) c.known.set(k, r.json)
      for (const k of c.gone) c.known.delete(k)
      this.known.set(c.chat, c.known)
      this.rowWrites += c.put.length
    }
  }

  /** a deleted task's chat: all its rows go */
  forget(chat: string) {
    this.pending.delete(chat)
    this.known.delete(chat)
    db.query('delete from chatlog where chat = ?').run(chat)
  }
}

/** The chats of these retired tasks leave the live reads: their rows are marked archived, in one transaction. */
export function archiveChats(ids: string[]) {
  db.exec(SCHEMA)
  tx((s) => {
    const mark = s.query('update chatlog set archived = 1 where substr(chat, 1, ?) = ?')
    for (const id of ids) mark.run(id.length + 1, `${id}_`)
  })
}
