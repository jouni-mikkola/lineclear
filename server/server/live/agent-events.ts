import type { AgentInfo, HerdrEvent } from './herdr.ts'

/** the parts of an agent that an event of its pane carries */
const FIELDS = ['agent', 'agent_status', 'agent_session', 'cwd', 'foreground_cwd', 'title', 'terminal_title_stripped'] as const

/**
 * The agents herdr listed, after one event of its subscription: the new list, nothing when the event changes none, or
 * `read` when only herdr can say (an event that lacks the pane's place).
 */
export function listAfter(listed: AgentInfo[], e: HerdrEvent): AgentInfo[] | 'read' | undefined {
  const pane = (e.data.pane ?? e.data) as Partial<AgentInfo>
  const movedFrom =
    e.event === 'pane_moved' ? (e.data.previous_pane_id ?? (e.data.pane as { previous_pane_id?: string } | undefined)?.previous_pane_id) : undefined
  const at = listed.findIndex((a) => a.pane_id === pane.pane_id || a.pane_id === movedFrom)
  // a new pane has no agent yet; the event of its agent follows
  if (e.event === 'pane_created') return undefined
  if (e.event === 'pane_agent_detected' && at < 0) {
    if (!pane.pane_id || !pane.agent || !pane.tab_id || !pane.workspace_id) return 'read'
    return [...listed, { agent_status: 'unknown', cwd: null, interactive_ready: false, ...pane } as AgentInfo]
  }
  if (at < 0) return undefined
  if (e.event === 'pane_closed' || e.event === 'pane_exited') return listed.filter((_, i) => i !== at)
  if (e.event === 'pane_moved') {
    const { tab_id, workspace_id } = pane
    if (!tab_id || !workspace_id) return 'read'
    return listed.map((a, i) => (i === at ? { ...a, pane_id: pane.pane_id ?? a.pane_id, tab_id, workspace_id } : a))
  }
  if (e.event !== 'pane_agent_status_changed' && e.event !== 'pane_updated' && e.event !== 'pane_agent_detected') return undefined
  const was = listed[at]
  // readiness for input is not in an event: a CLI that was not ready is read again
  if (was.interactive_ready === false) return 'read'
  const next = { ...was }
  for (const k of FIELDS) if (pane[k] !== undefined) Object.assign(next, { [k]: pane[k] })
  if (FIELDS.every((k) => JSON.stringify(next[k]) === JSON.stringify(was[k]))) return undefined
  return listed.map((a, i) => (i === at ? next : a))
}
