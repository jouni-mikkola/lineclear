import { TITLE_MAX, type Report, type Task, type TaskStatus, type UpdateCard } from '../../../shared/types.ts'
import { HOST } from '../places.ts'
import * as G from './git.ts'
import type * as GH from './github.ts'
import type * as Lane from './lane.ts'

export interface TaskRec {
  id: string
  n: number
  project: string
  /** the machine its worktree and agent are on (its label); left out: the server's own */
  machine?: string
  title: string
  result?: string
  desc: string
  /** the file under the data folder that holds the brief, and its size in bytes */
  briefPath?: string
  briefSize?: number
  by: string
  /** Exact coordinator chat that requested this task, when known. */
  requester?: string
  created: number
  /** former ids, `machine:ID`, kept when a duplicate id was renamed */
  aliases?: string[]
  updated: number
  branch?: string
  worktree?: string
  base?: string
  /** its pull request on GitHub, once one is open */
  pr?: { number: number; url: string }
  /** the commit Lineclear last pushed to its branch on GitHub, and when: checks a push starts take a moment to show */
  pushed?: { sha: string; at: number }
  /** what its agent knows of its pull request, so news is told once: comments from before `since` (when it first
   *  reported done) and those in `seen` (by id), and the checks that failed at a commit (`failed`) */
  watch?: { since: string; seen?: string[]; failed?: string }
  /** the agent's own words when it reported done */
  said?: string
  /** its facts line (PR, commit, checks, review, not proven), apart from the summary */
  facts?: string
  /** the agent ran lineclear ready and nothing was asked of it since */
  reported?: boolean
  /** on its way into main since it was reported ready: merging, GitHub's checks, a rebase (Merging) */
  landing?: Lane.Landing
  merged?: boolean
  /** why its last merge stopped, until it merges */
  mergeStopped?: string
  /** the commit its squash merge made on its base: what its branch is checked against when it is put away */
  squash?: string
  /** done with nothing merged (lineclear task close, or done with no changes): Done all the same */
  closed?: boolean
  /** how it closed: its agent's own `lineclear done` with no changes, or a `lineclear task close` (also a task moved to another machine) */
  closedBy?: 'done' | 'close'
  /** when it was merged or closed; tasks from before it was kept fall back to their last update */
  doneAt?: number
  /** when its agent first reported done: how long tasks take, for agents' guesses of their time left (estimates.ts) */
  reportedAt?: number
  /** when it was told that it is Ready with no review and no merge: once per Ready */
  readyNudged?: number
  /** its brief was sent again because its agent never began on it: once */
  briefResent?: boolean
  /** its place was put away once done: agent, space, worktree and branch (what lost nothing) */
  cleaned?: boolean
  /** what putting it away kept, and why ("~/x (uncommitted changes)") */
  kept?: string[]
  /** starting it went wrong */
  trouble?: string
  /** its worktree's install step failed: a stall (news for its coordinator, shown as stuck), not a question; a message to it starts it again */
  stuck?: string
  plan?: string[]
  /** its agent waits for a go (lineclear todo); anything written to it clears it */
  todo?: boolean
  /** queued: the tasks it waits for ("SHE-12", or "vm-str:SHE-12" on another machine); cleared by the go Lineclear
   *  sends once they are all done, or by anything written to it */
  after?: string[]
  /** the go sent to its agent, until the agent is seen at work: a restart in between sends it again */
  going?: string
  /** held by Lineclear until this machine has room for it (Settings → the machine's limits): why it waits (all its
   *  slots are taken, or the machine is too loaded) and since when. go: the message its agent gets then, and why it
   *  starts (none: it has no agent yet, and starts then on its brief). Anything you write to it lets it go at once */
  held?: { why: 'slots' | 'machine'; since: number; go?: string; goWhy?: string; plain?: boolean }
  /** lineclear task stop closed its agent and space; writing to it again clears it */
  stopped?: boolean
  /** the status coordinators were last told, so each change is told once */
  told?: TaskStatus
  /** the state last posted as a card (waiting on you, or done), so each is posted once */
  posted?: string
  /** when it was archived: out of every list and count, its record and chat kept (search and Archived show it) */
  archived?: number
  /** when it was last brought back: a Done task is archived again only that long after */
  unarchived?: number
  /** paused from the screen or task pause: 'sent' until its agent is seen stopped, then 'idle'. Seen at work again
   *  after that (work it left running in the background woke it), it is no longer paused: it works, and shows so */
  paused?: 'sent' | 'idle'
  /** when it was pinned: it shows in the Pinned group at the top of its lists; archiving or deleting it drops the pin */
  pinned?: number
  /** the CLI, model and effort its agent first starts with: from Settings, or task add's flags */
  agent?: Harness
  /** the CLI, model and effort its brief says reviews its change: from Settings, or task add's --reviewer flags */
  reviewer?: Harness
  /** lineclear merge waits for GitHub's checks, as its brief's Settings block said when it was added (Settings, or
   *  task add --set); none: a task from before, which follows Settings as they are now */
  waitChecks?: boolean
  /** its brief said to wait for the human's yes before merging, whatever Settings say now */
  askFirst?: boolean
  /** what its agent last said of its own progress (lineclear status): kept while it works or waits on you */
  report?: Reported
  /** its backup agent took over once its agent couldn't go on (retry.ts): from which CLI, to which, and why */
  tookOver?: { from: string; to: string; why: string; at: number }
  /** coordinators were told it stalled: its last sign of life then (`life`), and the report (by its time) it ran far
   *  past (`over`); each is told once, until it shows life again or reports anew */
  stalled?: { life?: number; over?: number }
  /** the last "may be stuck" card for Needs you with no question: when it was posted, so the next one is a gap later */
  silentAt?: number
}

/** a report as kept: its line, % done and minutes left as said `at` then; `pausedAt` while it waits on you */
export interface Reported {
  msg: string
  progress: number
  left?: number
  at: number
  pausedAt?: number
}

/** how an agent starts: its herdr kind (claude, codex, pi, …), model and effort; nothing for the CLI's own default */
export interface Harness {
  kind: string
  model?: string
  effort?: string
}

/** a CLI's own short error when its login ran out (Claude Code's API errors, its menu): never a reply about logins */
const LOGIN =
  /^\s*API Error\b.*(authentication_error|oauth token has expired|invalid api key|please run \/login)|^\s*(invalid api key|oauth token has expired)\b.*please run \/login/is
export const loginGone = (text = '') => text.length < 400 && LOGIN.test(text)

/**
 * The report a task shows: while it works, its minutes left count down from what its agent said; while it waits on
 * you, all of it stays as it was. Nothing once its job is over (Ready, Done, To do, Queued).
 */
export function reportOf(r: Reported | undefined, status: TaskStatus, now = Date.now()): Report | undefined {
  if (!r || (status !== 'work' && status !== 'need')) return undefined
  const spent = ((r.pausedAt ?? now) - r.at) / 60000
  return {
    msg: r.msg,
    progress: r.progress,
    eta: r.left === undefined ? undefined : Math.max(0, Math.round(r.left - spent)),
    paused: status === 'need' || undefined,
  }
}

/** finished: merged, or closed with nothing to merge */
export const ended = (t: TaskRec) => !!(t.merged || t.closed)

export const STATE: Record<TaskStatus, string> = {
  need: 'Needs you',
  ready: 'Ready',
  merging: 'Merging',
  work: 'Working',
  queued: 'Queued',
  todo: 'To do',
  done: 'Done',
}

/** one of the tasks a queued task waits for, as it stands: done, still open, ended without being done, gone, or on a
 *  machine that can't be reached right now */
export type DepState = 'done' | 'open' | 'stopped' | 'failed' | 'gone' | 'away'

/** another machine's task, as it last showed itself: 'away' while that machine can't be reached, 'unknown' for a
 *  machine this one doesn't know, nothing when that machine has no such task */
export type PeerTask = (machine: string, id: string) => Task | 'away' | 'unknown' | undefined

/** "vm-str:SHE-12" is another machine's task; this machine's own name leads to its own */
export const splitRef = (ref: string): [string | undefined, string] => {
  const i = ref.indexOf(':')
  if (i < 0) return [undefined, ref]
  const machine = ref.slice(0, i).toLowerCase()
  return [machine === HOST.toLowerCase() ? undefined : machine, ref.slice(i + 1)]
}

/** while load decides, held tasks start one at a time this far apart, so each one shows in the load first */
export const START_GAP = 30_000

/** the line a held task shows */
export const HELD = { slots: 'Waiting for a free slot', machine: 'Waiting for the machine' } as const

/** queued tasks are first looked at once herdr has told which agents are alive: a go sent before would start a second */
export const RECHECK_FIRST = 15_000

/** the branch every task's worktree gets */
export const branchFor = (t: TaskRec) => `work/${t.n}-${G.slug(t.title)}`

/** its herdr space's name */
export const labelOf = (t: TaskRec) => `${t.id} ${t.title}`

/** "7 days", "1 day", "off": how long a Done task stays before it archives itself (tasks.archiveAfter); null: never */
export function archiveAfterMs(v: string) {
  const m = v.trim().match(/^(\d+)(\s*days?)?$/i)
  return m && Number(m[1]) > 0 ? Number(m[1]) * 86_400_000 : null
}

/** leftovers of finished tasks are swept up this long after starting, and then every hour */
export const SWEEP_FIRST = 20_000
export const SWEEP_EVERY = 3_600_000

/** how long lineclear checks waits for GitHub's checks at most, and how often it looks */
export const CHECKS_WAIT = 9 * 60_000
export const CHECKS_EVERY = 10_000
/** checks a repo's workflows will start may take this long to show on a pull request just pushed */
export const CHECKS_SHOW = 90_000

/** a merge's caller may be gone after this long (an agent's shell, Claude Code's, moves a command to the background
 *  after two minutes), and a stopping Lineclear waits this long for the merges on their way */
export const MERGE_DEADLINE = 90_000

/** done tasks' pull requests are looked at for news (failed checks, comments) this long after starting, then this often */
export const WATCH_FIRST = 30_000
export const WATCH_EVERY = 120_000
/** a working task with no sign of life this long (no output, status report or commit) has stalled; looked at this often */
export const STALL_QUIET = 20 * 60_000
/** Needs you with no question, plan or login this long is a stall; a card each time it lasts this long again */
export const SILENT_NEED = 5 * 60_000
/** Ready this long with no merge and no word from its agent: the agent is told once */
export const READY_QUIET = 20 * 60_000
export const STALL_EVERY = 60_000
/** main's checks on GitHub are watched this long after a task merged through its pull request */
export const MAIN_WATCH = 3 * 3_600_000

/** the failed checks at a commit, as one key: the same failure is told once */
export const failKey = (head: string, c: GH.PrChecks) =>
  `${head}:${c.failed
    .map((f) => f.name)
    .sort()
    .join(',')}`

/** what someone wrote, as quoted to an agent: indented, and cut when long */
export const quote = (s: string, max = 1500) =>
  (s.length > max ? `${s.slice(0, max)}…` : s)
    .split('\n')
    .map((l) => `    ${l}`.trimEnd())
    .join('\n')

export const COMMENT: Record<string, string> = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', COMMENTED: 'Review' }

/** now, as GitHub writes times (to the second): what is compared with them */
export const ghNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

/** a pull request's footer, as the agent's CLI signs its work */
export const SIGNED: Record<string, string> = {
  claude: '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  codex: '🤖 Generated with [Codex](https://openai.com/codex)',
}

export const troubleOf = (e: unknown) => ((e as Error)?.message ?? String(e)).split('\n')[0].slice(0, 90)

/** a title fits one row: one too long (from an automation saved before the limit) is cut at a word */
export const short = (title: string) =>
  title.length > TITLE_MAX
    ? `${title
        .slice(0, TITLE_MAX)
        .replace(/\s+\S*$/, '')
        .slice(0, TITLE_MAX - 1)}…`
    : title

/** A title someone writes is refused when it would not fit one line of the tasks list on a phone. */
export function checkTitle(title: string) {
  const t = title.trim()
  if (t.length > TITLE_MAX)
    throw new Error(
      `That title is ${t.length} characters: write a shorter one, ${TITLE_MAX} at most, so it fits one line on a phone (the rest goes in the brief)`,
    )
  return t
}

export type Events = {
  changed: []
  /** news for coordinators: a task was added, waits on you, is ready, merged or closed; main went red on GitHub */
  /** card: one for the project's chat that no task's status posts (main went red) */
  news: [
    project: string,
    text: string,
    kind: 'added' | 'ready' | 'need' | 'done' | 'red' | 'stalled',
    about: { task: string; event: 'added' | 'ready' | 'needs-you' | 'merged' | 'closed' | 'main-red' | 'stalled' },
    card?: Omit<UpdateCard, 'id'>,
  ]
  /** a card for its project's chat: the task now waits on you (needs you, or ready), or it is done */
  card: [task: TaskRec, status: TaskStatus, sub: string]
  /** a task was stopped, merged, closed or deleted: what it had running beside its agent (its shared browser) goes;
   *  for good (forget) unless it was only stopped */
  gone: [task: TaskRec, forget: boolean]
}

/** a message you wrote makes the agent busy a moment later: until then it counts as working */
export const ANSWER_GRACE = 6000

/** an agent that never gets to work on its brief leaves To do after this long anyway (and then waits on you) */
export const BRIEF_WAIT = 120_000

/** what a task for later (task add --later) is told: its agent reads the brief and waits for a go */
export const LATER = "Don't start yet: wait for a go."
