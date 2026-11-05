import clsx from 'clsx'
import {
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/16/solid'
import type { Status, Report } from '@shared/types.ts'
import { type Btn, IconButton, ReportLine } from './ui-controls.tsx'
import { ic, Dot, field } from './ui-icons.tsx'

/**
 * A menu row (a menuitem unless given another role): an icon or check slot every row keeps, one line of text, and a
 * quiet hint or shortcut lined up on the right. 32px; 44px on a phone.
 */
export function MenuItem({ className, children, icon, hint, ...p }: Btn & { icon?: ReactNode; hint?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={clsx(
        'row-pop press flex h-8 w-full items-center gap-2 px-2 text-left whitespace-nowrap hover:bg-hover focus-visible:bg-hover focus-visible:outline-offset-[-2px] coarse:h-11 phone:h-11 phone:gap-3 phone:px-3',
        className,
      )}
      {...p}
    >
      <span className="grid size-4 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 pl-4 text-[0.75rem] text-fg3 phone:text-[0.875rem]">{hint}</span> : null}
    </button>
  )
}

/** a list row's look: Row's, and a row that holds buttons of its own (its name a button stretched over it). dense:
 *  a sidebar row, Slack's 28px of 15px text with a mouse */
export function rowClass(sel?: boolean, kb?: boolean, dense?: boolean) {
  return clsx(
    dense ? 'min-h-7 text-[0.9375rem]/5 phone:text-base/6' : 'min-h-8',
    'press relative flex cursor-pointer items-center gap-2 rounded-row px-2 text-fg hover:bg-hover focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] focus-visible:outline-none coarse:min-h-11 phone:min-h-12 phone:px-3',
    sel && 'bg-sel hover:bg-sel',
    kb && 'shadow-[inset_0_0_0_1.5px_var(--focus)]',
  )
}

/** A list row: places, tasks, agents */
export function Row({
  className,
  sel,
  kb,
  two,
  children,
  onActivate,
  ...p
}: HTMLAttributes<HTMLLIElement> & { sel?: boolean; kb?: boolean; two?: boolean; onActivate?: () => void }) {
  return (
    <li
      role="button"
      tabIndex={0}
      aria-current={sel || undefined}
      onClick={onActivate}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault()
          onActivate?.()
        }
      }}
      className={clsx(rowClass(sel, kb), two && 'items-start py-1.5 [&>.dot]:mt-[3px] phone:[&>.dot]:mt-1', className)}
      {...p}
    >
      {children}
    </li>
  )
}

export function List({ className, children }: { className?: string; children: ReactNode }) {
  return <ul className={clsx('px-1.5 phone:px-2', className)}>{children}</ul>
}

/** Row text: one line, cut short; an optional second line */
export function RowText({ children, sub, className }: { children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <span className={clsx('min-w-0 flex-1 truncate', className)}>
      {children}
      {sub ? <span className="mt-px block truncate text-xs/4 font-normal text-fg2 phone:text-sm/5">{sub}</span> : null}
    </span>
  )
}

export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('shrink-0 text-[0.75rem] text-fg3 tabular-nums phone:text-[0.8125rem]', className)}>{children}</span>
}

export function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('px-4 py-2 text-[0.8125rem] text-pretty text-fg2 phone:px-5 phone:text-[0.9375rem]', className)}>{children}</div>
}

/**
 * A list's filter: a slim field at its top that stays in view while the list scrolls. Esc clears it, and once empty
 * leaves it; onKey has the other keys first (the arrows, Enter).
 */
export function FilterBox({
  label,
  value,
  onChange,
  onKey,
  hint,
  children,
}: {
  label: string
  value: string
  onChange: (q: string) => void
  onKey?: (e: ReactKeyboardEvent<HTMLInputElement>) => void
  hint?: string
  /** under the box, staying with it (the lists' chips) */
  children?: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div data-filter className="sticky top-0 z-2 bg-bg px-1.5 pt-2 pb-0.5 phone:px-2 phone:pt-3">
      {/* the look of the sidebar's Search or jump to */}
      <div className="flex h-8 items-center gap-2 rounded-full bg-bg pr-0.5 pl-3 text-[0.8125rem] text-fg3 shadow-[inset_0_0_0_1px_var(--line2)] focus-within:shadow-[inset_0_0_0_1.5px_var(--focus)] coarse:h-11 phone:h-11 phone:text-[1rem]">
        <MagnifyingGlassIcon aria-hidden className={ic} />
        <input
          ref={input}
          name="filter"
          type="search"
          enterKeyHint="go"
          autoComplete="off"
          aria-label={label}
          placeholder={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            onKey?.(e)
            if (e.defaultPrevented || e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            if (value) onChange('')
            else input.current?.blur()
          }}
          className="peer h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg3 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {value ? (
          <IconButton
            label="Clear"
            className="size-7! coarse:size-10! phone:size-10!"
            onClick={() => {
              onChange('')
              input.current?.focus()
            }}
          >
            <XMarkIcon className={ic} />
          </IconButton>
        ) : hint ? (
          <kbd className="pr-2.5 font-sans text-[0.6875rem] text-fg3 peer-focus:invisible">{hint}</kbd>
        ) : null}
      </div>
      {children}
    </div>
  )
}

/** Column header: 52px with a hairline under it; its icon buttons are round, like its ⋯ */
export function Head({ children, className, conversation }: { children: ReactNode; className?: string; conversation?: boolean }) {
  return (
    <div
      data-chrome
      className={clsx(
        'relative flex min-h-[52px] shrink-0 items-center gap-2.5 border-b border-line pr-3 pl-4 [&_.hit]:rounded-full',
        conversation && 'px-0!',
        className,
      )}
    >
      {conversation ? (
        <div data-conversation-head className="mx-auto flex min-h-[51px] w-full max-w-read min-w-0 items-center gap-2.5 pr-3 pl-5 [&_.hit]:rounded-full">
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  )
}

/** A phone screen's top: round buttons either side, the title centred and as wide as the buttons leave room for; a
 *  mark after the subtitle */
export function PhoneTop({
  left,
  dot,
  icon,
  p,
  name,
  kind,
  mark,
  right,
  report,
  expandName,
}: {
  left?: ReactNode
  dot?: Status
  icon?: ReactNode
  p?: number
  name: string
  kind?: ReactNode
  mark?: ReactNode
  right?: ReactNode
  report?: Report
  expandName?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    // under a bar at the top (offline, a call) the notch is already kept clear
    <div
      data-kb
      data-chrome
      className={clsx(
        'relative grid shrink-0 items-center gap-2 border-b border-line px-3 pt-[calc(env(safe-area-inset-top)+6px)] pb-1.5 [[data-topbar]~*_&]:pt-1.5',
        expandName ? 'grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[1fr_minmax(0,auto)_1fr]',
      )}
    >
      <div className="flex gap-1">{left}</div>
      <div className="min-w-0 text-center">
        <div className="flex items-center justify-center gap-1.5 font-semibold">
          {dot ? <Dot s={dot} p={p} halo /> : null}
          {icon}
          {expandName ? (
            <button
              type="button"
              aria-label={`${expanded ? 'Collapse' : 'Show full'} task title: ${name}`}
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              className={clsx('min-w-0 text-left break-words', !expanded && 'line-clamp-2')}
            >
              {name}
            </button>
          ) : (
            <span className="truncate">{name}</span>
          )}
        </div>
        {mark && !report ? (
          // a mark (a coordinator's mode) ends the subtitle line, whole; the words before it give way first
          <div className="flex items-center justify-center gap-1.5 text-[0.8125rem]/[18px] text-fg2">
            <span className="min-w-0 truncate">{kind}</span>
            {mark}
          </div>
        ) : (
          <div className={clsx('text-[0.8125rem]/[18px] text-fg2', !report && 'truncate')}>
            {expandName ? kind : report ? <ReportLine w={report} head wrap /> : kind}
          </div>
        )}
        {expandName && report ? (
          <div className="text-[0.8125rem]/[18px] text-fg2">
            <ReportLine w={report} head wrap />
          </div>
        ) : null}
      </div>
      <div className="flex justify-end gap-1">{right}</div>
    </div>
  )
}

export function Who({ name, kind }: { name: ReactNode; kind?: ReactNode }) {
  return (
    // the title a step over the chat's 15px words, as Slack's channel name is
    <div className="min-w-0 flex-1">
      <div className="truncate text-base/5 font-semibold">{name}</div>
      {kind ? <div className="truncate text-[0.8125rem]/[18px] text-fg2 phone:text-sm/5">{kind}</div> : null}
    </div>
  )
}

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <kbd className="inline-flex gap-1 font-sans">
      {keys.map((k) => (
        <span
          key={k}
          className="inline-grid h-6 min-w-6 place-items-center rounded-md px-1.5 text-xs/none font-medium text-fg shadow-[inset_0_0_0_1px_var(--line2),0_1px_0_var(--line2)]"
        >
          {k}
        </span>
      ))}
    </kbd>
  )
}

export function Sent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('flex items-center gap-1.5 text-[0.8125rem] text-ready-fg phone:text-[0.9375rem]', className)}>{children}</div>
}

/** Ghost-style link button */
export function LinkButton({ className, children, ...p }: Btn) {
  return (
    <button
      type="button"
      className={clsx('relative font-medium text-focus after:absolute after:-inset-x-1 after:-inset-y-2.5 hover:underline', className)}
      {...p}
    >
      {children}
    </button>
  )
}

/** A sidebar footer button: shaped like a place's row, so it is as easy to tap and reads as part of the list */
export function FootButton({ className, children, ...p }: Btn) {
  return (
    <button
      type="button"
      className={clsx(
        'press flex min-h-8 items-center gap-2 rounded-row px-2 text-left text-fg2 hover:bg-hover hover:text-fg focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] focus-visible:outline-none coarse:min-h-11 coarse:text-fg phone:min-h-12 phone:text-fg phone:gap-3 phone:px-3',
        className,
      )}
      {...p}
    >
      {children}
    </button>
  )
}

/** A text box without a resize grip that grows with what you write (and with its placeholder) */
export function TextBox({
  label,
  onChange,
  className,
  ref: outer,
  ...p
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & { label: string; onChange: (v: string) => void; ref?: Ref<HTMLTextAreaElement> }) {
  const own = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = own.current
    if (!el) return
    el.style.height = 'auto'
    // an empty box is as tall as its placeholder
    if (!el.value && el.placeholder) {
      el.value = el.placeholder
      el.style.height = `${el.scrollHeight}px`
      el.value = ''
    } else el.style.height = `${el.scrollHeight}px`
  }, [p.value, p.placeholder])
  return (
    <textarea
      ref={(el) => {
        own.current = el
        if (typeof outer === 'function') outer(el)
        else if (outer) (outer as { current: HTMLTextAreaElement | null }).current = el
      }}
      rows={1}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={clsx('resize-none overflow-hidden', className)}
      {...p}
    />
  )
}

/** A secret's box: masked, never kept as a draft or offered for saving, and Enter saves. Its value lives only in the
 *  page's memory until it is sent */
export function SecretField({
  label,
  value,
  onChange,
  onEnter,
  className,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
  className?: string
  autoFocus?: boolean
}) {
  return (
    <input
      type="password"
      aria-label={label}
      placeholder="Paste or type it"
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && onEnter?.()}
      className={clsx(
        'min-h-10 w-full min-w-0 rounded-row bg-transparent px-3 py-[9px] font-mono placeholder:font-sans placeholder:text-fg3 coarse:min-h-11 phone:min-h-11 phone:text-[1rem]',
        field,
        className,
      )}
    />
  )
}

/** The numbered mark Mark up leaves on what you picked */
export function MarkBadge({ x, y }: { x: number; y: number }) {
  return (
    <span
      className="pointer-events-none absolute grid h-[18px] min-w-[18px] place-items-center rounded-full bg-focus px-[5px] text-[0.6875rem] font-semibold text-white tabular-nums phone:h-[22px] phone:min-w-[22px] phone:text-[0.8125rem]"
      style={{ left: x - 9, top: y - 9 }}
    >
      1
    </span>
  )
}

/** Mark up: a pointer and a speech bubble, a note left on a spot (like a design tool's comment). No Heroicon exists for
 *  it; drawn solid at 16px like the Micro set beside it */
export function MarkUpIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx(ic, 'fill-current')}>
      <path d="M1.5 6.1a.6.6 0 0 1 .95-.49l6.6 4.75a.6.6 0 0 1-.28 1.08l-2.6.32 1.45 2.8a.75.75 0 1 1-1.33.7L4.85 12.5l-2.37 1.7a.6.6 0 0 1-.95-.5Z" />
      <path d="M9.75 1h3.5A1.75 1.75 0 0 1 15 2.75v2.5A1.75 1.75 0 0 1 13.25 7H12.5l-1.85 1.85A.4.4 0 0 1 10 8.57V7h-.25A1.75 1.75 0 0 1 8 5.25v-2.5A1.75 1.75 0 0 1 9.75 1Z" />
    </svg>
  )
}
