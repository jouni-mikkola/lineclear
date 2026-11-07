/** a CLI the restart sheet offers; models and efforts where Lineclear passes them (none: it runs on its own) */
export interface RestartCli {
  kind: string
  name: string
  models?: { id: string; label: string; efforts: string[]; defaultEffort?: string }[]
  /** the levels its own default model takes */
  efforts?: string[]
}

export interface RestartInfo {
  role: 'task' | 'coordinator'
  /** its space, whose Settings a save changes */
  space?: string
  on: { kind: string; model?: string; effort?: string }
  /** False if no launch record exists; on is then only a proposed starting configuration. */
  onKnown?: boolean
  onWords: string
  want: { kind: string; model?: string; effort?: string }
  clis: RestartCli[]
  /** its agent is mid-turn: a restart interrupts it first */
  working: boolean
}
