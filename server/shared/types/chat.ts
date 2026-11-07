import type { Message } from './message.ts'

export interface ChatControls {
  /** the models its CLI offers, by name (Model Top 5.5) */
  models: string[]
  model: number
  /** the effort levels the model it is on takes, as the CLI names them (low, xhigh) */
  efforts: string[]
  effort: number
}

/** what the restart sheet shows: what its agent runs on now and what Settings say for its role (what it restarts with
 *  unless changed), each a CLI kind with a model id and level (none: the CLI's own) */
/** CLI-reported state, kept separate from the selected next-launch policy. */
export interface AgentRuntime {
  model?: string
  modelLabel?: string
  effort?: string
  effortUnsupported?: boolean
  source: 'session' | 'hook'
  at: number
}

/** "Runs on {on} · Settings now say {want}", by the first that differs: the CLI, the model or the effort */
export interface RestartHint {
  on: string
  want: string
}

export interface Chat {
  key: string
  /** the agent's and yours, and Lineclear's update cards among them */
  messages: Message[]
  /** herdr says the agent works: the CLI takes what you send at its next step */
  working?: boolean
  /** it works, but no message you will see is on its way: its turn is over and only background work runs (a subagent,
   *  a shell), or in a turn it started itself (news, background work waking it) no reply has shown yet; no dots then */
  background?: boolean
  /** what a screen sent (by its Message.cid) that waited for the agent and then couldn't go in, and why */
  failed?: { cid: string; error: string }[]
  /** finished agent: writing resumes it */
  finished?: boolean
  cli: string
  /** what this CLI lets the + menu change; only what it supports is listed */
  controls?: ChatControls
  /** Recorded launch values, never inferred from Settings. Missing values are CLI defaults, not observed telemetry. */
  agent?: { kind: string; model?: string; modelLabel?: string; effort?: string; runtime?: AgentRuntime }
  /** Settings for its role now say something else than what its agent runs on: a calm hint offers a restart */
  restart?: RestartHint
}
