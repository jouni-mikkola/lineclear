import clsx from 'clsx'
import { Fragment, useEffect } from 'react'
import { goPlace, placeOf, setUI, useSnap, useUI, type UI } from '@client/kernel.ts'
import { RowMenu, RowMenuButton, useRowMenu } from '@client/rowmenu.tsx'
import { DeleteIcon, ic, IconButton, List, MenuItem, Meta, PlusIcon, RenameIcon, SectionIcon } from '@client/ui.tsx'
import { kept, PINNED, sectionsIn, TOP } from '@shared/order.ts'
import type { Machine, Place, Snapshot } from '@shared/types.ts'
import { openAddSpace } from './add.tsx'
import { dragging, press } from './drag.ts'
import { openDeleteSection, openNewSection, openRename } from './section.tsx'
import {
  type Sort,
  Heading,
  MachineMark,
  reorder,
  type Group,
  SectionMark,
  shownIds,
  placeTree,
  folded,
  pending,
  useFolded,
  usePending,
  seen,
  setSeen,
  unfold,
  branchesOf,
  listsOf,
  loose,
  setPending,
} from './places-tree.tsx'
import { dragged, dropHeading, AddButton, Inside, removing, Space } from './places-items.tsx'

/** A machine's heading: its chevron folds its spaces and sections away, as a tap on it does; nothing opens. Its emoji
 *  (a server without one) before its name. It says when it can't be reached or struggles, and has a + (New space there)
 *  and a ⋯ (New space, New section in it, Rename machine). It drags among the machines, all it holds with it; a space of
 *  its own dropped on it goes back under it. */
function MachineHeading({
  m,
  snap,
  shut,
  spaces,
  sort,
  className,
}: {
  m: Machine
  snap: Snapshot
  shut: boolean
  spaces: Place[]
  sort: Sort
  className?: string
}) {
  const menu = useRowMenu({ beside: true })
  const off = m.status === 'off' && !m.connecting
  // a machine past an alert limit says which, quietly in red; all well, it says nothing (what it said last while it
  // connects again after a restart: not news)
  const herdr = !m.connecting && m.herdrDown
  const over = m.health?.meters.find((x) => x.level === 'over')
  const warn = herdr ? 'herdr down' : over ? `${over.name} ${over.pct}%` : ''
  return (
    <Heading
      id={m.id}
      label={m.name}
      folds={`${m.name}'s spaces`}
      icon={<MachineMark m={m} />}
      held={menu.held}
      shut={shut}
      data-machine={m.id}
      data-drop={m.id}
      className={clsx(dragged, dropHeading, className, menu.open && 'bg-hover')}
      onPointerDown={(e) =>
        press(e, {
          id: m.id,
          siblings: sort.ids,
          level: 'machine',
          drop: (ids) => reorder(sort.under, ids),
          ...(off ? {} : { hold: menu.hold, lift: menu.close, release: menu.release }),
        })
      }
      onContextMenu={off ? undefined : (e) => (dragging() ? e.preventDefault() : menu.press.onContextMenu(e))}
    >
      {off ? null : <AddButton machine={m.machine} name={m.name} />}
      {off ? null : <RowMenuButton menu={menu} label={`More for ${m.name}`} className="relative z-1 -mr-1 phone:-mr-1.5 phone:size-8" />}
      <span className={clsx('contents', !off && !warn && 'untucked:hidden')}>
        {warn ? <Meta className="text-need-fg!">{warn}</Meta> : null}
        {m.connecting ? <Meta>Connecting…</Meta> : off && !herdr ? <Meta>Can't reach</Meta> : null}
        {shut && !off ? <Inside snap={snap} spaces={spaces} /> : null}
      </span>
      {menu.open ? (
        <RowMenu menu={menu} label={m.name} className="min-w-56!">
          <MenuItem
            icon={<PlusIcon className={ic} />}
            onClick={() => {
              menu.close()
              openAddSpace(m.machine)
            }}
          >
            New space…
          </MenuItem>
          <MenuItem
            icon={<SectionIcon className={ic} />}
            onClick={() => {
              menu.close()
              // once the menu has given the focus back to the ⋯, which takes it again when the dialog goes
              setTimeout(() => openNewSection(m.machine))
            }}
          >
            New section…
          </MenuItem>
          <MenuItem
            icon={<RenameIcon className={ic} />}
            onClick={() => {
              menu.close()
              setTimeout(() => openRename(m.id))
            }}
          >
            Rename machine…
          </MenuItem>
        </RowMenu>
      ) : null}
    </Heading>
  )
}

/** A section's heading, at the top or in a machine: its mark and name, folding its spaces away. It drags among the
 *  sections beside it, its spaces with it; a space dropped on it goes in, last. Its ⋯ renames or deletes it; Pinned
 *  only renames (its pin stays), and shows while it holds any. */
function SectionHeading({
  g,
  snap,
  sort,
  keep,
  at,
  className,
}: {
  g: Group
  snap: Snapshot
  sort: Sort
  keep?: string[]
  at: 'top' | 'inner'
  className?: string
}) {
  const menu = useRowMenu({ beside: true })
  const { s } = g
  const pinned = s.id === PINNED
  return (
    <Heading
      id={s.id}
      label={s.name}
      folds={pinned ? 'the pinned' : `${s.name}'s spaces`}
      icon={<SectionMark s={s} />}
      held={menu.held}
      shut={g.shut}
      data-section={s.id}
      data-machine={at === 'inner' ? `m:${s.machine}` : undefined}
      data-drop={s.id}
      className={clsx(dragged, dropHeading, at === 'inner' && 'pl-5 phone:pl-6', className, menu.open && 'bg-hover')}
      // Pinned out of sight while it holds nothing keeps its place among them
      onPointerDown={(e) =>
        press(e, {
          id: s.id,
          siblings: sort.ids,
          level: 'section',
          drop: (ids) => reorder(sort.under, keep ? kept(keep, ids) : ids),
          hold: menu.hold,
          lift: menu.close,
          release: menu.release,
        })
      }
      onContextMenu={(e) => (dragging() ? e.preventDefault() : menu.press.onContextMenu(e))}
    >
      <RowMenuButton menu={menu} label={`More for ${s.name}`} className="relative z-1 -mr-1 phone:-mr-1.5 phone:size-8" />
      <span className="contents untucked:hidden">{g.shut ? <Inside snap={snap} spaces={g.spaces} /> : null}</span>
      {menu.open ? (
        <RowMenu menu={menu} label={s.name} className="min-w-56!">
          <MenuItem
            icon={<RenameIcon className={ic} />}
            onClick={() => {
              menu.close()
              setTimeout(() => openRename(s.id))
            }}
          >
            Rename section…
          </MenuItem>
          {pinned ? null : (
            <MenuItem
              icon={<DeleteIcon className={ic} />}
              onClick={() => {
                menu.close()
                setTimeout(() => openDeleteSection(s.id))
              }}
            >
              Delete section…
            </MenuItem>
          )}
        </RowMenu>
      ) : null}
    </Heading>
  )
}

/** the sidebar header's +: a new section at the top */
export function NewSection() {
  return (
    <IconButton label="New section" onClick={() => openNewSection()}>
      <PlusIcon className={ic} />
    </IconButton>
  )
}

/** Alt+↑/↓ (Option on a Mac): the space above or below in the sidebar as it shows, with its message box focused.
 *  Anywhere, the message box too: there Option+↑/↓ only jumps to its start or end. */
export function stepPlace(e: KeyboardEvent, ui: UI, snap: Snapshot) {
  if (!e.altKey || e.shiftKey || e.metaKey || e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return false
  // a sheet or dialog keeps the keys: the sidebar is out of reach
  if (ui.search || ui.adding || ui.viewer || removing) return false
  e.preventDefault()
  // from where it sits with every section open: the open space may be in a folded one
  const shown = new Set(shownIds(placeTree(snap, folded, pending)))
  const all = shownIds(placeTree(snap, [], pending))
  const i = all.indexOf(ui.place)
  const id = e.key === 'ArrowUp' ? all.slice(0, Math.max(0, i)).findLast((x) => shown.has(x)) : all.slice(i + 1).find((x) => shown.has(x))
  if (!id) return true
  goPlace(id)
  setUI({ focus: placeOf(snap, id).chat, kb: true })
  return true
}

export function Places() {
  const snap = useSnap()!
  const place = useUI((u) => u.place)
  const fold = useFolded()
  const mine = usePending()
  const { top, tree } = placeTree(snap, fold, mine)
  useEffect(() => {
    // one gone to from the sidebar itself (a click, Alt+↑/↓) was in sight already: the sidebar stays as it is
    if (seen !== null && seen !== place && !shownIds(placeTree(snap, folded, pending)).includes(place)) unfold(branchesOf(snap, place))
    setSeen(place)
  }, [place])
  useEffect(() => {
    // a list the snapshot has as it was dragged or moved shows from it again
    const now = listsOf(snap)
    const known = new Set([...snap.places.map((p) => p.id), ...(snap.machines ?? []).map((m) => m.id), ...(snap.sections ?? []).map((s) => s.id)])
    const same = (a: string[], b: string[]) => a.join('\n') === b.join('\n')
    const left = Object.fromEntries(
      Object.entries(pending).filter(([k, ids]) => {
        const want = ids.filter((x) => known.has(x))
        return loose.has(ids) ? !same([...(now[k] ?? [])].sort(), want.sort()) : !same(now[k] ?? [], want)
      }),
    )
    if (Object.keys(left).length !== Object.keys(pending).length) setPending(left)
  }, [snap])
  const tops = top.map((g) => g.s.id)
  const machines = tree.map((x) => x.m.id)
  return (
    <>
      {top.length ? (
        // one list, so a section drags among the others, as the machines do below
        <List className="pt-1">
          {top.map((g, i) => (
            <Fragment key={g.s.id}>
              <SectionHeading
                g={g}
                snap={snap}
                sort={{ under: TOP, ids: tops }}
                keep={listsOf(snap)[TOP]}
                at="top"
                className={i ? 'mt-3 phone:mt-4' : undefined}
              />
              {g.shown.map((p) => (
                <Space key={p.id} p={p} snap={snap} at="top" sort={{ under: g.s.id, ids: g.shown.map((x) => x.id) }} />
              ))}
            </Fragment>
          ))}
        </List>
      ) : null}
      {/* one list, so a machine drags among the others; each a section of its own, apart as those at the top are */}
      <List className={top.length ? 'pt-3 phone:pt-4' : 'pt-1'}>
        {tree.map(({ m, shut, shown, sections, all }, i) => (
          <Fragment key={m.id}>
            <MachineHeading m={m} snap={snap} shut={shut} spaces={all} sort={{ under: 'all', ids: machines }} className={i ? 'mt-3 phone:mt-4' : undefined} />
            {shown.map((p) => (
              <Space key={p.id} p={p} snap={snap} at="machine" sort={{ under: m.id, ids: shown.map((x) => x.id) }} />
            ))}
            {shut
              ? null
              : sections.map((g) => (
                  <Fragment key={g.s.id}>
                    <SectionHeading g={g} snap={snap} sort={{ under: sectionsIn(m.id), ids: sections.map((x) => x.s.id) }} at="inner" />
                    {g.shown.map((p) => (
                      <Space key={p.id} p={p} snap={snap} at="inner" sort={{ under: g.s.id, ids: g.shown.map((x) => x.id) }} />
                    ))}
                  </Fragment>
                ))}
          </Fragment>
        ))}
      </List>
    </>
  )
}
