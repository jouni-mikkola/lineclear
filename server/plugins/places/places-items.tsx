import clsx from 'clsx'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { act, counts, getState, goPlace, manyMachines, openSplit, removeSpace, splitClick, useSnap, useUI, type Pane } from '@client/kernel.ts'
import { and, Dialog, RowMenu, RowMenuButton, useRowMenu } from '@client/rowmenu.tsx'
import {
  BellIcon,
  BellSlashIcon,
  ic,
  MenuItem,
  MenuSeparator,
  MenuSetting,
  Meta,
  NextIcon,
  PlusIcon,
  Primary,
  ReadIcon,
  RemoveProjectIcon,
  RenameIcon,
  rowClass,
  SectionIcon,
  SplitIcon,
  TasksIcon,
} from '@client/ui.tsx'
import { markPlaceRead, placeUnread } from '@client/unread.ts'
import { RestartItem } from '@client/restart.tsx'
import { NOTIFY, NOTIFY_KEY, notifyOf, notifyRow } from '@shared/alerts.ts'
import { PINNED } from '@shared/order.ts'
import { machineName, NAME_MAX, nameProblem, slugify, type Place, type Snapshot } from '@shared/types.ts'
import { asTyped, openAddSpace } from './add.tsx'
import { dragging, press } from './drag.ts'
import { MoveItems, NOTIFY_HINT, PinItem, type Sort, moveKey, usePlaceRow, indent, reorder, mayGo, moveTo } from './places-tree.tsx'

/** A space's menu: its coordinator's Notify (a choice that is what it would get anyway goes back to following it), Mark
 *  as read (its own chat, as its row shows it), Pin, Restart agent (its coordinator), Move to section (the menu turns into where it may go), Rename, and
 *  what the row adds (Remove, but for a home space) */
function PlaceMenu({
  p,
  snap,
  menu,
  unread,
  onRename,
  children,
}: {
  p: Place
  snap: Snapshot
  menu: ReturnType<typeof useRowMenu>
  unread: boolean
  onRename?: () => void
  children?: ReactNode
}) {
  const [moving, setMoving] = useState(false)
  const now = notifyOf(snap, p.id)
  const row = notifyRow(snap, p.id)
  const pick = (v: string) => act({ type: 'setting', key: NOTIFY_KEY, value: row?.inherits?.value === v ? null : v, place: p.id })
  const desktop = useUI((u) => u.device === 'desktop')
  const split = (pane: Pane) => () => {
    menu.close()
    openSplit(pane)
  }
  if (moving)
    return (
      <RowMenu menu={menu} label={`Move ${p.name} to section`} className="min-w-[min(16rem,calc(100%-0.5rem))]!">
        <MoveItems p={p} snap={snap} menu={menu} onBack={() => setMoving(false)} />
      </RowMenu>
    )
  return (
    <RowMenu menu={menu} label={p.name} className="min-w-[min(16rem,calc(100%-0.5rem))]!">
      {desktop ? (
        <>
          <MenuItem icon={<SplitIcon className={ic} />} onClick={split({ kind: 'place', id: p.id })}>
            Open in split view
          </MenuItem>
          <MenuItem icon={<TasksIcon className={ic} />} onClick={split({ kind: 'tasks', id: p.id })}>
            Open its tasks in split view
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      <MenuSetting
        name="Notify"
        note="For its coordinator's chat; tasks alert as always"
        icon={now === 'Off' ? <BellSlashIcon className={ic} /> : <BellIcon className={ic} />}
        choices={NOTIFY.map((v) => ({ label: v, hint: NOTIFY_HINT[v], on: now === v, onClick: () => void pick(v).catch(() => undefined) }))}
      />
      <MenuItem
        icon={<ReadIcon className={ic} />}
        disabled={!unread}
        className="disabled:pointer-events-none disabled:text-fg3"
        onClick={() => {
          menu.close()
          markPlaceRead(snap, [p])
        }}
      >
        Mark as read
      </MenuItem>
      <PinItem p={p} snap={snap} menu={menu} />
      <RestartItem chat={p.chat} name={p.name} onPick={menu.close} />
      <MenuItem icon={<SectionIcon className={ic} />} hint={<NextIcon className={ic} />} aria-haspopup="menu" onClick={() => setMoving(true)}>
        Move to section
      </MenuItem>
      {onRename ? (
        <MenuItem
          icon={<RenameIcon className={ic} />}
          onClick={() => {
            menu.close()
            // once the menu has given the focus back to the ⋯: the name's box takes it then
            setTimeout(onRename)
          }}
        >
          Rename
        </MenuItem>
      ) : null}
      {children ? (
        <>
          <MenuSeparator />
          {children}
        </>
      ) : null}
    </RowMenu>
  )
}

function RenameBox({
  name,
  problem,
  onSave,
  onCancel,
}: {
  name: string
  problem: (v: string) => string | undefined
  onSave: (v: string) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(name)
  const box = useRef<HTMLInputElement>(null)
  // Enter or Escape closed it already: the blur its going brings changes nothing
  const done = useRef(false)
  const bad = problem(v)
  useEffect(() => {
    box.current?.focus({ preventScroll: true })
    box.current?.select()
  }, [])
  const end = (keep: boolean) => {
    if (done.current) return
    done.current = true
    if (keep && !bad) onSave(v)
    else onCancel()
  }
  return (
    <>
      <input
        ref={box}
        name="place-name"
        aria-label={`New name for ${name}`}
        aria-invalid={!!bad || undefined}
        title={bad}
        enterKeyHint="done"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={NAME_MAX}
        value={v}
        onChange={(e) => setV(asTyped(e.target.value))}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== 'Escape') return
          e.preventDefault()
          e.stopPropagation()
          if (e.key === 'Enter' && bad) return
          end(e.key === 'Enter')
        }}
        onBlur={() => end(true)}
        className="-ml-1 h-6 min-w-0 flex-1 rounded-[calc(var(--row-radius)-3px)] bg-bg px-1 text-fg shadow-[inset_0_0_0_1.5px_var(--focus)] outline-none aria-invalid:shadow-[inset_0_0_0_1.5px_var(--color-need-fg)] coarse:h-8 phone:h-8 phone:text-[1rem]"
      />
      {bad ? <Meta className="text-need-fg!">{bad.includes('Another') ? 'Taken' : 'Not allowed'}</Meta> : null}
    </>
  )
}

/**
 * Renaming a space, in its row: its name becomes a box, Enter (or leaving it) keeps the new name, Escape
 * keeps the old. Only the name that shows changes; empty gives it back its own. The new one shows at once, until the
 * snapshot has it. A space's name follows the space rules as you type (lowercase, a space becomes -), and one another
 * space on its machine has, or that breaks a rule, is refused in the box.
 */
function useRename(p: Place, snap: Snapshot) {
  const [editing, setEditing] = useState(false)
  const [typed, setTyped] = useState<string | null>(null)
  useEffect(() => setTyped(null), [p.name])
  const save = (v: string) => {
    setEditing(false)
    const name = slugify(v)
    if (name === p.name) return
    if (name) setTyped(name)
    act({ type: 'rename', id: p.id, name }).then(
      (r: { ok?: boolean }) => r.ok === false && setTyped(null),
      () => setTyped(null),
    )
  }
  const problem = (v: string) =>
    v
      ? nameProblem(
          v,
          snap.places.filter((x) => x.machine === p.machine && x.id !== p.id).map((x) => x.name),
        )
      : undefined
  return {
    editing,
    start: () => setEditing(true),
    /** the name as it shows: the one just typed until the snapshot has it */
    name: typed ?? p.name,
    box: editing ? <RenameBox name={typed ?? p.name} problem={problem} onSave={save} onCancel={() => setEditing(false)} /> : null,
  }
}

/** a space's row clicked: there, or with ⌘ (Ctrl off a Mac) beside the focused pane, in split view */
function openPlace(id: string, e: { metaKey: boolean; ctrlKey: boolean }) {
  if (splitClick(e)) openSplit({ kind: 'place', id })
  else goPlace(id)
}

/** a row's name: a button going there, stretched over the row so its ⋯ stays a button of its own */
function Go({
  p,
  said,
  sel,
  sort,
  onClick,
  children,
}: {
  p: Place
  said: string
  sel: boolean
  sort?: Sort
  onClick?: (e: { metaKey: boolean; ctrlKey: boolean }) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={said}
      aria-current={sel || undefined}
      aria-keyshortcuts={sort && sort.ids.length > 1 ? 'Alt+Shift+ArrowUp Alt+Shift+ArrowDown' : undefined}
      onKeyDown={sort ? (e) => moveKey(e, p.id, sort) : undefined}
      onClick={onClick ?? ((e) => openPlace(p.id, e))}
      className="flex min-w-0 flex-1 cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:shadow-[inset_0_0_0_1.5px_var(--focus)]"
    >
      {children}
    </button>
  )
}

/** a row being dragged lifts above the rest */
export const dragged = 'data-dragging:z-10 data-dragging:bg-bg data-dragging:shadow-menu'
const dropBefore = 'data-[drop-over=before]:shadow-[inset_0_2px_0_var(--focus)]'
const removeListeners = new Set<() => void>()

/* ---------- removing a space asks first ---------- */

export let removing: Place | null = null
function setRemoving(p: Place | null) {
  removing = p
  for (const l of removeListeners) l()
}

/** A space: its name (going there, a button stretched over the row), its ⋯ and its count. Its menu opens from the ⋯,
 *  a right click or a finger held on the row; none while its machine can't be reached. In a section at the top it sits
 *  in under its heading, its machine after its name where there are more machines; in a machine's section, in under
 *  that. It drags among those beside it, a home space too, or onto another section it may go in. */
export function Space({ p, snap, sort, at }: { p: Place; snap: Snapshot; sort: Sort; at: 'top' | 'machine' | 'inner' }) {
  const rename = useRename(p, snap)
  const top = at === 'top'
  const group = sort.under
  const r = usePlaceRow({ p: { ...p, name: rename.name }, snap, where: top && manyMachines(snap) ? machineName(snap.machines, p.machine) : undefined })
  const menu = useRowMenu({ beside: true })
  const off = p.status === 'off'
  const still = off || rename.editing
  return (
    <li
      data-machine={top ? undefined : `m:${p.machine}`}
      data-section={at === 'machine' ? undefined : group}
      data-project={p.id}
      data-pin={group === PINNED ? p.id : undefined}
      data-home={p.home || undefined}
      data-drop={group}
      className={clsx(
        rowClass(r.sel, false, true),
        dragged,
        dropBefore,
        indent[at],
        'group select-none [-webkit-touch-callout:none]',
        menu.open && !r.sel && 'bg-hover',
      )}
      onPointerDown={
        rename.editing
          ? undefined
          : (e) =>
              press(e, {
                id: p.id,
                siblings: sort.ids,
                level: 'project',
                drop: (ids) => reorder(group, ids),
                into: { group, may: (g) => mayGo(snap, p, g), go: (g, before) => moveTo(p.id, g, before) },
                ...(off ? {} : { hold: menu.hold, lift: menu.close, release: menu.release }),
              })
      }
      onContextMenu={still ? undefined : (e) => (dragging() ? e.preventDefault() : menu.press.onContextMenu(e))}
    >
      {r.mark}
      {rename.box ?? (
        <Go p={p} said={r.said} sel={r.sel} sort={sort} onClick={(e) => !menu.held() && openPlace(p.id, e)}>
          {r.name}
        </Go>
      )}
      {still ? null : <RowMenuButton menu={menu} label={`More for ${p.name}`} className="relative z-1 -mr-1 phone:-mr-1.5 phone:size-8" />}
      <span className={clsx('contents', !still && 'untucked:hidden')}>{r.end}</span>
      {menu.open ? (
        <PlaceMenu p={p} snap={snap} menu={menu} unread={r.fresh} onRename={rename.start}>
          {p.home ? null : (
            <MenuItem
              icon={<RemoveProjectIcon className={ic} />}
              onClick={() => {
                menu.close()
                // once the menu has given the focus back to the ⋯, which takes it again when the question goes
                setTimeout(() => setRemoving(p))
              }}
            >
              Remove from Lineclear…
            </MenuItem>
          )}
        </PlaceMenu>
      ) : null}
    </li>
  )
}

/** a space dragged over another section: its heading lights up, and a line shows where it goes among its spaces */
export const dropHeading = 'data-[drop-over=heading]:bg-sel'

function RemoveBox({ p, snap }: { p: Place; snap: Snapshot }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mine = snap.tasks.filter((t) => t.place === p.id && !t.archived)
  const working = mine.filter((t) => t.status === 'work').map((t) => t.id)
  const open = mine.filter((t) => t.status !== 'done').map((t) => t.id)
  const cancel = () => setRemoving(null)
  const go = async () => {
    setBusy(true)
    setError(null)
    const r = await removeSpace(p.id).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (r.ok === false) return setError(r.error || 'It could not be removed.')
    setRemoving(null)
    // it was open: its machine's home space takes its place
    const home = snap.places.find((x) => x.home && x.machine === p.machine)
    if (getState().ui.place === p.id && home) goPlace(home.id)
  }
  if (working.length)
    return (
      <Dialog title={`${p.name} can’t be removed yet`} safe cancel="OK" onCancel={cancel} buttons={null}>
        <p>
          {and(working)} {working.length > 1 ? 'are' : 'is'} still working. Pause {working.length > 1 ? 'them' : 'it'} or let{' '}
          {working.length > 1 ? 'them' : 'it'} finish first.
        </p>
      </Dialog>
    )
  return (
    <Dialog
      title={`Remove ${p.name} from Lineclear?`}
      safe
      onCancel={cancel}
      buttons={
        <Primary className="bg-need-fg! text-white! dark:text-black!" disabled={busy} onClick={go}>
          {busy ? 'Removing…' : 'Remove'}
        </Primary>
      }
    >
      <p>Its files and folder stay on disk. Lineclear only forgets it, and its coordinator closes.</p>
      <p className="mt-1.5">
        {open.length
          ? `${open.length > 1 ? `Its ${open.length} open tasks` : 'Its open task'}${open.length <= 4 ? ` (${and(open)})` : ''} ${open.length > 1 ? 'hide' : 'hides'} with it; ${open.length > 1 ? 'their worktrees and branches stay' : 'its worktree and branch stay'}. Add the space again to bring them and its chat back.`
          : 'Add it again any time to bring its chat back.'}
      </p>
      {error ? <p className="mt-1.5 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}

/**
 * "Remove gtm from Lineclear?": the folder and its code stay on disk; Lineclear forgets it and its coordinator closes.
 * Its open tasks hide with it and come back when it is added again. While one of its tasks is working it can't be
 * removed: it says which, and changes by itself once they stop.
 */
export function ConfirmRemove() {
  const p = useSyncExternalStore(
    (l) => {
      removeListeners.add(l)
      return () => void removeListeners.delete(l)
    },
    () => removing,
  )
  const snap = useSnap()
  if (!p || !snap) return null
  return <RemoveBox key={p.id} p={p} snap={snap} />
}

/** + on a machine's heading: a new space there. A mouse finds it on hover; a finger always sees it. */
export function AddButton({ machine, name }: { machine: string; name: string }) {
  return (
    <button
      type="button"
      aria-label={`New space on ${name}`}
      onClick={(e) => {
        e.stopPropagation()
        openAddSpace(machine)
      }}
      className="hit relative z-1 -mr-1 grid size-6 shrink-0 place-items-center rounded-full text-fg3 hover:bg-sel hover:text-fg tucked:pointer-events-none tucked:absolute tucked:opacity-0 phone:-mr-1.5 phone:size-8"
    >
      <PlusIcon className={ic} />
    </button>
  )
}

/** on a folded section's heading, what its hidden spaces hold: a red dot where something waits on you in one, else a
 *  grey one where one is unread; nothing all read. Quiet as a mark, not a count: the spaces have those. */
export function Inside({ snap, spaces }: { snap: Snapshot; spaces: Place[] }) {
  const on = spaces.filter((p) => p.status !== 'off')
  const needs = on.some((p) => counts(snap, p.id).own)
  const fresh = !needs && on.some((p) => placeUnread(snap, p))
  if (!needs && !fresh) return null
  const said = needs ? 'Something in it waits on you' : 'Something in it is unread'
  return (
    <span
      role="img"
      aria-label={said}
      data-inside={needs ? 'needs' : 'unread'}
      className={clsx('mx-1.5 size-2 shrink-0 rounded-full phone:size-2.5', needs ? 'bg-need' : 'bg-fg2')}
    />
  )
}
