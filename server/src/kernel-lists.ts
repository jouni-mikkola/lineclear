import { groupFor, namesFor, shownGroup, type GroupBy, type TaskGroup } from './groups.ts'
import { canDock, fit as fitSidebars, showPanel, toggleFocus as focusTo } from './sidebars.ts'
import { closed, MAX_PANES, normal, only, opened, PANE_MIN, samePane, type Pane } from './panes.ts'
import { machineName, type Place, type Snapshot, type Task } from '@shared/types.ts'
import type { ListView, UI, Lists } from './kernel-registry.ts'
import {
  state,
  setUI,
  known,
  placeOf,
  machineChip,
  listsPinned,
  panelHere,
  focusHere,
  compactPanel,
  placeInPane,
  splitTo,
  taskOf,
  panesHere,
  paneChat,
  agentChat,
  taskInMiddle,
} from './kernel-state.ts'
import { taskGroups, archivedIn, manyMachines, inList, ladder } from './kernel-connection.ts'

/** a list's task groups as this screen shows them: grouped as this device chose, Done cut short until Show all, a
 *  group folded shut (or under a machine folded shut) showing none of its tasks */
export function shownGroups(snap: Snapshot, list: ListView, ui: Pick<UI, 'groups' | 'allDone' | 'shut'> = state.ui) {
  const shut = (key: string) => ui.shut.includes(`${list.key}|${key}`)
  return taskGroups(snap, list, groupFor(ui.groups, list.level)).map((g) =>
    shownGroup(g, ui.allDone.includes(`${list.key}|${g.key}`), shut(g.key) || (!!g.machine && shut(`m:${g.machine.id}`))),
  )
}

/** fold a heading of a list's tasks shut or open ("group", "m:machine"); with siblings, them too, the same way */
export function toggleShut(listKey: string, key: string, siblings: string[] = []) {
  setUI((ui) => {
    const k = (x: string) => `${listKey}|${x}`
    const open = ui.shut.includes(k(key))
    const keys = [key, ...siblings].map(k)
    return { shut: open ? ui.shut.filter((x) => !keys.includes(x)) : [...ui.shut.filter((x) => !keys.includes(x)), ...keys], cur: 0 }
  })
}

/** Show all of a group's Done tasks, or (shown) back to the latest few */
export function toggleAllDone(listKey: string, key: string) {
  const k = `${listKey}|${key}`
  setUI((ui) => ({ allDone: ui.allDone.includes(k) ? ui.allDone.filter((x) => x !== k) : [...ui.allDone, k] }))
}

/** The chips the lists show: pinned, theirs; following, the place picked's own, or what was made of them there. Pinned
 *  chips all gone, they follow again. */
function listChips(ui: UI, snap: Snapshot): string[] {
  const l = ui.lists
  if (l.pinned || l.at === ui.place) {
    const chips = l.chips.filter((c) => known(snap, c))
    if (chips.length || !l.chips.length) return chips
  }
  const p = placeOf(snap, ui.place)
  return p.home && p.machine === snap.host ? [] : p.home ? [`m:${p.machine}`] : [p.id]
}

/** how lists of this level group their tasks (a place's level: 0 more machines', 1 one machine's) */
export function setGroup(level: number, by: GroupBy) {
  setUI((ui) => ({
    groups: { ...ui.groups, [level === 0 ? 'all' : 'machine']: by },
    lists: { ...ui.lists, chips: state.snap ? listChips(ui, state.snap) : [], at: ui.place },
    cur: 0,
  }))
}

/** whether every word typed is in one of these, any case: ⌘K's search and the lists' filters */
export function matches(q: string, ...fields: (string | number | undefined)[]) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const all = fields
    .filter((f) => f !== undefined && f !== '')
    .join(' ')
    .toLowerCase()
  return words.every((w) => all.includes(w))
}

/** a task by its id, title, status line or summary, and its pull request's number */
const taskMatches = (t: Task, q: string) => matches(q, t.id, t.name, t.report?.msg, t.sub, t.pr && `#${t.pr.number}`)

/** what a list is filtered by ('' while it isn't), by where its words are kept (a ListView's search) */
export const filterOf = (ui: UI, listKey: string, list: 'tasks' | 'artifacts') => ui.filter[`${listKey}|${list}`]?.trim() ?? ''

export function setFilter(listKey: string, list: 'tasks' | 'artifacts', q: string) {
  setUI((ui) => ({ filter: { ...ui.filter, [`${listKey}|${list}`]: q }, cur: 0 }))
}

/** A list's tasks filtered: in their groups, every Done one, and then its archived ones; groups with none left out */
export function filteredGroups(snap: Snapshot, list: ListView, q: string, ui: Pick<UI, 'groups'> = state.ui) {
  const groups: TaskGroup[] = taskGroups(snap, { ...list, attention: false }, groupFor(ui.groups, list.level))
  const archived = archivedIn(snap, list)
  if (archived.length) groups.push({ key: 'archived', label: 'Archived', tasks: archived, names: namesFor(list.level) })
  return groups.map((g) => ({ ...g, tasks: g.tasks.filter((t) => taskMatches(t, q)) })).filter((g) => g.tasks.length)
}

/** a list's tasks in the order they show, as the keyboard walks them: only the ones on screen */
export function orderedTasks(snap: Snapshot, list: ListView) {
  if (state.ui.archived === list.key) return archivedIn(snap, list)
  const q = filterOf(state.ui, list.search, 'tasks')
  if (q) return filteredGroups(snap, list, q).flatMap((g) => g.tasks)
  return shownGroups(snap, list).flatMap((g) => g.tasks)
}

/** what a space is, under its name in its header: a home space keeps its machine (the main machine's every machine) */
export function placeKind(snap: Snapshot, p: Place) {
  const on = machineName(snap.machines, p.machine)
  if (p.home) return !manyMachines(snap) ? 'Home space' : p.level === 0 ? 'Home · every machine' : `Home · ${on}`
  return manyMachines(snap) ? `Space on ${on}` : 'Space'
}

/** "GTM-15 agent", "gtm" */
export function chatName(snap: Snapshot, key: string) {
  if (key.includes('/')) {
    const [id, role] = key.split('/')
    return `${id} ${role.toLowerCase()}`
  }
  // a coordinator keeps its own name, even one the screen doesn't list (All machines with a single machine)
  return (snap.places.find((p) => p.chat === key) ?? placeOf(snap, key)).name
}

function listOf(snap: Snapshot, chips: string[]): Omit<ListView, 'search'> {
  const machines = new Set(snap.places.filter((p) => inList(snap, chips, p.id)).map((p) => p.machine))
  const level = machines.size > 1 || (!chips.length && manyMachines(snap)) ? 0 : chips.length === 1 && !machineChip(chips[0]) ? 2 : 1
  return { key: chips.length ? [...chips].sort().join('+') : '*', chips, level }
}

let lastList: { snap: Snapshot; lists: Lists; place: string; view: ListView } | null = null
function setLastList(value: typeof lastList): void {
  lastList = value
}

/** the lists as they show now: the same object while nothing they hang on changes, so a part can pick it */
export function listView(ui: UI, snap: Snapshot): ListView {
  if (lastList && lastList.snap === snap && lastList.lists === ui.lists && lastList.place === ui.place) return lastList.view
  const view = {
    ...listOf(snap, listChips(ui, snap)),
    search: listsPinned(ui, snap) ? '*pinned' : ui.place,
    attention: !!placeOf(snap, ui.place).home && placeOf(snap, ui.place).machine === snap.host && !listsPinned(ui, snap) && ui.lists.at !== ui.place,
  }
  setLastList({ snap, lists: ui.lists, place: ui.place, view })
  return view
}

/** a chip's words: a space's "# gtm" (with its machine where there are more: "# gtm · vm-str"), a machine's name */
export function chipName(snap: Snapshot, c: string) {
  if (machineChip(c)) return machineName(snap.machines, c.slice(2))
  return ladder(snap, c)
}

/** pin the lists to the chips they show, or let them follow the picked place again; what their filters say goes with
 *  them */
export function togglePin() {
  setUI((ui) => {
    const pinned = !!state.snap && listsPinned(ui, state.snap)
    const [from, to] = pinned ? ['*pinned', ui.place] : [ui.place, '*pinned']
    const filter = { ...ui.filter }
    for (const l of ['tasks', 'artifacts']) filter[`${to}|${l}`] = ui.filter[`${from}|${l}`] ?? ''
    return {
      lists: pinned ? { pinned: false, chips: [], at: null } : { pinned: true, chips: state.snap ? listChips(ui, state.snap) : [], at: ui.place },
      filter,
      cur: 0,
    }
  })
}

/** the lists' chips changed: pinned, they stay; following, until another place is picked */
export function setChips(chips: string[]) {
  setUI((ui) => ({ lists: { ...ui.lists, chips: [...new Set(chips)], at: ui.place }, cur: 0, archived: null }))
}

/** Places can dock independently of the device label, using the actual requested column widths. */
export function placesDocked(ui: UI, snap: Snapshot | null, width = innerWidth) {
  return ui.device === 'desktop' && canDock(ui.sidebars, width, !!snap && panelHere(ui, snap))
}

/** Focus and the user's toggle hide docked places; insufficient room makes them a drawer instead. */
export function placesDrawn(ui: UI, snap: Snapshot | null, width = innerWidth) {
  return ui.sidebars.open && !focusHere(ui, snap) && placesDocked(ui, snap, width)
}

/** open an item: the panel's tab on a desktop, a full-screen sheet on a phone or tablet */
export function openItem(id: string) {
  setUI((ui) =>
    ui.device === 'desktop'
      ? { sidebars: { ...showPanel(ui.sidebars, true, innerWidth), item: id }, taskMenu: false }
      : { sheet: id, taskMenu: false, plus: null, pick: null },
  )
}

/** close the sheet (its step in the history goes too) */
export function closeSheet() {
  setUI({ sheet: null })
}

/** show or hide the side panel (desktop) */
export function togglePanel() {
  setUI((ui) => ({ sidebars: showPanel(ui.sidebars, !ui.sidebars.panelOpen, innerWidth) }))
}

/** focus on an open task, or back out of it: its coordinator chat shows again (desktop and tablet) */
export function toggleFocus() {
  setUI((ui) => {
    // Showing the coordinator on a narrow window needs the tool's room. Closing it also ends automatic focus.
    if (state.snap && compactPanel(ui, state.snap))
      return { sidebars: showPanel({ ...ui.sidebars, focus: false, focusAuto: false, wide: false }, false, innerWidth) }
    return { sidebars: focusTo(ui.sidebars, !!state.snap && panelHere(ui, state.snap)) }
  })
}

/** the side panel widened to most of the window, or back to its width; widening a hidden panel opens it (desktop) */
export function toggleWide() {
  setUI((ui) => ({ sidebars: ui.sidebars.panelOpen && ui.sidebars.wide ? { ...ui.sidebars, wide: false } : { ...ui.sidebars, panelOpen: true, wide: true } }))
}

/** show or hide places beside the chat (desktop); shown on a window with no room beside an open panel, the panel shuts.
 *  In focus, it shows them and the coordinator chat again. */
export function togglePlaces() {
  setUI((ui) => {
    if (!placesDocked(ui, state.snap)) return { drawer: !ui.drawer }
    if (focusHere(ui, state.snap)) {
      const out = { ...ui, sidebars: { ...focusTo(ui.sidebars, true), open: true } }
      return { sidebars: placesDrawn(out, state.snap) ? out.sidebars : { ...out.sidebars, panelOpen: false } }
    }
    if (placesDrawn(ui, state.snap)) return { sidebars: { ...ui.sidebars, open: false } }
    const opened = { ...ui.sidebars, open: true }
    return { sidebars: placesDrawn({ ...ui, sidebars: opened }, state.snap) ? opened : { ...opened, panelOpen: false } }
  })
}

export function goPlace(id: string) {
  setUI((ui) => ({
    ...placeInPane(ui, id),
    place: id,
    task: null,
    drawer: false,
    settings: null,
    tab: 'chat',
    pick: null,
    menu: false,
    cur: 0,
    archived: null,
  }))
}

/** a click or the keys went into pane `i` (-1: the open task on the right) */
export function focusPane(i: number) {
  setUI((ui) => (ui.split.pane === i ? {} : splitTo({ ...ui.split, pane: i })))
}

/** a task opens straight into its agent's chat */
export function openTask(id: string) {
  const snap = state.snap
  const t = snap && taskOf(snap, id)
  // split, one open in a pane already gets the focus there
  const at = panesHere(state.ui).findIndex(samePane({ kind: 'task', id }))
  if (at >= 0) return focusPane(at)
  // the tab it was opened from stays: Back goes to it, as on iOS
  // one from the lists beside it stays over this place's chat; another goes to its own place. Split, the panes stay
  // as they are (the place is the focused pane's) and the task takes the keys
  setUI((ui) => ({
    ...(panesHere(ui).length ? { split: { ...ui.split, pane: -1 } } : {}),
    task: id,
    pick: null,
    cur: 0,
    drawer: false,
    place: t && !panesHere(ui).length && t.place !== ui.place && !inList(snap!, listChips(ui, snap!), t.place) ? t.place : ui.place,
  }))
}

export function goChat(key: string) {
  if (key.includes('/')) openTask(key.split('/')[0])
  else setUI({ place: key, task: null, tab: 'chat', drawer: false })
}

/** an artifact full screen, at its latest (following its updates) or at a version */
export function openArtifact(id: string, v?: number) {
  setUI({ viewer: { artifact: id, v }, pick: null, plus: null, menu: false })
}

/** close it (its step in the history goes too, so Back and the close button agree) */
export function closeArtifact() {
  setUI({ viewer: null })
}

/** a list's artifacts, newest first */
export function artifactsIn(snap: Snapshot, list: Pick<ListView, 'chips'>) {
  return (snap.artifacts ?? []).filter((a) => inList(snap, list.chips, a.place))
}

/** a ⌘-click (Ctrl-click off a Mac) opens in split view, as a browser opens a new tab (desktop) */
export const splitClick = (e: { metaKey: boolean; ctrlKey: boolean }) => state.ui.device === 'desktop' && (e.metaKey || e.ctrlKey)

/** the chat the keys work on (/, T, A, E): the focused pane's, else the open task's, else the place's */
export function keysChat(ui: UI, snap: Snapshot): string {
  const p = panesHere(ui)[ui.split.pane]
  return (p && paneChat(snap, p)) ?? agentChat(ui, snap)?.chat ?? placeOf(snap, ui.place).chat
}

/** how many panes the middle has room for, beside places, the lists and an open task's panel */
function roomFor(ui: UI, snap: Snapshot, width = innerWidth) {
  const panel = panelHere(ui, snap)
  const w = fitSidebars({ ...ui.sidebars, open: placesDrawn(ui, snap, width) }, width, true, panel)
  return Math.max(1, Math.min(MAX_PANES, Math.floor((width - w.left - w.right - w.panel) / PANE_MIN)))
}

/** open in split view (desktop): beside the focused pane, or beside the middle as it shows now */
export function openSplit(p: Pane) {
  setUI((ui) => {
    const snap = state.snap
    if (ui.device !== 'desktop' || !snap) return {}
    // what the middle shows now is the first pane
    const start: Pane = taskInMiddle(ui, snap) ? { kind: 'task', id: ui.task! } : { kind: 'place', id: placeOf(snap, ui.place).id }
    const v = normal(opened(ui.split, start, p, roomFor(ui, snap)))
    // a task leaves the right for its pane (or the middle it was in)
    const task = v.panes.some((x) => x.kind === 'task' && x.id === ui.task) || start.kind === 'task' ? { task: null } : {}
    // no room for two: a place opens as the middle always shows it
    const place = !v.panes.length && p.kind === 'place' ? { place: p.id } : {}
    return { ...splitTo(v), ...place, ...task, viewer: p.kind === 'artifact' ? null : ui.viewer, menu: false, taskMenu: false }
  })
}

function closing(ui: UI, i: number): Partial<UI> {
  const v = closed(ui.split, i)
  // the last place left takes the middle as always
  const last = !v.panes.length && ui.split.panes.length === 2 ? ui.split.panes[1 - i] : null
  return { ...splitTo(v), ...(last?.kind === 'place' ? { place: last.id } : {}) }
}

export function closePane(i: number) {
  setUI((ui) => closing(ui, i))
}

/** a task's pane gives way to the task opened on the right, with its side panel at `item` (its Terminal, Files, …) */
export function paneToPanel(i: number, item: string) {
  setUI((ui) => {
    const p = ui.split.panes[i]
    if (p?.kind !== 'task') return {}
    const out = closing(ui, i)
    // the task on the right has the focus now
    return {
      ...out,
      split: out.split?.panes.length ? { ...out.split, pane: -1 } : out.split,
      task: p.id,
      sidebars: { ...showPanel(ui.sidebars, true, innerWidth), item },
      taskMenu: false,
    }
  })
}

/** pane `i` the only one: a place's chat is the middle as always then */
export function onlyPane(i: number) {
  setUI((ui) => {
    const p = ui.split.panes[i]
    return { ...splitTo(only(ui.split, i)), ...(p?.kind === 'place' ? { place: p.id } : {}) }
  })
}

export function sizePanes(sizes: number[]) {
  setUI((ui) => ({ split: { ...ui.split, sizes } }))
}
