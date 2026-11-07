import type { Place, Machine, Task } from './types-core.ts'
import type { SettingSection, Chat } from './types-chat.ts'

export interface Snapshot {
  name: string
  host: string
  /** every space */
  places: Place[]
  /** the machines, as headings over their spaces */
  machines: Machine[]
  tasks: Task[]
  /** open coordinator questions, by place id (a choice card's id, or "blocked" on the CLI's own menu): counted as waiting on you */
  asks: Record<string, string>
  settings: SettingSection[]
  /** where the human's name in chat lines comes from */
  user: string
}

export type Action =
  /** cid: the screen's own id for what it sent, which comes back on the message (Message.cid); reply: the id of the
      message it answers */
  /** space: sent from a needs-you card in that space's chat (CardAsk) */
  | { type: 'send'; chat: string; text: string; attachments?: string[]; cid?: string; reply?: string; space?: string }
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
  /** a machine's or space's name as it shows everywhere ('' gives it back its own); kept by the main machine (id,
      not place: never sent on to another), and nothing else changes: its folder, repo, herdr space and task ids stay */
  /** a machine's emoji too: '' takes it away, none leaves it */
  | { type: 'rename'; id: string; name: string; emoji?: string }

/** an agent's terminal as herdr draws it: its recent lines (ANSI), and the pane's size in cells (none from an older
 *  machine) */
export interface TermScreen {
  ansi: string
  cols?: number
  rows?: number
}

export type ServerEvent =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'chat'; chat: Chat }
  | ({ type: 'terminal'; chat: string } & TermScreen)
  | { type: 'offline'; since: number }
  /** the answer to a screen's ping: its link still works */
  | { type: 'pong' }
