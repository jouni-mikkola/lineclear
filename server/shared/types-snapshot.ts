import type { BrowserNote } from './browser.ts'
import type { Place, Machine, Task, Artifact, Section } from './types-core.ts'
import type { SettingSection, Chat } from './types-chat.ts'

/** one file of a task's worktree */
export interface FileText {
  path: string
  size: number
  text?: string
  binary?: boolean
  /** only its start is shown */
  tooBig?: boolean
}

/** one file a task changed against its base */
export interface DiffFile {
  path: string
  /** a renamed file's old path */
  from?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  /** lines added and taken out */
  add: number
  del: number
  binary?: boolean
}

/** what a task changed against its base (main): committed or not */
export interface Diff {
  base: string
  files: DiffFile[]
  add: number
  del: number
}

/** one changed file's unified diff */
export interface Patch {
  path: string
  text: string
  binary?: boolean
  tooBig?: boolean
}

export interface PrCheck {
  name: string
  state: 'pass' | 'fail' | 'pending' | 'skip'
  url?: string
}

/** a task's pull request on GitHub */
export interface PullRequest {
  number: number
  title: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  url: string
  checks: PrCheck[]
}

/** what the side panel asks of a task's worktree */
export type WorktreeAsk = { task: string } & (
  | { what: 'files' }
  | { what: 'file'; path: string }
  | { what: 'diff' }
  | { what: 'patch'; path: string }
  | { what: 'pr' }
)

export interface Snapshot {
  name: string
  host: string
  /** every space, in the sidebar's order: each machine's home space first */
  places: Place[]
  /** the machines, as headings over their spaces, in the sidebar's order */
  machines: Machine[]
  tasks: Task[]
  /** every artifact, of every machine */
  artifacts: Artifact[]
  /** open coordinator questions, by place id (a choice card's id, or "blocked" on the CLI's own menu): counted as waiting on you */
  asks: Record<string, string>
  /** Unanswered request IDs by original chat, never forwarded copies. Optional for older machines/plugins. */
  attentionRequests?: Record<string, string[]>
  settings: SettingSection[]
  /** a source like demo marks its data as fictional */
  demo?: boolean
  /** where the human's name in chat lines comes from */
  user: string
  /** when each chat (by its key) last had something new from its agent or Lineclear (ms): it shows bold until read */
  last?: Record<string, number>
  /** how far you have read each chat (ms), the same on every device; '*': since when read marks are kept, so anything
   *  older counts as read */
  read?: Record<string, number>
  /** the sidebar's sections, as Slack's, each with its spaces in the human's order: the top ones first (Pinned, id
   *  'pinned', among them), then each machine's, its machine in order (shared/order.ts) */
  sections?: Section[]
}

export type Action =
  /** cid: the screen's own id for what it sent, which comes back on the message (Message.cid); reply: the id of the
      message it answers */
  /** space: sent from a needs-you card in that space's chat (CardAsk) */
  | { type: 'send'; chat: string; text: string; attachments?: string[]; cid?: string; reply?: string; space?: string }
  | { type: 'react'; chat: string; message: string; emoji: string }
  /** the smoke check after an update (install.sh): a hidden line that asks for no reply. It answers no open card */
  | { type: 'probe'; chat: string }
  /** a secret kept at a level (all, m:<machine>, p:<machine>:<space>), or removed (null); kept on the main machine, so
      it names no chat or place to be passed on by. card: the agent's ask it answers, told once it is kept */
  | { type: 'secret'; level: string; name: string; value: string | null; card?: { chat: string; id: string } }
  /** the main machine kept a secret an agent asked for: its card says so, and its agent is told (no value) */
  | { type: 'secret-saved'; chat: string; card: string; name: string; level: string }
  /** fromAlert: a notification's button, which answers only the card the chat still waits on (an old alert's can't
      answer what came after, or a card already settled in words) */
  | { type: 'answer'; chat: string; question: string; choice: number; choices?: number[]; note?: string; other?: string; fromAlert?: boolean; space?: string }
  | { type: 'page-send'; chat: string; page: string; text: string }
  | { type: 'page-note'; chat: string; page: string; note: string; target?: string }
  /** an artifact's page sent something, you noted on it, or wrote about it in its viewer: to its keeper. By its place,
      so another machine's goes there */
  | { type: 'artifact-send'; place: string; artifact: string; v: number; text: string }
  | { type: 'artifact-note'; place: string; artifact: string; v: number; note: string; target?: string }
  | { type: 'artifact-say'; place: string; artifact: string; v: number; text: string }
  | { type: 'artifact-delete'; place: string; artifact: string }
  /** Mark up's notes from the shared browser, sent together into the task's chat */
  | { type: 'browser-notes'; chat: string; url: string; title?: string; viewport?: { w: number; h: number }; notes: BrowserNote[] }
  | { type: 'model'; chat: string; model: string }
  | { type: 'effort'; chat: string; effort: string }
  | { type: 'keys'; chat: string; keys: string[] }
  | { type: 'text'; chat: string; text: string }
  | { type: 'call'; chat: string; on: boolean }
  /** place: the level it is set at, as a place id (all when none); a machine's or project's goes to that machine */
  | { type: 'setting'; key: string; value: string | null; place?: string }
  /** archive a task (on: true; its agent stops first) or bring it back; chat is its agent's key (ID/Agent) */
  | { type: 'archive'; chat: string; on: boolean }
  /** pin a task to the top of its lists (on: true) or unpin it */
  | { type: 'pin'; chat: string; on: boolean }
  /** pause a working task: its agent is interrupted (it stays alive) and the task is To do until written to */
  | { type: 'pause'; chat: string }
  /** what the restart sheet shows for a coordinator (chat: its place id) or a task's agent (ID/Agent): RestartInfo */
  | { type: 'restart-info'; chat: string }
  /** start a coordinator or a task's agent again on this CLI, model and effort (none: the CLI's own; no kind: all as
      Settings say for its role); save: as its space's Settings for its role too */
  | { type: 'restart'; chat: string; kind?: string; model?: string; effort?: string; save?: boolean }
  /** mark a task done with nothing merged (lineclear task close); refused (held) while it holds unmerged work, unless force */
  | { type: 'close'; chat: string; force?: boolean }
  /** delete a task: its agent, herdr space, worktree, branch, chat and record; refused while it holds work, unless force */
  | { type: 'delete'; chat: string; force?: boolean }
  /** forget a space (lineclear space remove): its folder and code stay on disk, its coordinator closes, and its open
      tasks and chat come back if it is added again; refused while one of its tasks is working */
  | { type: 'space-remove'; place: string }
  /** the sidebar's order, dragged by the human: the machines (under 'all'), or one machine's spaces
      (under its id), or a section's (under its id: 'pinned' for Pinned), or the sections at the top ('sections') or in a
      machine ('sections:<machine id>'). Kept by the machine the screen talks to, never sent on to another */
  | { type: 'order'; under: string; ids: string[] }
  /** a space into a section, or back under its machine (to: the machine's id), before another there or last */
  | { type: 'move'; id: string; to: string; before?: string }
  /** a section of the sidebar made (at the top, or inside a machine: its key) or deleted (its spaces go back under their
      machines); renamed with 'rename'. Kept as the order is */
  | { type: 'section'; op: 'new'; name: string; emoji?: string; machine?: string }
  | { type: 'section'; op: 'delete'; id: string }
  /** a machine's or space's name as it shows everywhere ('' gives it back its own); kept by the main machine (id,
      not place: never sent on to another), and nothing else changes: its folder, repo, herdr space and task ids stay */
  /** a machine's or section's emoji too: '' takes it away, none leaves it */
  | { type: 'rename'; id: string; name: string; emoji?: string }
  /** chats you have read, each up to its Snapshot.last as the screen saw it. Kept by the machine the screen talks to,
      never sent on to another */
  | { type: 'read'; chats: Record<string, number> }

/** an agent's terminal as herdr draws it: its recent lines (ANSI), and the pane's size in cells (none from an older
 *  machine) */
export interface TermScreen {
  ansi: string
  cols?: number
  rows?: number
}

/** how Lineclear's last update of itself went (update.json in its folder, written by the supervisor) */
export interface UpdateStatus {
  /** ok: running the newest commit; failed: kept the running version; restarting: about to come back on a new one */
  state: 'ok' | 'failed' | 'restarting'
  /** the commit tried last, and its subject line */
  commit: string
  subject: string
  /** the commit the running build was made from */
  built: string | null
  /** the release folder (in .releases) the server runs from */
  release?: string
  error?: string
  at: number
}

export type ServerEvent =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'chat'; chat: Chat }
  | ({ type: 'terminal'; chat: string } & TermScreen)
  | { type: 'offline'; since: number }
  | { type: 'update'; update: UpdateStatus | null }
  /** the answer to a screen's ping: its link still works */
  | { type: 'pong' }
