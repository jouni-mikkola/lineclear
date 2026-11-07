// CLI observations only. Launch preferences and model catalog defaults are deliberately not inputs.
import type { AgentRuntime } from '../../shared/types.ts'
import type { LogEvent } from './readers/types.ts'

export function sessionRuntime(events: LogEvent[], file: string | undefined, started: number): AgentRuntime | undefined {
  let state: AgentRuntime | undefined
  for (const e of events) {
    if (e.kind === 'session' && e.file === file) state = undefined
    if (e.kind !== 'runtime' || e.file !== file || e.at < started) continue
    // a new model drops the previous model's settings: an unset effort must not carry over
    if (e.runtime.model && state?.model && e.runtime.model !== state.model) state = undefined
    state = e.replace ? e.runtime : { ...state, ...e.runtime }
  }
  return state
}
