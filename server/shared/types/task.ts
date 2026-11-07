import type { Status } from './place.ts'

/** The most characters a task's title may have: with its id it fits one line of the tasks list on a 390 px phone. */
export const TITLE_MAX = 32

/** The most characters an agent's status line may have: one line of a task row on a 375 px phone. */
export const STATUS_MAX = 40

/** The most characters a task's summary may have: what changed for the human, in two or three lines of its card on a
    phone. More detail goes in its agent's chat or its proof, the facts (PR, commit, checks…) in the record, not on the card. */
export const SUMMARY_MAX = 160

/** a summary and its facts line apart: older summaries carried it at their end ("… Facts: PR #3 · commit 1a2b3c4") */
export function splitFacts(said: string, facts?: string): { said: string; facts?: string } {
  const at = said.search(/(^|\s)Facts:\s/)
  if (at < 0) return { said: said.trim(), facts: facts?.trim() || undefined }
  const tail = said
    .slice(at)
    .replace(/^\s*Facts:\s*/, '')
    .trim()
  return { said: said.slice(0, at).trim(), facts: facts?.trim() || tail || undefined }
}

/** What a task's agent last reported of its job (lineclear status): a status line, how far through it is, the minutes left. */
export interface Report {
  /** at most STATUS_MAX characters: what it is doing right now */
  msg: string
  /** 0-100: how far through the whole task it is */
  progress: number
  /** minutes left, counted down while it works; 0 for under a minute; none when it gave none */
  eta?: number
  /** the agent waits on you or is blocked: the report stays as it was */
  paused?: boolean
}

/** need: its agent asks or waits for you; ready: finished, waits for you to merge it; merging: finished and on its way
 * into main, nothing for you to do (GitHub's checks run, it is rebased or merged); work: its agent is at it; queued:
 * it waits for other tasks to be done, then Lineclear tells its agent to go; todo: its agent waits for a go, or is
 * starting and not yet at work on its brief; done: merged */
export type TaskStatus = 'need' | 'ready' | 'merging' | 'work' | 'queued' | 'todo' | 'done'

/** A task's one agent: tapping the task opens its chat. */
interface TaskAgent {
  /** chat key */
  chat: string
  role: string
  cli: string
  /** always the task's own status: the list and the chat show one and the same */
  status: Status
  age: string
  note: string
  /** what herdr last said of the agent, kept from its events: the rule loop reads it instead of asking herdr */
  herdr?: AgentHerdr
}

export interface AgentHerdr {
  /** herdr's agent_status */
  status: string
  /** the path of its pi session file */
  session?: string
  /** when the event or snapshot it comes from arrived (ms) */
  at: number
}

export interface Task {
  /** short name, as people say it: GTM-15 */
  id: string
  name: string
  status: TaskStatus
  /** project place id */
  place: string
  /** the machine its worktree and agent are on; none: the server's own */
  machine?: string
  /** its machine cannot be reached: the task as that machine last showed it, since this time */
  unreachableSince?: string
  /** when it was made (ms), and the former ids a rename kept, like `machine-b:OMA-91` */
  createdAt?: number
  aliases?: string[]
  /** second line in lists */
  sub?: string
  age: string
  /** when a Done task finished (ms): the Done group shows newest first */
  doneAt?: number
  branch?: string
  /** destination captured when this task was added */
  base?: string
  /** why its last merge stopped, until it merges */
  mergeStopped?: string
  /** the agent's plan, when it posted one */
  plan?: string[]
  /** none until the task's agent starts */
  agent?: TaskAgent
  result?: string
  /** done with nothing to merge, and how: its agent's own done, or a task close */
  closed?: boolean
  closedBy?: 'done' | 'close'
  desc?: string
  said?: string
  /** its facts line when done: PR, commit, checks, review, what is not proven */
  facts?: string
  state: string
  on: string
  created: string
  /** its agent's job, while it works or pauses; none once it is done */
  report?: Report
  /** its pull request on GitHub, once one is open */
  pr?: { number: number; url: string }
  /** queued: the tasks it still waits for ("SHE-12", "vm-str:SHE-12" on another machine) */
  after?: string[]
  /** how it ended, for a task queued after it: done (merged, or closed with nothing to merge), stopped, failed */
  outcome?: 'done' | 'stopped' | 'failed'
  /** when it was archived (ms): out of every list and count, only search and its place's Archived view show it */
  archived?: number
  /** when it was pinned (ms): it shows in the Pinned group at the top of its lists */
  pinned?: number
  /** not done, its worktree gone and its agent dead for over 2 h: it holds no locks */
  orphaned?: boolean
}

/** Done tasks newest first, at the end; the rest keep their order (a stable sort) */
export const doneNewestFirst = <T extends Pick<Task, 'status' | 'doneAt'>>(ts: T[]): T[] => [
  ...ts.filter((t) => t.status !== 'done'),
  ...ts.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
]
