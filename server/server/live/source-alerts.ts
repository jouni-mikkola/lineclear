import { randomUUID } from 'node:crypto'
import { taskAlert } from '../../shared/alerts.ts'
import { one, type Parsed } from './args.ts'
import type { TaskRec } from './engine/engine.ts'
import { placeId } from './places.ts'
import { LiveSourceRestartCommand } from './source-restart-command.ts'

export class LiveSourceAlerts extends LiveSourceRestartCommand {
  /** what a task's alert says and where it opens: its open card, else its last reply; a done task's card */
  protected taskAlert(t: TaskRec, status = this.engine.statusOf(t), sub = this.engine.subOf(t, status)) {
    const shown = status === 'need' || status === 'ready' || status === 'done' ? status : 'need'
    return taskAlert(t, shown, sub, { task: this.chats.chat(`${t.id}/Agent`), project: status === 'done' ? this.chats.chat(t.project) : undefined })
  }

  protected alertCommand(title: string | undefined, p: Parsed, ctx: { chat?: string }) {
    if (!title) throw new Error('lineclear alert "<title>" --body "<why>"')
    const named = one(p, 'task')
    const t = named ? this.engine.task(named) : undefined
    // another machine's task (the main machine's home space keeps every machine's overview): it opens on that task,
    // and while it waits on you it buzzes as the task's own alert would
    const far =
      named && !t
        ? this.peers
            ?.list()
            .flatMap((l) => l.snap?.tasks ?? [])
            .find((x) => x.id.toUpperCase() === named.toUpperCase())
        : undefined
    const waits = far && (far.status === 'need' || far.status === 'ready') ? { tag: far.id, task: true as const } : {}
    // about a task: it opens on its card. While the task waits on you, it says what the task needs as its own alert
    // does (the choices first, then the coordinator's why) and takes that alert's place
    const about = t && this.taskAlert(t)
    const body = one(p, 'body') ?? ''
    const from = ctx.chat ? this.chatName(ctx.chat) : 'Lineclear'
    if (t && about && ['need', 'ready'].includes(this.engine.statusOf(t)))
      this.alert({ id: randomUUID(), from: 'Lineclear', ...about, body: `${about.body}\n${from}: ${[title, body].filter(Boolean).join(': ')}` })
    else if (far) this.alert({ id: randomUUID(), from, title, body, go: { place: far.place, task: far.id }, ...waits })
    else {
      const go = about?.go ?? { place: ctx.chat && !ctx.chat.includes('/') ? ctx.chat : placeId.home() }
      this.alert({ id: randomUUID(), from, title, body, go, ...(ctx.chat?.includes('/') ? { task: true as const } : {}) })
    }
    return 'Alert sent.'
  }
}
