import type { AgentInfo, HerdrEvent } from './herdr.ts'

/** the parts of an agent that an event of its pane carries */
const FIELDS = ['agent', 'agent_status', 'agent_session', 'cwd', 'foreground_cwd', 'title', 'terminal_title_stripped'] as const

/**
 * The agents herdr listed, after one event of its subscription: the new list, nothing when the event changes none, or
 * `read` when only herdr can say (a pane that is new, moved or ended, an agent found: its name comes with the session).
 */
export function listAfter(listed: AgentInfo[], e: HerdrEvent): AgentInfo[] | 'read' | undefined {
  if (e.event === 'pane_created' || e.event === 'pane_agent_detected' || e.event === 'pane_exited' || e.event === 'pane_moved') return 'read'
  const pane = (e.data.pane ?? e.data) as Partial<AgentInfo>
  const at = listed.findIndex((a) => a.pane_id === pane.pane_id)
  if (at < 0) return undefined
  if (e.event === 'pane_closed') return listed.filter((_, i) => i !== at)
  if (e.event !== 'pane_agent_status_changed' && e.event !== 'pane_updated') return undefined
  const was = listed[at]
  // readiness for input is not in an event: a CLI that was not ready is read again
  if (was.interactive_ready === false) return 'read'
  const next = { ...was }
  for (const k of FIELDS) if (pane[k] !== undefined) Object.assign(next, { [k]: pane[k] })
  if (FIELDS.every((k) => JSON.stringify(next[k]) === JSON.stringify(was[k]))) return undefined
  return listed.map((a, i) => (i === at ? next : a))
}
