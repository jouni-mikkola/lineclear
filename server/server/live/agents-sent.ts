import type { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { HOME } from '../store.ts'
import { importOlder, inTx, lines, parse, storeOf } from './agent-rows.ts'
import type { OutItem } from './agents-helpers.ts'

/** internal news carries a cid of this form and is never a screen's message */
export const isNews = (cid?: string) => !!cid?.startsWith('requested-news:')
const LATELY = 600_000
const KEPT_ITEMS = 200
const KEPT_RECEIPTS = 1000

type Line = { item: OutItem } | { receipt: string }

/** What went into the agents' panes: the items of the last ten minutes (what a merge checks the agent has read, and what a
 *  screen's id is given back for) and the ids of internal news already delivered. A row of `typed` per delivery. */
export class SentLog {
  private h: Database
  private items: OutItem[] = []
  private receipts = new Set<string>()
  private itemRows = 0

  constructor(private dir = HOME) {
    this.h = storeOf(dir)
    this.load()
  }

  /** the lines of sent.jsonl and the receipts of the older requested-news-receipts.json, in the order they were written */
  private importOlder() {
    const receiptsFile = join(this.dir, 'requested-news-receipts.json')
    const sent = join(this.dir, 'sent.jsonl')
    importOlder(this.h, 'sent.jsonl', [sent, receiptsFile, join(this.dir, 'typed.json')], (s) => {
      const put = s.query('insert into typed (kind, json) values (?, ?)')
      for (const r of (parse(receiptsFile) as string[] | undefined) ?? []) put.run('receipt', JSON.stringify(r))
      for (const line of lines(sent) as Line[]) {
        if ('item' in line) put.run('item', JSON.stringify(line.item))
        else if ('receipt' in line) put.run('receipt', JSON.stringify(line.receipt))
      }
    })
  }

  private load() {
    this.importOlder()
    const now = Date.now()
    const rows = this.h.query('select seq, kind, json from typed order by seq').all() as { seq: number; kind: string; json: string }[]
    const items: { seq: number; item: OutItem }[] = []
    const receipts: { seq: number; cid: string }[] = []
    for (const r of rows) {
      const v = JSON.parse(r.json)
      if (r.kind === 'item') items.push({ seq: r.seq, item: v as OutItem })
      else if (!receipts.some((x) => x.cid === v)) receipts.push({ seq: r.seq, cid: v as string })
    }
    const keepItems = items.filter((i) => now - i.item.at < LATELY).slice(-KEPT_ITEMS)
    const keepReceipts = receipts.slice(-KEPT_RECEIPTS)
    const keep = new Set([...keepItems.map((i) => i.seq), ...keepReceipts.map((r) => r.seq)])
    const drop = rows.filter((r) => !keep.has(r.seq))
    if (drop.length) inTx(this.h, (s) => drop.forEach((r) => s.query('delete from typed where seq = ?').run(r.seq)))
    this.items = keepItems.map((i) => i.item)
    this.itemRows = keepItems.length
    this.receipts = new Set(keepReceipts.map((r) => r.cid))
  }

  /** `item` went into its agent's pane */
  record(item: OutItem, now = Date.now()) {
    const entry = { ...item, at: now }
    this.items = [...this.items.filter((o) => now - o.at < LATELY), entry].slice(-KEPT_ITEMS)
    const news = item.cid && isNews(item.cid) && !this.receipts.has(item.cid)
    inTx(this.h, (s) => {
      s.query('insert into typed (kind, json) values (?, ?)').run('item', JSON.stringify(entry))
      if (news) s.query('insert into typed (kind, json) values (?, ?)').run('receipt', JSON.stringify(item.cid))
      // rows many times what is kept are dropped in one go
      if (++this.itemRows > 2 * KEPT_ITEMS) {
        s.query("delete from typed where kind = 'item' and seq not in (select seq from typed where kind = 'item' order by seq desc limit ?)").run(KEPT_ITEMS)
        this.itemRows = KEPT_ITEMS
      }
      if (news) this.receiptAdded(s, item.cid as string)
    })
  }

  private receiptAdded(s: Database, cid: string) {
    this.receipts.add(cid)
    if (this.receipts.size <= KEPT_RECEIPTS) return
    this.receipts.delete(this.receipts.values().next().value as string)
    s.query("delete from typed where kind = 'receipt' and seq not in (select seq from typed where kind = 'receipt' order by seq desc limit ?)").run(
      KEPT_RECEIPTS,
    )
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
