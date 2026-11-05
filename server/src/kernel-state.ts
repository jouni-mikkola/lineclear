import { loadOutbox } from './outbox.ts'
import { loadAllDone, loadGroups, loadShut, saveAllDone, saveGroups, saveShut } from './groups.ts'
import { CHAT_READ, focused, loadSidebars, PANEL, RIGHT, saveSidebars } from './sidebars.ts'
import { loadPanes, replaced, savePanes, type Pane, type Panes } from './panes.ts'
import { decide, screenOf, stepKey, urlOf, type Entry } from './nav.ts'
import type { Place, Snapshot } from '@shared/types.ts'
import {
  type State,
  keptSnap,
  keptChats,
  keptUI,
  deviceFor,
  params,
  lastPlace,
  tabOf,
  loadSide,
  loadLists,
  type UI,
  linkedAt,
  FINDS_MACHINES_IN,
  recheck,
  setRecheck,
  SIDE,
  saveLists,
  oldPin,
  setOldPin,
} from './kernel-registry.ts'

export let state: State = {
  snap: keptSnap ?? null,
  chats: keptChats ?? {},
  terms: {},
  outbox: loadOutbox(),
  update: null,
  ui: {
    device: deviceFor(innerWidth),
    place: params.get('place') ?? lastPlace() ?? 'all',
    task: params.get('task'),
    tab: tabOf(params.get('tab')),
    side: loadSide(),
    lists: loadLists(),
    settings: null,
    drawer: false,
    sidebars: loadSidebars(),
    split: loadPanes(),
    viewer: params.get('artifact') ? { artifact: params.get('artifact')! } : null,
    photo: null,
    search: false,
    adding: false,
    term: null,
    arts: null,
    sheet: params.get('task') && deviceFor(innerWidth) !== 'desktop' ? params.get('item') : null,
    taskMenu: false,
    picked: {},
    call: null,
    callStarted: 0,
    callMuted: false,
    callError: null,
    plus: null,
    menu: false,
    groups: loadGroups(),
    allDone: loadAllDone(),
    shut: loadShut(),
    archived: null,
    filter: {},
    pick: null,
    pickChat: null,
    pickAll: false,
    selecting: null,
    focus: null,
    jump: params.get('focus'),
    keyboard: false,
    kb: false,
    cur: 0,
    dict: null,
    dictStarted: 0,
    dictDone: false,
    files: {},
    reply: {},
    find: null,
    offline: null,
    ...keptUI,
  },
}
export function setState(value: typeof state): void {
  state = value
}

/** The space the app opens on: the main machine's home space, which keeps every machine's overview. */
function home(snap: Snapshot) {
  return (snap.places.find((p) => p.home && p.machine === snap.host) ?? snap.places.find((p) => p.home) ?? snap.places[0])?.id ?? ''
}

/** the space a link names: by its id, or by its machine and name ("vm-str/gtm"); a link from before spaces to All
 *  machines or a machine goes to its home space */
function placeIdOf(snap: Snapshot, s: string) {
  if (snap.places.some((p) => p.id === s)) return s
  const [machine, name] = s.split('/')
  const named = name !== undefined && snap.places.find((p) => p.machine === machine && p.name === name)
  if (named) return named.id
  if (s === 'all') return home(snap)
  const m = s.match(/^m:(.+)$/)
  return m ? `p:${m[1]}:~` : s
}
/** a step back the app asked for (a close) is on its way: the next change waits for it to land */
export let backing: ReturnType<typeof setTimeout> | null = null
export function setBacking(value: typeof backing): void {
  backing = value
}

/** the history entry on screen, as the app wrote it */
export let entry: Entry | null = null
export function setEntry(value: typeof entry): void {
  entry = value
}

/** a space's address in links: its machine and its name ("vm-str/gtm") */
export function slugOf(snap: Snapshot | null, id: string) {
  const p = snap?.places.find((x) => x.id === id)
  return p ? `${p.machine}/${p.name}` : id
}

/** write the screen into the history: a new step, or in place of the one on screen */
export function write(how: 'push' | 'replace') {
  const screen = screenOf(state.ui)
  const url = urlOf(screen, state.ui.device === 'phone', location.pathname, (id) => slugOf(state.snap, id))
  const next: Entry = { shep: 1, key: stepKey(screen), prev: how === 'push' ? (entry?.key ?? null) : (entry?.prev ?? null), screen }
  // Safari allows only so many history writes: an unchanged screen isn't written again
  if (how === 'replace' && entry && url === location.pathname + location.search && JSON.stringify(entry) === JSON.stringify(next)) return
  if (how === 'push') history.pushState(next, '', url)
  else history.replaceState(next, '', url)
  setEntry(next)
  try {
    localStorage.setItem('shepherdr.place', state.ui.place)
  } catch {
    /* private window */
  }
}

export function syncUrl(replace = false) {
  if (backing) return
  const how = replace ? 'replace' : decide(entry, screenOf(state.ui))
  if (how !== 'back') return write(how)
  history.back()
  // no step came back (none was there): the screen goes in place of this one
  setBacking(
    setTimeout(() => {
      setBacking(null)
      write('replace')
    }, 600),
  )
}
/** the place the address names is in the focused pane: checked once, with the first spaces known */
let linked = !state.ui.split.panes.length
function setLinked(value: typeof linked): void {
  linked = value
}

export function taskOf(snap: Snapshot, id: string | null) {
  return id ? (snap.tasks.find((t) => t.id === id) ?? null) : null
}

/** the place a pane belongs to: the sidebar marks it and the lists on the right show it while it has the focus */
function placeOfPane(snap: Snapshot, p: Pane): string | null {
  if (p.kind === 'place' || p.kind === 'tasks') return p.id
  if (p.kind === 'task') return taskOf(snap, p.id)?.place ?? null
  return snap.artifacts?.find((a) => a.id === p.id)?.place ?? null
}
const NONE: Pane[] = []

/** the panes the middle shows: a desktop's (none: the middle as always) */
export function panesHere(ui: UI): Pane[] {
  return ui.device === 'desktop' ? ui.split.panes : NONE
}

/** split, a place picked opens in the focused pane (or focuses the pane that has it) */
export function placeInPane(ui: UI, id: string): Partial<UI> {
  if (!panesHere(ui).length) return {}
  // the open task on the right had the focus: the first pane takes it
  const at = Math.max(0, ui.split.pane)
  return { split: replaced({ ...ui.split, pane: at }, at, { kind: 'place', id }) }
}
function linkToPane() {
  const { snap, ui } = state
  if (linked || !snap) return
  setLinked(true)
  const p = ui.split.panes[Math.max(0, ui.split.pane)]
  if (!p || placeOfPane(snap, p) === ui.place) return
  // a reload names the focused pane's own place; a link another (or the place a task pane's task left)
  const patch = placeInPane(ui, ui.place)
  if (patch.split) {
    setState({ ...state, ui: { ...ui, ...patch } })
    savePanes(state.ui.split)
  }
}

const listeners = new Set<() => void>()
export const emit = () => listeners.forEach((l) => l())

/** The screen stays on a space it lists, else goes to the main home space: a space gone. A space on a machine still
 * connecting (just after Shepherdr restarted for an update) isn't gone: the screen stays on it. */
export function stayOnShown() {
  stayOnPlace()
  linkToPane()
}

function stayOnPlace() {
  const { snap, ui } = state
  if (!snap) return
  const id = placeIdOf(snap, ui.place)
  if (id !== ui.place && (snap.places.some((p) => p.id === id) || awaited(snap, id))) {
    setState({ ...state, ui: { ...ui, place: id } })
    return syncUrl(true)
  }
  if (snap.places.some((p) => p.id === ui.place) || awaited(snap, ui.place)) {
    // renamed: its address follows its new name
    if (new URLSearchParams(location.search).get('place') !== slugOf(snap, ui.place)) syncUrl(true)
    return
  }
  setState({ ...state, ui: { ...ui, place: home(snap), task: null } })
  syncUrl(true)
}

/** A space the screen doesn't list yet but will: its machine is connecting, or not known yet just after the link came
 *  back. Shown meanwhile as connecting, under the name it has in its id. */
function awaited(snap: Snapshot, id: string): Place | undefined {
  const m = id.match(/^p:([^:]+):(.+)$/)
  if (!m) return undefined
  const label = m[1]
  const machine = snap.machines?.find((x) => x.machine === label)
  if (machine ? !machine.connecting : Date.now() - linkedAt > FINDS_MACHINES_IN) return undefined
  // not listed yet: looked at again once the server has had time to find it
  if (!machine && !recheck)
    setRecheck(
      setTimeout(() => {
        setRecheck(null)
        stayOnShown()
        emit()
      }, FINDS_MACHINES_IN),
    )
  const home = m[2] === '~'
  return {
    id,
    name: home ? 'home' : m[2],
    machine: label,
    ...(home ? { home: true } : {}),
    level: home ? 1 : 2,
    status: 'idle',
    mode: 'regular',
    chat: id,
    connecting: true,
  }
}

/** The spaces the screen lists. */
export function shownPlaces(snap: Snapshot) {
  return snap.places
}

export function placeOf(snap: Snapshot, id: string) {
  const shown = shownPlaces(snap)
  return (
    shown.find((p) => p.id === id) ?? awaited(snap, id) ?? shown.find((p) => p.id === placeIdOf(snap, id)) ?? shown.find((p) => p.id === home(snap)) ?? shown[0]
  )
}

/** the patch that puts the panes at `v`, the place following the focused one */
export function splitTo(v: Panes): Partial<UI> {
  const p = v.panes[v.pane]
  const place = p && state.snap ? placeOfPane(state.snap, p) : null
  return { split: v, ...(place && state.snap ? { place: placeOf(state.snap, place).id } : {}) }
}

/* ---------- address bar and Back (nav.ts) ---------- */

/** what of the screen makes a step in the history (nav.ts) */
const STEP_FIELDS = new Set<keyof UI>(['place', 'task', 'tab', 'sheet', 'viewer', 'settings', 'search', 'drawer', 'photo', 'adding', 'archived'])

function saveSide(side: UI['side']) {
  try {
    localStorage.setItem(SIDE, side)
  } catch {
    /* private window: Tasks again next time */
  }
}

/* ---------- server link ---------- */

export let ws: WebSocket | null = null
export function setWs(value: typeof ws): void {
  ws = value
}

/** the open task's agent, whose chat is on screen */
export function agentChat(ui: UI, snap: Snapshot) {
  return taskOf(snap, ui.task)?.agent ?? null
}

/* ---------- an open task's side panel ---------- */

/** the side panel has a column here: a desktop with a task open whose agent has started */
export function panelHere(ui: UI, snap: Snapshot) {
  return ui.device === 'desktop' && !ui.settings && !!agentChat(ui, snap)
}

/** A tool left open while resizing must still leave its task chat readable. */
export function compactPanel(ui: UI, snap: Snapshot) {
  return panelHere(ui, snap) && ui.sidebars.panelOpen && innerWidth < CHAT_READ + RIGHT.min + PANEL.min
}

/** an open task in focus: it has the whole window, its coordinator chat and places hidden (desktop and tablet) */
export function focusHere(ui: UI, snap: Snapshot | null) {
  if (ui.device === 'phone' || !snap || !taskOf(snap, ui.task) || (ui.settings && ui.device === 'desktop')) return false
  const panel = panelHere(ui, snap)
  return focused(ui.sidebars, panel) || compactPanel(ui, snap)
}

/** the chat a pane shows, if any */
export function paneChat(snap: Snapshot, p: Pane): string | null {
  if (p.kind === 'place') return placeOf(snap, p.id).chat
  if (p.kind === 'task') return taskOf(snap, p.id)?.agent?.chat ?? null
  return null
}

export const machineChip = (c: string) => c.startsWith('m:')

/** a chip for a space or machine still listed (or just connecting) */
export function known(snap: Snapshot, c: string) {
  return machineChip(c) ? (snap.machines ?? []).some((m) => m.id === c) : snap.places.some((p) => p.id === c) || !!awaited(snap, c)
}

/** the lists stay on their chips whatever place is picked: pinned, on everything or on a chip still listed */
export function listsPinned(ui: UI, snap: Snapshot) {
  return ui.lists.pinned && (!ui.lists.chips.length || ui.lists.chips.some((c) => known(snap, c)))
}

/** a wide screen with the lists pinned opens a task in the middle, over its place's chat, the pinned list staying
 *  beside it; in focus the task has the window as always */
export function taskInMiddle(ui: UI, snap: Snapshot | null) {
  // split, an open task shows on the right
  return ui.device !== 'phone' && !panesHere(ui).length && !!snap && listsPinned(ui, snap) && !!taskOf(snap, ui.task) && !focusHere(ui, snap)
}

export function visibleChats(ui: UI, snap: Snapshot): string[] {
  const place = placeOf(snap, ui.place).chat
  const ag = agentChat(ui, snap)?.chat
  // a phone shows one chat (with a task open, its place's chat waits under it as it last was, unseen)
  if (ui.device === 'phone') return [ui.task ? ag : ui.tab === 'chat' && !ui.settings ? place : null].filter(Boolean) as string[]
  // split, each pane's chat
  const panes = panesHere(ui)
  // (focus on the open task hides them)
  if (panes.length) return [...new Set([...(focusHere(ui, snap) ? [] : panes.map((p) => paneChat(snap, p))), ag])].filter(Boolean) as string[]
  // a task in the middle covers its place's chat
  return [taskInMiddle(ui, snap) ? null : place, ag].filter(Boolean) as string[]
}

/** the side panel item on screen now, if any: the open panel's tab on a desktop, the sheet on a phone or tablet */
export function shownItem(ui: UI, snap: Snapshot): string | null {
  if (!agentChat(ui, snap)) return null
  if (ui.device === 'desktop') return panelHere(ui, snap) && ui.sidebars.panelOpen ? ui.sidebars.item : null
  return ui.sheet
}

/** the task's terminal is on screen in its side panel: the server sends its screen while it is */
function panelTerm(ui: UI, snap: Snapshot) {
  return shownItem(ui, snap) === 'terminal' ? (agentChat(ui, snap)?.chat ?? null) : null
}

let pushEndpoint: string | null = null
export function setPushEndpointValue(value: string | null): void {
  pushEndpoint = value
}

export let watched = ''
export function setWatched(value: typeof watched): void {
  watched = value
}

/** Tell the server the chats (and terminals) now on screen, and whether the app is on screen at all. */
export function watchVisible() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !state.snap) return
  const keys = visibleChats(state.ui, state.snap)
  const term = state.ui.term ?? panelTerm(state.ui, state.snap)
  const visible = document.visibilityState === 'visible'
  const next = JSON.stringify({ keys, term, visible, pushEndpoint })
  if (next === watched) return
  setWatched(next)
  ws.send(JSON.stringify({ type: 'watch', chats: keys, term, visible, push: pushEndpoint }))
}

export function setUI(patch: Partial<UI> | ((ui: UI) => Partial<UI>)) {
  let p = typeof patch === 'function' ? patch(state.ui) : patch
  // another task (or none) closes the sheet and the menu the last one had open
  if (p.task !== undefined && p.task !== state.ui.task) p = { sheet: null, taskMenu: false, ...p }
  // a link to a place the screen doesn't list (All machines with a single machine) goes to the top
  if (p.place !== undefined && state.snap) p.place = placeOf(state.snap, p.place).id
  // following, another place puts back its own chips: what was edited stayed with the place it was edited at
  if (p.place !== undefined && p.place !== state.ui.place && !p.lists && !state.ui.lists.pinned && state.ui.lists.at)
    p = { ...p, lists: { pinned: false, chips: [], at: null } }
  // split, a place picked (the sidebar, search, a key) opens in the focused pane
  if (p.place !== undefined && p.split === undefined && p.place !== state.ui.place) p = { ...placeInPane(state.ui, p.place), ...p }
  // the open task on the right had the focus and closes: the first pane takes it
  else if (p.task === null && p.split === undefined && state.ui.task && state.ui.split.pane < 0 && state.ui.split.panes.length)
    p = { ...splitTo({ ...state.ui.split, pane: 0 }), ...p }
  // nothing changes: nothing redraws
  if ((Object.keys(p) as (keyof UI)[]).every((k) => Object.is(p[k], state.ui[k]))) return
  setState({ ...state, ui: { ...state.ui, ...p } })
  if ((Object.keys(p) as (keyof UI)[]).some((k) => STEP_FIELDS.has(k))) syncUrl()
  if (p.sidebars) saveSidebars(p.sidebars)
  if (p.split) savePanes(p.split)
  if (p.groups) saveGroups(p.groups)
  if (p.allDone) saveAllDone(p.allDone)
  if (p.shut) saveShut(p.shut)
  if (p.lists) saveLists(p.lists)
  if (p.side) saveSide(p.side)
  watchVisible()
  emit()
}

/** the lists pinned to a place before chips, as chips: a space's own, a home space's its machine, the main machine's
 *  home space's everything */
export function fromOldPin(snap: Snapshot) {
  if (!oldPin) return
  const p = snap.places.find((x) => x.id === oldPin)
  // its machine still connecting (or not known yet): looked at again with the next snapshot
  if (!p && awaited(snap, oldPin)) return
  setOldPin(null)
  if (p) setUI({ lists: { pinned: true, chips: p.level === 0 ? [] : p.level === 1 ? [`m:${p.machine}`] : [p.id], at: null } })
}

export function getState() {
  return state
}

export const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
