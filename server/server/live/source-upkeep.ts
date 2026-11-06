import { dirname, join } from 'node:path'
import { clip } from '../../shared/alerts.ts'
import type { Action, Chat, TaskStatus, UpdateCard } from '../../shared/types.ts'
import type { Overview } from '../source.ts'
import type { PilotRun } from './autopilot.ts'
import { hidden } from './agents.ts'
import { overviewWakes, type Happened, type TriggerEvent } from './trigger.ts'
import type { BrowserBridge, BrowserClient } from './browser.ts'
import { excerpt, tag } from './chatlines.ts'
import { ended, type TaskRec } from './engine/engine.ts'
import * as G from './engine/git.ts'
import type { Machines } from './machines.ts'
import { BOX } from './box.ts'
import { HOST, placeId } from './places.ts'
import { relaunchedLine } from './prompts.ts'
import { logLoop, type Wrong } from './revive.ts'
import { startVoice } from './voice.ts'
import { has } from '../plugins.ts'
import { OVERVIEW_MAX, REPLY_AFTER_CARD, statusLine } from './source-helpers.ts'
import { LiveSourceCli } from './source-cli.ts'

export class LiveSourceUpkeep extends LiveSourceCli {
  protected configureAutopilot() {
    this.agents.acceptInput = (item) => !item.generation || (this.pilotOf(item.key)?.id === item.generation && this.pilotOf(item.key)?.state === 'on')
    this.engine.pilotOwner = (key) => {
      const r = this.pilotOf(key)
      if (!r) return undefined
      this.pilots.check(r, this.activePilotTasks(r))
      return r.id
    }
    this.engine.pilotClaim = (t) => this.pilots.claim(this.pilots.runs.find((r) => r.id === t.pilot)!, t.id)
    this.engine.pilotGate = (t) => {
      if (!t.pilot) return
      const r = this.pilots.runs.find((r) => r.id === t.pilot)
      if (!r) throw new Error('coordinator timer run no longer exists.')
      this.pilots.check(r, this.activePilotTasks(r, t.id))
      this.pilots.claim(r, t.id)
    }
    this.agents.launchAllowed = (spec) => {
      const r = this.pilotOf(spec.key)
      if (r && spec.key.includes('/')) this.pilots.check(r, this.activePilotTasks(r, spec.key.split('/')[0]))
      if (r && !['starting', 'on', 'workers'].includes(r.state)) throw new Error(r.error || 'This coordinator timer run has stopped.')
      if (!spec.key.includes('/') && this.pilots.busy(spec.key) && !spec.fresh) throw new Error('The coordinator is changing; messages are queued.')
      // A saved isolated session must never be resumed without its trusted owner.
      if (this.agents.record(spec.key)?.isolation && !r && this.places.mode(spec.key) !== 'regular') throw new Error('The isolated run has no active owner.')
    }
    this.agents.prepare = async (spec) => {
      const r = this.pilotOf(spec.key)
      if (!r) return { ...spec, isolation: undefined }
      const old = this.pilotSandboxes.get(spec.key)
      if (old) {
        await old.close()
        this.pilotSandboxes.delete(spec.key)
      }
      const project = spec.key.includes('/') ? this.engine.task(spec.key.split('/')[0])?.project : r.place
      const repo = project && this.places.space(project)?.path
      if (!repo) throw new Error('Isolated coordinator timer needs a repository space. Home-space coordinator timer is unavailable.')
      G.guardBrokerRepo(repo)
      G.guardBrokerRepo(spec.cwd)
      const box = await this.pilotRuntime.prepare(
        spec,
        r,
        repo,
        (args, ctx) => this.pilotCli(r, args, ctx),
        (spec.key.includes('/') ? this.engine.task(spec.key.split('/')[0])?.reviewer?.kind : undefined) ?? r.config.reviewer?.kind,
      )
      this.pilotSandboxes.set(spec.key, box)
      return {
        ...spec,
        env: { ...spec.env, ...box.env },
        isolation: { run: r.id, home: box.logsHome, captures: box.captures, control: join(dirname(box.logsHome), 'control'), path: box.wrapper },
        fresh: spec.fresh || this.agents.record(spec.key)?.isolation?.run !== r.id,
      }
    }
    this.agents.on('status', (key, state) => {
      if (state === 'gone' && this.agents.record(key)?.finished) {
        const box = this.pilotSandboxes.get(key)
        if (box) {
          void box.close()
          this.pilotSandboxes.delete(key)
        }
      }
      if (key.includes('/')) return
      const r = this.pilotOf(key)
      if (r?.state === 'on' && r.last && state === 'working') this.pilots.outcome(r, 'Running')
      if (r?.state === 'on' && r.last?.outcome === 'Running' && ['idle', 'done'].includes(state))
        this.pilots.outcome(r, 'Turn ended; inspect chat for the result', true)
    })
    // A server restart loses gateway sockets. Fail closed, including all owned workers, instead of reviving them unrestricted.
    // A run that was on then starts again through its own fresh gateway, with its limits carried over: an update of
    // the server must not end a night of work. A run that already came back in the last ten minutes stays failed.
    const cut: PilotRun[] = []
    for (const r of this.pilots.runs)
      if (['starting', 'on', 'stopping', 'workers'].includes(r.state)) {
        const again = r.state === 'on' && !(r.resumed && Date.now() - r.resumed < 600_000)
        r.state = 'failed'
        r.error = again
          ? 'Server restarted. Coordinator timer starts again with a fresh coordinator.'
          : 'Server restarted. Turn coordinator timer off and on to start a fresh coordinator.'
        void this.stopPilotAgents(r, false)
        if (again) cut.push(r)
      }
    this.pilots.save()
    if (cut.length) this.timers.push(setTimeout(() => void this.resumePilots(cut), 5000) as unknown as ReturnType<typeof setInterval>)
    this.timers.push(setInterval(() => void this.monitorPilots(), 1000))
  }

  /** a coordinator that runs outside its folder (another machine's started in the main machine's path for it, where
   *  that machine had no such folder, or a home space's that was its machine's coordinator): started again in its own,
   *  with its session, once its turn is over */
  protected reseat(key: string) {
    const c = key.includes('/') ? null : this.places.coordinator(key)
    const r = this.agents.record(key)
    const st = this.agents.status(key)
    if (!c?.home || !r || r.cwd === c.cwd || this.reseating.has(key) || (st !== 'idle' && st !== 'done') || this.agents.background(key)) return
    this.reseating.add(key)
    this.agents
      .finish(key)
      .then(() => this.coordinator(key))
      .catch(() => undefined)
      .finally(() => this.reseating.delete(key))
  }

  /** an agent Lineclear keeps running: a space's coordinator it started, or a task's agent while its task goes on */
  protected keepsRunning(key: string) {
    const r = this.agents.record(key)
    if (!r || r.finished || this.agents.busy(key) || this.reseating.has(key) || this.peers?.owner(key)) return false
    if (!key.includes('/')) return !!this.places.coordinator(key)
    return this.engine.mayRetry(key) && !!this.engine.task(key.split('/')[0])?.worktree
  }

  /**
   * Coordinators and task agents that stopped, or run without the files Lineclear starts them with now (herdr restored
   * an older command after it restarted): started again, resuming their session, a few times at most (revive.ts)
   */
  async revive(now = Date.now()) {
    if (!this.agents.reachable || now - this.agents.lastReach > 10_000) return
    for (const key of Object.keys(this.agents.records)) {
      if (this.reviving.has(key)) continue
      if (!this.keepsRunning(key)) {
        this.revivals.skip(key)
        continue
      }
      const why = await this.agents.wrong(key)
      if (why === null) continue
      if (!why) this.revivals.fine(key, now)
      else {
        const go = this.revivals.seen(key, now, why === 'stale' ? why : '')
        if (go === 'go') void this.relaunch(key, why)
        else if (go) void this.gaveUp(key, why)
      }
    }
  }

  protected async relaunch(key: string, why: Wrong) {
    this.reviving.add(key)
    // read before it starts: its status once started says it is idle
    const working = this.agents.wasWorking(key) || this.revivals.wasWorking(key)
    try {
      console.error(`lineclear: ${key}'s agent ${why === 'stale' ? 'runs on outdated settings' : 'stopped'}: starting it again`)
      // its pane still holds it, or its shell: herdr would count that as running
      await this.agents.relaunch(key, why !== 'gone', () => (key.includes('/') ? this.resumeTaskAgent(key) : this.coordinator(key)))
      if (working) await this.agents.send(key, hidden(relaunchedLine(), 'restart'))
    } catch (e) {
      console.error(`lineclear: couldn't start ${key}'s agent again: ${(e as Error).message}`)
    } finally {
      this.reviving.delete(key)
      this.emit('snapshot')
    }
  }

  /** started again a few times and still not right: its chat says so, with an alert */
  protected async gaveUp(key: string, why: Wrong) {
    // one that still runs on other settings keeps its task working: it is told to carry on, with no card
    if (why === 'stale') {
      void logLoop(key, this.agents.record(key), this.agents.info(key)?.pane_id, (r) => this.agents.filesOf(r))
      if (this.agents.wasWorking(key) || this.revivals.wasWorking(key)) await this.agents.send(key, hidden(relaunchedLine(), 'restart')).catch(() => undefined)
      return
    }
    const id = `revive:${key}:${Date.now()}`
    this.chats.post(key, { id, card: { id, text: `Its agent stopped, and starting it again didn't help. Restart it from ⋯ → Restart agent.` } })
    this.stoppedAlert(key, id, `Its agent stopped, and Lineclear couldn't start it again.`, `revive:${key}`)
  }

  /** what cut off an agent's last turn, if its log says the provider did */
  protected checkCut(key: string) {
    if (this.agents.record(key) && !this.peers?.owner(key)) this.retries.seen(key, this.chats.cutOff(key))
  }

  /** news for coordinators: they act on it when the human asked them to, and on coordinator timer on their own. News the human
   *  sees as a card in the space's chat gets its coordinator's short reply after it, so a card never ends the chat. The
   *  space's own coordinator hears it, and its machine's home space's while that one is on coordinator timer. The main
   *  machine's home space keeps every machine's overview and picks what buzzes: it hears each space's news in one line
   *  (overview()), another machine's over its worker's link */
  protected news(
    project: string,
    text: string,
    kind: 'added' | 'ready' | 'need' | 'done' | 'red' | 'stalled',
    about?: { task: string; event: string },
    card?: Omit<UpdateCard, 'id'>,
  ) {
    const projName = this.places.nameOf(project) ?? project
    if (card) {
      const id = `card:${about?.event ?? kind}:${Date.now()}`
      this.chats.post(project, { id, card: { id, ...card } })
      if (this.watched.includes(project)) this.emit('chat', project)
    }
    // its task's card went up just before (a status's news follows its card at once); a second word on it has none
    const seen = !!card || (!!about?.task && this.carded === about.task)
    this.carded = undefined
    const home = placeId.home()
    const main = this.roleOf(home) === 'main'
    for (const id of project === home ? [home] : [project, home]) {
      const mode = this.places.mode(id)
      if (mode === 'regular' && kind === 'added') continue
      if (id === home && id !== project) {
        if (main) {
          // its event rules looked at in overview()
          this.overview(projName, { place: project, line: text, kind, about })
          continue
        }
        // the space's own coordinator is awake for it: another machine's home space, off coordinator timer, would only say the same again
        if (mode === 'regular') continue
      }
      const prefix = id === project ? '' : `${projName}: `
      if (!this.wakes(id, this.happened(kind, project, text, about?.task), `${prefix}${text}`)) continue
      const act = mode === 'regular' ? ' Act on it if the human asked you to handle such things.' : ' Act on it by your coordinator timer rules.'
      const tail =
        id === project && seen
          ? `${act} A card in this chat already shows the human the news${kind === 'need' ? ', and lets them answer the task right there (you hear when they do)' : ''}: ${REPLY_AFTER_CARD}`
          : kind === 'done'
            ? ' A card in the space’s chat already tells the human. Check for a next step (a task waiting for it, a failure, a question); if there is none, reply with only <no-reply>reason</no-reply>.'
            : mode === 'regular'
              ? ' Act on it if the human asked you to handle such things; otherwise tell the human what matters in a line or two. Nothing matters: reply with only <no-reply>reason</no-reply>.'
              : ' Act on it by your coordinator timer rules. Nothing worth saying: reply with only <no-reply>reason</no-reply>.'
      this.agents
        .send(id, hidden(`${prefix}${text}.${tail}`, 'news', about), { ensure: () => this.coordinator(id), generation: this.pilotOf(id)?.id })
        .catch(() => undefined)
    }
    const requester = about?.task ? this.engine.task(about.task)?.requester : undefined
    // Owner and home already heard above. The main home already receives the overview over the worker link.
    const mainHome = requester && !BOX ? placeId.home() : undefined
    if (requester && requester !== project && requester !== mainHome && !(requester === home && this.places.mode(home) === 'autopilot')) {
      this.requestedNews.post({ to: requester, from: project, text, task: about!.task, event: about!.event })
      void this.drainRequestedNews()
    }
    // for the main machine's home space, when this is another machine's worker: its link carries it there (app.ts; the
    // main machine has no link, and hears its own above)
    this.emit('news', { place: project, line: text, kind, about })
    // one event each: a task that went wrong is failed, not needs-you too
    this.fireTaskAutomations(this.happened(kind, project, text, about?.task), project, about?.task)
  }

  protected async drainRequestedNews() {
    if (this.drainingNews) return
    this.drainingNews = true
    try {
      await this.requestedNews.drain(
        (chat) => chat.startsWith(`p:${HOST}:`),
        async (n) => {
          // Removed spaces and invented identities must not start a coordinator or receive task details.
          if (!this.places.find(n.to) || !this.agents.record(n.to) || this.agents.record(n.to)?.finished) return
          // Main home receives this event through the existing overview route.
          if (n.to === placeId.home() && !BOX) return
          const kind =
            ({ added: 'added', ready: 'ready', 'needs-you': 'need', merged: 'done', closed: 'done', stalled: 'stalled' } as const)[n.event as 'ready'] ?? 'need'
          if (!this.wakes(n.to, this.happened(kind, n.from, n.text, n.task), `${n.from}: ${n.text}`)) return
          const words = `${n.from}: ${n.text}. You requested this task. Its owning coordinator still handles it. Act only within the human's request; otherwise reply with only <no-reply>reason</no-reply>.`
          await this.agents.send(n.to, hidden(words, 'news', { task: n.task, event: n.event }), {
            cid: `requested-news:${n.id}`,
            ensure: () => this.coordinator(n.to),
          })
        },
      )
    } catch {
      /* keep it on disk until herdr/the coordinator can receive it */
    } finally {
      this.drainingNews = false
    }
  }

  /** news for the main machine's home space from another space, on any machine: its first line only, since that
   *  space's own coordinator has the whole of it and acts on it; this one keeps the overview and picks what buzzes */
  protected overview(from: string, n: Overview) {
    const home = placeId.home()
    if (!overviewWakes(this.places.mode(home), n.kind)) return
    const line = clip(n.line.split('\n')[0].replace(/\.$/, ''), OVERVIEW_MAX)
    if (
      !this.wakes(
        home,
        n.kind === 'health' ? { event: 'health' } : this.happened(n.kind, n.place, n.line, (n.about as { task?: string } | undefined)?.task),
        `${from}: ${line}`,
      )
    )
      return
    const tail =
      ' Its own coordinator has the whole of it. If it can’t wait, alert the human with lineclear alert (--task <id> when it is about a task) and say why; otherwise reply with only <no-reply>reason</no-reply>.'
    this.agents
      .send(home, hidden(`${from}: ${line}.${tail}`, n.kind === 'health' ? 'health' : 'news', n.about), { ensure: () => this.coordinator(home) })
      .catch(() => undefined)
  }

  /** another machine's news, from its worker: its space by the name the human sees, or the machine for its health */
  protected peerNews(machine: string, n: Overview) {
    if (this.roleOf(placeId.home()) !== 'main') return
    this.overview(n.kind === 'health' ? `Machine ${machine}` : `${machine} · ${this.chatName(n.place)}`, n)
  }

  /** is a coordinator free for its heartbeat: its turn over (or not started), nothing it runs in the background, and
   *  nothing waiting to go in */
  protected idle(id: string) {
    const st = this.agents.status(id)
    return (st === 'idle' || st === 'done' || st === 'gone') && !this.agents.background(id) && !this.agents.waiting(id).length
  }

  /** each coordinator on coordinator timer that runs here gets its heartbeat once one is due and it is idle (heartbeat.ts) */
  heartbeat(now = Date.now()) {
    if (!has('autopilot') || !this.agents.reachable) return
    for (const p of this.placeList()) {
      if (p.mode !== 'autopilot' || this.peers?.owner(p.id)) continue
      if (this.pilots.busy(p.id) || this.pilotOf(p.id)?.state !== 'on') continue
      const h = this.settings.heartbeat(this.levelOf(p.id))
      if (!this.heartbeats.due(p.id, h.time, h.zone, now) || !this.idle(p.id)) continue
      void this.wakePilot(p.id, 'Schedule', now).catch(() => undefined)
    }
  }

  /** what a piece of news is, to match against event rules: its event, and its space and task */
  protected happened(kind: string, project: string, text: string, task?: string): Happened {
    const t = task ? this.engine.task(task) : undefined
    const event: TriggerEvent =
      kind === 'need'
        ? /needs you: Went wrong/.test(text)
          ? 'failed'
          : 'needs-you'
        : kind === 'done'
          ? 'merged'
          : kind === 'red'
            ? 'main-red'
            : (kind as TriggerEvent)
    return { event, space: this.places.space(project)?.name ?? this.places.nameOf(project) ?? undefined, branch: t?.branch, title: t?.title }
  }

  /** a task now waits on you, is done, or stalled: one small update card in its space's chat, one line of a few
   *  words; its summary is in the task (the main machine's home space's coordinator picks what buzzes) */
  protected onCard(t: TaskRec, status: TaskStatus, sub: string) {
    const id = status === 'work' ? `card:${t.id}:stalled:${Date.now()}` : `card:${t.id}:${t.posted}`
    const text =
      status === 'done'
        ? t.closed
          ? 'is done, nothing to merge'
          : 'is merged'
        : status === 'ready'
          ? 'is ready to merge'
          : status === 'work'
            ? sub
            : `needs you: ${sub}`
    this.chats.post(t.project, { id, card: { id, task: t.id, status, text, pr: t.pr } })
    this.carded = t.id
    if (this.watched.includes(t.project)) this.emit('chat', t.project)
    // what it asks, kept on its card though no one looks yet
    else if (status === 'need') this.withAsks(this.chats.chat(t.project))
  }

  protected runSchedules() {
    for (const a of this.automations.dueNow(this.settings.zone())) this.fire(a, true)
  }

  /* ---------- voice ---------- */

  /** a Browser panel's link to a task's shared browser: here, or passed through to the machine the task is on */
  browser(task: string, out: BrowserClient): BrowserBridge {
    const peer = this.peers?.owner(task)
    if (peer) {
      const url = new URL(`${peer.rec.url}/api/browser?task=${encodeURIComponent(task)}`)
      url.protocol = url.protocol.replace('http', 'ws')
      const ws = new WebSocket(url)
      const early: string[] = []
      ws.onopen = () => early.splice(0).forEach((m) => ws.send(m))
      // frames (the big messages) are skipped for a screen that can't keep up, as on the task's own machine
      ws.onmessage = (e) => {
        const d = String(e.data)
        if (d.length < 20_000 || (out.buffered?.() ?? 0) < 2_000_000) out.send(d)
      }
      ws.onclose = () => out.close()
      return { message: (m) => (ws.readyState === WebSocket.OPEN ? ws.send(m) : early.push(m)), end: () => ws.close() }
    }
    const t = this.engine.tasks.find((x) => x.id === task)
    // a stopped task's browser stays closed until the task is talked to again
    if (!this.browsers || !t || ended(t) || t.stopped) {
      out.send(
        JSON.stringify({
          type: 'error',
          gone: true,
          message: !this.browsers
            ? 'The browser is not in the plugin list.'
            : t?.stopped
              ? 'The browser closed when the task was stopped.'
              : 'No such task here.',
        }),
      )
      out.close()
      return { message() {}, end() {} }
    }
    return this.browsers.attach(task, out)
  }

  voice(chat: string, out: { send(d: ArrayBuffer | string): void; close(): void }) {
    if (!has('voice')) {
      out.send(JSON.stringify({ type: 'error', message: 'Voice is not in the plugin list.' }))
      return { audio() {}, end() {} }
    }
    try {
      return startVoice(this.voiceTools(chat), out)
    } catch (e) {
      out.send(JSON.stringify({ type: 'error', message: (e as Error).message }))
      out.close()
      return { audio() {}, end() {} }
    }
  }

  /** Voice uses the same actions and chat views as the screen; the owner stays attached to a target. */
  voiceTools(chat: string): import('./voice.ts').VoiceTools {
    const targets = () => {
      const local = this.placeList()
        .filter((p) => !this.peers?.owner(p.chat))
        .map((p) => ({ key: p.chat, name: p.name, machine: HOST, peer: undefined as ReturnType<Machines['owner']> }))
      local.push(
        ...this.engine.tasks.flatMap((t) =>
          ['Agent', 'Reviewer'].map((role) => ({ key: `${t.id}/${role}`, name: role === 'Agent' ? t.id : `${t.id} reviewer`, machine: HOST, peer: undefined })),
        ),
      )
      for (const peer of this.peers?.list() ?? []) {
        local.push(...(peer.snap?.places ?? []).map((p) => ({ key: p.chat, name: this.chatName(p.chat), machine: peer.rec.machine, peer })))
        local.push(
          ...(peer.snap?.tasks ?? []).flatMap((t) =>
            ['Agent', 'Reviewer'].map((role) => ({
              key: role === 'Agent' ? (t.agent?.chat ?? `${t.id}/Agent`) : `${t.id}/Reviewer`,
              name: role === 'Agent' ? t.id : `${t.id} reviewer`,
              machine: peer.rec.machine,
              peer,
            })),
          ),
        )
      }
      return local
    }
    const resolve = (to?: string) => {
      const all = targets()
      const n = (to || chat).trim().toLowerCase()
      const found = all.filter((t) => [t.key, t.name, `${t.machine}:${t.name}`, `${t.machine}:${t.key}`].some((v) => v.toLowerCase() === n))
      if (found.length !== 1)
        throw new Error(found.length ? 'Several chats match; use machine:name or the full space key.' : 'No such chat. Use overview to find its full name.')
      return found[0]
    }
    const load = async (t: ReturnType<typeof resolve>) => {
      if (!t.peer) return { chat: this.chats.chat(t.key), status: this.chatStatus(t.key) }
      if (!t.peer.reachable) throw new Error(`${t.machine} is unavailable; its chat may be stale.`)
      const r = await this.peers!.fetch(t.peer, `/api/chat?chat=${encodeURIComponent(t.key)}`, { signal: AbortSignal.timeout(4000) })
      if (!r.ok) throw new Error(`${t.machine} could not read the chat.`)
      const view = (await r.json()) as { chat: Chat | null; status?: string }
      if (!view.chat || view.chat.key !== t.key || !view.status) throw new Error('The owning machine did not return this chat.')
      return { chat: view.chat, status: view.status }
    }
    return {
      name: `${resolve().machine}:${resolve().name}`,
      send: async (text, to) => {
        const t = resolve(to)
        const action: Action = { type: 'send', chat: t.key, text }
        const queuedHere = t.peer && !t.peer.reachable
        const r = (await (t.peer ? this.peers!.act(t.peer, action) : this.actLocal(action))) as {
          ok?: boolean
          error?: string
          waiting?: boolean
          waitsFor?: string
        }
        if (r.error || r.ok === false) throw new Error(r.error ?? 'The message was refused.')
        if (!r.waiting) return 'Sent.'
        if (queuedHere) return 'Queued here while the owning machine is unavailable. It has not reached the agent yet.'
        if (r.waitsFor === 'menu') return 'It waits until the question on its screen is answered; it goes in then.'
        return r.waitsFor === 'turn' ? 'It goes in once the agent finishes this step.' : 'It goes in once the agent has started.'
      },
      read: async (to) => {
        const t = resolve(to)
        const { chat: c, status: state } = await load(t)
        return `${t.machine}:${t.name} is ${state === 'gone' ? 'not running' : state}.\n${c.messages
          .slice(-8)
          .map(
            (m) =>
              `${m.who === 'you' ? this.user : t.name}: ${excerpt(m.text ?? m.question?.title ?? (m.artifact ? tag('artifact', { id: m.artifact.id, title: this.snapshot().artifacts.find((a) => a.id === m.artifact!.id)?.title ?? 'deleted' }) : ''), 300)}`,
          )
          .join('\n')}`
      },
      overview: async () => {
        const s = this.snapshot()
        const places = s.places.map(
          (p) => `${p.id} (${p.machine}:${p.name}): ${p.unreachableSince || p.connecting ? 'unavailable; last known ' : ''}${p.status}`,
        )
        const tasks = s.tasks
          .filter((t) => !t.archived)
          .map((t) => {
            const p = s.places.find((p) => p.id === t.place)
            return `${p?.machine ?? t.place}:${t.id} ${t.name}: ${p?.unreachableSince || p?.connecting ? 'unavailable; last known ' : ''}${t.state}${statusLine(t) ? ` (${statusLine(t)})` : ''}`
          })
        return [...places, ...tasks].join('\n') || 'No tasks.'
      },
      onReply: (fn) => {
        const t = resolve()
        if (!t.peer) {
          const set = this.replyFns.get(t.key) ?? new Set()
          set.add(fn)
          this.replyFns.set(t.key, set)
          this.lastAgentMsg.set(t.key, this.chats.lastReply(t.key) ?? '')
          return () => {
            set.delete(fn)
            if (!set.size) {
              this.replyFns.delete(t.key)
              this.lastAgentMsg.delete(t.key)
            }
          }
        }
        let active = true
        let ready = false
        const seen = new Map<string, string>()
        const accept = (c: Chat) => {
          const replies = c.messages.filter((m) => m.who === 'agent' && m.text && !m.card)
          if (ready) for (const m of replies) if (seen.get(m.id) !== m.text) fn(excerpt(m.text!, 600))
          for (const m of replies) seen.set(m.id, m.text!)
          ready = true
        }
        const off = this.peers!.subscribeChat(t.peer, t.key, (c) => {
          if (active) accept(c)
        })
        void load(t)
          .then((view) => {
            if (active && !ready) accept(view.chat)
          })
          .catch(() => {})
        return () => {
          active = false
          off()
        }
      },
    }
  }
}
