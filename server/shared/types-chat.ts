import { type Question, type ArtifactPost, type Reaction, type ReplyQuote, type UpdateCard, type Machine, type Task, type Mode, MODES } from './types-core.ts'

/** what kind of step a tool call is, for its icon and its row */
export type StepKind = 'run' | 'read' | 'edit' | 'search' | 'web' | 'agent' | 'other'

/** A turn's steps grouped into rows that read at a glance: "Edited 2 files: app.ts, panel.tsx", "Ran tests: 41 passed" */
export interface StepRow {
  /** the same row whether it came with the turn or from its steps */
  key: string
  kind: StepKind
  text: string
  added?: number
  removed?: number
  /** how many of its steps failed */
  failed?: number
  /** its steps (Step.id), in order */
  steps: string[]
}

/** What a tool call did, in plain words, from its tool and input (the agent's own short description where it gave one) */
export interface StepWords {
  /** once over: "Checked the task list", "Read app.ts", "Searched the code for “review”" */
  title: string
  /** while it runs: "Checking the task list" */
  doing: string
  /** what it is on, to group by: a file's name (read, edit), a search's words; may be empty */
  target: string
  /** the raw thing, one tap deeper: the command, a file's path, the pattern, the address */
  detail?: string
  /** an edit's lines added and removed */
  added?: number
  removed?: number
  /** a test run: its outcome ("41 passed") reads from its output once over */
  test?: boolean
}

/** One tool call of an agent's turn: what it did, on what */
export interface Step extends StepWords {
  id: string
  kind: StepKind
  /** the tool's own name: Bash, Read, exec_command */
  tool: string
  at: number
  /** when it ended; none while it runs */
  end?: number
  failed?: boolean
  /** a test run's outcome: "41 passed", "2 failed, 39 passed" */
  result?: string
  /** it started this background job (Job.id) */
  job?: string
  /** its raw output can be read (activityOf, what: 'output') */
  output?: boolean
}

/** A turn's steps as the chat shows them: a few rows at a glance; all its steps come when it opens (activityOf, what:
 *  'turn') */
export interface TurnActivity {
  /** the turn's id, to ask for its steps */
  id: string
  at: number
  /** when it ended; none while it runs */
  end?: number
  /** the rows that say most, at most three, in the order they happened */
  rows: StepRow[]
  /** how many rows more it has */
  more?: number
  /** how many steps */
  steps: number
  /** the step it is on now (a live turn only) */
  now?: Step
  /** how many failed */
  failed?: number
}

/** a secret an agent asked for by name: the human types or pastes it in a masked box, for one of the levels offered;
 *  only its name ever shows, never its value */
export interface SecretAsk {
  id: string
  name: string
  /** why the agent needs it, in its words */
  why?: string
  /** where it may be kept, the agent's space first: a level's id (p:<machine>:<space>, m:<machine>, all) and its name */
  levels: { id: string; label: string }[]
  /** saved: where, by its level's name */
  saved?: string
}

export interface Message {
  id: string
  who: 'you' | 'agent'
  /** plain text (yours) or markdown (the agent's) */
  text?: string
  /** "Answered “Rerun CI on main?”" */
  answered?: string
  /** answered on the question's copy in a space's chat: a link there */
  elsewhere?: Question['elsewhere']
  artifact?: ArtifactPost
  question?: Question
  reactions?: Reaction[]
  /** waits to go in: the agent shows a menu or permission prompt, or is still starting (a busy one takes it at once) */
  waiting?: boolean
  /** why it waits: a menu is up (typed text could pick an option), the agent is starting, or a CLI command waits for the
   *  turn to end */
  waitsFor?: 'menu' | 'start' | 'turn'
  /** an attached file: each one is a message of its own, right after the text it came with */
  file?: { name: string; path: string }
  /** the id the screen gave what you sent: it showed it at once, and this message takes its place */
  cid?: string
  /** what it answers: a short quote of that message, and its id while the chat still has it (a tap jumps to it) */
  reply?: ReplyQuote
  /** a thin "New session" divider before this message */
  newSession?: boolean
  /** Shepherdr's update card about a task, drawn as the card; its text ("SHE-4 is done: …") is what a reaction or a
   *  reply quotes */
  card?: UpdateCard
  /** a turn's tool steps, as a few rows in plain words, just before its last reply */
  activity?: TurnActivity
  /** a secret the agent asked for (lineclear secret ask): a masked box to give it in */
  secret?: SecretAsk
  at?: number
}

/** an artifact posted with words becomes a message of its own right after them, as a file does; a question that came
 *  with it goes after it, the last thing the chat waits on */
export const apart = (msgs: Message[]): Message[] =>
  msgs.flatMap((m) => {
    if (!m.artifact || !(m.text || m.question || m.file)) return [m]
    const { artifact, question, ...words } = m
    const card = { id: `${m.id}:art`, who: m.who, at: m.at, artifact }
    if (!question) return [words, card]
    return words.text || words.file
      ? [words, card, { id: `${m.id}:q`, who: m.who, at: m.at, question }]
      : [
          { ...card, id: m.id },
          { id: `${m.id}:q`, who: m.who, at: m.at, question },
        ]
  })

/** Work an agent started in the background that still runs */
export interface Job {
  id: string
  kind: 'agent' | 'shell' | 'monitor' | 'headless'
  /** what it is: a subagent's description, a shell's command, a headless CLI's words */
  title: string
  at: number
  /** what it does now: its latest step, or its output's last line */
  now?: string
  /** its own steps (a subagent, a headless agent) or its output (a shell) can be read (activityOf, what: 'job') */
  more?: 'steps' | 'output'
}

/** what the screen asks of a chat's activity: a turn's steps, a step's raw output, a background job's steps or output */
export interface ActivityAsk {
  chat: string
  what: 'turn' | 'output' | 'job'
  id: string
}

export type ActivityAnswer = { steps: Step[]; more?: number } | { output: string; cut?: boolean } | { error: string }

/** Done tasks newest first, at the end; the rest keep their order (a stable sort) */
/** a machine's name as the human reads it ("Mac mini"), from its key, a place's machine ("Mac") */
export const machineName = (machines: Machine[] | undefined, machine?: string) => machines?.find((m) => m.machine === machine)?.name ?? machine ?? ''

export const doneNewestFirst = <T extends Pick<Task, 'status' | 'doneAt'>>(ts: T[]): T[] => [
  ...ts.filter((t) => t.status !== 'done'),
  ...ts.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
]

/** a mode's name: "Coordinator timer" */
export const modeName = (mode: Mode) => MODES.find(([m]) => m === mode)?.[1] ?? mode

/** a mode card, coordinator timer switched on or off: "coordinator timer on · works on its own", "coordinator timer off · does what you ask" */
export function modeCard(id: string, mode: Mode): UpdateCard {
  const what = MODES.find(([m]) => m === mode)?.[2] ?? ''
  return { id, mode: 'autopilot', text: `${mode === 'autopilot' ? 'on' : 'off'} · ${what.toLowerCase()}` }
}

/** an update card as a message in the chat: its words are what a reaction or a reply quotes */
export const cardMessage = (card: UpdateCard, at?: number): Message => ({
  id: card.id,
  who: 'agent',
  at,
  text: `${card.task ?? (card.mode ? modeName(card.mode) : (card.health?.machine ?? card.red ?? ''))} ${card.text}`,
  card,
})

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
  /** the agent's and yours, and Shepherdr's update cards among them */
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
  /** the turn that runs now: how far it got and its step on now, drawn as one quiet line at the end of the chat */
  live?: TurnActivity
  /** what it started in the background that still runs: subagents, shells, headless agents */
  jobs?: Job[]
  cli: string
  /** what this CLI lets the + menu change; only what it supports is listed */
  controls?: ChatControls
  /** Recorded launch values, never inferred from Settings. Missing values are CLI defaults, not observed telemetry. */
  agent?: { kind: string; model?: string; modelLabel?: string; effort?: string; runtime?: AgentRuntime }
  /** Settings for its role now say something else than what its agent runs on: a calm hint offers a restart */
  restart?: RestartHint
}

/** a CLI the restart sheet offers; models and efforts where Shepherdr passes them (none: it runs on its own) */
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

/** a trigger setting as Settings shows it: in plain words, its next runs (a time rule's), and a few ready-made values
 *  to pick; anything else the coordinator writes from the human's words */
export interface TriggerRow {
  words: string
  next: string[]
  presets: { label: string; value: string }[]
}

export interface SettingRow {
  label: string
  key: string
  value: string
  /** free text instead of a pick list */
  text?: boolean
  /** private instruction text, saved explicitly without a repository file */
  multiline?: boolean
  /** a trigger's time rule or event rules (Coordinator timer's heartbeat): shown in words, never as written */
  trigger?: TriggerRow
  /** a whole file's words (a coordinator's HEARTBEAT.md), in a box as wide as the page */
  doc?: boolean
  /** Complete generated launch settings, plain text after the editable Heartbeat. */
  instructions?: string
  /** read-only row (plugins, machines) */
  fixed?: boolean
  /** a page of Lineclear this row's value is set on (its path); the row is read-only here */
  lineclear?: string
  /** a line under the row's label (a plugin of yours replaces the built-in one) */
  hint?: string
  /** a refusal or a fault shown under the row */
  warn?: string
  /** pick list values */
  options?: string[]
  /** a number from min to max (step: what it goes up by, 1 when none), with its unit (plural, and one: singular);
   *  off: it may be left empty for off, zero: 0 is off */
  num?: { min: number; max: number; step?: number; unit?: string; one?: string; off?: boolean; zero?: boolean }
  /** the small heading it sits under (Tasks, Coordinators) */
  group?: string
  /** not set at this level: where its value comes from (All machines, a machine's name) */
  from?: string
  /** set at this level: the value a reset goes back to, and where that comes from (Default at All machines) */
  inherits?: { value: string; from: string }
  /** the exact line it adds to every new brief's Settings block, as it is set now (What agents are told) */
  line?: string
}

export interface SettingSection {
  name: string
  rows: SettingRow[]
  /** one line on what the section is for, above its rows */
  about?: string
  /** text shown under the rows as it is (the lines every new brief ends with) */
  note?: string
  /** the note's heading ("Every new brief ends with" when none) */
  noteTitle?: string
  /** the machine whose level it is (a machine's or one of its projects'); none: All machines */
  machine?: string
  /** the level its defaults are set at, as a place id: all (All machines), m:<machine> or p:<machine>:<project> */
  level?: string
  /** one for all machines and projects (alerts, voice): shown once, whatever level is picked */
  global?: boolean
  /** only words in agents' prompts (What agents are told), not how Shepherdr runs */
  told?: boolean
  /** the secrets kept at its level, by name (Secrets): added, replaced and removed in masked boxes */
  secrets?: { name: string; at: number }[]
}

export interface Alert {
  id: string
  from: string
  title: string
  body: string
  /** where tapping it goes; focus: the message or card (by its id, or its question's) brought into view and lit up */
  go: { place: string; task?: string; focus?: string }
  /** one alert per task (its id) or coordinator question: a newer one with the same tag takes the old one's place */
  tag?: string
  /** the card it is about: where a device shows buttons on alerts, they answer it */
  card?: { chat: string; question: string; choices: { label: string; choice: number }[] }
  /** a new message in a coordinator's chat, nothing more: it buzzes only where Notify is All */
  message?: true
  /** about a task (from its agent, or what it needs): it buzzes whatever its place's Notify, which is its coordinator's */
  task?: true
}

/** A folder on a machine, for adding a space from the sidebar (home only) */
export interface FolderEntry {
  name: string
  /** as the human writes it: ~/dev/shepherdr */
  path: string
  /** has its own .git */
  repo: boolean
  /** a space already */
  added?: boolean
}

/** What a typed path is on that machine, and the folders in it */
export interface Folders {
  path: string
  exists: boolean
  /** a folder (not a file) */
  dir: boolean
  /** the repo it is in (its top folder), if any */
  repo: string | null
  added?: boolean
  entries: FolderEntry[]
  /** more folders than listed */
  more?: boolean
  /** at home: repos it likely is, the latest worked in first */
  likely?: FolderEntry[]
}

/** Adding a space from the sidebar: an existing repo, or (create) a new one made there first; its name as given */
export interface AddSpace {
  machine: string
  path: string
  name?: string
  create?: boolean
}

/* ---------- a task's worktree, read only, for its side panel ---------- */

/** the files in a task's worktree: tracked ones and new ones git doesn't ignore */
export interface TreeFiles {
  files: string[]
  /** more files than listed */
  more?: boolean
}
