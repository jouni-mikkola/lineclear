import { taskIdsSection } from './task-ids.ts'
import { coordinatorRequestIds } from '../../shared/attention.ts'
import { age } from '../../shared/time.ts'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BODY_MAX, clip, lastReply, openCards, TITLE_MAX } from '../../shared/alerts.ts'
import type { Action, Alert, Artifact, CardAsk, Chat, Question, Snapshot } from '../../shared/types.ts'
import { readJson, writeJson } from '../store.ts'
import type { PilotRun } from './autopilot.ts'
import { hidden } from './agents.ts'
import { excerpt, line } from './chatlines.ts'
import { rememberReply } from './chats.ts'
import { ended } from './engine/engine.ts'
import type { ArtifactRec } from './artifacts.ts'
import { BOX } from './box.ts'
import { Mirror } from './mirror.ts'
import { claudeProjectDir, piSessionDir } from './readers/find.ts'
import { boxDir } from './mfs.ts'
import * as task from './mfs.ts'
import { HOST, NAME, placeId } from './places.ts'
import { restartHint, type Harness } from './restart.ts'
import { repositorySection } from './settings.ts'
import { secretPages } from './secrets.ts'
import { pluginSection } from '../plugins.ts'
import { TOOK_OVER, type TookOver } from '../took-over.ts'
import { STOPPED } from './source-helpers.ts'
import { LiveSourceState } from './source-state.ts'

export class LiveSourceViews extends LiveSourceState {
  pushWarnings: () => string[] = () => []
  /** a worker's copy of its machine's agent logs, as they grow */
  mirror = BOX ? new Mirror(BOX) : null

  /** once, after Shepherdr replaced herdr-projects here (scripts/take-over.ts): what it did, in the home space's chat */
  protected sayTookOver() {
    const rec = readJson<TookOver | null>(TOOK_OVER, null)
    if (!rec || rec.said) return
    this.chats.post(placeId.home(), { id: `took-over:${rec.at}`, text: rec.text })
    writeJson(TOOK_OVER, { ...rec, said: true })
  }

  /** a look at this machine: limits judged, held tasks started where there is room, the screen told of new numbers */
  healthTick(now = Date.now()) {
    const at = this.health.last?.at
    this.health.tick(now)
    // too busy to start held tasks: browsers finished tasks left open go first (at most once a minute)
    if (this.health.last?.at !== at && this.health.busy() && now - this.sweptAt > 60_000) {
      this.sweptAt = now
      void this.sweepBrowsers().catch(() => undefined)
    }
    this.engine.release(now)
    if (this.health.last?.at !== at) this.emit('snapshot')
  }

  /** what a worker's mirror follows on its machine: the hooks, Claude Code's session files, and each agent's logs and
   *  the folders its CLI writes new ones in */
  protected followLogs() {
    const b = BOX!
    const day = (t: number) => {
      const d = new Date(t)
      return `${b.home}/.codex/sessions/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    }
    const dirs = [join(boxDir(), 'hooks'), `${b.home}/.claude/sessions`, day(Date.now()), day(Date.now() - 86_400_000)]
    const files: string[] = []
    for (const r of Object.values(this.agents.records)) {
      if (r.kind === 'claude') dirs.push(task.unmirrored(claudeProjectDir(r.cwd)))
      if (r.kind === 'pi') dirs.push(task.unmirrored(piSessionDir(r.cwd)))
      files.push(...r.logs.map(task.unmirrored))
    }
    this.mirror!.follow(dirs, files)
  }

  /** before it stops: the merges on their way finish (engine.drain) */
  drain() {
    return this.engine.drain()
  }

  stop() {
    for (const box of this.pilotSandboxes.values()) void box.close()
    this.peers?.stop()
    this.mirror?.stop()
    this.timers.forEach(clearInterval)
    this.agents.stop()
    this.engine.stop()
    this.retries.stop()
  }

  /* ---------- unread ---------- */

  /** a coordinator's chat may have something new: it shows unread, and a new message buzzes where its place's Notify is
   *  All (app.ts asks shared/alerts.ts notifies); a card about a task does not, the task's own alert says it. A task's
   *  chat counts for nothing here: its row shows its status, and its alerts follow no Notify */
  protected fresh(key: string) {
    if (key.includes('/')) return
    const n = this.chats.newest(key)
    if (!n || !this.unread.saw(key, n.at)) return
    this.emit('snapshot')
    // what the first look after a restart finds came before
    if (n.at < this.born || n.card) return
    this.alert({
      id: randomUUID(),
      from: 'Lineclear',
      title: clip(this.chatName(key), TITLE_MAX),
      body: clip(n.text || 'New message', BODY_MAX),
      go: { place: key },
      message: true,
    })
  }

  /** another machine's alert about its coordinator says the name the human gave the place: that machine knows only its own */
  protected renamed(a: Alert): Alert {
    const name = !a.go.task && this.places.names[a.go.place]
    const was = name && this.peers?.owner(a.go.place)?.snap?.places.find((p) => p.id === a.go.place)?.name
    return was && a.title.startsWith(was) ? { ...a, title: clip(name + a.title.slice(was.length), TITLE_MAX) } : a
  }

  /** another machine's task, as it last showed itself, for a task queued after it */
  protected peerTask(machine: string, id: string) {
    const l = this.peers?.list().find((x) => x.rec.machine.toLowerCase() === machine.toLowerCase())
    if (!l) return 'unknown' as const
    if (!l.reachable) return 'away' as const
    return l.snap?.tasks.find((t) => t.id.toUpperCase() === id.toUpperCase() && t.place.startsWith(`p:${l.rec.machine}:`))
  }

  /** Read original chats only: forwarded cards must never multiply requests. */
  protected attentionRequests(): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const p of [placeId.home(), ...this.places.spaces.map((x) => placeId.space(x.name))]) {
      const log = this.chats.log(p)
      out[p] = coordinatorRequestIds(
        log.posted,
        log.answers,
        openCards(this.chats.chat(p)).map((m) => m.question.id),
        this.agents.status(p) === 'blocked',
      )
    }
    for (const t of this.engine.tasks.filter((t) => !t.archived && this.engine.statusOf(t) === 'need')) {
      const key = `${t.id}/Agent`
      const ids = openCards(this.chats.chat(key)).map((m) => m.question.id)
      // Plain questions and permission menus without a card still require one response.
      out[key] = ids.length ? ids : ['attention']
    }
    return out
  }

  /** the Everywhere defaults, for the other machines (they keep a copy) */
  everywhere() {
    return this.settings.everywhere()
  }

  /* ---------- reading ---------- */

  snapshot(): Snapshot {
    const { places, machines, sections } = this.listed()
    const peers = this.peers?.list() ?? []
    const automations: Snapshot['automations'] = Object.fromEntries(places.map((p) => [p.id, this.automations.view(p.id, this.settings.zone())]))
    const asks = this.asks()
    const attentionRequests = this.attentionRequests()
    for (const l of peers) {
      Object.assign(automations, l.snap?.automations ?? {})
      Object.assign(asks, l.snap?.asks ?? {})
      Object.assign(attentionRequests, l.snap?.attentionRequests ?? {})
    }
    return this.withSecrets({
      name: 'Lineclear',
      host: HOST,
      places,
      machines,
      tasks: [
        ...this.engine.tasks
          .filter((t) => this.places.space(t.project))
          .map((t) => ({ ...this.engine.view(t), ...(this.browsers && !ended(t) ? { browser: t.stopped ? STOPPED : this.browsers.status() } : {}) })),
        ...peers.flatMap((l) => l.snap?.tasks ?? []),
      ],
      automations,
      artifacts: [...Object.values(this.artifacts.list).map((a) => this.artifactView(a)), ...peers.flatMap((l) => l.snap?.artifacts ?? [])].sort(
        (a, b) => b.at - a.at,
      ),
      asks,
      attentionRequests,
      last: Object.assign({}, ...peers.map((l) => l.snap?.last ?? {}), this.unread.last),
      read: this.unread.read,
      sections,
      settings: this.settings
        .sections(
          this.devices(),
          [
            {
              name: NAME,
              state: `${BOX ? `Run from the main machine over SSH (${BOX.target})` : 'Main'} · ${this.agents.reachable ? 'reachable' : 'herdr not answering'}`,
            },
            ...(this.peers?.rows() ?? []),
          ],
          pluginSection(),
          HOST,
          ['~', ...this.places.spaces.map((p) => p.name)],
          NAME,
          (id) => this.heartbeats.read(id, this.roleOf(id)),
          this.pushWarnings(),
        )
        .map((section) => this.pilotSection(section))
        .concat(
          this.places.spaces.map((p) => {
            const id = placeId.space(p.name)
            this.engine.taskIds.ensure(id, p.key)
            const seq = this.engine.taskIds.get(id)
            return taskIdsSection(id, HOST, seq.prefix, seq.last + 1)
          }),
        )
        .concat(this.places.spaces.map((p) => repositorySection(placeId.space(p.name), HOST, p.base, p.install)))
        .concat(peers.flatMap((l) => (l.snap?.settings ?? []).filter((x) => x.machine === l.rec.machine))),
      user: this.user,
    })
  }

  /** each level's Secrets page, after its other pages: the names kept there, never a value. The main machine's
   *  snapshot has them for every machine (the vault is its own); a worker's has none */
  protected withSecrets(s: Snapshot): Snapshot {
    return BOX ? s : { ...s, settings: secretPages(s.settings, this.vault.names()) }
  }

  chatStatus(key: string): string {
    return this.agents.status(key)
  }

  chat(key: string): Chat | undefined {
    if (this.peers?.owner(key)) return this.peers.chat(key)
    const c = { ...this.chats.chat(key), restart: this.restartHintOf(key) }
    return key.includes('/') ? c : this.withAsks(c)
  }

  /** a needs-you card in a space's chat carries what its task asks, to answer there as in the task's own chat: its
   *  question cards as they stand there, or the agent's plain question and a reply box. What it asked is kept on the
   *  card once seen, so it still shows how it was answered */
  protected withAsks(c: Chat): Chat {
    const l = this.chats.log(c.key)
    const latest = new Map<string, string>()
    for (const p of l.posted) if (p.card?.task) latest.set(p.card.task, p.card.id)
    const chats = new Map<string, Chat>()
    const chatOf = (key: string) => chats.get(key) ?? chats.set(key, this.chats.chat(key)).get(key)!
    const shown = new Map<string, CardAsk>()
    let saved = false
    for (const p of l.posted) {
      const card = p.card
      if (!card?.task) continue
      const t = this.engine.task(card.task)
      const last = latest.get(card.task) === card.id && card.status === 'need'
      if (!t || (!card.ask && !last)) continue
      const key = `${t.id}/Agent`
      const waits = last && this.engine.statusOf(t) === 'need'
      const tc = chatOf(key)
      const open = waits ? openCards(tc) : []
      // what it asks now, once seen: a question card that came while it waits, or its plain question
      if (open.length && open.some((m) => !card.ask?.questions?.some((q) => q.id === m.question.id)) && (!card.ask || !this.askOf(card.ask, tc, false).open)) {
        card.ask = { chat: key, questions: open.map((m) => m.question) }
        saved = true
      } else if (waits && !card.ask && !open.length && this.agents.status(key) !== 'blocked' && !/^needs you: (?:Went wrong|Signed out)/.test(card.text)) {
        const r = lastReply(tc)
        if (r?.text) {
          card.ask = { chat: key, reply: { id: r.id, text: r.text } }
          saved = true
        }
      }
      if (card.ask) shown.set(card.id, this.askOf(card.ask, tc, waits, t.id))
    }
    if (saved) this.chats.saveLog(c.key)
    if (!shown.size) return c
    return { ...c, messages: c.messages.map((m) => (m.card && shown.has(m.card.id) ? { ...m, card: { ...m.card, ask: shown.get(m.card.id) } } : m)) }
  }

  /** a needs-you card's ask as it stands now in its task's chat: each question as it is there (a terminal's menu is
   *  gone once answered), whether it still takes an answer, and where it was answered */
  protected askOf(ask: CardAsk, tc: Chat, waits: boolean, task = ask.chat.split('/')[0]): CardAsk {
    const link = (label: string) => ({ label, chat: ask.chat, name: `${task} chat` })
    if (ask.reply) {
      const at = tc.messages.findIndex((m) => m.id === ask.reply!.id)
      const yours = at >= 0 ? tc.messages.slice(at + 1).find((m) => m.who === 'you' && !m.waiting && (m.text || m.file)) : undefined
      const answered =
        ask.answered ?? (yours ? { where: 'task' as const, text: yours.text ?? yours.file?.name } : !waits ? { where: 'task' as const } : undefined)
      return { ...ask, answered, open: !answered && waits }
    }
    const live = new Map(tc.messages.flatMap((m) => (m.question ? [[m.question.id, m.question] as const] : [])))
    const open = new Set(openCards(tc).map((m) => m.question.id))
    const qs = (ask.questions ?? []).map((q) => live.get(q.id) ?? { ...q, sent: -1, said: ask.answered?.text })
    const settled = qs.every((q) => q.sent !== undefined)
    const where = ask.answered?.where ?? (qs.some((q) => q.via === 'terminal') ? 'terminal' : 'task')
    const label = where === 'space' ? 'Answered here ·' : where === 'terminal' ? 'Answered in the terminal ·' : 'Answered in'
    const questions = qs.map((q): Question => {
      if (q.sent === undefined && !open.has(q.id)) return { ...q, sent: -1, elsewhere: link('No longer waits ·') }
      // the words it was answered with show on the card; the message that said them is in the task's chat
      return q.sent === undefined ? q : { ...q, via: undefined, elsewhere: link(label) }
    })
    return {
      ...ask,
      questions,
      answered: settled ? { where, text: ask.answered?.text } : undefined,
      open: !settled && questions.some((q) => q.sent === undefined),
    }
  }

  /** answered on a needs-you card in its space's chat: the card says so, and the space's coordinator hears the human
   *  answered it, so it doesn't answer it too */
  protected answeredHere(space: string, key: string, title: string, text: string) {
    const l = this.chats.log(space)
    const p = l.posted.findLast((x) => x.card?.ask?.chat === key)
    if (p?.card?.ask) {
      p.card.ask.answered = { where: 'space', text }
      this.chats.saveLog(space)
    }
    const task = key.split('/')[0]
    const words = `The human answered ${task}'s question from its card in this chat (“${excerpt(title, 120)}”: ${excerpt(text, 200)}). It went to ${task}'s agent as their answer: don't answer it too. Nothing else to say: reply with only <no-reply>answered by the human</no-reply>.`
    this.agents.send(space, hidden(words, 'news', { task, event: 'answered' })).catch(() => undefined)
    this.emit('chat', space)
  }

  protected replies = new Set<string>()

  /** a reply to a plain question from its needs-you card: once, though two screens show it, and the card says
   *  answered only once it went to the agent */
  protected async replyHere(space: string, a: Extract<Action, { type: 'send' }>) {
    if (!a.reply || this.replies.has(a.chat) || !this.askOpen(space, a.chat, a.reply)) return { ok: false, error: 'This card is answered already.' }
    this.replies.add(a.chat)
    try {
      const r = await this.send(a.chat, this.replying(a.chat, a.text, a.reply), a.attachments ?? [], false, a.cid)
      this.chats.repliedFrom(a.chat, a.reply, space)
      this.answeredHere(space, a.chat, this.chats.chat(a.chat).messages.find((m) => m.id === a.reply)?.text ?? 'its question', a.text)
      return r
    } finally {
      this.replies.delete(a.chat)
    }
  }

  /** does the needs-you card for this task's chat still take an answer */
  protected askOpen(space: string, key: string, reply?: string) {
    const card = this.chats.log(space).posted.findLast((p) => p.card?.task && `${p.card.task}/Agent` === key)?.card
    const t = this.engine.task(key.slice(0, -'/Agent'.length))
    return (
      !!card?.ask &&
      !!t &&
      (!reply || card.ask.reply?.id === reply) &&
      this.askOf(card.ask, this.chats.chat(key), card.status === 'need' && this.engine.statusOf(t) === 'need').open
    )
  }

  /* ---------- artifacts ---------- */

  protected artifactView(a: ArtifactRec): Artifact {
    const last = this.artifacts.latest(a)
    return {
      id: a.id,
      title: a.title,
      place: a.place,
      at: last.at,
      v: last.n,
      when: age(last.at),
      by: last.by,
      keeper: this.chatName(this.keeperOf(a)),
      thumb: a.thumb,
      chats: [...new Set(a.versions.flatMap((v) => (v.chat ? [v.chat] : [])))],
      versions: [...a.versions].reverse().map((v) => ({
        n: v.n,
        when: age(v.at),
        by: v.by,
        note: v.note,
        html: v.html,
        what: v.html === v.n ? undefined : v.data === v.n ? ('data' as const) : ('title' as const),
      })),
    }
  }

  /** who hears from an artifact: the agent that made its latest version, while it has a task to come back to; its
   *  place's coordinator after that (or when it came from a terminal) */
  protected keeperOf(a: ArtifactRec) {
    const chat = this.artifacts.latest(a).chat
    if (!chat) return a.place
    if (!chat.includes('/')) return chat
    const t = this.engine.task(chat.split('/')[0])
    return t && !ended(t) ? chat : a.place
  }

  protected pilotSection(section: import('../../shared/types.ts').SettingSection) {
    if (section.name !== 'Coordinator timer' || !section.level?.startsWith('p:')) return section
    const place = section.level,
      r = this.pilots.current(place) ?? this.pilots.runs.findLast((run) => run.place === place)
    let instructions: string
    try {
      instructions = this.pilotWords(r?.state === 'on' ? r : ({ place, config: this.settings.pilot(this.spaceKey(place)) } as PilotRun))
    } catch (e) {
      instructions = (e as Error).message
    }
    const h = this.settings.heartbeat(this.levelOf(place))
    const next = this.places.mode(place) === 'autopilot' && r?.state === 'on' ? this.heartbeats.next(place, h.time, h.zone) : undefined
    return {
      ...section,
      rows: section.rows
        .map((row) => (row.doc ? { ...row, instructions } : row))
        .concat([
          {
            label: 'State',
            key: '',
            value: this.pilots.busy(place) ? 'Changing coordinator; messages wait' : (r?.error ?? (this.places.mode(place) === 'autopilot' ? 'On' : 'Off')),
            fixed: true,
            group: 'Wake-up',
          },
          { label: 'Time zone', key: '', value: h.zone, fixed: true, group: 'Wake-up' },
          {
            label: 'Next',
            key: '',
            value: next ? new Date(next).toLocaleString('en-GB', { timeZone: h.zone }) : 'No scheduled wake',
            fixed: true,
            group: 'Wake-up',
          },
          {
            label: 'Last run',
            key: '',
            value: r?.last
              ? `${new Date(r.last.at).toLocaleString('en-GB', { timeZone: h.zone })} · ${r.last.reason} · ${r.last.outcome}${r.last.ended ? ` · ${Math.round((r.last.ended - r.last.at) / 1000)} s` : ''}`
              : 'No runs yet',
            fixed: true,
            group: 'Wake-up',
          },
          { label: 'Shared usage', key: '', value: `${r?.used ?? 0} reported tokens`, fixed: true, group: 'Access and limits' },
        ]),
    }
  }

  /** a coordinator (its place id) or a task's agent (ID/Agent) restarted: its role and space, what it runs on, what
   *  Settings say for it now and what Settings said when it last started on them */
  protected restartable(key: string) {
    const t = key.includes('/') ? this.engine.task(key.split('/')[0]) : undefined
    if (key.includes('/') && !t) throw new Error('No such task.')
    if (!t && !this.places.coordinator(key)) throw new Error('No such place.')
    const role = t ? ('task' as const) : ('coordinator' as const)
    const space = t ? this.places.space(t.project)?.name : this.spaceKey(key)
    const want = this.settings.harness(role, space)
    const r = this.agents.record(key)
    const on: Harness = r ? { kind: r.kind, model: r.model, effort: r.effort } : (t?.agent ?? want)
    return { t, role, space, want, on, set: r?.set }
  }

  /** the calm hint a chat shows once Settings for its role say other than what its agent runs on */
  protected restartHintOf(key: string) {
    try {
      const x = this.restartable(key)
      if (!this.agents.record(key) || (x.t && (ended(x.t) || x.t.archived))) return undefined
      return restartHint(x.on, x.set, x.want)
    } catch {
      return undefined
    }
  }

  /** what you write: a coordinator wakes for it (resumed with its memory); a task agent is resumed if it finished */
  protected async send(key: string, text: string, files: string[], fromScreen = false, cid?: string) {
    const at = Date.now()
    const lines = files.map((p) =>
      line.attach(
        this.user,
        p
          .split('/')
          .pop()!
          .replace(/^[a-z0-9]+-/, ''),
        p,
      ),
    )
    const full = [text, ...lines].filter(Boolean).join('\n')
    if (!full) return {}
    // whatever you send answers the choice cards still open there: the place's dot no longer waits on them
    if (this.chats.closeAsks(key)) this.emit('snapshot')
    // a task held before it ever started has no agent: what you write starts it now, on its brief and your words
    if (key.includes('/') && this.engine.unstarted(key.split('/')[0])) {
      await this.engine.tell(key.split('/')[0], full)
      this.emit('chat', key)
      return { waiting: true, at }
    }
    const ensure = key.includes('/') ? () => this.resumeTaskAgent(key) : () => this.coordinator(key)
    if (!key.includes('/') && this.agents.status(key) === 'gone') await this.coordinator(key).catch(() => undefined)
    const r = await this.agents.send(key, full, { ensure, cid })
    if (key.includes('/')) this.engine.youWrote(key)
    void fromScreen
    this.emit('chat', key)
    // at: when it began to go in, by this machine's clock: the log has it after that (a screen matching what it sent
    // without the id goes by it)
    return { waiting: r.waiting, waitsFor: r.waitsFor, at }
  }

  /** your words as a reply to a message, quoting its start (a file by its name); plain words when it is gone */
  protected replying(key: string, text: string, reply?: string) {
    if (!reply) return text
    const m = this.chats.chat(key).messages.find((x) => x.id === reply)
    const art = !m?.text && m?.artifact && this.artifacts.get(m.artifact.id)
    const quoted = m?.text ?? m?.file?.name
    if (!quoted && !art) return text
    const l = art ? line.replyArtifact(this.user, line.artifact(art.title, art.id, m.artifact!.v), text) : line.reply(this.user, quoted!, text)
    rememberReply(l, reply)
    return l
  }
}
