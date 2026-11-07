import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clock } from '../../shared/time.ts'
import type { Chat } from '../../shared/types.ts'
import { type Link, workerHome } from './machines-helpers.ts'
import { MachinesLinks } from './machines-links.ts'

export class MachinesActions extends MachinesLinks {
  chat(key: string): Chat | undefined {
    return this.owner(key)?.chats.get(key)
  }

  /** pass a request (pages, files) through to the machine that has it */
  async fetch(l: Link, path: string, init?: RequestInit) {
    if (!l.rec.url) throw new Error(`${l.rec.machine} isn't running yet.`)
    return fetch(`${l.rec.url}${path}`, init)
  }

  /* ---------- lineclear doctor ---------- */

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
      const missing = p ? [!p.tools.gh && 'gh (pull requests of GitHub repos)', !p.tools.pi && 'pi'].filter(Boolean) : []
      out.push(
        `${l.rec.machine} (${l.saved.target}): ${l.lacks.length ? `needs ${l.lacks.join(', ')}` : l.state.startsWith("Can't") || l.state.startsWith('herdr') ? l.state : 'helper put there again, worker started again'}${missing.length ? `; not there: ${missing.join(', ')}` : ''}`,
      )
    }
    return out.length ? out : ['No other machines saved in herdr (herdr machine add <ssh target> adds one).']
  }

  /** each machine's line for Settings → Machines */
  rows() {
    return [...this.links.values()].map((l) => ({
      name: l.rec.machine,
      state: l.failed
        ? `${l.failed}; ${l.waiting.length} waiting`
        : l.reachable && l.state === 'Ready'
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
      return readFileSync(join(workerHome(label), 'worker.log'), 'utf8')
        .split('\n')
        .slice(-20)
        .join('\n')
    } catch (e) {
      return `Can't read the log: ${(e as Error).message}`
    }
  }
}
