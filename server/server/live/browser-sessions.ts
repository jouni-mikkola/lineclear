import { dirname } from 'node:path'
import type { BrowserDown, BrowserUp } from '../../shared/browser.ts'
import { statSync } from 'node:fs'
import { run as onBox } from './box.ts'
import { rmSync } from './mfs.ts'
import { isTaskId, usedMark, type BrowserClient, type BrowserBridge, LEAVE_MS, IDLE_MS, type Chrome, chromesIn } from './browser-helpers.ts'
import { BrowsersHubs } from './browser-hubs.ts'

export class BrowsersSessions extends BrowsersHubs {
  /** a Browser panel opened: it gets the state, the last frame and everything after */
  attach(task: string, c: BrowserClient): BrowserBridge {
    const h = this.hub(task)
    clearTimeout(h.leave)
    clearTimeout(h.idle)
    h.clients.add(c)
    c.send(JSON.stringify(this.state(h)))
    if (h.frame) c.send(h.frame)
    if (!h.up) this.start(h)
    return {
      message: (raw) => {
        let m: BrowserUp
        try {
          m = JSON.parse(raw) as BrowserUp
        } catch {
          return
        }
        this.onMessage(h, c, m).catch((e) => c.send(JSON.stringify({ type: 'error', message: (e as Error).message } satisfies BrowserDown)))
      },
      end: () => {
        h.clients.delete(c)
        h.seenAt = Date.now()
        // closed with its task: nothing is left to hand back
        if (h.clients.size || h.gone) return
        // nobody watches: the stream stops (no frames to encode), and a take-over left open goes back to the agent
        h.idle = setTimeout(() => this.disconnect(h), IDLE_MS)
        if (h.driver === 'you') h.leave = setTimeout(() => this.handBack(h), LEAVE_MS)
      },
    }
  }

  /* ---------- clean-up ---------- */

  /** the sessions agent-browser runs for Lineclear on this machine */
  protected async sessions(): Promise<string[]> {
    const r = await this.run('_', ['session', 'list'])
    return r.ok ? ((r.data?.sessions ?? []) as string[]) : []
  }

  /** a task stopped or merged: its browser closes (and with forget, a merged task's sign-ins go too) */
  async close(task: string, forget = false) {
    if (!isTaskId(task)) return
    const h = this.hubs.get(task)
    if (h) {
      this.hubs.delete(task)
      h.gone = true
      const s = JSON.stringify({ type: 'error', message: 'The browser closed with the task.', gone: true } satisfies BrowserDown)
      for (const c of h.clients) {
        c.send(s)
        c.close()
      }
      h.clients.clear()
      clearTimeout(h.leave)
      clearTimeout(h.idle)
      const up = h.up
      h.up = undefined
      up?.close()
      h.cdp?.close()
      h.fwd?.close()
      h.cdpFwd?.close()
    }
    await this.end(task)
    if (forget) {
      rmSync(this.env(task).AGENT_BROWSER_PROFILE, { recursive: true, force: true })
      rmSync(usedMark(this.env(task).AGENT_BROWSER_PROFILE), { force: true })
    }
  }

  /** a task's browser closed and its whole Chrome ended (its profile stays). still: whether to go on, asked before each
   *  step (someone may start it again meanwhile) */
  protected async end(task: string, still: () => Promise<boolean> = async () => true) {
    if ((await this.usable()) && (await this.sessions()).includes(task) && (await still())) await this.run(task, ['close'])
    // what agent-browser left running (a close that failed or timed out, a daemon gone before its Chrome): ended
    const left = (await this.chromes()).filter((c) => c.task === task)
    if (left.length && (await still())) await onBox(['kill', '-9', ...left.map((c) => String(c.pid))], { timeoutMs: 20_000 })
  }

  /** every Chrome process running in a task's profile on this machine (agent-browser starts it with --user-data-dir),
   *  with how long ago it started */
  protected async chromes(): Promise<Chrome[]> {
    const flag = `--user-data-dir=${dirname(this.env('X-1').AGENT_BROWSER_PROFILE)}/`
    const r = await onBox(['ps', '-axo', 'pid=,etime=,command='], { timeoutMs: 20_000 })
    return r.code ? [] : chromesIn(r.out, flag)
  }

  /** when each task's agent last ran a command on its browser (0: never, as far as its mark says) */
  protected async usedAt(tasks: string[]): Promise<Map<string, number>> {
    const marks = tasks.map((t) => usedMark(this.env(t).AGENT_BROWSER_PROFILE))
    return new Map(tasks.map((t, i) => [t, statSync(marks[i], { throwIfNoEntry: false })?.mtimeMs ?? 0]))
  }

  protected idling = false

  /** browsers no agent command used and no one watched for longer than their task's setting: closed with their whole
   *  Chrome, sign-ins kept. Says which tasks they were */
  async closeIdle(now = Date.now()): Promise<string[]> {
    if (this.idling || !this.o.idleClose) return []
    this.idling = true
    try {
      // a task's browser runs since its newest Chrome process started
      const since = new Map<string, number>()
      for (const c of await this.chromes()) since.set(c.task, Math.max(since.get(c.task) ?? 0, Date.now() - c.age))
      const quiet = (task: string) => {
        const h = this.hubs.get(task)
        return !h?.clients.size && !h?.starting
      }
      const due = [...since.keys()].filter((t) => isTaskId(t) && this.o.idleClose!(t) !== null && quiet(t))
      if (!due.length) return []
      const used = await this.usedAt(due)
      const closed: string[] = []
      for (const t of due) {
        const h = this.hubs.get(t)
        const last = Math.max(since.get(t)!, used.get(t) ?? 0, h?.seenAt ?? 0, h?.agentAt ?? 0)
        // looked at again, or its setting changed, meanwhile
        const after = this.o.idleClose!(t)
        if (after === null || now - last < after || !quiet(t)) continue
        if (h) {
          clearTimeout(h.idle)
          this.disconnect(h)
          h.target = ''
        }
        // until it is gone, a screen opening it or the agent using it again keeps it
        const mark = used.get(t) ?? 0
        await this.end(t, async () => quiet(t) && ((await this.usedAt([t])).get(t) ?? 0) === mark)
        closed.push(t)
      }
      return closed
    } finally {
      this.idling = false
    }
  }

  /** browsers whose task is gone, stopped or done (left over from a restart, or opened again after): closed. Says
   *  which tasks they were */
  async sweep(keep: (task: string) => boolean, forget: (task: string) => boolean): Promise<string[]> {
    const open = new Set((await this.chromes()).map((c) => c.task))
    if (await this.usable()) for (const s of await this.sessions()) open.add(s)
    const closed = [...open].filter((s) => isTaskId(s) && !keep(s))
    for (const s of closed) await this.close(s, forget(s))
    return closed
  }
}
