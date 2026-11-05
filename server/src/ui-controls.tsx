import clsx from 'clsx'
import { Fragment, useEffect, useLayoutEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type Ref, type RefObject } from 'react'
import { ChevronUpDownIcon } from '@heroicons/react/16/solid'
import type { Task, Report } from '@shared/types.ts'
import { useMotion } from './motion.ts'
import { reportEnd, dimmed, ic } from './ui-icons.tsx'

/**
 * What the agent is doing right now; in a header, its minutes left quietly at the end, the words giving way first so
 * the minutes never get cut off. While it waits on you, all of it frozen and quiet (no pause mark: Pause is the menu's
 * own action). `head` is a chat header's wording; on
 * a phone (`wrap`) the line flows centred, the minutes kept whole after the words: two lines at most for the
 * status line's 40 characters, and never more than three.
 */
export function ReportLine({ w, head = false, wrap = false }: { w: Report; head?: boolean; wrap?: boolean }) {
  const end = reportEnd(w, head, head && !wrap)
  const tail = end ? (
    <span className="whitespace-nowrap text-fg3 tabular-nums">
      {wrap ? ' ' : ''}· {end}
    </span>
  ) : null
  if (wrap)
    return (
      <span className={clsx('line-clamp-3 text-balance', w.paused && 'text-fg3')}>
        {w.msg}
        {tail}
      </span>
    )
  return (
    <span className={clsx('flex min-w-0 items-center gap-1', w.paused && 'text-fg3')}>
      <span className="truncate">{w.msg}</span>
      {tail ? <span className="shrink-0">{tail}</span> : null}
    </span>
  )
}

/** the progress a task row shows: only while it works. Waiting on you, its row says what it asks instead */
const rowReport = (t: Task) => (t.status === 'work' ? t.report : undefined)

/**
 * A task row's one line under its title: working, its agent's status line; waiting on you, Ready or Done, what it asks,
 * waits for or did, cut short; To do, nothing (its sub is empty). Where the list doesn't say where the task is, it
 * starts with that (its machine, its project: "vm-str · gtm") in place of its pull request's number, which gives way
 * before the line it leads: at most half the width, cut short.
 */
export function taskLine(t: Task, where?: string[]): ReactNode {
  const w = rowReport(t)
  const line = w ? <ReportLine w={w} /> : t.sub
  // where it is leads, or else its pull request's number, small: the link itself is in its chat's header
  const parts = [...(where?.length ? where : t.pr ? [`PR #${t.pr.number}`] : []), ...(t.base ? [`→ ${t.base}`] : [])]
  const lead = parts.length ? (
    // alone (no line after it), it has the whole width: half of it cut the machine's short name ("vm-…")
    <span className={clsx('inline-flex min-w-0 shrink-0 align-bottom text-fg3', line ? 'max-w-1/2' : 'max-w-full')}>
      {parts.map((x, i) => (
        <Fragment key={i}>
          {i ? <span className="shrink-0 whitespace-pre"> · </span> : null}
          {/* the machine's name (short) stays whole as long as it can; the project gives way first */}
          <span
            className={!where?.length ? 'shrink-0 tabular-nums' : i < parts.length - 1 ? clsx('shrink-0 truncate', line && 'max-w-1/2') : 'min-w-0 truncate'}
          >
            {x}
          </span>
        </Fragment>
      ))}
      {line ? <span className="shrink-0 whitespace-pre"> · </span> : null}
    </span>
  ) : null
  if (lead && w)
    return (
      <span className="flex min-w-0">
        {lead}
        {line}
      </span>
    )
  return lead || line ? (
    <>
      {lead}
      {line}
    </>
  ) : null
}

export function Count({ n, className, label }: { n: number; className?: string; label?: string }) {
  if (!n) return null
  return (
    <span
      aria-label={label}
      className={clsx(
        'inline-grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-need px-[5px] text-[0.6875rem] font-semibold text-white tabular-nums phone:h-[22px] phone:min-w-[22px] phone:text-[0.8125rem]',
        className,
      )}
    >
      {/* trimmed to the digits' own height (cap to baseline), so the grid centres the ink, not the line with its
          room for descenders below, which sat the digit a pixel low */}
      <span className="[text-box:trim-both_cap_alphabetic]">{n}</span>
    </span>
  )
}

/** One notification, with separate counts: needs you on the left, ready on the right.
 * Cap each printed count independently; the accessible name always keeps the exact numbers. */
export function AttentionBadge({ need, ready, scope }: { need: number; ready: number; scope: string }) {
  if (!need && !ready) return null
  const split = need > 0 && ready > 0
  const label = `${need} needs you, ${ready} ready · ${scope}`
  const cap = (n: number) => (n > 9 ? '9+' : String(n))
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-attention-badge={split ? 'both' : need ? 'need' : 'ready'}
      className={clsx('attention-badge', split && 'attention-badge-split')}
    >
      {need > 0 ? (
        <span aria-hidden="true" className="attention-badge-need">
          {cap(need)}
        </span>
      ) : null}
      {ready > 0 ? (
        <span aria-hidden="true" className="attention-badge-ready">
          {cap(ready)}
        </span>
      ) : null}
    </span>
  )
}

export type Btn = ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }

type LabelledBtn = Btn & { label: string; pressed?: boolean }

function LabelledButton({ label, pressed, children, ...p }: LabelledBtn) {
  return (
    <button type="button" aria-label={label} aria-pressed={pressed} {...p}>
      {children}
    </button>
  )
}

/** 28px icon button (44px on a phone), with a finger-sized hit area */
export function IconButton({ className, ...p }: LabelledBtn) {
  return (
    <LabelledButton
      className={clsx(
        'hit press-dim inline-grid size-7 shrink-0 place-items-center rounded-full text-fg2 enabled:hover:bg-hover aria-pressed:bg-sel aria-pressed:text-fg phone:size-11',
        dimmed,
        className,
      )}
      {...p}
    />
  )
}

/** Phone header buttons: round, 44px */
export function RoundButton({ className, ...p }: LabelledBtn) {
  return (
    <LabelledButton
      className={clsx('press-dim grid size-11 shrink-0 place-items-center rounded-full bg-bubble text-fg2', p.pressed && 'bg-fg! text-bg!', className)}
      {...p}
    />
  )
}

/** Secondary button: 28px desktop, 36px phone */
export function Ghost({ className, children, ...p }: Btn) {
  return (
    <button
      type="button"
      className={clsx(
        'press-dim relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] whitespace-nowrap text-fg2 shadow-[inset_0_0_0_1px_var(--line2)] after:absolute after:-inset-x-0.5 after:-inset-y-2 enabled:hover:bg-hover disabled:cursor-default disabled:opacity-40 coarse:h-9 phone:h-9 phone:text-[0.875rem]',
        className,
      )}
      {...p}
    >
      {children}
    </button>
  )
}

/** The one filled button of a view (34px; 44px on a phone). soft: the same size, secondary look (inside cards). */
export function Primary({ className, children, soft, ...p }: Btn & { soft?: boolean }) {
  return (
    <button
      type="button"
      className={clsx(
        'press-dim relative inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full px-3.5 font-medium after:absolute after:-inset-1 disabled:cursor-default disabled:opacity-40 coarse:h-11 phone:h-11',
        soft ? 'bg-bg text-fg shadow-soft enabled:hover:bg-hover' : 'bg-fg text-bg focus-visible:outline-offset-2',
        className,
      )}
      {...p}
    >
      {children}
    </button>
  )
}

/** Segmented tabs */
export function Tabs({ className, children, label, ...p }: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return (
    <div role="group" aria-label={label} className={clsx('inline-flex shrink-0 gap-0.5 rounded-full bg-hover p-0.5', className)} {...p}>
      {children}
    </div>
  )
}

/** a segment; filling, it shares out the room its row has (a menu setting's choices), and on a narrow screen its words
 * end in … before the row runs out */
export function Tab({ on, fill, className, children, ...p }: Btn & { on: boolean; fill?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={clsx(
        'relative inline-flex h-7 items-center gap-1.5 rounded-full text-[0.8125rem] whitespace-nowrap text-fg2 after:absolute after:-inset-y-2 after:inset-x-0 disabled:cursor-default disabled:opacity-40 aria-pressed:bg-seg-on aria-pressed:text-fg aria-pressed:shadow-[0_0_0_1px_var(--line2)] coarse:h-9 phone:h-9 phone:text-[0.875rem]',
        fill ? 'min-w-0 grow justify-center px-2 phone:max-[359px]:text-[0.8125rem]' : 'shrink-0 px-2.5 phone:px-3.5',
        className,
      )}
      {...p}
    >
      {fill ? <span className="truncate">{children}</span> : children}
    </button>
  )
}

/** the click a press outside a popup ends with only closes it: it presses nothing under it (the popup's own button
 * would open it again). A press that turns into a scroll ends with none. */
function swallowClick() {
  let t: ReturnType<typeof setTimeout> | undefined
  const off = () => {
    clearTimeout(t)
    removeEventListener('click', eat, true)
    removeEventListener('pointerdown', off, true)
    removeEventListener('pointercancel', off, true)
    removeEventListener('pointerup', up, true)
  }
  const eat = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    off()
  }
  const up = () => (t = setTimeout(off, 500))
  addEventListener('click', eat, true)
  addEventListener('pointerdown', off, true)
  addEventListener('pointercancel', off, true)
  addEventListener('pointerup', up, true)
}

/**
 * What every popup (a menu, a ⋯, a picker, a popover) shares: a click or tap anywhere outside it closes it, and so does
 * a click into a frame (a terminal, an artifact, the browser), which the page itself never hears.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      swallowClick()
      close.current()
    }
    const blur = () => setTimeout(() => document.activeElement instanceof HTMLIFrameElement && close.current())
    addEventListener('pointerdown', down, true)
    addEventListener('blur', blur)
    return () => {
      removeEventListener('pointerdown', down, true)
      removeEventListener('blur', blur)
    }
  }, [ref])
}

/**
 * A dropdown menu: one surface (the shared popover corner and shadow) whose rows all line up. Arrow keys, Home and
 * End move between its rows, Escape or a click outside closes it (useDismiss); opened from the keyboard, its first row takes the focus, and the focus
 * goes back to what opened it when it closes. `tabs`: it holds settings as tabs too, so Tab walks on to them rather
 * than closing it. `select`: a select's menu, whose chosen row (checked) takes the focus rather than the first.
 */
export function Menu({
  label,
  onClose,
  tabs,
  select,
  className,
  children,
}: {
  label: string
  onClose: () => void
  tabs?: boolean
  select?: boolean
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // it springs out of its button and fades away
  useMotion(ref, 'menu')
  const close = useRef(onClose)
  close.current = onClose
  useDismiss(ref, onClose)
  useLayoutEffect(() => {
    const el = ref.current!
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const rows = () => [...el.querySelectorAll<HTMLElement>('[role^=menuitem]:not(:disabled)')]
    // opened from the keyboard, the first row takes the focus; a text field (always focus-visible) keeps it, so a tap on
    // + while typing leaves a phone's keyboard up
    if (opener?.matches(':focus-visible') && !opener.matches('input, textarea'))
      ((select && rows().find((r) => r.getAttribute('aria-checked') === 'true')) || rows()[0])?.focus({ preventScroll: true })
    const on = (e: KeyboardEvent) => {
      // a picker in it (a menu setting with many choices) takes its own arrow keys
      if (document.activeElement instanceof HTMLSelectElement && el.contains(document.activeElement) && e.key !== 'Escape' && e.key !== 'Tab') return
      const all = rows()
      const at = all.indexOf(document.activeElement as HTMLElement)
      const go = (i: number) => {
        e.preventDefault()
        e.stopImmediatePropagation()
        const row = all[(i + all.length) % all.length]
        row?.focus({ preventScroll: true })
        // a long menu (a setting's many choices) scrolls to it
        row?.scrollIntoView({ block: 'nearest' })
      }
      if (e.key === 'ArrowDown') go(at + 1)
      else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(-1)
      else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        close.current()
      } else if (e.key === 'Tab' && at >= 0 && !tabs) close.current()
    }
    // before the app's own keys, so Escape closes the menu and nothing behind it
    addEventListener('keydown', on, true)
    return () => {
      removeEventListener('keydown', on, true)
      if (el.contains(document.activeElement) && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  return (
    <div ref={ref} role="menu" aria-label={label} className={clsx('popover min-w-56 text-left', className)}>
      {children}
    </div>
  )
}

/** A menu's section name, over the rows' text */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-7 items-center pr-2 pl-8 text-[0.75rem] font-medium text-fg3 phone:h-9 phone:pr-3 phone:pl-10 phone:text-[0.8125rem]">
      {children}
    </div>
  )
}

/** A thin line between a menu's sections */
export function MenuSeparator() {
  return <div role="separator" className="mx-2 my-1 h-px bg-line phone:mx-3" />
}

export function Small({ children, className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('text-[0.75rem] text-fg2 phone:text-[0.8125rem]', className)} {...p}>
      {children}
    </div>
  )
}

/**
 * A setting in a menu, one row about as tall as the others (room for the track on a desktop): its icon where a row's icon goes, then its choices as segmented
 * tabs filling the rest. The name labels the tabs; a
 * choice's hint is said to screen readers. A note, when given, is one quiet line under the tabs. Too many choices for
 * tabs on a phone (a CLI's models, its effort levels) make it a row with its name and the choice it is on, which opens
 * the device's own picker.
 */
export function MenuSetting({
  name,
  icon,
  choices,
  note,
}: {
  name: string
  icon: ReactNode
  choices: { label: string; on: boolean; hint?: string; onClick: () => void }[]
  note?: string
}) {
  const long = choices.length > 3 || choices.reduce((n, c) => n + c.label.length, 0) > 24
  const on = Math.max(
    0,
    choices.findIndex((c) => c.on),
  )
  const row = long ? (
    <label className="press relative flex h-8 items-center gap-2 px-2 whitespace-nowrap hover:bg-hover has-focus-visible:bg-hover coarse:h-11 phone:h-11 phone:gap-3 phone:px-3">
      <span className="grid size-4 shrink-0 place-items-center text-fg2 max-[359px]:hidden">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="flex min-w-0 items-center gap-1 text-fg2">
        <span className="truncate">{choices[on]?.label}</span>
        <ChevronUpDownIcon className={clsx(ic, 'shrink-0')} />
      </span>
      {/* the device's own picker: a wheel on a phone, a list on a desktop; 16px, so a phone doesn't zoom in */}
      <select
        name={name}
        aria-label={name}
        value={on}
        onChange={(e) => choices[Number(e.target.value)]?.onClick()}
        className="absolute inset-0 size-full cursor-pointer appearance-none text-base opacity-0"
      >
        {choices.map((c, i) => (
          <option key={c.label} value={i}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  ) : (
    <div className="flex h-9 items-center gap-2 px-2 phone:h-11 phone:gap-3 phone:px-3">
      <span className="grid size-4 shrink-0 place-items-center text-fg2 max-[359px]:hidden">{icon}</span>
      <Tabs label={name} className="min-w-0 flex-1">
        {choices.map((c) => (
          <Tab key={c.label} fill on={c.on} aria-label={c.hint ? `${c.label}: ${c.hint}` : undefined} onClick={c.onClick}>
            {c.label}
          </Tab>
        ))}
      </Tabs>
    </div>
  )
  if (!note) return row
  return (
    <div className="flex flex-col">
      {row}
      <Small className="truncate pr-2 pb-1 pl-8 text-fg3! tabular-nums phone:pr-3 phone:pl-10 max-[359px]:pl-2">{note}</Small>
    </div>
  )
}

/**
 * A setting that is on or off, as a menu row like the others (its icon in their slot, its switch where their hints go),
 * red when on (the colour of what it turns on, as the header's pill), and the whole row flips it. A note, when given, is
 * one quiet line under it.
 */
export function MenuSwitch({ name, icon, on, note, onClick }: { name: string; icon: ReactNode; on: boolean; note?: string; onClick: () => void }) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        onClick={onClick}
        className="group row-pop press flex h-8 w-full items-center gap-2 px-2 text-left whitespace-nowrap hover:bg-hover focus-visible:bg-hover focus-visible:outline-offset-[-2px] coarse:h-11 phone:h-11 phone:gap-3 phone:px-3"
      >
        <span className="grid size-4 shrink-0 place-items-center text-fg2 max-[359px]:hidden">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {/* the track: grey off, red on; its knob slides across */}
        <span
          aria-hidden
          className="relative inline-flex w-9 shrink-0 rounded-full bg-line2 p-0.5 shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-200 ease-in-out group-aria-checked:bg-need group-aria-checked:shadow-none phone:w-11"
        >
          <span className="aspect-square w-1/2 rounded-full bg-white shadow-xs ring-1 ring-black/5 transition-transform duration-200 ease-in-out group-aria-checked:translate-x-full" />
        </span>
      </button>
      {note ? <Small className="truncate pr-2 pb-1 pl-8 text-fg3! tabular-nums phone:pr-3 phone:pl-10 max-[359px]:pl-2">{note}</Small> : null}
    </div>
  )
}
