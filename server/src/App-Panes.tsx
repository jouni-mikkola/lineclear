import clsx from 'clsx'
import { Fragment, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type RefObject } from 'react'
import {
  focusPane,
  openArtifact,
  panesHere,
  placesDocked,
  sizePanes,
  focusHere,
  getState,
  useStore,
  placeKind,
  chipName,
  listsPinned,
  panelHere,
  placeOf,
  registry,
  setUI,
  taskInMiddle,
  taskOf,
  useSnap,
  useUI,
  type Pane,
} from './kernel.ts'
import { PANE_MIN } from './panes.ts'
import { ChatColumn, Frame, PanelColumn, PlacesToggle } from './Frame.tsx'
import { FocusToggle, PanelToggle, TaskMenu, TaskPanel } from './Panel.tsx'
import { Stack } from './Stack.tsx'
import type { Place, Snapshot, Task } from '@shared/types.ts'
import { useListView } from './App-Sidebar.tsx'
import {
  BackIcon,
  ChatIcon,
  OpenIcon,
  Dot,
  Empty,
  Head,
  IconButton,
  PageIcon,
  PhoneTop,
  PlaceIcon,
  RoundButton,
  SearchIcon,
  TasksIcon,
  ReportLine,
  Who,
  ic,
} from './ui.tsx'
import {
  agentPlaceholder,
  Scroll,
  MenuButton,
  PaneButtons,
  SideList,
  TaskAttention,
  PlaceColumn,
  Sidebar,
  Drawer,
  PlaceMarks,
  PlaceMenu,
  PinButton,
  unreachable,
} from './App-Sidebar.tsx'

/** An open task is its one agent's chat; until its agent starts there is no chat yet. In the middle (the lists pinned),
 *  it has what the place's chat there has to bring places back. */
export function TaskPage({ task, middle, pane }: { task: Task; middle?: boolean; pane?: number }) {
  const snap = useSnap()!
  const g = task.agent ?? null
  const Chat = registry.views.chat
  const finished = useStore((s) => s.chats[g?.chat ?? '']?.finished)
  const back = () => setUI({ task: null })
  const phone = useUI((u) => u.device === 'phone')
  const desktop = useUI((u) => u.device === 'desktop')
  const keyboard = useUI((u) => u.keyboard)
  const coordinator = placeOf(snap, task.place).name
  const target = task.base ? (
    <div className="shrink-0 truncate border-b border-line px-4 py-1 text-xs text-fg3" title={`Merges into ${task.base}`}>
      Merges into <span className="font-medium text-fg2">{task.base}</span>
    </div>
  ) : null
  // in focus it sits at the window's edge: no line there
  const focus = useStore((s) => focusHere(s.ui, s.snap))
  // split, a click on the open task on the right gives it the focus (the keys work on its chat)
  const split = useUI((u) => panesHere(u).length > 0)
  const body = g ? (
    Chat ? (
      <Chat chatKey={g.chat} placeholder={agentPlaceholder(task, g.status === 'done' || finished)} />
    ) : null
  ) : (
    <Empty>
      {task.status === 'todo' || task.status === 'work' || task.status === 'queued'
        ? `${task.id} is starting: its chat opens here in a moment.`
        : `${task.id}'s agent didn't start: its chat opens here once it does. Ask ${coordinator} about it.`}
    </Empty>
  )
  if (phone)
    return (
      <section className="flex min-h-0 flex-1 flex-col">
        <PhoneTop
          left={
            <RoundButton label="Back" onClick={back}>
              <BackIcon className={ic} />
            </RoundButton>
          }
          dot={task.status}
          p={task.report?.progress}
          name={task.name}
          expandName
          kind={g ? `${task.id} · ${g.cli}` : task.id}
          right={
            g ? (
              <>
                {registry.agentHeader.map(({ View: B }, i) => (
                  <B key={i} chatKey={g.chat} />
                ))}
                <TaskMenu task={task} chatKey={g.chat} />
              </>
            ) : null
          }
          report={task.report}
        />
        {target}
        {/* no bar under a task's chat: the message box keeps clear of the home indicator itself */}
        <div className={clsx('flex min-h-0 flex-1 flex-col', !keyboard && 'pb-[env(safe-area-inset-bottom)]')}>
          <Scroll chat={!!g}>{body}</Scroll>
        </div>
      </section>
    )
  if (pane !== undefined)
    return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Head conversation>
          {pane ? null : (
            <>
              <MenuButton />
              <PlacesToggle when="closed" />
            </>
          )}
          <Dot s={task.status} p={task.report?.progress} halo />
          <Who
            name={task.name}
            kind={
              task.report ? (
                <span className="flex min-w-0 gap-1">
                  {task.id} ·<ReportLine w={task.report} head />
                </span>
              ) : (
                `${task.id} · ${coordinator}`
              )
            }
          />
          <div className="flex shrink-0 items-center gap-1">
            {g ? registry.agentHeader.map(({ View: B }, i) => <B key={i} chatKey={g.chat} />) : null}
            {g ? <TaskMenu task={task} chatKey={g.chat} pane={pane} /> : null}
            <PaneButtons i={pane} />
          </div>
        </Head>
        {target}
        <Scroll chat={!!g}>{body}</Scroll>
      </section>
    )
  return (
    <section
      data-drawer-from={middle || undefined}
      onPointerDownCapture={split && !middle ? () => focusPane(-1) : undefined}
      onFocusCapture={split && !middle ? () => focusPane(-1) : undefined}
      className={clsx('flex min-h-0 min-w-0 flex-1 flex-col border-line', !focus && !middle && 'border-l')}
    >
      <Head conversation>
        {middle ? (
          <>
            <MenuButton />
            <PlacesToggle when="closed" />
          </>
        ) : null}
        <IconButton label="Back" onClick={back}>
          <BackIcon className={ic} />
        </IconButton>
        <Dot s={task.status} p={task.report?.progress} halo />
        {/* its name leads, the words a narrow column has room for; its id starts the line under it */}
        <Who
          name={task.name}
          kind={
            task.report ? (
              <span className="flex min-w-0 gap-1">
                {task.id} ·<ReportLine w={task.report} head />
              </span>
            ) : (
              `${task.id} · ${g ? `${g.cli} · ${coordinator}` : coordinator}`
            )
          }
        />
        {/* its buttons close together, as a toolbar's, so the name keeps the room */}
        <div className="flex shrink-0 items-center gap-1">
          {g ? registry.agentHeader.map(({ View: B }, i) => <B key={i} chatKey={g.chat} />) : null}
          {/* the layout's toggles side by side, as VS Code has them: the chat to the left, the panel to the right */}
          <FocusToggle task={task} />
          {g && desktop ? <PanelToggle /> : null}
          {g ? <TaskMenu task={task} chatKey={g.chat} /> : null}
        </div>
      </Head>
      {target}
      <Scroll chat={!!g}>{body}</Scroll>
    </section>
  )
}

/** The right-hand column: a place's tasks or its artifacts, and the open task's agent chat pushed over them (pinned,
 *  the task opens in the middle instead and the list stays) */
function TaskColumn({ snap }: { snap: Snapshot }) {
  const open = taskOf(
    snap,
    useUI((u) => u.task),
  )
  const middle = useStore((s) => taskInMiddle(s.ui, s.snap))
  const task = middle ? null : open
  return <Stack base={<SideList snap={snap} />} top={task ? <TaskPage task={task} /> : null} topKey={task?.id ?? null} onBack={() => setUI({ task: null })} />
}

/**
 * Between two panes: invisible until the pointer finds it, then a thin line, as the sidebars' edges are. Drag it to
 * share their width out again (each keeps PANE_MIN), double-click to share it evenly, or focus it and use the arrow
 * keys. While dragging, the shares go straight onto the panes and reach the store once, on letting go.
 */
function Divider({ at, box }: { at: number; box: RefObject<HTMLDivElement | null> }) {
  const drag = useRef<{ x: number; sizes: number[]; next: number[]; px: number } | null>(null)
  const sizes = () => getState().ui.split.sizes
  const els = () => [...(box.current?.querySelectorAll<HTMLElement>(':scope > [data-pane]') ?? [])]
  /** the two panes beside it shared out again, `dx` pixels moved */
  const moved = (from: number[], dx: number, px: number) => {
    const total = from.reduce((a, b) => a + b, 0)
    const pair = from[at - 1] + from[at]
    const unit = total / px
    const min = Math.min(PANE_MIN * unit, pair / 2)
    const left = Math.max(min, Math.min(pair - min, from[at - 1] + dx * unit))
    return from.map((s, j) => (j === at - 1 ? left : j === at ? pair - left : s))
  }
  const draw = (next: number[]) => els().forEach((el, j) => (el.style.flexGrow = String(next[j])))
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const px = els().reduce((a, el) => a + el.getBoundingClientRect().width, 0)
    drag.current = { x: e.clientX, sizes: sizes(), next: sizes(), px }
    e.currentTarget.dataset.dragging = ''
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    d.next = moved(d.sizes, e.clientX - d.x, d.px)
    draw(d.next)
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    delete e.currentTarget.dataset.dragging
    sizePanes(d.next)
  }
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? 64 : 16) * (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0)
    if (!step) return
    e.preventDefault()
    e.stopPropagation()
    const px = els().reduce((a, el) => a + el.getBoundingClientRect().width, 0)
    sizePanes(moved(sizes(), step, px))
  }
  return (
    <div className="relative z-4 w-0 shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => sizePanes(sizes().map(() => 1))}
        onKeyDown={key}
        className="group absolute inset-y-0 -left-1 flex w-2 cursor-col-resize touch-none justify-center focus-visible:outline-none"
      >
        <span className="w-0.5 bg-fg3 not-group-hover:not-group-focus-visible:not-group-data-dragging:opacity-0" />
      </div>
    </div>
  )
}

/** a space's tasks in a pane */
function TasksPane({ place, i }: { place: Place; i: number }) {
  const snap = useSnap()!
  const Tasks = registry.views.tasks
  const TasksMenu = registry.views.tasksMenu
  return (
    <section aria-label={`Tasks of ${place.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Head>
        {i ? null : <PlacesToggle when="closed" />}
        <TasksIcon className={clsx(ic, 'text-fg2')} />
        <Who
          name={
            <span className="flex items-center gap-1.5">
              Tasks
              <TaskAttention />
            </span>
          }
          kind={placeKind(snap, place) ? `${place.name} · ${placeKind(snap, place)}` : place.name}
        />
        {TasksMenu ? <TasksMenu key={place.id} place={place} /> : null}
        <PaneButtons i={i} />
      </Head>
      <div className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain">{Tasks ? <Tasks placeId={place.id} /> : null}</div>
    </section>
  )
}

function GonePane({ i, what }: { i: number; what: string }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Head>
        <div className="flex-1" />
        <PaneButtons i={i} />
      </Head>
      <Empty>{what}</Empty>
    </section>
  )
}

/** an artifact in a pane, at its latest */
function ArtifactPane({ id, i }: { id: string; i: number }) {
  const snap = useSnap()!
  const art = snap.artifacts?.find((a) => a.id === id)
  const View = registry.views.artifact
  if (!art) return <GonePane i={i} what="This artifact is gone." />
  return (
    <section aria-label={art.title} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Head>
        {i ? null : <PlacesToggle when="closed" />}
        <PageIcon className={clsx(ic, 'text-fg2')} />
        <Who name={art.title} kind={`${placeOf(snap, art.place).name} · v${art.v} · ${art.when}`} />
        <IconButton label="Open full screen" onClick={() => openArtifact(art.id)}>
          <OpenIcon className={ic} />
        </IconButton>
        <PaneButtons i={i} />
      </Head>
      <div className="relative min-h-0 flex-1">{View ? <View artifactId={art.id} /> : null}</div>
    </section>
  )
}

function PaneView({ snap, p, i }: { snap: Snapshot; p: Pane; i: number }) {
  if (p.kind === 'place') return <PlaceColumn place={placeOf(snap, p.id)} pane={i} />
  if (p.kind === 'tasks') return <TasksPane place={placeOf(snap, p.id)} i={i} />
  if (p.kind === 'artifact') return <ArtifactPane id={p.id} i={i} />
  const task = taskOf(snap, p.id)
  return task ? <TaskPage key={task.id} task={task} pane={i} /> : <GonePane i={i} what={`${p.id} is gone.`} />
}

/* ---------- split view (panes.ts) ---------- */

/** The panes side by side, a divider between each two; the focused one marked while there are more */
function Split({ snap, panes }: { snap: Snapshot; panes: Pane[] }) {
  const sizes = useUI((u) => u.split.sizes)
  const focused = useUI((u) => u.split.pane)
  const box = useRef<HTMLDivElement>(null)
  return (
    // a window narrowed after they opened: each keeps a readable width, and they scroll sideways
    <div ref={box} className="flex min-h-0 min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
      {panes.map((p, i) => (
        <Fragment key={`${p.kind}:${p.id}`}>
          {i ? <Divider at={i} box={box} /> : null}
          <div
            data-pane={i}
            data-focused={panes.length > 1 && focused === i ? '' : undefined}
            style={{ flexGrow: sizes[i] ?? 1 }}
            // a click or the focus going in gives it the focus: the sidebar, the lists and the keys follow it
            onPointerDownCapture={() => focusPane(i)}
            onFocusCapture={() => focusPane(i)}
            className={clsx(
              'relative flex min-w-[280px] basis-0 flex-col',
              i && 'border-l border-line',
              // the focused one: a thin line along its top, as a focused editor's tab has
              'after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:z-3 after:h-0.5 after:bg-accent not-data-focused:after:hidden',
            )}
          >
            <PaneView snap={snap} p={p} i={i} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}

/** The middle: the place's chat, or with the lists pinned the open task's */
function Middle({ snap }: { snap: Snapshot }) {
  const place = placeOf(
    snap,
    useUI((u) => u.place),
  )
  const task = useStore((s) => (taskInMiddle(s.ui, s.snap) ? taskOf(snap, s.ui.task) : null))
  const panes = useUI(panesHere)
  return (
    <ChatColumn>
      {panes.length ? <Split snap={snap} panes={panes} /> : task ? <TaskPage key={task.id} task={task} middle /> : <PlaceColumn place={place} />}
    </ChatColumn>
  )
}

export function WideLayout({ snap }: { snap: Snapshot }) {
  const settings = useUI((u) => !!u.settings)
  const desktop = useUI((u) => u.device === 'desktop')
  const docked = useStore((s) => placesDocked(s.ui, s.snap))
  // the open task whose side panel has a column here
  const panel = useUI((u) => (panelHere(u, snap) ? u.task : null))
  const Settings = registry.views.settings
  if (settings && Settings && desktop)
    return (
      <Frame places>
        <Sidebar />
        <Settings />
        {!docked ? <Drawer /> : null}
      </Frame>
    )
  if (desktop) {
    const task = panel ? taskOf(snap, panel) : null
    return (
      <Frame places tasks panel={!!task}>
        <Sidebar />
        <Middle snap={snap} />
        <TaskColumn snap={snap} />
        {!docked ? <Drawer /> : null}
        {task ? (
          <PanelColumn>
            <TaskPanel task={task} />
          </PanelColumn>
        ) : null}
      </Frame>
    )
  }
  // a tablet: settings push over the chat and its tasks
  return (
    <Stack
      base={
        <Frame tasks>
          <Middle snap={snap} />
          <TaskColumn snap={snap} />
          <Drawer />
        </Frame>
      }
      top={settings && Settings ? <Settings /> : null}
      topKey={settings ? 'settings' : null}
      onBack={() => setUI({ settings: null })}
    />
  )
}

/** Chat | Tasks | Artifacts and Search at the bottom of the phone */
function PhoneBar() {
  const tab = useUI((u) => u.tab)
  return (
    <div className="flex shrink-0 gap-2 px-4 pt-1 pb-[max(env(safe-area-inset-bottom),--spacing(4))]">
      {/* each tab as wide as its words and the rest shared out, so Tasks with its count gets the room it needs and the
          count never crowds the next tab */}
      <div role="group" aria-label="View" className="flex flex-1 rounded-full bg-bubble p-1">
        {(
          [
            ['chat', 'Chat', ChatIcon],
            ['tasks', 'Tasks', TasksIcon],
            ...(registry.views.artifacts ? [['artifacts', 'Artifacts', PageIcon] as const] : []),
          ] as const
        ).map(([k, l, Icon]) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            onClick={() => setUI({ tab: k, pick: null, plus: null, menu: false })}
            className="relative flex h-12 min-w-0 flex-auto items-center justify-center gap-1.5 rounded-full text-[0.875rem] whitespace-nowrap text-fg2 aria-pressed:bg-seg-on aria-pressed:text-fg aria-pressed:shadow-seg"
          >
            {/* a phone in Display Zoom (320px) has room for the words only */}
            <Icon className={clsx(ic, 'max-[359px]:hidden')} />
            {l}
            {k === 'tasks' ? <TaskAttention /> : null}
          </button>
        ))}
      </div>
      <RoundButton label="Search" className="size-14" onClick={() => setUI({ search: true, searchScope: undefined })}>
        <SearchIcon className={ic} />
      </RoundButton>
    </div>
  )
}

/** The place: its chat, tasks or artifacts, the bar to switch them, and the drawer a swipe right opens */
export function PhoneHome({ snap }: { snap: Snapshot }) {
  const { place, view } = useListView(snap)
  // Tasks and Artifacts show what their chips hold: pinned, the top bar says so and names them
  const pinned = useStore((s) => listsPinned(s.ui, snap))
  const tab = useUI((u) => u.tab)
  const keyboard = useUI((u) => u.keyboard)
  const Chat = registry.views.chat
  const Tasks = registry.views.tasks
  const TasksMenu = registry.views.tasksMenu
  const Artifacts = registry.views.artifacts
  const lists = tab !== 'chat' && pinned
  return (
    <div data-drawer-from className="relative flex min-h-0 flex-1 flex-col">
      <PhoneTop
        left={<MenuButton />}
        name={
          lists ? (view.chips.length ? chipName(snap, view.chips[0]) + (view.chips.length > 1 ? ` +${view.chips.length - 1}` : '') : 'Everything') : place.name
        }
        icon={<PlaceIcon level={2} className="text-fg2" />}
        kind={lists ? 'Locked' : placeKind(snap, place)}
        mark={tab === 'chat' ? <PlaceMarks place={place} /> : undefined}
        right={
          tab === 'chat' ? (
            <>
              {registry.placeHeader.map(({ View }, i) => (
                <View key={i} place={place} />
              ))}
              <PlaceMenu place={place} />
            </>
          ) : (
            <>
              <PinButton />
              {tab === 'tasks' && TasksMenu ? <TasksMenu key={view.key} place={place} /> : null}
            </>
          )
        }
      />
      {tab === 'chat' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {Chat ? <Chat chatKey={place.chat} placeholder={`Message ${place.name}…`} unreachable={unreachable(place, snap)} /> : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain">
          {tab === 'artifacts' && Artifacts ? <Artifacts placeId={place.id} /> : Tasks ? <Tasks placeId={place.id} /> : null}
        </div>
      )}
      {/* the keyboard is up: the message box sits right on it, so more of the chat shows */}
      {keyboard ? null : <PhoneBar />}
      <Drawer />
    </div>
  )
}
