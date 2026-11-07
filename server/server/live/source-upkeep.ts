import { clip } from '../../shared/alerts.ts'
import type { TaskStatus, UpdateCard } from '../../shared/types.ts'
import type { Overview } from '../source.ts'
import { hidden } from './agents.ts'
import type { BrowserBridge, BrowserClient } from './browser.ts'
import { ended, type TaskRec } from './engine/engine.ts'
import { BOX } from './box.ts'
import { HOST, placeId } from './places.ts'
import { relaunchedLine } from './prompts.ts'
import { logLoop, type Wrong } from './revive.ts'
import { OVERVIEW_MAX, REPLY_AFTER_CARD } from './source-helpers.ts'
import { LiveSourceCli } from './source-cli.ts'

export class LiveSourceUpkeep extends LiveSourceCli {
  /** a coordinator that runs outside its folder (another machine's started in the main machine's path for it, where
   *  that machine had no such folder, or a home space's that was its machine's coordinator): started again in its own,
   *  with its session, once its turn is over */
  protected reseat(key: string) {
    const c = key.includes('/') ? null : this.places.coordinator(key)
    const r = this.agents.record(key)
    const st = this.agents.status(key)
    if (!c?.home || !r || r.cwd === c.cwd || this.reseating.has(key) || (st !== 'idle' && st !== 'done')) return
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

  /** news for coordinators: they act on it when the human asked them to. News the human
   *  sees as a card in the space's chat gets its coordinator's short reply after it, so a card never ends the chat. The
   *  space's own coordinator hears it. The main
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
    for (const id of project === home ? [home] : [project, home]) {
      if (kind === 'added') continue
      // the space's own coordinator is awake for it, and the home space hears only machine health (overview())
      if (id === home && id !== project) continue
      const prefix = id === project ? '' : `${projName}: `
      const act = ' Act on it if the human asked you to handle such things.'
      const tail =
        id === project && seen
          ? `${act} A card in this chat already shows the human the news${kind === 'need' ? ', and lets them answer the task right there (you hear when they do)' : ''}: ${REPLY_AFTER_CARD}`
          : kind === 'done'
            ? ' A card in the space’s chat already tells the human. Check for a next step (a task waiting for it, a failure, a question); if there is none, reply with only <no-reply>reason</no-reply>.'
            : ' Act on it if the human asked you to handle such things; otherwise tell the human what matters in a line or two. Nothing matters: reply with only <no-reply>reason</no-reply>.'
      this.agents.send(id, hidden(`${prefix}${text}.${tail}`, 'news', about), { ensure: () => this.coordinator(id) }).catch(() => undefined)
    }
    const requester = about?.task ? this.engine.task(about.task)?.requester : undefined
    // Owner and home already heard above. The main home already receives the overview over the worker link.
    const mainHome = requester && !BOX ? placeId.home() : undefined
    if (requester && requester !== project && requester !== mainHome) {
      this.requestedNews.post({ to: requester, from: project, text, task: about!.task, event: about!.event })
      void this.drainRequestedNews()
    }
    // for the main machine's home space, when this is another machine's worker: its link carries it there (app.ts; the
    // main machine has no link, and hears its own above)
    this.emit('news', { place: project, line: text, kind, about })
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
          const _kind =
            ({ added: 'added', ready: 'ready', 'needs-you': 'need', merged: 'done', closed: 'done', stalled: 'stalled' } as const)[n.event as 'ready'] ?? 'need'
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
    if (n.kind !== 'health') return
    const line = clip(n.line.split('\n')[0].replace(/\.$/, ''), OVERVIEW_MAX)
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
}
