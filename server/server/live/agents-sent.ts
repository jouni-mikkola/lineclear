import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HOME } from '../store.ts'
import type { OutItem } from './agents-helpers.ts'

/** internal news carries a cid of this form and is never a screen's message */
export const isNews = (cid?: string) => !!cid?.startsWith('requested-news:')
const LATELY = 600_000
const KEPT_ITEMS = 200
const KEPT_RECEIPTS = 1000

type Line = { item: OutItem } | { receipt: string }

/** What went into the agents' panes: the items of the last ten minutes (what a merge checks the agent has read, and what a
 *  screen's id is given back for) and the ids of internal news already delivered. A log of lines, one appended per delivery. */
export class SentLog {
  private file: string
  private items: OutItem[] = []
  private receipts = new Set<string>()
  private lines = 0

  constructor(dir = HOME) {
    this.file = join(dir, 'sent.jsonl')
    this.load()
  }

  private load() {
    if (!existsSync(this.file)) return
    const now = Date.now()
    const items: OutItem[] = []
    const receipts: string[] = []
    for (const text of readFileSync(this.file, 'utf8').split('\n')) {
      try {
        const line = JSON.parse(text) as Line
        if ('item' in line && now - line.item.at < LATELY) items.push(line.item)
        else if ('receipt' in line && !receipts.includes(line.receipt)) receipts.push(line.receipt)
      } catch {
        // an empty line, or one cut short by a stop mid-write
      }
    }
    this.items = items.slice(-KEPT_ITEMS)
    this.receipts = new Set(receipts.slice(-KEPT_RECEIPTS))
    this.rewrite()
  }

  private rewrite() {
    const lines: Line[] = [...[...this.receipts].map((receipt) => ({ receipt })), ...this.items.map((item) => ({ item }))]
    writeFileSync(this.file, lines.map((l) => `${JSON.stringify(l)}\n`).join(''))
    this.lines = lines.length
  }

  private append(line: Line) {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    appendFileSync(this.file, `${JSON.stringify(line)}\n`)
    this.lines++
  }

  /** `item` went into its agent's pane */
  record(item: OutItem, now = Date.now()) {
    const entry = { ...item, at: now }
    this.items = [...this.items.filter((o) => now - o.at < LATELY), entry].slice(-KEPT_ITEMS)
    this.append({ item: entry })
    if (item.cid && isNews(item.cid) && !this.receipts.has(item.cid)) {
      this.receipts.add(item.cid)
      this.append({ receipt: item.cid })
    }
    // a log many times what it holds is written again from memory
    if (this.lines > 4 * (this.items.length + this.receipts.size) + 1000) this.rewrite()
  }

  received(cid: string) {
    return this.receipts.has(cid)
  }

  /** what went in with this screen's id */
  withId(cid: string) {
    return this.items.find((o) => o.cid === cid)
  }

  /** what went in with a screen's id in the last ten minutes, oldest first */
  lately(key: string) {
    return this.items.filter((o) => o.cid && o.key === key && Date.now() - o.at < LATELY)
  }

  since(key: string, at: number) {
    return this.items.filter((o) => o.key === key && o.at > at)
  }
}

/** what a screen sent and could not get in, until it is sent again or ten minutes pass */
export class SendFailures {
  private list: { key: string; cid: string; error: string; at: number }[] = []

  add(key: string, cids: string[], error: string) {
    const now = Date.now()
    this.list = [...this.list.filter((f) => now - f.at < LATELY), ...cids.map((cid) => ({ key, cid, error, at: now }))]
  }

  clear(cid: string) {
    this.list = this.list.filter((f) => f.cid !== cid)
  }

  forget(key: string) {
    this.list = this.list.filter((f) => f.key !== key)
  }

  lately(key: string) {
    return this.list.filter((f) => f.key === key && Date.now() - f.at < LATELY).map(({ cid, error }) => ({ cid, error }))
  }
}
