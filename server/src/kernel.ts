import { expire } from './outbox.ts'
import { hush } from './motion.ts'
import { savePanes } from './panes.ts'
import { screenOfUrl, systemSwipe, type Entry } from './nav.ts'
import { state, setState, emit, backing, setBacking, entry, setEntry, syncUrl, write, stayOnShown, placeInPane, watchVisible, setUI } from './kernel-state.ts'
import { params, tabOf, deviceFor } from './kernel-registry.ts'
import { putOutbox, startHistory, forgetJump, wake, setTyped } from './kernel-connection.ts'
import { placesDocked } from './kernel-lists.ts'
export type { UI, PanelItem, ListView } from './kernel-registry.ts'
export { registry, definePlugin, has, installPlugins } from './kernel-registry.ts'
export {
  taskOf,
  panesHere,
  shownPlaces,
  placeOf,
  agentChat,
  panelHere,
  focusHere,
  listsPinned,
  taskInMiddle,
  visibleChats,
  shownItem,
  setUI,
  getState,
} from './kernel-state.ts'
export {
  useStore,
  setOutbox,
  useUI,
  useSnap,
  getDraft,
  setDraft,
  useDraftOf,
  useDraft,
  openLink,
  act,
  connect,
  setPushEndpoint,
  holdReload,
  manyMachines,
  archivedIn,
  archiveTask,
  pinTask,
  pauseTask,
  closeTask,
  deleteTask,
  removeSpace,
  counts,
} from './kernel-connection.ts'
export type {} from './kernel-lists.ts'
export {
  shownGroups,
  toggleShut,
  toggleAllDone,
  setGroup,
  matches,
  filterOf,
  setFilter,
  filteredGroups,
  orderedTasks,
  placeKind,
  chatName,
  listView,
  chipName,
  togglePin,
  setChips,
  placesDocked,
  placesDrawn,
  openItem,
  closeSheet,
  togglePanel,
  toggleFocus,
  toggleWide,
  togglePlaces,
  goPlace,
  focusPane,
  openTask,
  goChat,
  openArtifact,
  closeArtifact,
  artifactsIn,
  splitClick,
  keysChat,
  openSplit,
  closePane,
  paneToPanel,
  onlyPane,
  sizePanes,
} from './kernel-lists.ts'

export { groupChoices, groupFor, namesFor, type GroupBy, type TaskGroup } from './groups.ts'
export type { Pane } from './panes.ts'

// split, the place is the focused pane's; a link to a place (an alert's) opens it there once the spaces are known
{
  const { split } = state.ui
  const p = split.panes[split.pane]
  if (!params.get('place') && p && (p.kind === 'place' || p.kind === 'tasks')) state.ui.place = p.id
}

// one still sending long after its time didn't go through; one that went in but never came back stops showing
setInterval(() => {
  const out = expire(state.outbox, Date.now(), (chat) => !!state.chats[chat]?.working)
  if (out === state.outbox) return
  putOutbox(out)
  emit()
}, 2000)
startHistory()
if (state.ui.jump) forgetJump()

addEventListener('popstate', (e) => {
  const st = (e as PopStateEvent).state as Entry | null
  if (backing) {
    // the step back the app asked for: the screen already shows it, and what changed meanwhile goes in now
    clearTimeout(backing)
    setBacking(null)
    setEntry(st?.shep ? st : null)
    return syncUrl()
  }
  setEntry(st?.shep ? st : null)
  // iOS's own swipe already slid the screen: it lands still
  if (systemSwipe()) hush()
  const before = state.ui
  setState({
    ...state,
    ui: {
      ...state.ui,
      ...(st?.shep ? st.screen : screenOfUrl(location.search, state.ui.device === 'desktop', tabOf)),
      menu: false,
      taskMenu: false,
      plus: null,
      pick: null,
      pickAll: false,
    },
  })
  if (!entry) write('replace')
  stayOnShown()
  // split, the place stepped back to shows in the focused pane (or focuses the pane that has it)
  if (state.ui.place !== before.place) {
    const patch = placeInPane(before, state.ui.place)
    if (patch.split) {
      setState({ ...state, ui: { ...state.ui, ...patch } })
      savePanes(state.ui.split)
    }
  }
  watchVisible()
  emit()
})

addEventListener('resize', () => {
  const d = deviceFor(innerWidth)
  if (d !== state.ui.device || (state.ui.drawer && placesDocked(state.ui, state.snap))) setUI({ device: d, drawer: false })
  else {
    // Docking and compact task focus also change within a device class. Rewatch chats brought back by widening.
    watchVisible()
    emit()
  }
})

document.addEventListener('visibilitychange', wake)
addEventListener('pageshow', (e) => (e as PageTransitionEvent).persisted && wake())
addEventListener('online', wake)

document.addEventListener('visibilitychange', () => watchVisible())

addEventListener('input', () => setTyped(Date.now()), true)
