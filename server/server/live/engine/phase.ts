// A task is in one phase at a time, kept on its record so a restart sees what the engine was doing.
// `transitions` lists every move; an event a phase does not list is refused.

/** idle: nothing of the engine's runs for it (stored as no phase) */
export type Phase = 'idle' | 'starting' | 'briefing' | 'handing' | 'cleaning'

export type PhaseEvent =
  /** its worktree and agent are being made */
  | 'start'
  /** its agent is up and its brief is sent: it is To do until the agent works on it */
  | 'launched'
  /** the work of the phase is over (the brief phase is ended by `brief-over`) */
  | 'over'
  /** the brief was taken up, never arrived, the task was stopped or went on with a go */
  | 'brief-over'
  /** its backup agent takes over */
  | 'handoff'
  /** its place is put away */
  | 'clean'
  /** the engine started again: whatever it was doing is gone */
  | 'interrupted'

export const PHASES: readonly Phase[] = ['idle', 'starting', 'briefing', 'handing', 'cleaning']
export const EVENTS: readonly PhaseEvent[] = ['start', 'launched', 'over', 'brief-over', 'handoff', 'clean', 'interrupted']

export const transitions: Record<Phase, Partial<Record<PhaseEvent, Phase>>> = {
  idle: { start: 'starting', handoff: 'handing', clean: 'cleaning' },
  starting: { launched: 'briefing', over: 'idle', interrupted: 'idle' },
  briefing: { start: 'starting', 'brief-over': 'idle', handoff: 'handing', clean: 'cleaning', interrupted: 'idle' },
  handing: { over: 'idle', interrupted: 'idle' },
  cleaning: { over: 'idle', interrupted: 'idle' },
}

/** moves a record to its next phase; false and nothing changed when the phase refuses the event */
export function move(t: { phase?: Phase }, event: PhaseEvent): boolean {
  const to = transitions[t.phase ?? 'idle'][event]
  if (!to) return false
  t.phase = to === 'idle' ? undefined : to
  return true
}
