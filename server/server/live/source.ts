import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Source } from '../source.ts'
import { HOME } from '../store.ts'
import { followCommand } from './commands.ts'
import { HOME_SPACE, placeId } from './places.ts'
import { carryOn } from './retry.ts'
import { has } from '../plugins.ts'
import { LiveSourceUpkeep } from './source-upkeep.ts'
import { held } from './loop-lag.ts'

export class LiveSource extends LiveSourceUpkeep implements Source {
  constructor() {
    super()
    this.timers.push(setInterval(() => held('rule requested news', () => void this.drainRequestedNews()), 1000))
    this.agents.secretScope = (chat) => {
      const space = /^[^/]+\/(Agent|Reviewer)$/.test(chat)
        ? this.engine.task(chat.split('/')[0])?.project
        : this.places.find(chat)?.id === chat
          ? chat
          : undefined
      return space ? [space, placeId.machine(), 'all'] : undefined
    }
    mkdirSync(HOME, { recursive: true })
    // what the Watcher kept, from before agents reported their own progress
    for (const f of ['watcher.json', 'watcher-call.json']) rmSync(join(HOME, f), { force: true })
    if (this.mirror) {
      this.followLogs()
      this.mirror.start()
      this.timers.push(setInterval(() => held('rule follow logs', () => this.followLogs()), 5000))
      // the Everywhere defaults: the main machine's, read from its settings as they change
      this.adoptEverywhere()
      this.timers.push(setInterval(() => held('rule adopt everywhere', () => this.adoptEverywhere()), 3000))
    }
    this.peers?.on('snapshot', () => {
      // another machine's task may be what a queued task here waits for
      this.syncMachines()
      this.engine.recheck()
      this.engine.unifyIds(this.peerTasks())
      this.emit('snapshot')
    })
    this.engine.peerTask = this.peers ? (machine, id) => this.peerTask(machine, id) : undefined
    // held tasks start once this machine has room: by its load (once measured) and herdr answering
    this.engine.machine = () => (has('health') && this.health.last ? { busy: this.health.busy(), herdr: this.agents.reachable } : undefined)
    this.peers?.on('chat', (key) => this.emit('chat', key))
    this.peers?.on('terminal', (key, screen) => this.emit('terminal', key, screen))
    this.peers?.on('alert', (a) => this.emit('alert', this.renamed(a)))
    this.peers?.on('news', (machine, n) => this.peerNews(machine, n))
    this.chats.onPost = (key) => this.fresh(key)
    this.chats.onRead = (key) => {
      this.emit('chat', key)
      this.fresh(key)
    }
    this.agents.on('routed', (key) => this.engine.routeRecovered(key))
    this.agents.on('status', (key, st) => {
      if (key === '*') return this.emit('snapshot')
      this.revivals.status(key, st)
      this.engine.agentStatus(key)
      this.fresh(key)
      // its turn ended: maybe its provider cut it off (its log may say so a moment later)
      if (st !== 'working' && st !== 'blocked') {
        this.checkCut(key)
        setTimeout(() => this.checkCut(key), 2000)
        this.reseat(key)
      }
      this.emit('snapshot')
      this.chats
        .readMenu(key)
        .then(() => this.emit('chat', key))
        .catch(() => {})
    })
    this.agents.on('logs', (key) => this.watched.includes(key) && this.emit('chat', key))
    this.agents.on('sent', (item) => {
      if (item.command) void followCommand(this.agents, this.chats, item, (key) => this.emit('chat', key))
      // anything else that goes in wakes it: the count of tries starts again
      if (item.text !== carryOn(this.retries.get(item.key)?.reason ?? '')) this.retries.clear(item.key)
      this.engine.sent(item.key)
      this.emit('chat', item.key)
    })
    this.agents.on('undelivered', (key) => this.engine.briefLost(key))
    this.agents.on('failed', (key) => this.emit('chat', key))
    this.agents.on('output', (key, screen) => {
      if (this.terms.includes(key)) this.emit('terminal', key, screen)
    })
    this.engine.on('changed', () => this.emit('snapshot'))
    this.engine.retry = (key) => this.retries.get(key)
    // a turn cut short (Esc, a prompt turned down) runs no hook: its log says it is over
    this.agents.endedSince = (key, at) => this.chats.endedSince(key, at)
    this.agents.beforeInput = async (key) => {
      if (!['working', 'gone'].includes(this.agents.status(key)) && (await this.chats.readMenu(key, true))) this.emit('chat', key)
    }
    this.agents.menuUp = (key) => this.menuAnswers.has(key) || !!this.chats.menu(key)
    this.engine.on('card', (t, status, sub) => this.onCard(t, status, sub))
    // a task's question shows on its needs-you card in its space's chat too: the card follows it
    this.on('chat', (key) => {
      const t = key.endsWith('/Agent') ? this.engine.task(key.slice(0, -'/Agent'.length)) : undefined
      if (!t) return
      if (this.watched.includes(t.project)) this.emit('chat', t.project)
      // no one looks at it now: its card still keeps what it asks, to show how it was answered
      else if (this.engine.statusOf(t) === 'need') this.withAsks(this.chats.chat(t.project))
    })
    this.engine.on('news', (project, text, kind, about, card) => this.news(project, text, kind, about, card))
    this.engine.on('gone', (t, forget) => {
      // stopped, closed or deleted: no try is due any more
      this.retries.clear(`${t.id}/Agent`)
      void this.browsers?.close(t.id, forget).catch(() => undefined)
    })
    if (this.browsers && process.env.NODE_ENV !== 'test') {
      // browsers left from before a restart, or opened again after their task ended (tests never sweep this machine's)
      const sweep = () => void this.sweepBrowsers().catch(() => undefined)
      this.timers.push(setTimeout(sweep, 20_000) as unknown as ReturnType<typeof setInterval>, setInterval(sweep, 600_000))
      // browsers left idle (Settings, browser.idleClose): looked for once a minute
      this.timers.push(setInterval(() => void this.browsers?.closeIdle().catch(() => undefined), 60_000))
    }
    this.agents.start()
    // the space the machine's and All machines' coordinators shared is the home space's now; their agents close
    void this.agents.space(HOME_SPACE.label, HOME_SPACE.was).catch(() => undefined)
    // watched chats: read new log lines once a second; schedules once a minute
    this.timers.push(setInterval(() => held('rule poll chats', () => this.pollChats()), 1000))
    // a reply in a turn that goes on (or one only background work follows) changes no status: looked for here
    this.timers.push(
      setInterval(
        () => held('rule fresh status', () => Object.keys(this.agents.records).forEach((k) => this.agents.status(k) !== 'gone' && this.fresh(k))),
        5000,
      ),
    )
    this.timers.push(setInterval(() => held('rule run schedules', () => this.runSchedules()), 60_000))
    this.timers.push(setInterval(() => this.emit('snapshot'), 30_000))
    if (process.env.NODE_ENV !== 'test') this.timers.push(setInterval(() => held('rule health tick', () => this.healthTick()), 5000))
    if (process.env.NODE_ENV !== 'test') this.timers.push(setInterval(() => void this.revive().catch(() => undefined), 15_000))
  }
}
