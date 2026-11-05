import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type FC, type ReactNode } from 'react'
import type { SettingRow, SettingSection } from '@shared/types.ts'
import type { Appearance } from './theme.ts'
import { CheckIcon, DownIcon, Ghost, ic, Menu, MenuItem, MinusIcon, PlusIcon, Small, Tab, Tabs, TextBox, UpDownIcon } from './ui.tsx'

/** a setting's word as the screen says it: "Off", "On its own", "2 rounds"; a name like model-lite-5-5 as it is */
export const shown = (v: string) => (v === 'xhigh' ? 'Extra high' : /^[a-z][a-z ,]*$/.test(v) ? v.charAt(0).toUpperCase() + v.slice(1) : v)

/** a setting's choices: the shared menu, springing out of it (up, near the bottom of the screen); one too long to show
 *  whole scrolls, the one picked in view */
function Choices({
  value,
  options,
  up,
  tall,
  onPick,
  onClose,
  show,
  depth,
  icon,
  ordered,
  left,
}: {
  value: string
  options: string[]
  up: boolean
  tall: number
  onPick: (v: string) => void
  onClose: () => void
  show: (v: string) => string
  depth?: (v: string) => { depth: number; name: string }
  icon?: (v: string) => ReactNode
  ordered?: boolean
  left?: boolean
}) {
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && el.scrollHeight > el.clientHeight) el.querySelector('[aria-checked=true]')?.scrollIntoView({ block: 'center' })
  }, [])
  return (
    <Menu
      label="Choices"
      onClose={onClose}
      className={clsx(
        'absolute z-10 min-w-full max-w-[calc(100vw-2rem)]',
        left ? 'left-0' : 'right-0',
        up ? 'bottom-full mb-1' : 'top-full mt-1',
        up ? (left ? 'origin-bottom-left' : 'origin-bottom-right') : left ? 'origin-top-left' : 'origin-top-right',
      )}
    >
      {depth && options.length > 10 ? (
        <input
          aria-label="Find scope or value"
          placeholder="Find…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mx-2 mb-1 w-[calc(100%-1rem)] min-w-0 rounded-row bg-well px-2 py-2 outline-none"
        />
      ) : null}
      <div ref={ref} style={{ maxHeight: tall - (depth && options.length > 10 ? 56 : 12) }} className="overflow-y-auto overscroll-contain">
        {(ordered ? options : [value, ...options.filter((o) => o !== value)])
          .filter((o) => show(o).toLowerCase().includes(query.toLowerCase()))
          .map((o) => {
            const at = depth?.(o)
            return (
              <MenuItem
                key={o}
                role="menuitemradio"
                aria-checked={o === value}
                aria-label={at && at.name !== show(o) ? show(o) : undefined}
                icon={o === value ? <CheckIcon className={ic} /> : null}
                onClick={() => onPick(o)}
              >
                {/* a tree's rows step in under the one they belong to, as the sidebar's */}
                <span style={at ? { paddingLeft: `${at.depth}rem` } : undefined} className={clsx(icon && 'flex min-w-0 items-center gap-2')}>
                  {icon?.(o)}
                  <span className="truncate">{at ? at.name : show(o)}</span>
                </span>
              </MenuItem>
            )
          })}
      </div>
    </Menu>
  )
}

/** a setting's value and the menu of its choices; plain, as a phone's grouped rows have it (the value and ⌃⌄, no box) */
export function Pick({
  value,
  options,
  onPick,
  label,
  plain,
  show = shown,
  depth,
  icon,
  ordered,
  left,
  className,
}: {
  value: string
  options: string[]
  onPick: (v: string) => void
  label: string
  plain?: boolean
  /** its words for a value */
  show?: (v: string) => string
  /** a mark before a value's words, in the picker and its menu (a place's icon) */
  icon?: (v: string) => ReactNode
  /** a tree: how deep each choice sits, and its own short name there (a project's, under its machine) */
  depth?: (v: string) => { depth: number; name: string }
  /** the choices in their own order (else the one picked first) */
  ordered?: boolean
  /** its menu opens from its left edge */
  left?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // a menu near the bottom of the screen opens upward, so every choice stays in view; a long one (pi's many models,
  // every place) shows ten rows and scrolls, fewer where the screen has less room (a phone on its side)
  const [up, setUp] = useState(false)
  const [tall, setTall] = useState(0)
  const toggle = () => {
    const r = ref.current?.getBoundingClientRect()
    const row = innerWidth < 640 || matchMedia('(pointer: coarse)').matches ? 44 : 32
    const need = (Math.min(options.length, 10) + 1) * row + 16
    const below = r ? innerHeight - r.bottom - 12 : need
    const above = r ? r.top - 12 : 0
    const upward = below < need && above > below
    setUp(upward)
    setTall(Math.max(3 * row, Math.min(need, upward ? above : below)))
    setOpen(!open)
  }
  const ref = useRef<HTMLDivElement>(null)
  return (
    // plain, its ⌃⌄ sits a hair past the row's edge, lined up with the other rows' ends
    <div ref={ref} className={clsx('relative max-w-full', plain && 'left-1', className)}>
      {plain ? (
        <button
          type="button"
          aria-label={`${label}: ${show(value)}`}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={toggle}
          className="press-dim relative -my-2.5 inline-flex min-h-11 max-w-full items-center gap-1 pl-2 whitespace-nowrap text-fg2"
        >
          {icon?.(value)}
          <span className="truncate">{show(value)}</span>
          <UpDownIcon className={ic} />
        </button>
      ) : (
        <Ghost
          className="max-w-full pr-1.5 pl-2.5 tabular-nums"
          aria-label={`${label}: ${show(value)}`}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={toggle}
        >
          {icon?.(value)}
          <span className="truncate">{show(value)}</span>
          <DownIcon className={ic} />
        </Ghost>
      )}
      {open ? (
        <Choices
          value={value}
          options={options}
          show={show}
          depth={depth}
          icon={icon}
          ordered={ordered}
          left={left}
          up={up}
          tall={tall}
          onClose={() => setOpen(false)}
          onPick={(o) => {
            setOpen(false)
            if (o !== value) onPick(o)
          }}
        />
      ) : null}
    </div>
  )
}

/** a number as the screen says it: "7 days", "1.5× cores", "Off" */
export const numShown = (v: string, num: NonNullable<SettingRow['num']>) =>
  v === 'off' ? 'Off' : v.replace(/^(\d+(?:\.\d+)?)(\s*).*$/, (_, n, sp) => `${n}${num.unit ? `${sp}${Number(n) === 1 && num.one ? num.one : num.unit}` : ''}`)

/** a value you type: a box as wide as its words, saved when you leave it (Enter too) */
export function TextValue({ value, onSave, onEdit, label }: { value: string; onSave: (v: string) => void; onEdit: () => void; label: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    // as tall and round as the pickers beside it, its edge a shade darker while you type (a text box's look)
    <span className="relative inline-flex h-7 max-w-full items-center rounded-full shadow-[inset_0_0_0_1px_var(--line2)] has-focus:shadow-box-focus coarse:h-9 phone:h-9">
      <span aria-hidden="true" className="invisible block truncate px-2.5 whitespace-pre">
        {v || ' '}
      </span>
      <input
        name={label}
        aria-label={label}
        value={v}
        onFocus={onEdit}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onSave(v)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="absolute inset-0 w-full min-w-0 bg-transparent px-2.5 outline-none phone:text-[1rem]"
      />
    </span>
  )
}

/** on or off: the track grey off, green on, its knob sliding across (iOS's) */
export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="group relative inline-flex w-9 shrink-0 rounded-full bg-line2 p-0.5 shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-200 ease-in-out after:absolute after:-inset-2 aria-checked:bg-ready aria-checked:shadow-none coarse:w-12 phone:w-12"
    >
      <span className="aspect-square w-1/2 rounded-full bg-white shadow-xs ring-1 ring-black/5 transition-transform duration-200 ease-in-out group-aria-checked:translate-x-full" />
    </button>
  )
}

/** a few short choices side by side, the one picked raised */
export function Segments({
  value,
  options,
  label,
  onPick,
  fill,
}: {
  value: string
  options: string[]
  label: string
  onPick: (v: string) => void
  fill?: boolean
}) {
  return (
    <Tabs label={label} className={fill ? 'flex! w-full' : undefined}>
      {options.map((o) => (
        <Tab key={o} fill={fill} on={o === value} onClick={() => o !== value && onPick(o)}>
          {shown(o)}
        </Tab>
      ))}
    </Tabs>
  )
}

/** a stepper's − or + */
function Step({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="press-dim relative grid size-7 shrink-0 place-items-center rounded-full bg-hover text-fg2 after:absolute after:-inset-1 enabled:hover:bg-sel enabled:hover:text-fg disabled:cursor-default disabled:opacity-40 coarse:size-9 phone:size-9"
    >
      {children}
    </button>
  )
}

/** a count or a threshold: − and + step it (↑ and ↓ too), or type any number in its range, its unit after it; one
 *  that may be off is off below its least, or left empty. Typed, it is saved when you leave it; stepped, a moment
 *  after the last step */
export function NumberValue({
  value,
  num,
  onSave,
  onEdit,
  label,
}: {
  value: string
  num: NonNullable<SettingRow['num']>
  onSave: (v: string) => void
  onEdit: () => void
  label: string
}) {
  const now = value === 'off' ? '' : String(Number.parseFloat(value))
  const [v, setV] = useState(now)
  useEffect(() => setV(now), [now])
  const offable = !!(num.off || num.zero)
  const later = useRef<ReturnType<typeof setTimeout>>(undefined)
  // a step still waiting is saved as the row goes (another page, Settings closed)
  const pending = useRef<() => void>(undefined)
  useEffect(() => () => pending.current?.(), [])
  const save = (t = v.trim()) => {
    clearTimeout(later.current)
    pending.current = undefined
    if (t === now) return
    if (!t && !offable) return setV(now)
    onSave(t || 'off')
  }
  const step = (by: number) => {
    onEdit()
    const s = num.step ?? 1
    const x = Number.parseFloat(v)
    let next: string
    if (!Number.isFinite(x)) next = by > 0 ? String(num.min) : v
    else {
      const to = Math.round((x + by * s) / s) * s
      next = to < num.min - 1e-9 ? (offable ? '' : String(num.min)) : String(+Math.min(num.max, to).toFixed(4))
    }
    setV(next)
    clearTimeout(later.current)
    pending.current = () => save(next)
    later.current = setTimeout(() => save(next), 700)
  }
  const x = Number.parseFloat(v)
  const unit = v && num.unit ? (x === 1 && num.one ? num.one : num.unit) : ''
  return (
    <span className="inline-flex items-center gap-1.5">
      <Step label={`Less: ${label}`} onClick={() => step(-1)} disabled={!v || (!offable && x <= num.min)}>
        <MinusIcon className={ic} />
      </Step>
      <span className="relative inline-flex h-7 min-w-14 items-center justify-center rounded-full tabular-nums shadow-[inset_0_0_0_1px_var(--line2)] has-focus:shadow-box-focus coarse:h-9 phone:h-9">
        {/* the box is as wide as its number */}
        <span className="inline-grid">
          <span aria-hidden="true" className={clsx('invisible col-start-1 row-start-1 pl-2.5 whitespace-pre', !unit && 'pr-2.5')}>
            {v || (offable ? 'Off' : ' ')}
          </span>
          <input
            type="text"
            inputMode="decimal"
            name={label}
            aria-label={num.unit ? `${label} (${num.unit})` : label}
            value={v}
            placeholder={offable ? 'Off' : undefined}
            onFocus={onEdit}
            onChange={(e) => setV(e.target.value)}
            onBlur={() => save()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                step(e.key === 'ArrowUp' ? 1 : -1)
              }
            }}
            className={clsx(
              'col-start-1 row-start-1 w-0 min-w-full bg-transparent pl-2.5 outline-none placeholder:text-fg2 phone:text-[1rem]',
              !unit && 'pr-2.5',
            )}
          />
        </span>
        {unit ? <span className={clsx('pr-2.5 whitespace-nowrap text-fg2', !/^[×%]/.test(unit) && 'pl-1')}>{unit}</span> : null}
      </span>
      <Step label={`More: ${label}`} onClick={() => step(1)} disabled={!!v && x >= num.max}>
        <PlusIcon className={ic} />
      </Step>
    </span>
  )
}

/** a trigger (Coordinator timer's heartbeat, the news that wakes it): never its rule as written, but in plain words, its next
 *  runs, and a few ready-made picks side by side (none raised for one the coordinator wrote); anything else is asked of
 *  the coordinator */
export function TriggerValue({
  row,
  phone,
  onPick,
}: {
  row: SettingRow & { trigger: NonNullable<SettingRow['trigger']> }
  phone: boolean
  onPick: (v: string) => void
}) {
  const t = row.trigger
  const picked = t.presets.find((p) => p.value === row.value)?.label ?? ''
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <p className="text-pretty text-fg">{t.words}</p>
        {t.next.length ? <Small className="tabular-nums">Next: {t.next.join(' · ')}</Small> : null}
      </div>
      <Segments
        label={row.label}
        value={picked}
        options={t.presets.map((p) => p.label)}
        fill={phone}
        onPick={(l) => onPick(t.presets.find((p) => p.label === l)!.value)}
      />
      <Small className="text-pretty">
        {row.key === 'heartbeat.on' ? 'Other news waits for the next heartbeat. ' : ''}Ask the coordinator for anything else.
      </Small>
    </div>
  )
}

/** a whole file's words (a coordinator's HEARTBEAT.md): an editor as wide as the page that grows with them, its
 *  name on top; Save (⌘S, Ctrl+S) and Undo show once it changed, Undo putting back what is saved */
export function DocValue({
  value,
  onSave,
  label,
  file,
  phone,
  privateRules = false,
}: {
  value: string
  onSave: (v: string) => void
  label: string
  file: string
  phone: boolean
  privateRules?: boolean
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const changed = v !== value
  return (
    <div
      className={clsx(
        'flex w-full flex-col',
        privateRules && clsx('overflow-hidden rounded-row shadow-[inset_0_0_0_1px_var(--line2)] has-focus:shadow-box-focus', phone ? 'bg-well' : 'bg-bg'),
      )}
    >
      <div className={clsx('flex min-h-9 items-center gap-3 text-[0.8125rem] phone:min-h-11', privateRules && 'border-b border-line py-1 pr-1.5 pl-3')}>
        <span className={clsx('min-w-0 flex-1 text-fg2', privateRules && 'truncate font-mono text-[0.75rem]')}>{file}</span>
        {changed ? (
          <>
            <span className="text-fg3 phone:hidden">Not saved</span>
            <Ghost onClick={() => setV(value)}>Undo</Ghost>
            <Ghost onClick={() => onSave(v)} className="bg-fg text-bg! shadow-none! enabled:hover:bg-fg">
              Save
            </Ghost>
          </>
        ) : null}
      </div>
      <TextBox
        label={label}
        value={v}
        onChange={setV}
        spellCheck={false}
        placeholder={privateRules ? 'Empty: no private rules for this role' : 'Empty: nothing to go through'}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault()
            if (changed) onSave(v)
          }
        }}
        className={clsx(
          'w-full bg-transparent outline-none',
          privateRules
            ? 'min-h-24 px-3 py-2.5 font-mono text-[0.8125rem]/5 phone:text-[0.875rem]/[1.375rem]'
            : 'min-h-40 whitespace-pre-wrap wrap-anywhere text-base/6 focus-visible:rounded-row focus-visible:outline-2 focus-visible:outline-box-focus',
        )}
      />
    </div>
  )
}

/** a page of settings: one of the server's sections (set Everywhere), or this device's own (Appearance, or a plugin's
 *  drawn by its View) */
export interface Page extends SettingSection {
  targets?: Record<string, string>
  device?: boolean
  Icon?: ComponentType<{ className?: string }>
  View?: FC<{ phone: boolean }>
}

export const APPEARANCE: Page = { name: 'Appearance', device: true, about: 'How Lineclear looks on this device. Your other devices keep their own.', rows: [] }

export const LOOKS: Record<Appearance, { label: string; hint?: string }> = {
  system: { label: 'System', hint: "Light or dark, as this device's own setting is" },
  light: { label: 'Light' },
  dark: { label: 'Dark' },
}
