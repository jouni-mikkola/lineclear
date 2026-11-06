/** Status marks: red needs you, green ready, green ring merging, amber working, grey idle, queued, to do or done, dashed unreachable. */
type Status = 'need' | 'ready' | 'merging' | 'work' | 'idle' | 'queued' | 'todo' | 'done' | 'off'

/** regular, always the fallback: the coordinator does what the human asks; or coordinator timer, a switch on top of it */
export type Mode = 'regular' | 'autopilot'

/** each mode, its name and what it means in a few words */
export const MODES: [Mode, string, string][] = [
  ['regular', 'Regular', 'Does what you ask'],
  ['autopilot', 'Coordinator timer', 'Works on its own'],
]

/** the longest name a space can be given, as Slack's channels */
export const NAME_MAX = 80

/** a machine's emoji as given: one emoji, its skin tone and joins kept; '' none; null anything else */
export function asEmoji(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim()
  if (!e) return ''
  const one = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(e)].length === 1
  return one && e.length <= 16 && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(e) ? e : null
}

/** a space's name as Slack's channel rules have it: lowercase letters, numbers, hyphens and underscores, no spaces.
 *  What was typed, turned into one ("My Project" → "my-project"); '' when nothing of it is left */
export function slugify(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_MAX)
    .replace(/-+$/, '')
}

/** why a space's name can't be (it breaks a rule, or another space on its machine has it), or undefined */
export function nameProblem(name: string, taken: string[] = []): string | undefined {
  if (!name) return 'Give it a name.'
  if (name.length > NAME_MAX) return `At most ${NAME_MAX} characters.`
  if (/[A-Z]/.test(name)) return 'Lowercase only.'
  if (/\s/.test(name)) return 'No spaces: use - or _.'
  if (!/^[a-z0-9_-]+$/.test(name)) return 'Only letters, numbers, - and _.'
  if (taken.includes(name)) return 'Another space on this machine has that name.'
  return undefined
}

/** A space: a folder on a machine with a name and its own coordinator, as herdr's spaces. Every machine has its home
 *  space (its home folder, ~), always first under it and never removed: its coordinator also keeps an eye on the
 *  machine, and the main machine's on every machine. Spaces are the only places with a chat. */
export interface Place {
  id: string
  /** its name, Slack-channel style ("my-project"), unique on its machine: the slug its links and commands use */
  name: string
  /** the machine it is on (its key: herdr's label for it) */
  machine: string
  /** the machine's home space */
  home?: boolean
  /** what its Tasks and Artifacts list: 2 its own; 1 its machine's (a home space); 0 every machine's (the main
   *  machine's home space, where there are more machines) */
  level: 0 | 1 | 2
  status: Status
  mode: Mode
  /** chat key of this space's coordinator */
  chat: string
  /** its machine can't be reached: when it went quiet, as shown ("14:02") */
  unreachableSince?: string
  /** its machine hasn't been reached yet since Lineclear started (an update): what it showed last, while it connects */
  connecting?: boolean
  /** does its repo have a GitHub remote */
  githubRemote?: boolean
  /** herdr on its machine isn't answering, since then ("14:02"): its agents can't hear anything */
  herdrDown?: string
}

/** A machine, as a heading over its spaces in the sidebar: no chat, nothing to open. How it is doing shows on it and in
 *  its home space. */
/** a section of the sidebar that only organizes spaces: Pinned (id 'pinned') or one the human made (s:<id>), at the top
 *  (any machine's spaces) or inside a machine (its key: only its spaces) */
export interface Section {
  id: string
  name: string
  emoji?: string
  machine?: string
  /** the spaces in it, in order */
  spaces: string[]
}

/** what Lineclear measures on a machine, as one level each: a share of what it has (CPU: its 1-minute load over its
 *  cores, so over 100 means more work than cores) */
export type HealthLevel = 'ok' | 'busy' | 'over'

export interface HealthMeter {
  /** CPU, Memory, Disk, GPU */
  name: string
  /** 0-100, or above for a CPU loaded past its cores */
  pct: number
  /** the numbers behind it, in a few words ("load 13.2 on 16 cores", "10 of 31 GB", "home 22% · /tmp 22%") */
  detail: string
  /** ok; busy: new tasks wait (start limit); over: past the alert limit, and the coordinator was told */
  level: HealthLevel
}

export interface MachineHealth {
  /** CPU, Memory, Disk, and GPU where the machine has one */
  meters: HealthMeter[]
  /** herdr answers */
  herdr: boolean
  /** tasks at work now, and how many may be (none: no limit by number) */
  working: number
  max?: number
  /** tasks Lineclear holds until there is room, and why the first one waits */
  held: number
  heldWhy?: string
  /** when it was sampled ("08:41") */
  at: string
}

export interface Machine {
  /** m:<its key>: what its spaces' order and its fold are kept under */
  id: string
  /** its key: herdr's label for it */
  machine: string
  /** the name the human reads */
  name: string
  /** the emoji the human gave it, before its name as a Slack section's (none: a server icon) */
  emoji?: string
  /** off: Lineclear can't reach it */
  status: 'idle' | 'off'
  unreachableSince?: string
  connecting?: boolean
  /** how it is doing, sampled every 30 seconds */
  health?: MachineHealth
  herdrDown?: string
}

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
export interface TaskAgent {
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
  /** its pane still shows the pasted brief */
  pasted: boolean
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
  /** the shared browser (the browser plugin), for a task not merged: whether it works on its machine, and if not why */
  browser?: { ready: boolean; hint?: string }
}

/** An automation as a project's Tasks lists it: its name, when it runs, the task it adds */
export interface Automation {
  name: string
  /** its trigger in words: "Monday to Friday at 9:00 (Stockholm)", "When a task is merged" */
  when: string
  /** the title of the task it adds */
  what: string
  /** the brief of the task it adds */
  brief?: string
  /** off: paused */
  on: boolean
  /** its trigger as kept, for agents: its time rule (an RRULE, or "once …") and its event rules ("ready, merged") */
  time?: string
  events?: string
  /** its next runs by its time rule, in words ("Tomorrow 9:00"); none while paused or without one */
  next: string[]
  /** its latest runs, newest first: when (ms), and the task it added or why it couldn't */
  runs: { at: number; task?: string; error?: string }[]
}

/** A question card: built-in choice cards, a CLI's own menus, plans. */
interface Choice {
  label: string
  description?: string
}

export interface Question {
  id: string
  title: string
  kind: 'Form' | 'Question' | 'Plan'
  /** Explicitly an ordinary question, never permission or approval. Missing means confirm. */
  ordinary?: boolean
  steps?: string[]
  /** CLI prompt context, read from its visible screen. */
  screen?: string
  terminal?: boolean
  /** A terminal checkbox prompt can be declined without enabling any of its choices. */
  reject?: string
  choices: Choice[]
  multi?: boolean
  /** an "Other" answer with free text */
  other?: boolean
  /** which choice needs a note to be sent (a plan sent back) */
  noteRequiredFor?: number
  /** no note box at all */
  noNote?: boolean
  to: string
  /** index of the choice sent, once answered; -1 answered without a pick */
  sent?: number
  /** answered without a pick: the words it was answered with (an Other answer, or the message that answered it) */
  said?: string
  /** answered without a pick, and not on the card: by a message in the chat, or in the CLI's own terminal */
  via?: 'chat' | 'terminal'
  /** who asks, when it is not the agent's own message ("Claude Code asks") */
  asks?: string
  /** answered on its other copy (a task's question and its copy in its space's chat): where, and a link to that chat */
  elsewhere?: { label: string; chat: string; name: string }
}

interface ArtifactVersion {
  n: number
  when: string
  by: string
  note?: string
  /** the version whose HTML it shows: one that only brought new data shows the HTML before it */
  html: number
  /** what it brought, when not a new page: only data, or only a title */
  what?: 'data' | 'title'
}

/** an artifact: what an agent shows beyond words, kept in its place and updated as new versions */
export interface Artifact {
  id: string
  title: string
  /** the place it lives in */
  place: string
  /** its latest version, and when that came (ms) */
  v: number
  at: number
  /** when that came, short ("2m"), and who made it ("SHE-56 agent") */
  when: string
  by: string
  /** who its Send, notes and messages go to: the agent that made the latest version, or the place's coordinator once
   *  that agent's task is over */
  keeper: string
  /** the check's picture of it, for the list */
  thumb?: boolean
  /** the chats its kept versions came from (a chat's ⋯ → Artifacts) */
  chats?: string[]
  /** newest first */
  versions: ArtifactVersion[]
}

/** an artifact as posted in a chat: the version it came with. A message of its own (words posted with it come just
 *  before it), so it takes reactions and replies like any message */
export interface ArtifactPost {
  id: string
  v: number
}

/** how a reaction or a reply names an artifact: its title and the version posted ("Weekly board · v2") */
export const artifactQuote = (title: string, v: number) => `${title} · v${v}`

export interface Reaction {
  emoji: string
  by: 'me' | 'them' | 'both'
  /** sent while the agent shows a menu or is starting: waits like a typed message */
  pending?: boolean
}

/** A reply's quote of the message it answers */
export interface ReplyQuote {
  /** none when that message is no longer in the chat (only the quote is known) */
  id?: string
  who?: 'you' | 'agent'
  /** the start of its words, a file's name, or an artifact's title and version */
  text: string
  file?: boolean
  artifact?: boolean
}

/** what a needs-you card asks, from its task's chat: its question cards, or the agent's plain question */
export interface CardAsk {
  /** the task's chat, where the answer goes */
  chat: string
  /** its question cards, as asked; on screen each as it stands in the task's chat */
  questions?: Question[]
  /** a plain question with no choices: the agent's words, answered with a reply */
  reply?: { id: string; text: string }
  /** once answered: where (in this card, in the task's chat or its terminal) and the words, if known */
  answered?: { where: 'space' | 'task' | 'terminal'; text?: string }
  /** on screen: it still waits, so it takes an answer here */
  open?: boolean
}

/** One small update card Lineclear posts in a project's coordinator chat. */
export interface UpdateCard {
  id: string
  /** the task it is about; none on a mode card */
  task?: string
  /** the task's state when posted */
  status?: TaskStatus
  /** a mode card: the place's coordinator went on this mode (text: "on · works on its own"); an older one may say Manual */
  mode?: Mode
  /** a few words on one line ("is merged"); a task's summary is in the task, never on its card */
  text: string
  /** the task's pull request, linked from the card */
  pr?: { number: number; url: string }
  /** a machine health card: what crossed its limit (or came back under it); text says it in words */
  health?: { level: HealthLevel; machine: string }
  /** the project's base branch went red on GitHub ("main"); text says which checks failed */
  red?: string
  /** its agent started again (text: "Restarted on Codex (Model Code 6, high)") */
  restart?: boolean
  /** a task that needs you: a copy of what it asks, answered here as in its own chat */
  ask?: CardAsk
}
