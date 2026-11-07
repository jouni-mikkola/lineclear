import { join } from 'node:path'
import type { TermScreen } from '../../shared/types.ts'
import type { AgentInfo, AgentStatus, HerdrError } from './herdr.ts'
import { tag } from './chatlines.ts'
import { boxDir } from './mfs.ts'

export interface AgentRecord {
  /** Identity for startup instructions; every replacement invalidates the old ones. */
  launch?: string
  /** chat key */
  key: string
  /** herdr agent name */
  name: string
  /** herdr agent kind */
  kind: string
  cwd: string
  /** herdr workspace label it lives in */
  workspace: string
  tab?: string
  model?: string
  effort?: string
  /** instructions appended to the CLI's system prompt (or sent first, hidden, where it has no such option) */
  system?: string
  /** log files, oldest first: one per session */
  logs: string[]
  /** the CLI's own session id (claude, pi), for resuming */
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
  /** the CLI, model and effort Settings said for its role when it last started on them: a change since is offered as
   *  a restart in its chat (restart.ts) */
  set?: { kind: string; model?: string; effort?: string }
}

export interface OutItem {
  generation?: string
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
  /** /new: Lineclear reads the new session's log */
  command?: boolean
}

/** what starts an agent: its record, the first thing it is told, and where its pane comes from when it isn't its
 *  workspace by label (a task's herdr worktree space) */
/** was: the label its workspace had before, renamed in place when that one is still open */
export type Spec = Omit<AgentRecord, 'logs' | 'started'> & { first?: string; pane?: () => Promise<string>; was?: string; fresh?: boolean }

/** why what you send waits: a menu or permission prompt is up, the agent is starting, or (a CLI command) mid-turn */
export type Hold = 'menu' | 'start' | 'turn'

export interface SendOpts {
  generation?: string
  /** starts (or resumes) the agent when it isn't running */
  ensure?: () => Promise<unknown>
  /** the screen's own id for it */
  cid?: string
  /** a CLI command: only between turns */
  idle?: boolean
  /** /new (see OutItem.command) */
  command?: boolean
}

export interface Sent {
  waiting: boolean
  /** why it waits */
  waitsFor?: Hold
  item: OutItem
}

export const ROUTING_FAILURE = 'Could not provision private agent command routing'

export type Events = {
  routed: [key: string]
  status: [key: string, status: AgentStatus | 'gone']
  logs: [key: string]
  sent: [item: OutItem]
  /** what a screen sent couldn't go in */
  failed: [key: string]
  /** a first message that never arrived: given up on */
  undelivered: [key: string]
  output: [key: string, screen: TermScreen]
}

/** where an agent's instructions are kept for its CLI to read */
export const promptPath = (name: string) => join(boxDir(), 'prompts', `${name}.md`)

/** herdr refused a start because the agent's name sits on a pane: the pane (not `except`, the new one) that holds
 *  exactly this name, which is the agent's own earlier pane; never a pane under another name */
export function ownOldPane(e: unknown, list: AgentInfo[], name: string, except: string): string | undefined {
  if (!/already used/.test((e as Error)?.message ?? '')) return undefined
  return list.find((a) => a.name === name && a.pane_id !== except)?.pane_id
}

/** what a refusal from herdr means for what you send: a menu is up, or the agent just started and herdr doesn't count
 *  it as its named agent yet ("agent shep-all is not an active named agent"); anything else, it can't go in */
export function holdFrom(e: unknown): Hold | undefined {
  const code = (e as HerdrError).code
  if (code === 'agent_blocked') return 'menu'
  if (code === 'agent_not_found' || code === 'agent_not_ready' || code === 'agent_not_running') return 'start'
  if (/not an active named agent/.test((e as Error)?.message ?? '')) return 'start'
  return undefined
}

/** wraps text Lineclear sends that is not for the chat (instructions, news), in a tag of what it is when it is one
 *  of its lines: <lineclear><news task="SHE-9" event="merged">…</news></lineclear>; readers' text is stripped of it */
export const hidden = (s: string, kind?: string, attrs: Record<string, string> = {}) => tag('lineclear', {}, kind ? tag(kind, attrs, s) : s)
export const stripHidden = (s: string) => s.replace(/<lineclear(?:\s+[\w-]+="[^"]*")*\s*>[\s\S]*?<\/lineclear>\s*/g, '').trim()
