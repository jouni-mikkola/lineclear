import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { HOME } from '../store.ts'
import { hidden } from './agents.ts'
import { ended } from './engine/engine.ts'
import { NAME, placeId } from './places.ts'
import { restartLine, resumedLine } from './prompts.ts'
import { fitHarness, harnessProblem, harnessWords, recentChat, type Harness } from './restart.ts'
import { CLI_NAME } from './settings.ts'
import { chatDir } from './source-helpers.ts'
import { LiveSourceAnswers } from './source-answers.ts'

export class LiveSourceRestarts extends LiveSourceAnswers {
  /** a coordinator started again on this CLI, model and effort: the same CLI resumes its session, another takes over
   *  with its role's prompt and the chat's last words. Its tasks go on as they are; a card in its chat marks it */
  protected async restartCoordinator(id: string, to: Harness) {
    if (!this.places.coordinator(id)) throw new Error(`No place ${id}`)
    if (!this.engine.installed(to.kind)) throw new Error(`${CLI_NAME[to.kind] ?? to.kind} isn't installed on this machine.`)
    const h = fitHarness(to)
    const words = harnessWords(h)
    const from = this.agents.record(id)?.kind
    const them = CLI_NAME[from ?? ''] ?? from ?? 'Its agent'
    // read once its turn has stopped: what it said meanwhile counts
    const first = async () => {
      await this.agents.stopTurn(id)
      if (!from) return undefined
      return from === h.kind
        ? hidden(resumedLine(words), 'restart')
        : hidden(restartLine({ from: them, to: words, chat: recentChat(this.chats.chat(id).messages, them) }), 'restart')
    }
    await this.coordinator(id, { as: h, restart: first })
    const card = `restart:${id}:${Date.now()}`
    this.chats.post(id, { id: card, card: { id: card, restart: true, text: `Restarted on ${words}` } })
    if (this.watched.includes(id)) this.emit('chat', id)
    return words
  }

  /** start a coordinator or a task's agent again, on Settings' CLI, model and effort or these; save: as its space's
   *  Settings too */
  protected async restart(key: string, to: Partial<Harness>, save = false) {
    const x = this.restartable(key)
    const requested = { ...x.want, ...to, kind: to.kind ?? x.want.kind }
    const problem = harnessProblem(requested)
    if (problem) throw new Error(problem)
    const h = fitHarness(requested)
    // refused before anything is saved
    if (x.t && ended(x.t)) throw new Error(this.engine.overWords(x.t))
    if (x.t && !x.t.worktree) throw new Error(`${x.t.id} hasn't started yet: it starts on what its brief says.`)
    if (!this.engine.installed(h.kind)) throw new Error(`${CLI_NAME[h.kind] ?? h.kind} isn't installed on this machine.`)
    if (save) {
      const at = x.space ? { space: x.space } : ('machine' as const)
      for (const [k, v] of [
        ['agent', CLI_NAME[h.kind] ?? h.kind],
        ['model', h.model ?? 'default'],
        ['effort', h.effort ?? 'default'],
      ])
        if (this.settings.pick(`${x.role}.${k}`, at).value !== v) {
          const r = this.settings.set(`${x.role}.${k}`, v, at)
          if (!r.ok) throw new Error(r.error ?? `Couldn't save ${x.role}.${k}`)
          this.settingChanged(`${x.role}.${k}`)
        }
    }
    const words = x.t ? await this.engine.restart(x.t.id, h) : await this.restartCoordinator(key, h)
    this.emit('snapshot')
    this.emit('chat', key)
    return words
  }

  /** a change from the screen, shown once it is made; or why it could not be */
  protected async shown(change: () => unknown): Promise<{ ok: boolean; error?: string }> {
    try {
      await change()
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
    this.emit('snapshot')
    return { ok: true }
  }

  /** a level's name, as Settings shows it: Everywhere, this machine's, a space's */
  protected secretLevelName(level: string) {
    if (level === 'all') return 'Everywhere'
    if (level === placeId.machine()) return NAME
    return level.startsWith('p:') ? (this.places.nameOf(level) ?? level.split(':').slice(2).join(':')) : level.slice(2)
  }

  /** delete a task (its agent, herdr space, worktree, branch, chat and record) and what this side kept of its chat */
  protected async deleteTask(id: string, force: boolean) {
    const key = `${id}/Agent`
    const left = await this.engine.deleteTask(id, { force })
    rmSync(join(HOME, 'inbox', chatDir(key)), { recursive: true, force: true })
    this.emit('snapshot')
    return left
  }
}
