import clsx from 'clsx'
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type LiHTMLAttributes, type ReactNode } from 'react'
import { act, counts, getState, useUI } from '@client/kernel.ts'
import type { useRowMenu } from '@client/rowmenu.tsx'
import {
  BackIcon,
  BellSlashIcon,
  AttentionBadge,
  DownIcon,
  HashIcon,
  ic,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  NextIcon,
  PinnedIcon,
  PinTaskIcon,
  rowClass,
  RowText,
  SectionIcon,
  ServerIcon,
  UnpinIcon,
} from '@client/ui.tsx'
import { muted, placeUnread } from '@client/unread.ts'
import type { NOTIFY } from '@shared/alerts.ts'
import { PINNED, sectionsIn, TOP, type PlaceOrder } from '@shared/order.ts'
import type { Machine, Place, Section, Snapshot } from '@shared/types.ts'

/* ---------- folded sections (Pinned, the machines), remembered on this device ---------- */

const KEY = 'shepherdr.folded'
const listeners = new Set<() => void>()
export let folded: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
})()

function setFolded(next: string[]) {
  folded = next
  try {
    localStorage.setItem(KEY, JSON.stringify(folded))
  } catch {
    /* private window: unfolded again next time */
  }
  for (const l of listeners) l()
}

function toggleFold(id: string) {
  setFolded(folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id])
}

/** opens the sections a space sits in, once you go there */
export function unfold(ids: string[]) {
  if (ids.some((id) => folded.includes(id))) setFolded(folded.filter((x) => !ids.includes(x)))
}

export function useFolded() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => folded,
  )
}
const orderListeners = new Set<() => void>()

/* ---------- the order you dragged or moved, shown at once until the server's snapshot has it ---------- */

export let pending: PlaceOrder = {}
export function setPending(next: PlaceOrder) {
  pending = next
  for (const l of orderListeners) l()
}

export function usePending() {
  return useSyncExternalStore(
    (l) => {
      orderListeners.add(l)
      return () => orderListeners.delete(l)
    },
    () => pending,
  )
}

/** lists shown before the snapshot has them where only what is in them is sure, not where: a space back under its
 *  machine goes where it was, which only the server knows */
export const loose = new Set<string[]>()

/** shows these lists at once, and lets each go once the snapshot has it, or the server refused or never answered */
function hold(lists: PlaceOrder, sent: Promise<{ ok?: boolean }>) {
  setPending({ ...pending, ...lists })
  const forget = () => {
    for (const ids of Object.values(lists)) loose.delete(ids)
    setPending(Object.fromEntries(Object.entries(pending).filter(([k, ids]) => lists[k] !== ids)))
  }
  sent.then((r) => r.ok === false && forget(), forget)
  // the snapshot with it comes long before; this only lets go of one that never came
  setTimeout(forget, 10_000)
}

/** keeps a new order: the machines (under 'all'), a machine's spaces (under its id), a section's (under its id), or the
 *  sections at the top (TOP) or in a machine */
export function reorder(under: string, ids: string[]) {
  hold({ [under]: ids }, act({ type: 'order', under, ids }))
}

/** every list of the sidebar as the snapshot has it, by what it is under (shared/order.ts): the machines, the sections
 *  at the top and in each machine, each section's spaces and each machine's own */
export function listsOf(snap: Snapshot): PlaceOrder {
  const sections = snap.sections ?? []
  const inside = new Set(sections.flatMap((s) => s.spaces))
  const out: PlaceOrder = { all: (snap.machines ?? []).map((m) => m.id), [TOP]: sections.filter((s) => !s.machine).map((s) => s.id) }
  for (const s of sections) out[s.id] = s.spaces
  for (const m of snap.machines ?? []) {
    out[m.id] = snap.places.filter((p) => p.machine === m.machine && !inside.has(p.id)).map((p) => p.id)
    out[sectionsIn(m.id)] = sections.filter((s) => s.machine === m.machine).map((s) => s.id)
  }
  return out
}

/* ---------- the tree: sections at the top, then the machines with their spaces and sections ---------- */

/** a list that holds spaces: a section's (its id) or a machine's own (its id, m:<key>) */
const groupKey = (k: string) => k === PINNED || k.startsWith('s:') || k.startsWith('m:')

/** a space into a section (PINNED too) or back under its machine (to: its id), before another there or last */
export function moveTo(id: string, to: string, before?: string) {
  const lists = { ...listsOf(getState().snap!), ...pending }
  const from = Object.keys(lists).find((k) => groupKey(k) && lists[k].includes(id))
  if (from === to && !before) return
  const next: PlaceOrder = {}
  if (from) next[from] = lists[from].filter((x) => x !== id)
  const there = (next[to] ?? lists[to] ?? []).filter((x) => x !== id)
  const i = before ? there.indexOf(before) : -1
  next[to] = i < 0 ? [...there, id] : [...there.slice(0, i), id, ...there.slice(i)]
  if (to.startsWith('m:') && !before) loose.add(next[to])
  hold(next, act({ type: 'move', id, to, ...(before ? { before } : {}) }))
}

/** where a row can be moved, and Alt+Shift+↑/↓ moving it one step */
export interface Sort {
  under: string
  /** its place and its siblings as they show */
  ids: string[]
}

export function moveKey(e: ReactKeyboardEvent, id: string, sort: Sort) {
  if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
  e.preventDefault()
  const i = sort.ids.indexOf(id)
  const j = i + (e.key === 'ArrowUp' ? -1 : 1)
  if (i < 0 || j < 0 || j >= sort.ids.length) return
  const ids = sort.ids.filter((x) => x !== id)
  ids.splice(j, 0, id)
  reorder(sort.under, ids)
}

export interface Group {
  s: Section
  spaces: Place[]
  shut: boolean
  /** its spaces as they show: none while it or its machine is folded */
  shown: Place[]
}

/** the space open the last time the sidebar looked: the first one shows as you left the tree, later ones open it */
export let seen: string | null = null
export function setSeen(value: typeof seen): void {
  seen = value
}

/** the sidebar as it shows: the sections at the top (Pinned while it holds any), then each machine with its own spaces
 *  and its sections. A space shows once, where it sits; one just dragged or moved shows there at once. A folded section
 *  hides every space in it, a folded machine its sections too. */
export function placeTree(snap: Snapshot, fold: string[], mine: PlaceOrder) {
  const lists = { ...listsOf(snap), ...mine }
  const places = new Map(snap.places.map((p) => [p.id, p]))
  const sections = new Map((snap.sections ?? []).map((s) => [s.id, s]))
  const seen = new Set<string>()
  const take = (ids: string[] | undefined, fits: (p: Place) => boolean) =>
    (ids ?? []).flatMap((id) => {
      const p = places.get(id)
      if (!p || seen.has(id) || !fits(p)) return []
      seen.add(id)
      return [p]
    })
  const group = (id: string, out: boolean, fits: (p: Place) => boolean): Group[] => {
    const s = sections.get(id)
    if (!s) return []
    const spaces = take(lists[id], fits)
    const shut = fold.includes(id)
    return [{ s, spaces, shut, shown: shut || out ? [] : spaces }]
  }
  const top = (lists[TOP] ?? []).flatMap((id) => group(id, false, () => true)).filter((g) => g.s.id !== PINNED || g.spaces.length)
  const machines = new Map((snap.machines ?? []).map((m) => [m.id, m]))
  const tree = (lists.all ?? []).flatMap((id) => {
    const m = machines.get(id)
    if (!m) return []
    const shut = fold.includes(m.id)
    const fits = (p: Place) => p.machine === m.machine
    const spaces = take(lists[m.id], fits)
    const inside = (lists[sectionsIn(m.id)] ?? []).flatMap((s) => group(s, shut, fits))
    return [{ m, spaces, shut, shown: shut ? [] : spaces, sections: inside, all: [...spaces, ...inside.flatMap((g) => g.spaces)] }]
  })
  return { top, tree }
}

/** the spaces of the sidebar as they show, top to bottom */
export function shownIds({ top, tree }: ReturnType<typeof placeTree>) {
  return [...top.flatMap((g) => g.shown), ...tree.flatMap((t) => [...t.shown, ...t.sections.flatMap((g) => g.shown)])].map((p) => p.id)
}

/** the sections a space sits in: its section at the top, or its machine and its section there */
export function branchesOf(snap: Snapshot, id: string) {
  const { top, tree } = placeTree(snap, [], pending)
  const g = top.find((x) => x.spaces.some((p) => p.id === id))
  if (g) return [g.s.id]
  const t = tree.find((x) => x.all.some((p) => p.id === id))
  if (!t) return []
  return [t.m.id, ...t.sections.filter((x) => x.spaces.some((p) => p.id === id)).map((x) => x.s.id)]
}

/** where a space sits: its section's id, or its machine's */
function groupOf(snap: Snapshot, mine: PlaceOrder, p: Place) {
  const lists = { ...listsOf(snap), ...mine }
  return Object.keys(lists).find((k) => groupKey(k) && lists[k].includes(p.id)) ?? `m:${p.machine}`
}

/** the sections a space may go into, by id: any at the top, its own machine's, its machine (back under it) */
export function mayGo(snap: Snapshot, p: Place, group: string) {
  if (group.startsWith('m:')) return group === `m:${p.machine}`
  const s = snap.sections?.find((x) => x.id === group)
  return !!s && (!s.machine || s.machine === p.machine)
}

/** a row's icon: a hair under the name's 15px, tucked 2px nearer the name */
const icon = 'size-[15px] shrink-0 -mr-0.5 phone:size-4'

/* ---------- rows ---------- */

/** what every space's row shows: its name, bold when something new came in its coordinator's chat or waits on you
 *  there (with its count: a task waiting on you ends as a card in its space's chat), or that its machine can't be
 *  reached; dimmed when muted, as Slack's muted channels, its count still red */
export function usePlaceRow({ p, snap, where }: { p: Place; snap: Snapshot; where?: string }) {
  const sel = useUI((u) => u.place === p.id)
  const c = counts(snap, p.id)
  const n = c.own
  const fresh = placeUnread(snap, p)
  const quiet = muted(snap, p.id)
  const off = p.status === 'off' && !p.connecting
  const pilot = p.mode === 'autopilot' && !off
  return {
    sel,
    // what the row says aloud, its count and offline too
    said: `${p.name}${where ? ` on ${where}` : ''}${p.home ? ', home space' : ''}${p.connecting ? ', connecting' : off ? ", can't reach" : n ? `, ${c.ownNeed} need you, ${c.ownReady} ready here` : ''}${fresh && !off ? ', unread' : ''}${pilot ? ', on coordinator timer' : ''}${quiet ? ', muted' : ''}`,
    fresh,
    // the coordinator timer mark, then the space's # before the name, as Slack's channels have: grey, lit with the name where
    // it is open or something is new
    mark: (
      <>
        <span aria-hidden data-autopilot={pilot || undefined} className={clsx('mode-pill mark', !pilot && 'invisible')} />
        <HashIcon className={clsx(icon, off || quiet ? 'text-fg3' : sel || n || fresh ? 'text-fg' : 'text-fg2')} />
      </>
    ),
    name: (
      <RowText className={off || quiet ? 'text-fg3' : n || fresh ? 'font-semibold text-fg' : sel ? 'text-fg' : 'text-fg2'}>
        {p.name}
        {where ? <span className="font-normal text-fg3"> · {where}</span> : null}
      </RowText>
    ),
    end: (
      <>
        {quiet ? <BellSlashIcon aria-hidden className={clsx(ic, 'text-fg3')} /> : null}
        {p.connecting || off ? null : <AttentionBadge need={c.ownNeed} ready={c.ownReady} scope="here" />}
      </>
    ),
  }
}

/* ---------- indents: a space in by a chevron's room, its # under its heading's icon ---------- */

export const indent = {
  top: 'pl-[33px] phone:pl-[38px]',
  machine: 'pl-[33px] phone:pl-[38px]',
  inner: 'pl-[45px] phone:pl-[50px]',
}

/** the chevron before a heading's name: folds what is under it away */
function Fold({ label, id, shut }: { label: string; id: string; shut: boolean }) {
  const Icon = shut ? NextIcon : DownIcon
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={!shut}
      onClick={(e) => {
        e.stopPropagation()
        toggleFold(id)
      }}
      className="hit relative z-1 -ml-0.5 grid size-4 shrink-0 place-items-center rounded-full text-fg3 hover:bg-sel hover:text-fg phone:-ml-1 phone:size-5"
    >
      <Icon className="size-3 phone:size-3.5" />
    </button>
  )
}

/** a section's heading (Pinned, a machine): its chevron, its icon (Pinned's pin; a machine's emoji or server) and its word. A tap anywhere on it folds
 *  what is under it, as its chevron does; it goes nowhere, as Slack's sections don't. What it adds (a machine's +, ⋯
 *  and how it is) comes after its name. */
export function Heading({
  id,
  label,
  folds,
  icon: mark,
  shut,
  held,
  className,
  children,
  ...rest
}: { id: string; label: string; folds: string; icon: ReactNode; shut: boolean; held?: () => boolean; className?: string; children?: ReactNode } & Omit<
  LiHTMLAttributes<HTMLLIElement>,
  'children'
>) {
  return (
    <li data-heading={id} className={clsx(rowClass(false, false, true), 'group gap-1.5 select-none [-webkit-touch-callout:none]', className)} {...rest}>
      <Fold label={`${shut ? 'Show' : 'Hide'} ${folds}`} id={id} shut={shut} />
      {mark}
      <h2 className="contents">
        <button
          type="button"
          aria-expanded={!shut}
          // a finger held to open its menu folds nothing
          onClick={() => !held?.() && toggleFold(id)}
          className="flex min-w-0 flex-1 cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:shadow-[inset_0_0_0_1.5px_var(--focus)]"
        >
          <RowText className="font-medium text-fg2">{label}</RowText>
        </button>
      </h2>
      {children}
    </li>
  )
}

export const NOTIFY_HINT: Record<(typeof NOTIFY)[number], string> = {
  All: 'every new message from its coordinator',
  'Needs me': "its coordinator's questions and alerts",
  Off: 'nothing from its coordinator, and its row stays quiet',
}

function Emoji({ e }: { e: string }) {
  return (
    <span data-icon="emoji" aria-hidden className="-mr-0.5 grid w-[15px] shrink-0 place-items-center text-[0.9375rem] leading-none phone:w-4 phone:text-base">
      {e}
    </span>
  )
}

/** A section's mark: Pinned's pin, its emoji, or a folder without one */
export function SectionMark({ s }: { s: Section }) {
  return s.id === PINNED ? (
    <PinnedIcon className={clsx(icon, 'text-fg3')} />
  ) : s.emoji ? (
    <Emoji e={s.emoji} />
  ) : (
    <SectionIcon className={clsx(icon, 'text-fg3')} />
  )
}

/** A machine's mark: its emoji, or a server without one */
export function MachineMark({ m }: { m: Machine }) {
  return m.emoji ? <Emoji e={m.emoji} /> : <ServerIcon className={clsx(icon, 'text-fg3')} />
}

/** Move to section: back first, then its machine's sections, those at the top (Pinned too), and its machine itself (no
 *  section); where it is now says Here */
export function MoveItems({ p, snap, menu, onBack }: { p: Place; snap: Snapshot; menu: ReturnType<typeof useRowMenu>; onBack: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const here = groupOf(snap, usePending(), p)
  const m = snap.machines?.find((x) => x.machine === p.machine)
  const all = snap.sections ?? []
  useEffect(() => ref.current?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true }), [])
  const item = (id: string, name: string, mark: ReactNode) => (
    <MenuItem
      key={id}
      icon={mark}
      disabled={id === here}
      hint={id === here ? 'Here' : undefined}
      className="disabled:pointer-events-none disabled:text-fg3"
      onClick={() => {
        menu.close()
        moveTo(p.id, id)
      }}
    >
      {name}
    </MenuItem>
  )
  const own = all.filter((s) => s.machine === p.machine)
  return (
    <div ref={ref} className="contents">
      <MenuItem icon={<BackIcon className={ic} />} className="text-fg2" onClick={onBack}>
        Move to section
      </MenuItem>
      <MenuSeparator />
      {own.length && m ? (
        <>
          <MenuLabel>In {m.name}</MenuLabel>
          {own.map((s) => item(s.id, s.name, <SectionMark s={s} />))}
        </>
      ) : null}
      <MenuLabel>At the top</MenuLabel>
      {all.filter((s) => !s.machine).map((s) => item(s.id, s.name, <SectionMark s={s} />))}
      {m ? (
        <>
          <MenuSeparator />
          {item(m.id, m.name, <MachineMark m={m} />)}
        </>
      ) : null}
    </div>
  )
}

/** Pin (to Pinned, at the end) or Unpin (back under its machine, where it was): a space's, wherever it sits */
export function PinItem({ p, snap, menu }: { p: Place; snap: Snapshot; menu: ReturnType<typeof useRowMenu> }) {
  const on = groupOf(snap, usePending(), p) === PINNED
  return (
    <MenuItem
      icon={on ? <UnpinIcon className={ic} /> : <PinTaskIcon className={ic} />}
      onClick={() => {
        menu.close()
        moveTo(p.id, on ? `m:${p.machine}` : PINNED)
      }}
    >
      {on ? 'Unpin' : 'Pin'}
    </MenuItem>
  )
}
