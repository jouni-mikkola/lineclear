import { attentionCounts } from './attention.ts'
import clsx from 'clsx'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import {
  closePane,
  onlyPane,
  placesDocked,
  getState,
  useStore,
  placeKind,
  listsPinned,
  listView,
  placeOf,
  registry,
  setUI,
  togglePin,
  useSnap,
  useUI,
} from './kernel.ts'
import { PlacesColumn, PlacesToggle } from './Frame.tsx'
import { Drawer as SlideDrawer } from './Stack.tsx'
import { machineName, type Place, type Snapshot, type Task } from '@shared/types.ts'
import {
  CrookIcon,
  CogIcon,
  AttentionBadge,
  FitIcon,
  FootButton,
  Head,
  IconButton,
  Menu,
  MOD,
  MenuIcon,
  MenuSeparator,
  MoreIcon,
  LockIcon,
  PlaceIcon,
  RoundButton,
  SearchIcon,
  shortcut,
  Tab,
  Tabs,
  Who,
  XIcon,
  ic,
} from './ui.tsx'

/** before the first snapshot: the mark and a quiet word, in the app's own type; one that can't reach Shepherdr says so
 *  and keeps trying */
export function Loading() {
  const device = useUI((u) => u.device)
  const lost = useUI((u) => !!u.offline)
  // a link that neither opens nor fails says so too, after a while
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000)
    return () => clearTimeout(t)
  }, [])
  const offline = lost || slow
  return (
    <div data-device={device} className="grid h-full place-items-center bg-bg px-6 font-sans text-sm/5 text-fg3 antialiased phone:text-base/6">
      <div role="status" className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-10 place-items-center overflow-hidden rounded-[11px] bg-fg pt-1 text-bg">
          <CrookIcon className="size-8 overflow-visible" />
        </span>
        {offline ? "Can't reach Lineclear. Trying again…" : 'Loading…'}
      </div>
    </div>
  )
}

export function useKeyboard() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const s = getState()
      if (!s.snap) return
      for (const k of registry.keys) if (k.handle({ e, ui: s.ui, snap: s.snap })) return
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [])
}

/* ---------- pieces of the frame ---------- */

function Brand() {
  const snap = useSnap()!
  const Menu = registry.views.placesMenu
  return (
    <div className="flex items-center gap-2 px-3.5 pt-3 pb-0.5 text-[0.9375rem] font-semibold desktop:pr-2.5 phone:px-5 phone:pt-3 phone:pb-1 phone:text-[1.125rem]">
      <CrookIcon className="size-6" />
      <span className="min-w-0 flex-1 truncate">{snap.name}</span>
      {Menu ? <Menu /> : null}
      <PlacesToggle when="open" />
    </div>
  )
}

function SearchBox() {
  const device = useUI((u) => u.device)
  return (
    <div className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-1.5">
      <button
        type="button"
        onClick={() => setUI({ search: true, searchScope: undefined, drawer: false })}
        className="press-dim flex h-8 flex-1 items-center gap-2 rounded-full bg-bg px-3 text-left text-[0.8125rem] text-fg3 shadow-[inset_0_0_0_1px_var(--line2)] coarse:h-11 phone:h-11 phone:text-[1rem]"
      >
        <SearchIcon className={ic} />
        <span className="min-w-0 truncate">Search or jump to</span>
        {device !== 'phone' ? <kbd className="ml-auto font-sans text-[0.6875rem] text-fg3">{shortcut(MOD, 'K')}</kbd> : null}
      </button>
    </div>
  )
}

function SideFoot({ drawer }: { drawer?: boolean }) {
  // a phone opens its list of sections; a wider screen the first, beside that list
  const phone = useUI((u) => u.device === 'phone')
  const settings = () => setUI({ settings: { section: phone ? null : 0 }, drawer: false })
  // pinned to the bottom under a thin line, over the rows scrolling behind it, and lifted clear of the phone's home bar
  // (wider, the frame keeps clear of it already)
  return (
    <div
      className={clsx(
        'sticky bottom-0 z-2 mt-auto flex border-t border-line bg-well px-1.5 pt-1.5 phone:px-2 phone:pt-2',
        drawer ? 'pb-2 phone:pb-[max(env(safe-area-inset-bottom),--spacing(2))]' : 'pb-1.5',
      )}
    >
      <FootButton onClick={settings} className="flex-1">
        <CogIcon className="size-4 shrink-0 text-fg3 coarse:text-fg2 phone:size-5 phone:text-fg2" />
        Settings
      </FootButton>
    </div>
  )
}

export function Sidebar() {
  const P = registry.views.places
  return (
    <PlacesColumn>
      <Brand />
      <SearchBox />
      {P ? <P /> : null}
      <SideFoot />
    </PlacesColumn>
  )
}

/** The places drawer (phone and tablet): out from the left edge or across the place's chat, back with a swipe left */
export function Drawer() {
  const open = useUI((u) => u.drawer)
  const phone = useUI((u) => u.device === 'phone')
  // a swipe opens it only while nothing is over the place (a menu, a sheet, settings; a task, on a phone)
  const can = useUI(
    (u) => !u.settings && !u.menu && !u.taskMenu && !u.plus && !u.pick && !u.search && !u.viewer && !u.photo && !u.adding && !(phone && (u.task || u.sheet)),
  )
  const P = registry.views.places
  return (
    <SlideDrawer
      open={open}
      onOpen={(drawer) => setUI({ drawer })}
      can={can}
      label="Places"
      panel={phone ? 'w-[84%] pt-[env(safe-area-inset-top)]' : 'w-[320px]'}
    >
      <Brand />
      <SearchBox />
      {P ? <P /> : null}
      <SideFoot drawer />
    </SlideDrawer>
  )
}

export function MenuButton() {
  const device = useUI((u) => u.device)
  const docked = useStore((s) => placesDocked(s.ui, s.snap))
  if (docked) return null
  return device === 'phone' ? (
    <RoundButton label="Places" onClick={() => setUI({ drawer: true })}>
      <MenuIcon className={ic} />
    </RoundButton>
  ) : (
    <IconButton label="Places" onClick={() => setUI({ drawer: true })}>
      <MenuIcon className={ic} />
    </IconButton>
  )
}

/** The coordinator chat's top-right menu: plugins fill its sections (mode, search, terminal), a thin line between them */
export function PlaceMenu({ place, pane }: { place: Place; pane?: number }) {
  const phone = useUI((u) => u.device === 'phone')
  const term = useUI((u) => u.term === place.chat)
  const arts = useUI((u) => u.arts === place.chat)
  // split, it opens in the focused pane: a click in a pane focuses it first
  const menu = useUI((u) => u.menu && (pane === undefined || u.split.pane === pane))
  if (!registry.placeMenu.length) return null
  const B = phone ? RoundButton : IconButton
  return (
    <div className="relative">
      <B
        label={term ? 'Menu, terminal open' : arts ? 'Menu, artifacts open' : 'Menu'}
        aria-haspopup="menu"
        aria-expanded={menu}
        className={clsx(
          'rounded-full!',
          phone ? 'aria-expanded:bg-line2' : 'aria-expanded:bg-hover',
          (term || arts) && (phone ? 'bg-fg! text-bg!' : 'bg-sel text-fg'),
        )}
        onClick={() => setUI({ menu: !menu, plus: null, pick: null })}
      >
        <MoreIcon className={ic} />
      </B>
      {menu ? (
        <Menu
          label="Menu"
          tabs
          onClose={() => setUI({ menu: false })}
          className="absolute top-full right-0 z-21 mt-1.5 max-w-[calc(100vw-24px)] origin-top-right"
        >
          {registry.placeMenu.map(({ View, joined }, i) => (
            <Fragment key={i}>
              {i && !joined ? <MenuSeparator /> : null}
              <View place={place} />
            </Fragment>
          ))}
        </Menu>
      ) : null}
    </div>
  )
}

/** What plugins put beside a coordinator's menu, or on a phone after its subtitle (its mode) */
export function PlaceMarks({ place }: { place: Place }) {
  return registry.placeMark.length ? registry.placeMark.map(({ View }, i) => <View key={i} place={place} />) : null
}

/** A pane's own buttons, at the end of its header: the only one, and close */
export function PaneButtons({ i }: { i: number }) {
  const many = useUI((u) => u.split.panes.length > 1)
  return (
    <div className="flex shrink-0 items-center gap-1">
      {many ? (
        <IconButton label="Make it the only one" onClick={() => onlyPane(i)}>
          <FitIcon className={ic} />
        </IconButton>
      ) : null}
      <IconButton label="Close pane" onClick={() => closePane(i)}>
        <XIcon className={ic} />
      </IconButton>
    </div>
  )
}

export function unreachable(p: Place, snap: Snapshot) {
  const m = machineName(snap.machines, p.machine)
  // just after Shepherdr started (an update): what it showed last, calmly
  if (p.connecting) return `Connecting to ${m}… Showing what it said last; messages wait until it is back.`
  if (p.herdrDown) return `herdr isn't answering on ${m} since ${p.herdrDown}, so its agents can't hear anything. Messages wait until it is back.`
  return p.status === 'off' && p.unreachableSince
    ? `Can't reach ${m} since ${p.unreachableSince}. Showing what it said last; messages wait until it is back.`
    : undefined
}

/** The coordinator chat in the middle; a container (named place) so its header can fit what it shows to its width */
export function PlaceColumn({ place, pane }: { place: Place; pane?: number }) {
  const snap = useSnap()!
  const Chat = registry.views.chat
  return (
    <section data-drawer-from className="@container/place flex min-h-0 min-w-0 flex-1 flex-col">
      <Head conversation>
        <MenuButton />
        {pane ? null : <PlacesToggle when="closed" />}
        <Who
          name={
            <>
              <PlaceIcon level={2} className="mr-1.5 inline-block align-[-2px] text-fg2" />
              {place.name}
            </>
          }
          kind={placeKind(snap, place)}
        />
        {registry.placeHeader.map(({ View }, i) => (
          <View key={i} place={place} />
        ))}
        <PlaceMarks place={place} />
        <PlaceMenu place={place} pane={pane} />
        {pane === undefined ? null : <PaneButtons i={pane} />}
      </Head>
      {Chat ? <Chat chatKey={place.chat} placeholder={`Message ${place.name}…`} unreachable={unreachable(place, snap)} /> : null}
    </section>
  )
}

export function agentPlaceholder(t: Task, finished: boolean | undefined) {
  return finished ? `Write to resume ${t.id}…` : `Message ${t.id}…`
}

/** Task requests in the panel’s scope, excluding coordinator requests. */
export function TaskAttention() {
  const snap = useSnap()!
  const view = useStore((s) => listView(s.ui, snap))
  const ids = snap.places.filter((p) => !view.chips.length || view.chips.includes(p.id) || view.chips.includes(`m:${p.machine}`)).map((p) => p.id)
  const c = attentionCounts(
    { ...snap, asks: {}, attentionRequests: { ...snap.attentionRequests, ...Object.fromEntries(snap.places.map((p) => [p.chat, []])) } },
    ids,
  )
  return <AttentionBadge need={c.need} ready={c.ready} scope="panel scope" />
}

/** Locks the lists' filters while switching spaces; the stored pin behaviour stays compatible. */
export function PinButton() {
  const pinned = useStore((s) => listsPinned(s.ui, s.snap!))
  const phone = useUI((u) => u.device === 'phone')
  const name = pinned ? 'Locked' : 'Lock'
  const label = pinned ? 'Locked: unlock filters to follow the space picked' : 'Lock filters: keep them when switching spaces'
  if (phone)
    return (
      <RoundButton label={label} pressed={pinned} onClick={togglePin}>
        <LockIcon className={ic} />
      </RoundButton>
    )
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pinned}
      title={label}
      onClick={togglePin}
      className={clsx(
        'press-dim inline-flex h-7 max-w-40 min-w-7 shrink items-center justify-center gap-1.5 rounded-full px-2 text-[0.8125rem] text-fg coarse:h-9 @sm/side:pr-2.5',
        pinned && 'bg-sel',
      )}
    >
      <LockIcon className={ic} />
      {/* a narrow column has room for the lock alone */}
      <span className="truncate @max-sm/side:hidden">{name}</span>
    </button>
  )
}

/** the place the lists show, and the view its chips hold */
export function useListView(snap: Snapshot) {
  const place = placeOf(
    snap,
    useUI((u) => u.place),
  )
  const view = useStore((s) => listView(s.ui, snap))
  return { place, view }
}

/** The lists' tasks, or their artifacts: what their chips hold */
export function SideList({ snap }: { snap: Snapshot }) {
  const { place, view } = useListView(snap)
  const shown = useUI((u) => u.side)
  const Tasks = registry.views.tasks
  const TasksMenu = registry.views.tasksMenu
  const Artifacts = registry.views.artifacts
  const side = Artifacts ? shown : 'tasks'
  return (
    <section className="@container/side flex min-h-0 min-w-0 flex-1 flex-col border-l border-line" aria-label={side === 'tasks' ? 'Tasks' : 'Artifacts'}>
      <Head>
        {/* Tasks | Artifacts as segmented tabs, so which one shows is plain; the chat beside it already names the place.
            What waits on you is counted on the Tasks tab itself, whichever tab shows, so the count never moves */}
        {Artifacts ? (
          <div className="flex flex-1 items-center">
            <Tabs label="Show">
              {(
                [
                  ['tasks', 'Tasks'],
                  ['artifacts', 'Artifacts'],
                ] as const
              ).map(([k, l]) => (
                <Tab key={k} on={side === k} onClick={() => setUI({ side: k })}>
                  {l}
                  {k === 'tasks' ? <TaskAttention /> : null}
                </Tab>
              ))}
            </Tabs>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <h2 className="min-w-0 truncate font-semibold">Tasks</h2>
            <TaskAttention />
          </div>
        )}
        <PinButton />
        {side === 'tasks' && TasksMenu ? <TasksMenu key={view.key} place={place} /> : null}
      </Head>
      <div className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain">
        {side === 'artifacts' && Artifacts ? <Artifacts placeId={place.id} /> : Tasks ? <Tasks placeId={place.id} /> : null}
      </div>
    </section>
  )
}

/** chats manage their own scrolling (messages scroll, composer stays); other bodies scroll as a whole */
export function Scroll({ chat, children }: { chat: boolean; children: ReactNode }) {
  return chat ? (
    <div className="flex min-h-0 flex-1 flex-col">{children}</div>
  ) : (
    <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain">{children}</div>
  )
}
