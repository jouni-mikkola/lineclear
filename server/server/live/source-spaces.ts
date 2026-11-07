import { randomUUID } from 'node:crypto'
import { dirname, join, sep } from 'node:path'
import { STATUS_MAX, type ActivityAnswer, type ActivityAsk, type AddSpace, type Folders, type WorktreeAsk } from '../../shared/types.ts'
import { one, type Parsed } from './args.ts'
import { line } from './chatlines.ts'
import { ended } from './engine/engine.ts'
import { fitStatus } from './engine/status-line.ts'
import { listFolders, makeRepo, resolveInHome } from './folders.ts'
import { BOX, boxHome } from './box.ts'
import { fileType } from '../../shared/files.ts'
import { boxDir } from './mfs.ts'
import * as task from './mfs.ts'
import { HOST, NAME, placeId } from './places.ts'
import { SECRET_NAME } from './secrets.ts'
import { diffFiles, diffPatch, listFiles, pullRequest, readFile } from './worktree.ts'
import { has } from '../plugins.ts'
import { minutesOf, chatDir, sharedEverywhere } from './source-helpers.ts'
import type { LiveSource } from './source.ts'
import { LiveSourceViews } from './source-views.ts'

export class LiveSourceSpaces extends LiveSourceViews {
  /** the space a needs-you card's answer came from, when that is the task's own space */
  protected spaceOf(key: string, space?: string) {
    return space && key.endsWith('/Agent') && this.engine.task(key.slice(0, -'/Agent'.length))?.project === space ? space : undefined
  }

  /** the machine an artifact lives on, when it is not this one */
  protected artifactPeer(id: string) {
    if (this.artifacts.get(id)) return undefined
    return this.peers?.list().find((l) => l.snap?.artifacts?.some((x) => x.id === id))
  }

  async artifact(id: string, v?: number): Promise<{ html: string; data?: unknown; sent?: string } | undefined> {
    const peer = this.artifactPeer(id)
    if (peer) {
      const r = await this.peers!.fetch(peer, `/api/artifacts/${encodeURIComponent(id)}/raw${v ? `?v=${v}` : ''}`).catch(() => null)
      return r?.ok ? ((await r.json()) as { html: string; data?: unknown; sent?: string }) : undefined
    }
    const a = this.artifacts.get(id)
    const html = a && this.artifacts.html(a, v)
    return html ? { html, data: this.artifacts.data(a, v), sent: this.artifacts.sentFor(a, v) } : undefined
  }

  async artifactThumb(id: string, dark: boolean): Promise<Blob | null> {
    const peer = this.artifactPeer(id)
    if (peer) {
      const r = await this.peers!.fetch(peer, `/api/artifacts/${encodeURIComponent(id)}/thumb${dark ? '?dark=1' : ''}`).catch(() => null)
      return r?.ok ? r.blob() : null
    }
    const a = this.artifacts.get(id)
    const f = a?.thumb ? Bun.file(this.artifacts.thumbFile(a.id, dark)) : null
    return f && (await f.exists()) ? f : null
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
      const reply = await this.chats.readReply(k).catch(() => false)
      // what runs in the background shows live too, though its agent writes nothing meanwhile
      const jobs = this.chats.jobsChanged(k)
      if (pulled || menu || reply || jobs) this.emit('chat', k)
    }
  }

  async upload(chat: string, name: string, data: Uint8Array) {
    // a file lands on the machine of the agent it is for
    const peer = this.peers?.owner(chat)
    if (peer) {
      const body = new FormData()
      body.append('chat', chat)
      body.append('file', new File([new Uint8Array(data)], name))
      const r = await this.peers!.fetch(peer, '/api/upload', { method: 'POST', body })
      return ((await r.json()) as { path: string }).path
    }
    // on the machine of the agent it is for: there it reads it
    const dir = join(boxDir(), 'inbox', chatDir(chat))
    task.mkdirSync(dir, { recursive: true })
    const safe = name.replace(/[^a-zA-Z0-9_. -]+/g, '_').slice(0, 120) || 'file'
    // its own path even next to a file of the same name: a reaction names the file by it
    const f = join(dir, `${Date.now().toString(36)}${randomUUID().slice(0, 4)}-${safe}`)
    task.writeFileSync(f, data)
    return f
  }

  async attachment(chat: string, path: string) {
    // only a file attached in this chat, or uploaded for it and still waiting in the message box, and only from the
    // inbox: a path that leads anywhere else is refused
    const c = this.chat(chat)
    if (!c) return null
    const sent = c.messages.some((m) => m.file?.path === path)
    const peer = this.peers?.owner(chat)
    if (peer) {
      const r = await this.peers!.fetch(peer, `/api/file?chat=${encodeURIComponent(chat)}&path=${encodeURIComponent(path)}`).catch(() => null)
      return r?.ok ? r.blob() : null
    }
    try {
      const inbox = task.realpathSync(join(boxDir(), 'inbox'))
      const real = task.realpathSync(path.replace(/^~(?=\/)/, boxHome()))
      // a file sent before this machine was run from the main one is still in its own install's inbox
      const old = () => {
        try {
          return BOX ? real.startsWith(task.realpathSync(join(boxHome(), '.lineclear', 'inbox')) + sep) : false
        } catch {
          return false
        }
      }
      const ok = sent ? real.startsWith(inbox + sep) || old() : dirname(real) === join(inbox, chatDir(chat))
      if (!ok || !task.statSync(real).isFile()) return null
      return BOX ? new Blob([new Uint8Array(task.readFileSync(real))], { type: fileType(real).type }) : Bun.file(real)
    } catch {
      return null
    }
  }

  /* ---------- a chat's activity: a turn's steps, a step's output, a background job ---------- */

  async activity(ask: ActivityAsk): Promise<ActivityAnswer> {
    const peer = this.peers?.owner(ask.chat)
    if (peer) {
      if (!peer.reachable) return { error: `Can't reach ${peer.rec.machine} right now.` }
      return this.onPeer(peer, `/api/activity?${new URLSearchParams({ chat: ask.chat, what: ask.what, id: ask.id })}`)
    }
    if (!this.agents.record(ask.chat)) return { error: 'No such chat.' }
    return this.chats.activity(ask)
  }

  /* ---------- a task's worktree, for its side panel ---------- */

  /** what PR a task has, asked of gh: kept a little while, so a panel open on many screens asks GitHub once */
  protected prs = new Map<string, { at: number; v: Promise<unknown> }>()

  async worktree(ask: WorktreeAsk): Promise<unknown> {
    if (!has('worktree')) throw new Error('The worktree plugin is off.')
    const peer = this.peers?.owner(ask.task)
    if (peer) {
      if (!peer.reachable) throw new Error(`Can't reach ${peer.rec.machine} right now.`)
      const q = new URLSearchParams({ task: ask.task, what: ask.what, ...('path' in ask ? { path: ask.path } : {}) })
      return this.onPeer(peer, `/api/worktree?${q}`)
    }
    const t = this.engine.tasks.find((x) => x.id === ask.task && this.places.space(x.project))
    if (!t) throw new Error(`No task ${ask.task}.`)
    if (!t.worktree || !task.existsSync(t.worktree))
      throw new Error(ended(t) ? `${t.id} is Done (${t.closed ? 'nothing to merge' : 'merged'}): its worktree was put away.` : `${t.id} has no worktree yet.`)
    const base = t.base ?? this.places.space(t.project)!.base
    if (ask.what === 'files') return listFiles(t.worktree)
    if (ask.what === 'file') return readFile(t.worktree, ask.path)
    if (ask.what === 'diff') return diffFiles(t.worktree, base)
    if (ask.what === 'patch') return diffPatch(t.worktree, base, ask.path)
    const had = this.prs.get(t.id)
    if (had && Date.now() - had.at < 30_000) return had.v
    const v = pullRequest(t.worktree, t.branch ?? '')
    for (const [k, x] of this.prs) if (Date.now() - x.at > 300_000) this.prs.delete(k)
    this.prs.set(t.id, { at: Date.now(), v })
    return v
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

  async folders(machine: string, path: string): Promise<Folders> {
    const l = this.peerFor(machine)
    if (l) return this.onPeer(l, `/api/folders?machine=${encodeURIComponent(machine)}&path=${encodeURIComponent(path)}`)
    return listFolders(
      path,
      this.places.spaces.map((p) => p.path),
    )
  }

  async addSpace(req: AddSpace): Promise<{ place: string }> {
    const l = this.peerFor(req.machine)
    if (l) return this.onPeer(l, '/api/spaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })
    const name = req.name === undefined ? undefined : req.name.trim()
    const bad = name === undefined ? undefined : this.places.nameProblem(name)
    if (bad) throw new Error(bad)
    // never git init the home folder itself: it is the home space already
    if (resolveInHome(req.path).abs === resolveInHome('~').abs) throw new Error('Your home folder is the home space already: pick a folder in it.')
    const at = req.create ? await makeRepo(req.path) : resolveInHome(req.path).abs
    const pr = await this.addAsSpace(at, name)
    return { place: placeId.space(pr.name) }
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

  /** a slash command you typed: into the CLI as typed, once its turn is over, and no answer to a card or go for a
   *  queued task. Files with it follow as a message of their own. */
  protected async slashCommand(key: string, text: string, files: string[], cid?: string) {
    // a task held before it ever started has no CLI yet: your words start it
    if (key.includes('/') && this.engine.unstarted(key.split('/')[0])) return this.send(key, text, files, false, cid)
    const at = Date.now()
    const ensure = key.includes('/') ? () => this.resumeTaskAgent(key) : () => this.coordinator(key)
    if (!key.includes('/') && this.agents.status(key) === 'gone') await this.coordinator(key).catch(() => undefined)
    const r = await this.agents.send(key, text, { ensure, cid, idle: true, command: true })
    if (key.includes('/')) this.engine.youWrote(key, { go: false })
    if (files.length) await this.send(key, '', files)
    this.emit('chat', key)
    return { waiting: r.waiting, waitsFor: r.waitsFor, at }
  }

  protected async react(key: string, messageId: string, emoji: string) {
    if (!has('reactions')) return { ok: false }
    const chat = this.chats.chat(key)
    const m = chat.messages.find((x) => x.id === messageId)
    // an artifact's card by its title, id and the version posted
    const art = !m?.text && !m?.file && m?.artifact && this.artifacts.get(m.artifact.id)
    if (!m || !(m.text || m.file || art)) return { ok: false }
    const mine = m.reactions?.find((r) => r.emoji === emoji && (r.by === 'me' || r.by === 'both'))
    // a file is named with its path: two files may share a name
    const f = m.text ? undefined : m.file
    const text = art
      ? (mine ? line.unreactArtifact : line.reactArtifact)(this.user, emoji, line.artifact(art.title, art.id, m.artifact!.v))
      : f
        ? (mine ? line.unreactFile : line.reactFile)(this.user, emoji, f.name, f.path)
        : (mine ? line.unreact : line.react)(this.user, emoji, m.text!)
    await this.agents.send(key, text, {
      reaction: { message: messageId, emoji },
      ensure: key.includes('/') ? () => this.resumeTaskAgent(key) : () => this.coordinator(key),
    })
    this.emit('chat', key)
    return {}
  }

  protected menuAnswers = new Set<string>()

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

  /** each name's value, for lineclear secret run and env (names may come comma-separated) */
  protected secretValues(words: string[], chain: string[]) {
    const names = words
      .flatMap((w) => w.split(','))
      .map((w) => w.trim())
      .filter(Boolean)
    if (!names.length) throw new Error('lineclear secret run NAME [NAME …] -- <command>, or lineclear secret env NAME [NAME …] [--file .env]')
    const bad = names.filter((n) => !SECRET_NAME.test(n))
    if (bad.length) throw new Error(`Not a secret's name: ${bad.join(', ')} (letters, digits and _, like GITHUB_TOKEN)`)
    const { found, missing } = this.vault.pick(names, chain)
    if (missing.length)
      throw new Error(
        `No secret ${missing.join(', ')} here. Ask the human for it: lineclear secret ask ${missing[0]} --why "<what it is for>", then end your turn.`,
      )
    return Object.fromEntries(Object.entries(found).map(([n, f]) => [n, f.value]))
  }
}
