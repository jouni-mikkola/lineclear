import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clock } from '../../shared/time.ts'
import type { Chat } from '../../shared/types.ts'
import { type Link, machineHome } from './machines-helpers.ts'
import { MachinesLinks } from './machines-links.ts'

export class MachinesActions extends MachinesLinks {
  subscribeChat(l: Link, key: string, fn: (chat: Chat) => void) {
    const keys = this.voiceWatches.get(l) ?? new Map<string, number>()
    keys.set(key, (keys.get(key) ?? 0) + 1)
    this.voiceWatches.set(l, keys)
    const off = this.on('peerChat', (machine, k, chat) => {
      if (machine === l.rec.machine && k === key) fn(chat)
    })
    this.watch(this.screenWatch.chats, this.screenWatch.term)
    let active = true
    return () => {
      if (!active) return
      active = false
      off()
      const count = keys.get(key) ?? 0
      if (count <= 1) keys.delete(key)
      else keys.set(key, count - 1)
      if (!keys.size) this.voiceWatches.delete(l)
      this.watch(this.screenWatch.chats, this.screenWatch.term)
    }
  }

  chat(key: string): Chat | undefined {
    return this.owner(key)?.chats.get(key)
  }

  /** pass a request (pages, files) through to the machine that has it */
  async fetch(l: Link, path: string, init?: RequestInit) {
    if (!l.rec.url) throw new Error(`${l.rec.machine} isn't running yet.`)
    return fetch(`${l.rec.url}${path}`, init)
  }

  /* ---------- shepherdr doctor ---------- */

  /** check every machine and repair what is missing: the helper put there again, its worker started again */
  async doctor(): Promise<string[]> {
    await this.sync()
    const out: string[] = []
    for (const l of this.links.values()) {
      if (l.worker) {
        l.worker.kill()
        await l.worker.exited
        l.worker = undefined
      }
      await this.start(l, true)
      const p = l.probe
      const missing = p
        ? [!p.tools.gh && 'gh (pull requests of GitHub repos)', !p.tools.claude && 'Claude Code', !p.tools.codex && 'Codex'].filter(Boolean)
        : []
      out.push(
        `${l.rec.machine} (${l.saved.target}): ${l.lacks.length ? `needs ${l.lacks.join(', ')}` : l.state.startsWith("Can't") || l.state.startsWith('herdr') ? l.state : 'helper put there again, worker started again'}${missing.length ? `; not there: ${missing.join(', ')}` : ''}${l.chrome ? `; ${l.chrome}` : ''}`,
      )
    }
    return out.length ? out : ['No other machines saved in herdr (herdr machine add <ssh target> adds one).']
  }

  /** each machine's line for Settings → Machines */
  rows() {
    return [...this.links.values()].map((l) => ({
      name: l.rec.machine,
      state:
        l.reachable && l.state === 'Ready'
          ? `Ready · ${l.saved.target}`
          : l.reachable
            ? l.state
            : l.connecting
              ? 'Connecting…'
              : l.down && l.rec.url
                ? `Can't reach since ${clock(l.down)}`
                : l.state,
    }))
  }

  /** the worker's own log, for the doctor */
  log(label: string) {
    try {
      return readFileSync(join(machineHome(label), 'worker.log'), 'utf8')
        .split('\n')
        .slice(-20)
        .join('\n')
    } catch {
      return ''
    }
  }
}
