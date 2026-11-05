import { Subscription } from './herdr.ts'
import { AgentsSending } from './agents-sending.ts'
import { uniqueLogs } from './log-list.ts'
export type { AgentRecord, OutItem, Spec } from './agents-helpers.ts'
export { ROUTING_FAILURE, hidden, stripHidden } from './agents-helpers.ts'

export class Agents extends AgentsSending {
  constructor() {
    super()
    // records written before logs were kept once each
    for (const r of Object.values(this.records)) {
      r.logs = uniqueLogs(r.logs ?? [])
      this.byName.set(r.name, r.key)
    }
    // status and pane changes arrive as events; the session is read once it opens and when it drops and reopens
    this.sub = new Subscription(
      (e) => this.heard(e),
      (planned) => this.subOpened(planned),
      undefined,
      () => this.linkDown(),
    )
  }

  /** the subscription is open: the session is read unless the caller read it just before opening and herdr answered */
  private subOpened(planned: boolean) {
    this.subDown = false
    if (!planned || !this.reachable) void this.refresh(true)
  }

  /** the subscription dropped: herdr is out of reach until it opens again and the session is read */
  private linkDown() {
    this.subDown = true
    if (this.stopped || !this.reachable) return
    this.reachable = false
    this.emit('status', '*', 'gone')
  }
}
