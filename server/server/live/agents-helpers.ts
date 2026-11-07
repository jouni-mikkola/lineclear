import { join } from 'node:path'
import type { TermScreen } from '../../shared/types.ts'
import type { AgentInfo, AgentStatus } from './herdr.ts'
import { tag } from './chatlines.ts'
import { boxDir } from './mfs.ts'

export interface AgentRecord {
  /** identity for startup instructions; every replacement invalidates the old ones */
  launch?: string
  /** the files it was started with: another set now means a restored older command runs, to be started again */
  files?: string
  /** chat key, then herdr's agent name and kind, and the herdr workspace label it lives in */
  key: string
  name: string
  kind: string
  cwd: string
  workspace: string
  tab?: string
  model?: string
  effort?: string
  /** instructions appended to the CLI's system prompt */
  system?: string
  /** log files, oldest first: one per session */
  logs: string[]
  /** the CLI's own session id, for resuming */
  sessionId?: string
  started: number
  /** whether it was at work when last seen running: kept on disk, so a reboot still tells it to carry on */
  working?: boolean
  /** set when the agent's run ended for good (task done): writing resumes it */
  finished?: boolean
  /** 'ask' keeps the CLI's own approvals; otherwise (task agents) it runs without asking */
  access?: 'full' | 'ask'
  /** environment for its terminal: who it is to the lineclear command */
  env?: Record<string, string>
  /** the CLI, model and effort Settings said for its role when it last started: a change since is offered as a restart */
  set?: { kind: string; model?: string; effort?: string }
}

export interface OutItem {
  launch?: string
  id: string
  key: string
  text: string
  at: number
  /** the screen's own id for it (Message.cid) */
  cid?: string
  /** the first message of a launch (the brief) */
  brief?: boolean
  /** a CLI command (/model, /compact): goes in only between turns */
  idle?: boolean
  command?: boolean
}

/** what starts an agent: its record, the first thing it is told, where its pane comes from when it isn't its workspace by
 *  label (a task's worktree space), and `was`, the label the workspace had before (renamed in place if still open) */
export type Spec = Omit<AgentRecord, 'logs' | 'started'> & {
  first?: string
  pane?: () => Promise<string>
  was?: string
  fresh?: boolean
  /** runs as a `pi --mode rpc` child of this server, not in a pane (pi on the server's own machine only) */
  rpc?: boolean
}

/** why what you send waits: a menu or permission prompt is up, the agent is starting, or (a CLI command) mid-turn */
export type Hold = 'menu' | 'start' | 'turn'

/** `ensure` starts (or resumes) the agent when it isn't running */
export type SendOpts = Pick<OutItem, 'cid' | 'idle' | 'command'> & { ensure?: () => Promise<unknown> }

export interface Sent {
  waiting: boolean
  /** what an RPC agent did with it: started, queued or handled */
  disposition?: string
  waitsFor?: Hold
  item: OutItem
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const ROUTING_FAILURE = 'Could not provision private agent command routing'

export type Events = {
  /** herdr's first full list was read after the start */
  listed: []
  routed: [key: string]
  status: [key: string, status: AgentStatus | 'gone']
  logs: [key: string]
  sent: [item: OutItem]
  failed: [key: string]
  output: [key: string, screen: TermScreen]
}

export const promptPath = (name: string) => join(boxDir(), 'prompts', `${name}.md`)

/** herdr refused a start because the agent's name sits on a pane: the other pane (not `except`, the new one) that holds
 *  exactly this name is the agent's own earlier pane */
export function ownOldPane(e: unknown, list: AgentInfo[], name: string, except: string): string | undefined {
  if (!/already used/.test((e as Error)?.message ?? '')) return undefined
  return list.find((a) => a.name === name && a.pane_id !== except)?.pane_id
}

/** wraps text Lineclear sends that is not for the chat in a tag: <lineclear><news task="SHE-9" event="merged">…</news></lineclear> */
export const hidden = (s: string, kind?: string, attrs: Record<string, string> = {}) => tag('lineclear', {}, kind ? tag(kind, attrs, s) : s)
export const stripHidden = (s: string) => s.replace(/<lineclear(?:\s+[\w-]+="[^"]*")*\s*>[\s\S]*?<\/lineclear>\s*/g, '').trim()
