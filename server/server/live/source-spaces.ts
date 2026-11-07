import { STATUS_MAX } from '../../shared/types.ts'
import { one, type Parsed } from './args.ts'
import { fitStatus } from './engine/status-line.ts'
import { HOST, NAME, placeId } from './places.ts'
import { minutesOf, sharedEverywhere } from './source-helpers.ts'
import type { LiveSource } from './source.ts'
import { LiveSourceFiles } from './source-files.ts'

export class LiveSourceSpaces extends LiveSourceFiles {
  /** the space a needs-you card's answer came from, when that is the task's own space */
  protected spaceOf(key: string, space?: string) {
    return space && key.endsWith('/Agent') && this.engine.task(key.slice(0, -'/Agent'.length))?.project === space ? space : undefined
  }

  watch(chats: string[], terms: string[]) {
    this.peers?.watch(chats, terms[0] ?? null)
    if (this.peers) {
      chats = chats.filter((k) => !this.peers!.owner(k))
      terms = terms.filter((k) => !this.peers!.owner(k))
    }
    this.watched = chats
    this.terms = terms
    this.agents.watchTerminals(terms)
    for (const k of terms) this.agents.screen(k).then((s) => this.emit('terminal', k, s))
    for (const k of chats) this.agents.discoverLog(k)
  }

  protected async pollChats() {
    for (const k of new Set([...this.watched, ...Object.keys(this.agents.records).filter((k) => !['gone', 'working'].includes(this.agents.status(k)))])) {
      // pull first: the reply's read goes by the turn the log shows now
      const pulled = this.chats.pull(k)
      const menu = await this.chats.readMenu(k).catch(() => false)
      if (pulled || menu) this.emit('chat', k)
    }
  }

  /* ---------- adding spaces ---------- */

  /** a repo becomes a space: its own herdr space, with its coordinator in it */
  protected async addAsSpace(path: string, name?: string) {
    const pr = await this.places.add(path, name)
    this.coordinator(placeId.space(pr.name)).catch(() => undefined)
    this.emit('snapshot')
    return pr
  }

  /**
   * Lineclear forgets a space, as `lineclear space remove` and the sidebar's menu do: nothing on disk changes. Its
   * coordinator closes; its tasks, chat and mode are kept and come back if it is added again. Refused while one of its
   * tasks is working: pause or finish it first. A home space is never removed, nor a machine's last space.
   */
  protected async removeSpace(name: string) {
    if (this.places.find(name)?.id === placeId.home()) throw new Error(`${name} is ${NAME}'s home space: it can be renamed, not removed.`)
    const pr = this.places.byName(name)
    if (!pr) throw new Error(`No space called ${name}`)
    if (this.places.shown().length < 2) throw new Error(`${name} is the last space on ${NAME}: a machine always keeps one.`)
    const id = placeId.space(pr.name)
    const working = this.engine.tasks.filter((t) => t.project === id && !t.archived && this.engine.statusOf(t) === 'work').map((t) => t.id)
    if (working.length > 1) throw new Error(`${working.slice(0, -1).join(', ')} and ${working.at(-1)} are still working: pause or finish them first.`)
    if (working.length) throw new Error(`${working[0]} is still working: pause or finish it first.`)
    this.places.remove(pr.name)
    await this.agents.finish(id)
    this.emit('snapshot')
    return pr
  }

  /** the other machine a request is for; none for this one */
  protected peerFor(machine: string) {
    if (!machine || machine === HOST) return null
    const l = this.peers?.owner(placeId.machine(machine))
    if (!l) throw new Error(`No machine called ${machine}.`)
    if (!l.reachable) throw new Error(`Can't reach ${machine} right now.`)
    return l
  }

  protected async onPeer<T>(l: NonNullable<ReturnType<LiveSource['peerFor']>>, path: string, init?: RequestInit): Promise<T> {
    const r = await this.peers!.fetch(l, path, { ...init, signal: AbortSignal.timeout(20_000) })
    const b = (await r.json().catch(() => ({}))) as T & { error?: string }
    if (!r.ok) throw new Error(b.error ?? `${l.rec.machine} said ${r.status}`)
    return b
  }

  /** take the main machine's Everywhere defaults (a worker for another machine), and what a change sets going */
  protected adoptEverywhere() {
    const all = sharedEverywhere()
    if (!all || !this.settings.adopt(all)) return
    this.engine.release()
    // the restart hint of the chats open now
    for (const k of this.watched) this.emit('chat', k)
    this.emit('snapshot')
  }

  /** what a changed default sets going: Done tasks archived on time, held ones started where there is room */
  protected settingChanged(key: string) {
    if (key === 'tasks.archiveAfter') this.engine.autoArchive()
    if (key.startsWith('machine.')) this.engine.release()
    // an agent's CLI, model or effort: the restart hint of the chats open now
    if (/^(task|coordinator)\.(agent|model|effort)$/.test(key)) for (const k of this.watched) this.emit('chat', k)
    this.emit('snapshot')
  }

  /** the space a command runs for: --space, its coordinator's, its task's, or the one its folder is in */
  protected placeOfCommand(p: Parsed, ctx: { chat?: string; cwd?: string }) {
    if (one(p, 'space') || (ctx.chat?.startsWith('p:') && this.places.space(ctx.chat)) || ctx.chat?.includes('/')) return this.projectFor(p, ctx)
    return ctx.cwd ? this.places.forPath(ctx.cwd) : undefined
  }

  /** /new, which the Dispatcher's chat sends before each message: into the CLI once its turn is over, then its new
   *  session's log is read. A task's agent not started yet is started by it as by any message. */
  protected async newSession(key: string, cid?: string) {
    const at = Date.now()
    const ensure = key.includes('/') ? () => this.resumeTaskAgent(key) : () => this.coordinator(key)
    if (!key.includes('/') && this.agents.status(key) === 'gone') await this.coordinator(key).catch(() => undefined)
    const r = await this.agents.send(key, '/new', { ensure, cid, idle: true, command: true })
    this.emit('chat', key)
    return { waiting: r.waiting, waitsFor: r.waitsFor, at }
  }

  protected followNewSession(key: string, text: string, cid?: string) {
    const at = Date.now()
    this.chats.post(key, { id: `command:${at}`, who: 'you', text, cid })
    this.emit('chat', key)
    this.agents.follow(key, at)
  }

  protected projectFor(p: Parsed, ctx: { chat?: string; cwd?: string }) {
    const named = one(p, 'space')
    if (named) {
      const x = this.places.byName(named) ?? this.places.byKey(named)
      if (!x && this.places.find(named))
        throw new Error(`${named} is ${NAME}'s home space: it holds no repo, so tasks go in another space (lineclear space list).`)
      if (!x) throw new Error(`No space called ${named}; lineclear space list shows them`)
      return x
    }
    if (ctx.chat?.startsWith('p:') && this.places.space(ctx.chat)) return this.places.space(ctx.chat)!
    if (ctx.chat?.includes('/')) return this.places.space(this.engine.task(ctx.chat.split('/')[0])!.project)!
    const byPath = ctx.cwd ? this.places.forPath(ctx.cwd) : undefined
    if (byPath) return byPath
    if (this.places.spaces.length === 1) return this.places.spaces[0]
    throw new Error('Which space? Add --space NAME (lineclear space list shows them)')
  }

  /** a task's agent says how far along it is: lineclear status <id> "<line>" --done <0-100> [--left 5m] */
  protected reportCommand(id: string, words: string[], p: Parsed, ctx: { chat?: string }) {
    const t = this.engine.task(id)
    if (!t) throw new Error(`No task ${id}; lineclear status <id> "<line>" --done <0-100> [--left 5m]`)
    if (ctx.chat?.includes('/') && ctx.chat.split('/')[0].toUpperCase() !== t.id.toUpperCase())
      throw new Error(`A task's agent reports only its own task's progress, not ${t.id}'s.`)
    const line = words.join(' ').trim()
    const done = (one(p, 'done') ?? '').replace(/%$/, '')
    if (!line || !/^\d{1,3}$/.test(done) || Number(done) > 100)
      throw new Error(`lineclear status ${t.id} "<what you are doing, at most ${STATUS_MAX} characters>" --done <0-100> [--left 5m|1h20m]`)
    const leftArg = one(p, 'left')
    const left = leftArg === undefined ? undefined : minutesOf(leftArg)
    // up to 99 hours: what fits under the dot ("99h")
    if (p.flags.has('left') || left === null || (left ?? 0) > 99 * 60)
      throw new Error(`--left takes a time up to 99h, like 5m, 90m or 1h20m${leftArg ? `, not ${leftArg}` : ''}`)
    if (!/[\p{L}\p{N}]/u.test(fitStatus(line))) throw new Error('Write the line in words: what you are doing now.')
    const r = this.engine.report(t.id, line, Number(done), left)
    const cut = r.msg !== line.replace(/\s+/g, ' ') ? ` (cut to ${STATUS_MAX} characters)` : ''
    return `Noted: ${t.id} shows "${r.msg}"${cut}, ${r.progress}% done${r.left !== undefined ? `, about ${r.left} min left` : ''}.`
  }
}
