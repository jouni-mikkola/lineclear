import { actionable, attentionCounts } from './attention.ts'
import { useSyncExternalStore } from 'react'
import { buildId } from '@shared/build.ts'
import { prune, saveOutbox, settle, type Outgoing } from './outbox.ts'
import { keptOf, mayReload } from './reload.ts'
import { OPEN_WITHIN, PONG_WITHIN, retryIn, SAY_LOST_AFTER } from './link.ts'
import { groupTasks, type GroupBy, type TaskGroup } from './groups.ts'
import { screenOf, stepKey, stepsTo, urlOf, type Entry } from './nav.ts'
import { machineName, type Action, type ServerEvent, type Snapshot, type Task } from '@shared/types.ts'
import { type State, type UI, keptText, setLinkedAt, type ListView } from './kernel-registry.ts'
import {
  subscribe,
  state,
  setState,
  emit,
  entry,
  setEntry,
  write,
  slugOf,
  syncUrl,
  setUI,
  ws,
  setWs,
  visibleChats,
  setWatched,
  watchVisible,
  stayOnShown,
  fromOldPin,
  placeOf,
  setPushEndpointValue,
} from './kernel-state.ts'

/** Pick only what a part shows: it redraws when that changes, not on every change to the store. */
export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => pick(state))
}

export function putOutbox(out: Outgoing[]) {
  if (out === state.outbox) return
  setState({ ...state, outbox: out })
  saveOutbox(out)
}

/** change what waits to show in the chats; what a chat already shows goes at once */
export function setOutbox(fn: (out: Outgoing[]) => Outgoing[]) {
  let out = fn(state.outbox)
  for (const key of new Set(out.map((o) => o.chat))) if (state.chats[key]) out = settle(out, state.chats[key])
  putOutbox(out)
  emit()
}

/** What's on screen; better, pick the bits a part shows (`useUI((u) => u.device)`) so it redraws only when they change. */
export function useUI(): UI
export function useUI<T>(pick: (ui: UI) => T): T
export function useUI<T>(pick?: (ui: UI) => T) {
  return useStore((s) => (pick ? pick(s.ui) : s.ui))
}
export const useSnap = () => useStore((s) => s.snap)

/* ---------- drafts ---------- */

// Half-typed texts live apart from the store: a letter typed redraws only the box it went in, not the whole screen.
let drafts: Record<string, string> = keptText ?? {}
function setDrafts(value: typeof drafts): void {
  drafts = value
}

const draftListeners = new Set<() => void>()
const subscribeDrafts = (l: () => void) => {
  draftListeners.add(l)
  return () => {
    draftListeners.delete(l)
  }
}

export const getDraft = (key: string): string | undefined => drafts[key]

export function setDraft(key: string, text: string) {
  if (drafts[key] === text) return
  setDrafts({ ...drafts, [key]: text })
  draftListeners.forEach((l) => l())
}

/** a half-typed text that survives a reload (the screen reloads itself on a new build); undefined until first set */
export function useDraftOf(key: string): string | undefined {
  return useSyncExternalStore(subscribeDrafts, () => drafts[key])
}

/** a half-typed text that survives a reload, and its setter */
export function useDraft(key: string): [string, (v: string) => void] {
  return [useDraftOf(key) ?? '', (t) => setDraft(key, t)]
}

/** the first entry: a reload keeps its steps; a link (an alert's) gets the steps that lead to it */
export function startHistory() {
  const st = history.state as Entry | null
  if (st?.shep) {
    setEntry(st)
    return write('replace')
  }
  const phone = state.ui.device === 'phone'
  stepsTo(screenOf(state.ui)).forEach((s, i) => {
    const next: Entry = { shep: 1, key: stepKey(s), prev: entry?.key ?? null, screen: s }
    if (i)
      history.pushState(
        next,
        '',
        urlOf(s, phone, location.pathname, (id) => slugOf(state.snap, id)),
      )
    else
      history.replaceState(
        next,
        '',
        urlOf(s, phone, location.pathname, (id) => slugOf(state.snap, id)),
      )
    setEntry(next)
  })
}

// the card to bring into view is not part of the address: a reload or a step back doesn't bring it into view again
let jumpTimer: ReturnType<typeof setTimeout> | null = null
function setJumpTimer(value: typeof jumpTimer): void {
  jumpTimer = value
}

export function forgetJump() {
  if (new URLSearchParams(location.search).has('focus')) syncUrl(true)
  // a card its chat no longer has (answered meanwhile) is let go
  if (jumpTimer) clearTimeout(jumpTimer)
  setJumpTimer(setTimeout(() => state.ui.jump && setUI({ jump: null }), 15_000))
}

/** go where an alert's link points (its place, task and card), as a tap on the alert does with the app open */
export function openLink(href: string) {
  const q = new URL(href, location.href).searchParams
  const place = q.get('place')
  if (!place) return
  const task = q.get('task')
  const closed = { settings: null, drawer: false, search: false, adding: false, menu: false, pick: null, pickAll: false, viewer: null, photo: null, cur: 0 }
  // a task elsewhere comes with its place as a step before it, so Back from it goes to its place
  if (task && (state.ui.place !== place || state.ui.task)) setUI({ ...closed, place, task: null, tab: 'chat' })
  setUI({ ...closed, place, task, tab: 'chat', jump: q.get('focus') })
  forgetJump()
}

export async function act(a: Action, signal?: AbortSignal) {
  const r = await fetch('api/action', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lineclear': '1' }, body: JSON.stringify(a), signal })
  if (!r.ok) throw new Error((await r.text()) || `${r.status}`)
  return r.json().catch(() => ({}))
}

// One live socket to the server (link.ts says how it comes back). The screen keeps what it last showed meanwhile.
let tries = 0
function setTries(value: typeof tries): void {
  tries = value
}

let retrying: ReturnType<typeof setTimeout> | null = null
function setRetrying(value: typeof retrying): void {
  retrying = value
}

let opening: ReturnType<typeof setTimeout> | null = null
function setOpening(value: typeof opening): void {
  opening = value
}

let pinging: ReturnType<typeof setTimeout> | null = null
function setPinging(value: typeof pinging): void {
  pinging = value
}

let saying: ReturnType<typeof setTimeout> | null = null
function setSaying(value: typeof saying): void {
  saying = value
}

let downSince: number | null = null
function setDownSince(value: typeof downSince): void {
  downSince = value
}

/** the outbox was cleared of what a loading screen drops */
let pruned = false
function setPruned(value: typeof pruned): void {
  pruned = value
}

let tried = 0
function setTried(value: typeof tried): void {
  tried = value
}

/** let go of the socket, whatever it is doing */
function forget() {
  if (!ws) return
  ws.onopen = ws.onmessage = ws.onclose = null
  ws.close()
  setWs(null)
  clearTimeout(opening!)
  if (pinging) clearTimeout(pinging)
  setPinging(null)
}

/** say the link is gone in a few seconds, unless it is back by then; a timer that slept with the page starts over */
function sayLater(at = Date.now()): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    if (Date.now() - at > SAY_LOST_AFTER + 1000) setSaying(sayLater())
    else if (ws?.readyState !== WebSocket.OPEN) setUI({ offline: downSince })
  }, SAY_LOST_AFTER)
}

/** whether a chat is still there: a space's coordinator's, or a task's agent's (an archived task's too) */
function chatIn(snap: Snapshot) {
  const keys = new Set([...snap.places.map((p) => p.chat), ...snap.tasks.flatMap((t) => (t.agent ? [t.agent.chat] : []))])
  return (key: string) => keys.has(key)
}

/* ---------- reloading on a new build ---------- */

// the build this screen is (empty under the dev server: it reloads by itself)
const BUILD = buildId(document.head.innerHTML)
let reloading: ReturnType<typeof setInterval> | null = null
function setReloading(value: typeof reloading): void {
  reloading = value
}

let holds = 0
function setHolds(value: typeof holds): void {
  holds = value
}

export let typed = 0
export function setTyped(value: typeof typed): void {
  typed = value
}

function keep(st: State, text: Record<string, string>) {
  const shown = st.snap ? visibleChats(st.ui, st.snap) : []
  const k = keptOf(st.ui, text)
  try {
    sessionStorage.setItem(
      'shepherdr.kept',
      JSON.stringify({ ...k, snap: st.snap ?? undefined, chats: Object.fromEntries(shown.filter((c) => st.chats[c]).map((c) => [c, st.chats[c]])) }),
    )
  } catch {
    // too much to keep (a long chat): what was open and typed still comes back
    try {
      sessionStorage.setItem('shepherdr.kept', JSON.stringify(k))
    } catch {
      /* private window: the reload still brings the newest screen */
    }
  }
}

function reloadSoon() {
  if (reloading) return
  const tryNow = () => {
    if (!mayReload(state.ui, { holds, sinceTyped: Date.now() - typed, focused: document.activeElement })) return
    keep(state, drafts)
    // what of itself each part keeps (a chat, how far up it was read)
    dispatchEvent(new Event('shepherdr:reloading'))
    location.reload()
  }
  setReloading(setInterval(tryNow, 1000))
  tryNow()
}

export function connect() {
  if (retrying) clearTimeout(retrying)
  setRetrying(null)
  const url = new URL('api/ws', location.href)
  url.protocol = url.protocol.replace('http', 'ws')
  const sock = new WebSocket(url)
  setWs(sock)
  setTried(Date.now())
  setOpening(setTimeout(() => drop(sock), OPEN_WITHIN))
  sock.onopen = () => {
    clearTimeout(opening!)
    setLinkedAt(Date.now())
    setTries(0)
    setDownSince(null)
    if (saying) clearTimeout(saying)
    setSaying(null)
    setWatched('')
    if (state.ui.offline) setUI({ offline: null })
    watchVisible()
  }
  sock.onmessage = (ev) => {
    if (pinging) clearTimeout(pinging)
    setPinging(null)
    const msg = JSON.parse(ev.data) as ServerEvent
    if (msg.type === 'pong') return
    if (msg.type === 'snapshot') {
      setState({ ...state, snap: msg.snapshot })
      stayOnShown()
      fromOldPin(msg.snapshot)
      // once loaded, the first snapshot with every machine in reach says which chats are gone (one connecting or out
      // of reach may not list its chats yet: then none is dropped); later ones don't, so a failed one left open a day
      // keeps its Retry
      if (!pruned && msg.snapshot.machines.every((m) => !m.connecting && m.status !== 'off')) {
        putOutbox(prune(state.outbox, Date.now(), chatIn(msg.snapshot)))
        setPruned(true)
      }
    } else if (msg.type === 'chat') {
      setState({ ...state, chats: { ...state.chats, [msg.chat.key]: msg.chat } })
      putOutbox(settle(state.outbox, msg.chat))
    } else if (msg.type === 'terminal') setState({ ...state, terms: { ...state.terms, [msg.chat]: { ansi: msg.ansi, cols: msg.cols, rows: msg.rows } } })
    else if (msg.type === 'update') setState({ ...state, update: msg.update })
    else if (msg.type === 'build' && BUILD && msg.id && msg.id !== BUILD) reloadSoon()
    if (msg.type === 'snapshot') watchVisible()
    emit()
  }
  sock.onclose = () => drop(sock)
}

/** this socket is done (closed, never opened, or silent): try again, and say the link is gone if it stays gone */
function drop(sock: WebSocket) {
  if (sock !== ws) return
  forget()
  setDownSince(downSince ?? Date.now())
  setSaying(saying ?? sayLater())
  const wait = retryIn(tries)
  setTries(tries + 1)
  setRetrying(setTimeout(connect, wait))
}

/** back on screen (or on the network): an open link must answer a ping, any other is tried again at once */
export function wake() {
  if (document.visibilityState !== 'visible') return
  if (ws?.readyState === WebSocket.OPEN) {
    if (pinging) return
    const sock = ws
    setPinging(
      setTimeout(() => {
        setTries(0)
        drop(sock)
      }, PONG_WITHIN),
    )
    return sock.send(JSON.stringify({ type: 'ping' }))
  }
  // back on screen, the link gets a fresh few seconds before the top line says it is gone; a try made while away
  // went out before the network woke and can hang, so it starts over (one just made stays: a phone says it twice)
  if (saying) {
    clearTimeout(saying)
    setSaying(sayLater())
    if (state.ui.offline) setUI({ offline: null })
  }
  if (ws && Date.now() - tried < 1000) return
  forget()
  setTries(0)
  connect()
}

/** This device's push subscription (alerts sets it): while the app is on screen, the server sends it no alerts. */
export function setPushEndpoint(endpoint: string | null) {
  setPushEndpointValue(endpoint)
  watchVisible()
}

/** Hold off reloading while something can't be picked up again (an upload on its way). Returns the release. */
export function holdReload() {
  setHolds(holds + 1)
  let done = false
  return () => {
    if (!done) setHolds(holds - 1)
    done = true
  }
}

/* ---------- derived ---------- */

/** More than one machine known (reachable or not): only then does a space say its machine where it shows apart from it. */
export function manyMachines(snap: Snapshot) {
  return (snap.machines?.length ?? 0) > 1
}

/** the spaces a space's lists show, itself included: its own; a home space's its machine's; the main machine's home
 *  space's every machine's */
function subtree(snap: Snapshot, id: string): string[] {
  const p = snap.places.find((x) => x.id === id)
  if (!p) return []
  if (p.level === 2) return [id]
  return snap.places.filter((x) => p.level === 0 || x.machine === p.machine).map((x) => x.id)
}

/** "gtm · vm-str" with more machines, else the space's name */
export function ladder(snap: Snapshot, id: string) {
  const p = placeOf(snap, id)
  return manyMachines(snap) ? `${p.name} · ${machineName(snap.machines, p.machine)}` : p.name
}

/** a place is in a list with these chips: one of them is it or its machine, or there are none (everything) */
export function inList(snap: Snapshot, chips: string[], placeId: string) {
  if (!chips.length || chips.includes(placeId)) return true
  const p = snap.places.find((x) => x.id === placeId)
  return !!p && chips.includes(`m:${p.machine}`)
}

/** a list's tasks: archived ones are left out of every list and count */
function tasksIn(snap: Snapshot, list: Pick<ListView, 'chips'>) {
  return snap.tasks.filter((t) => inList(snap, list.chips, t.place) && !t.archived)
}

/** a list's archived tasks, for its Archived view: the latest archived first */
export function archivedIn(snap: Snapshot, list: Pick<ListView, 'chips'>) {
  return snap.tasks.filter((t) => inList(snap, list.chips, t.place) && t.archived).sort((a, b) => b.archived! - a.archived!)
}

/** archive a task (its agent stops first) or bring it back */
export function archiveTask(t: Task, on: boolean) {
  const key = t.agent?.chat ?? `${t.id}/Agent`
  return act({ type: 'archive', chat: key, on })
}

/** pin a task to the top of its lists, or unpin it */
export function pinTask(t: Task, on: boolean) {
  return act({ type: 'pin', chat: t.agent?.chat ?? `${t.id}/Agent`, on })
}

/** pause a working task: its agent is interrupted and the task is To do until written to */
export function pauseTask(t: Task) {
  return act({ type: 'pause', chat: t.agent?.chat ?? `${t.id}/Agent` })
}

/** mark a task done with nothing merged: refused (held: what it holds) while it holds unmerged work, unless force */
export function closeTask(t: Task, force = false): Promise<{ ok?: boolean; error?: string; held?: string[]; waiting?: boolean }> {
  return act({ type: 'close', chat: t.agent?.chat ?? `${t.id}/Agent`, force })
}

/** delete a task for good: refused (held: what it holds) while it holds work, unless force */
export function deleteTask(t: Task, force = false): Promise<{ ok?: boolean; error?: string; held?: string[]; stopped?: boolean; waiting?: boolean }> {
  return act({ type: 'delete', chat: t.agent?.chat ?? `${t.id}/Agent`, force })
}

/** Shepherdr forgets a space (its folder stays on disk): refused (error) while one of its tasks is working, and for a
 *  home space */
export function removeSpace(placeId: string): Promise<{ ok?: boolean; error?: string; waiting?: boolean }> {
  return act({ type: 'space-remove', place: placeId })
}

/** What waits on you at a place: red counts its whole subtree, own only the place itself (its own coordinator's chat: the sidebar's count). */
export function counts(snap: Snapshot, placeId: string) {
  const sub = subtree(snap, placeId)
  const c = attentionCounts(snap, sub)
  const own = attentionCounts(snap, [placeId])
  // Legacy totals remain available for plugins; named categories are separate.
  return {
    red: c.need + c.ready,
    tasks: snap.tasks.filter((t) => sub.includes(t.place) && !t.archived && actionable(t)).length,
    own: own.need + own.ready,
    need: c.need,
    ready: c.ready,
    ownNeed: own.need,
    ownReady: own.ready,
  }
}

/** a list's tasks in their groups, in the order they show: more machines' under each machine's name */
export function taskGroups(snap: Snapshot, list: ListView, by: GroupBy): TaskGroup[] {
  const tasks = tasksIn(snap, list)
  if (list.attention)
    return snap.places.flatMap((p) =>
      (['need', 'ready'] as const).flatMap((status) => {
        const rows = tasks.filter((t) => t.place === p.id && t.status === status)
        return rows.length
          ? [
              {
                key: `${p.id}|${status}`,
                label: `${p.name} · ${status === 'need' ? 'Needs you' : 'Ready'}`,
                note: machineName(snap.machines, p.machine),
                tasks: rows,
                names: { machine: false, project: false },
              },
            ]
          : []
      }),
    )
  return groupTasks(snap.places, snap.machines ?? [], tasks, by, list.level)
}
