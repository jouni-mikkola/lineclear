import type { FC } from 'react'
import type { Outgoing } from './outbox.ts'
import type { Kept } from './reload.ts'
import type { Groups } from './groups.ts'
import { CHAT_READ, RIGHT, type Sidebars } from './sidebars.ts'
import type { Panes } from './panes.ts'
import { setupGuarded } from './guard.tsx'
import type { Chat, Message, Place, ReplyQuote, Snapshot, Task, TermScreen, UpdateStatus } from '@shared/types.ts'

/* ---------- what's on screen ---------- */

export type Device = 'phone' | 'tablet' | 'desktop'

/** What the Tasks and Artifacts lists show: their chips, spaces ("p:…") and whole machines ("m:…") a task or artifact
 *  may be in (none: everything). Following, the place picked's own, or what was made of them while at it (at); pinned,
 *  they stay whatever place is picked. */
export interface Lists {
  pinned: boolean
  chips: string[]
  at: string | null
}

export interface UI {
  device: Device
  place: string
  /** the open task: its agent's chat */
  task: string | null
  /** phone: Chat, Tasks or Artifacts */
  tab: 'chat' | 'tasks' | 'artifacts'
  /** a wide screen's right-hand column: the place's Tasks or its Artifacts, remembered on this device */
  side: 'tasks' | 'artifacts'
  /** what the Tasks and Artifacts lists show (their chips) and whether it stays whatever place is picked, remembered
   *  on this device */
  lists: Lists
  /** the section shown (null: a phone's list of them), and the level of defaults it edits (a place id: all, m:…, p:…;
   *  none: the place it was opened from) */
  settings: { section: number | null; level?: string } | null
  drawer: boolean
  /** the wide screen's sidebar widths, and whether places shows (sidebars.ts) */
  sidebars: Sidebars
  /** split view: the panes side by side in the middle, the focused one and their widths (desktop; panes.ts),
   *  remembered on this device */
  split: Panes
  /** an artifact open full screen: at a version you picked, or (none) its latest, following its updates */
  viewer: { artifact: string; v?: number } | null
  /** an attached picture opened full screen: a sent one by its message, one still in the message box by its file */
  photo: { chat: string; msg?: string; file?: { name: string; path: string } } | null
  search: boolean
  /** initial scope for unified search; global entrances leave it empty */
  searchScope?: { kind: 'all' } | { kind: 'chat' | 'space' | 'machine'; id: string }
  /** the Add a project dialog is open: true, or the name of the machine whose + opened it */
  adding: boolean | string
  /** chat key flipped to its terminal (a coordinator's; a task's terminal is an item of its side panel) */
  term: string | null
  /** chat key flipped to the list of its artifacts (a coordinator's; a task's is an item of its side panel) */
  arts: string | null
  /** phone and tablet: the side panel item open over the task's chat, as a full-screen sheet */
  sheet: string | null
  /** the task header's ⋯ menu is open (phone and tablet) */
  taskMenu: boolean
  /** what each side panel item has picked, by "task|item" (the file shown) */
  picked: Record<string, string>
  /** chat key on a voice call */
  call: string | null
  callStarted: number
  callMuted: boolean
  /** why the last voice call stopped, until dismissed */
  callError: string | null
  plus: string | null
  /** the coordinator chat's top-right menu is open */
  menu: boolean
  /** how All machines and a machine group their tasks, remembered on this device */
  groups: Groups
  /** task groups showing all their Done tasks ("place|group"), remembered on this device */
  allDone: string[]
  /** task headings folded shut, each view its own ("place|group", "place|m:machine"), remembered on this device */
  shut: string[]
  /** the lists (by their key) whose tasks column shows their Archived tasks instead */
  archived: string | null
  /** what each list is filtered by, while typed: "place|tasks", "place|artifacts" (*pinned for the pinned chips) */
  filter: Record<string, string>
  /** message id with the reaction bar open */
  pick: string | null
  /** the chat of that message (two chats on screen may share message ids) */
  pickChat: string | null
  /** the full emoji picker is open for it */
  pickAll: boolean
  /** message id whose text a touch can select (holding it reacts otherwise) */
  selecting: string | null
  /** chat key whose box has keyboard focus */
  focus: string | null
  /** an alert's link: the message or card (its id, or its question's) to bring into view and light up once its chat
   *  shows it */
  jump: string | null
  /** the on-screen keyboard is up */
  keyboard: boolean
  /** keyboard cursor in lists */
  kb: boolean
  cur: number
  /** chat key listening for talk-to-type */
  dict: string | null
  dictStarted: number
  /** Done was pressed: the last words are still coming in */
  dictDone: boolean
  files: Record<string, { name: string; path?: string }[]>
  /** search in a chat: its words, and the match shown (by message id; none: the newest) */
  find: { chat: string; q: string; id: string | null } | null
  /** the message each chat's box replies to, with its quote */
  reply: Record<string, ReplyQuote & { id: string }>
  offline: number | null
}

/* ---------- slots ---------- */

interface KeyContext {
  e: KeyboardEvent
  ui: UI
  snap: Snapshot
}

interface Views {
  /** the list of places in the sidebar and drawer (places) */
  places: FC
  /** a coordinator's or agent's chat: messages and composer (chat) */
  chat: FC<{ chatKey: string; placeholder: string; unreachable?: string }>
  /** the lists' tasks, grouped: what their chips hold (listView); placeId is the place picked (tasks) */
  tasks: FC<{ placeId: string }>
  /** the lists' artifacts, newest first: what their chips hold (listView); placeId is the place picked (artifacts) */
  artifacts: FC<{ placeId: string }>
  /** the Tasks header's ⋯: how its tasks are grouped, by listView's level; place is the place picked (tasks) */
  tasksMenu: FC<{ place: Place }>
  /** buttons in the sidebar's header beside the app's name: New section (places) */
  placesMenu: FC
  /** the settings page */
  settings: FC
  /** ⌘K: search and jump (keyboard) */
  search: FC<{ onClose: () => void }>
  /** an artifact at its latest, filling the box it is in: a split view's pane (artifacts) */
  artifact: FC<{ artifactId: string }>
}

/**
 * An item of an open task's side panel (Terminal, Files, Diff, Pull request; Browser): a tab in the panel on a
 * desktop, a row of the task header's ⋯ menu opening it as a full-screen sheet on a phone or tablet.
 */
export interface PanelItem {
  id: string
  order: number
  label: string
  Icon: FC<{ className?: string }>
  /** a hook: why it has nothing to show for this task (greyed out with that hint), or null */
  useOff?: (task: Task) => string | null
  View: FC<{ task: Task; chatKey: string }>
}

/* ---------- what the Tasks and Artifacts lists show: their chips ---------- */

/** A list as it shows now: its chips, and what is kept under its key */
export interface ListView {
  /** its folds, Show alls, filters and Archived are kept under it: a space's id, else its chips joined (*: all) */
  key: string
  /** its filter's words are kept under it: the place picked's, or the pinned chips' (*pinned), so editing the chips
   *  keeps them */
  search: string
  chips: string[]
  /** what its rows needn't say, as a place's level: 2 one space's, 1 one machine's, 0 more machines' */
  level: 0 | 1 | 2
  /** Global Home’s default, before an explicit scope or search. */
  attention?: boolean
}

export interface Registry {
  views: Partial<Views>
  /** parts drawn under a message's bubble (the reaction picker, artifacts, question cards) */
  messageParts: { order: number; View: FC<{ msg: Message; chat: Chat; from: string }> }[]
  /** marks sitting on a message bubble's bottom edge (reactions) */
  messageEdge: { order: number; View: FC<{ msg: Message; chat: Chat }> }[]
  /** rows drawn after a chat's messages (waiting lines, question cards from the CLI) */
  chatTail: { order: number; View: FC<{ chat: Chat; from: string }> }[]
  /** buttons at the right of a coordinator chat's header, before its menu (health) */
  placeHeader: { order: number; View: FC<{ place: Place }> }[]
  /** a coordinator's mark (its mode): after the header's buttons, before its menu; on a phone, whose header has no
   *  room for its word, at the end of the subtitle line */
  placeMark: { order: number; View: FC<{ place: Place }> }[]
  /** sections of the menu at the top right of a coordinator chat (mode, search, terminal); `joined` goes on the section
   *  before it, with no line between (artifacts, under terminal) */
  placeMenu: { order: number; joined?: boolean; View: FC<{ place: Place }> }[]
  /** buttons at the right of an agent chat's header */
  agentHeader: { order: number; View: FC<{ chatKey: string }> }[]
  /** rows at the top of a task chat's ⋯ menu, before its panel items (search) */
  agentMenu: { order: number; View: FC<{ chatKey: string }> }[]
  /** the items of an open task's side panel */
  taskPanel: PanelItem[]
  /** replaces a chat's body (the terminal) */
  chatBody: { when: (ui: UI, chatKey: string) => boolean; View: FC<{ chatKey: string }> }[]
  /** takes over the composer box while it is on: a voice call, talk to type */
  composerLive: { when: (ui: UI, chatKey: string) => boolean; View: FC<{ chatKey: string }> }[]
  /** above the composer box (+ menu, attachments) */
  composerAbove: { order: number; View: FC<{ chatKey: string; cli: string }> }[]
  /** the right-hand composer button while the box is empty (voice call) */
  composerIdle: FC<{ chatKey: string }> | null
  /** settings at the top of the + menu's agent section, before the CLI's own (a coordinator's mode); `when` says if one shows */
  composerSettings: { order: number; when: (snap: Snapshot, chatKey: string) => boolean; View: FC<{ chatKey: string }> }[]
  /** the + menu */
  composerPlus: FC<{ chatKey: string; cli: string }> | null
  /** the mic */
  composerMic: FC<{ chatKey: string }> | null
  /** whole-screen layers: viewer */
  overlays: FC[]
  /** a line under the top of the screen (voice call elsewhere, offline) */
  topBars: FC[]
  /** under the task list: place is its one space, else the place picked; list, what it shows (listView) */
  tasksFooter: FC<{ place: Place; list?: ListView }>[]
  /** keyboard: return true when handled */
  keys: { order: number; handle: (k: KeyContext) => boolean }[]
  /** a settings row a plugin acts on itself (alerts: turn them on for this device); returns what to say */
  settingActions: Record<string, () => Promise<string>>
  /** pages a plugin adds to Settings' This device group, after Appearance (the keyboard shortcuts); `when` says if one shows */
  settingsPages: { name: string; about?: string; Icon: FC<{ className?: string }>; when: (ui: UI) => boolean; View: FC<{ phone: boolean }> }[]
}

export const registry: Registry = {
  views: {},
  messageParts: [],
  messageEdge: [],
  chatTail: [],
  placeHeader: [],
  placeMark: [],
  placeMenu: [],
  agentHeader: [],
  agentMenu: [],
  taskPanel: [],
  chatBody: [],
  composerLive: [],
  composerAbove: [],
  composerSettings: [],
  composerIdle: null,
  composerPlus: null,
  composerMic: null,
  overlays: [],
  topBars: [],
  tasksFooter: [],
  keys: [],
  settingActions: {},
  settingsPages: [],
}

export interface ClientPlugin {
  name: string
  setup(reg: Registry): void
}

export const definePlugin = (p: ClientPlugin) => p

let enabledNames: string[] = []
function setEnabledNames(value: typeof enabledNames): void {
  enabledNames = value
}

export const has = (name: string) => enabledNames.includes(name)

/** set up each plugin on the slots; `user`: the human's own, guarded so one that throws stops only itself (guard.tsx) */
export function installPlugins(plugins: ClientPlugin[], enabled: string[], user: string[] = []) {
  setEnabledNames(enabled)
  for (const p of plugins) {
    if (user.includes(p.name)) setupGuarded(p.name, registry, (r) => p.setup(r))
    else p.setup(registry)
  }
  const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order
  registry.messageParts.sort(byOrder)
  registry.messageEdge.sort(byOrder)
  registry.chatTail.sort(byOrder)
  registry.placeHeader.sort(byOrder)
  registry.placeMark.sort(byOrder)
  registry.placeMenu.sort(byOrder)
  registry.agentHeader.sort(byOrder)
  registry.agentMenu.sort(byOrder)
  registry.taskPanel.sort(byOrder)
  registry.composerAbove.sort(byOrder)
  registry.composerSettings.sort(byOrder)
  registry.keys.sort(byOrder)
}

/* ---------- store ---------- */

export interface State {
  snap: Snapshot | null
  chats: Record<string, Chat>
  terms: Record<string, TermScreen>
  /** what you sent that the chats don't show yet: it shows at once, and survives a reload */
  outbox: Outgoing[]
  /** how Shepherdr's last update of itself went */
  update: UpdateStatus | null
  ui: UI
}

export function tabOf(t: string | null): UI['tab'] {
  return t === 'tasks' || t === 'artifacts' ? t : 'chat'
}

export function deviceFor(w: number): Device {
  return w < CHAT_READ + RIGHT.min ? 'phone' : w < 1024 ? 'tablet' : 'desktop'
}

const LISTS = 'shepherdr.lists'
// before: the lists pinned to one place, its id; a home space's meant its machine's, the main machine's everything
const PIN = 'shepherdr.pin'
/** a place the lists were pinned to before chips, until the first snapshot says what it showed */
export let oldPin: string | null = null
export function setOldPin(value: typeof oldPin): void {
  oldPin = value
}

export function loadLists(): Lists {
  const follow: Lists = { pinned: false, chips: [], at: null }
  try {
    const v = JSON.parse(localStorage.getItem(LISTS) ?? 'null') as Partial<Lists> | null
    if (v)
      return {
        pinned: v.pinned === true,
        chips: Array.isArray(v.chips) ? v.chips.filter((c): c is string => typeof c === 'string') : [],
        at: typeof v.at === 'string' ? v.at : null,
      }
    setOldPin(localStorage.getItem(PIN))
    return follow
  } catch {
    return follow
  }
}

export function saveLists(l: Lists) {
  try {
    localStorage.setItem(LISTS, JSON.stringify(l))
    localStorage.removeItem(PIN)
  } catch {
    /* private window: following again next time */
  }
}

/** when the link to the server last came back: a restarted server may not know its other machines for a moment */
export let linkedAt = 0
export function setLinkedAt(value: typeof linkedAt): void {
  linkedAt = value
}

/** a server finds its other machines within this long of starting */
export const FINDS_MACHINES_IN = 30_000
export let recheck: ReturnType<typeof setTimeout> | null = null
export function setRecheck(value: typeof recheck): void {
  recheck = value
}

function kept(): Kept {
  try {
    const k = sessionStorage.getItem('shepherdr.kept')
    sessionStorage.removeItem('shepherdr.kept')
    return k ? (JSON.parse(k) as Kept) : {}
  } catch {
    return {}
  }
}
// a reload for a new build draws at once what it showed: the last snapshot and the chats on screen, until the server's
export const { text: keptText, snap: keptSnap, chats: keptChats, ...keptUI } = kept()

export const params = new URLSearchParams(location.search)

export function lastPlace(): string | null {
  try {
    return localStorage.getItem('shepherdr.place')
  } catch {
    return null
  }
}

export const SIDE = 'shepherdr.side'

export function loadSide(): UI['side'] {
  try {
    return localStorage.getItem(SIDE) === 'artifacts' ? 'artifacts' : 'tasks'
  } catch {
    return 'tasks'
  }
}
