import { statSync } from '../mfs.ts'
import { hidden } from '../agents.ts'
import { type TaskRec, STALL_QUIET, SILENT_NEED, READY_QUIET } from './engine-helpers.ts'
import { EngineStatus, NEED } from './status.ts'

export class EngineStalls extends EngineStatus {
  /**
   * Working tasks that went quiet (no sign of life for STALL_QUIET) or ran far past the time their agent said was left:
   * news for their coordinator, once per stall. Only time and liveness, which agents can't see of themselves: what to
   * do about it is the coordinator's call.
   */
  checkStalls(now = Date.now()) {
    for (const t of this.tasks) this.checkReady(t, now)
    for (const t of this.tasks) this.checkSilentNeed(t, now)
    for (const t of this.tasks) {
      if (t.archived || t.paused || this.statusOf(t) !== 'work' || this.retrying(t) || this.handing.has(t.id)) continue
      const life = this.lifeOf(t)
      const r = t.report
      // shown life since: its next stall is news again
      if (t.stalled?.life !== undefined && life > t.stalled.life) t.stalled.life = undefined
      const quiet = now - life >= STALL_QUIET && t.stalled?.life === undefined
      const over = r?.left !== undefined && r.at !== t.stalled?.over && now - r.at > (r.left + Math.max(r.left, 20)) * 60_000
      if (!quiet && !over) continue
      t.stalled = { life: quiet ? life : t.stalled?.life, over: r?.at }
      const mins = Math.max(0, Math.round((now - (quiet ? life : r!.at + r!.left! * 60_000)) / 60_000))
      this.emit('card', t, 'work', quiet ? `may be stuck: quiet for ${mins}m` : `may be stuck: ${mins}m past its time left`)
      this.emit('news', t.project, this.stallLine(t, now, quiet ? life : undefined), 'stalled', { task: t.id, event: 'stalled' })
      this.save()
    }
  }

  /**
   * Needs you with nothing to answer: no question, plan, login or failure. Nobody can act on it, so it is a stall: a
   * card every SILENT_NEED it lasts, for the rule loop to move up one rung each. Posted as a work card, like any stall,
   * so it keeps its own id and never replaces the task's Needs you card.
   */
  protected checkSilentNeed(t: TaskRec, now: number) {
    // the standard line is what a task shows when nothing asks you: a question, plan, login or failure shows its own
    const silent = !t.archived && !t.paused && !t.stopped && this.statusOf(t) === 'need' && this.subOf(t, 'need') === NEED.reply
    if (!silent) {
      t.silentAt = undefined
      return
    }
    const life = this.lifeOf(t)
    if (now - Math.max(life, t.silentAt ?? 0) < SILENT_NEED) return
    t.silentAt = now
    this.emit('card', t, 'work', `may be stuck: Needs you with no question for ${Math.round((now - life) / 60_000)}m`)
    this.save()
  }

  /**
   * Ready, its agent idle, and nothing merged or asked for a long while: its turn ended after `ready` with no review
   * and no merge, so nothing else will move it. Its agent is told once per Ready, and its coordinator hears.
   */
  protected checkReady(t: TaskRec, now: number) {
    if (t.archived || !t.reported || !t.reportedAt || t.readyNudged === t.reportedAt || this.statusOf(t) !== 'ready') return
    // asked to wait for the human's yes: Ready is where it should stay
    if (this.settings.ways(this.proj(t).name).merge === 'ask me first') return
    const key = this.key(t)
    if (this.agents.status(key) === 'working' || now - Math.max(t.reportedAt, this.lifeOf(t)) < READY_QUIET) return
    t.readyNudged = t.reportedAt
    const mins = Math.round((now - t.reportedAt) / 60_000)
    this.agents
      .send(
        key,
        hidden(
          `You reported ${t.id} ready ${mins} minutes ago and nothing has happened since: no review and no merge. Do what your brief says next: run the review it asks for, then merge with lineclear merge ${t.id}, or ask the human if it says to ask first.`,
          'go',
        ),
        { ensure: () => this.launch(t) },
      )
      .catch(() => undefined)
    this.emit('news', t.project, `${t.id} has been Ready for ${mins}m with no review and no merge. Its agent was told to go on`, 'stalled', {
      task: t.id,
      event: 'stalled',
    })
    this.save()
  }

  /** its last sign of life: its status changed, it was written to or reported, a tool call beat (lineclear alive), its hooks or its CLI's log moved */
  protected lifeOf(t: TaskRec) {
    const key = this.key(t)
    const logs = (this.agents.record(key)?.logs ?? []).slice(-2).map((p) => {
      try {
        return statSync(p).mtimeMs
      } catch {
        return 0
      }
    })
    return Math.max(t.updated, this.wrote.get(t.id) ?? 0, this.heard.get(t.id) ?? 0, this.beat.get(t.id) ?? 0, this.agents.said(key)?.at ?? 0, ...logs)
  }

  /** what Shepherdr saw of a stall: how long quiet (or past its estimate), its last status line, whether its agent runs */
  protected stallLine(t: TaskRec, now: number, quietSince?: number) {
    const key = this.key(t)
    const mins = (ms: number) => `${Math.max(0, Math.round(ms / 60_000))}m`
    const r = t.report
    const bg = this.agents.status(key) !== 'working' && this.agents.background(key)
    const ran = { agents: 'a subagent', shells: 'a shell', servers: 'a server' }
    const why =
      quietSince === undefined
        ? `it has worked ${mins(now - r!.at)} since its agent said ${r!.left}m were left`
        : bg
          ? `its agent's turn ended while ${ran[bg]} it started runs on, and nothing has changed for ${mins(now - quietSince)}`
          : `its agent shows as working, but nothing has changed for ${mins(now - quietSince)}: no new output, status report or commit`
    const heard = this.heard.get(t.id)
    const last = r ? `Its last status: "${r.msg}", ${r.progress}% done${heard ? `, ${mins(now - heard)} ago` : ''}` : 'It has reported no status'
    const info = this.agents.info(key)
    const alive = !info ? 'herdr shows no pane for its agent' : info.agent ? 'its agent process is running' : 'herdr sees no agent CLI running in its pane'
    return `${t.id} may have stalled: ${why}. ${last}; ${alive}. Nudge it (lineclear task tell ${t.id} "…"), stop it, or tell the human`
  }
}
