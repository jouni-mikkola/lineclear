import clsx from 'clsx'
import { useEffect, useState, type ComponentType } from 'react'
import { machineName, type SettingRow, type SettingSection, type Snapshot } from '@shared/types.ts'
import { ago } from '@shared/time.ts'
import { act, registry, type UI } from './kernel.ts'
import { APPEARANCES, setAppearance, useAppearance } from './theme.ts'
import {
  AppearanceIcon,
  AutopilotIcon,
  ClockIcon,
  BellIcon,
  ChatIcon,
  CheckIcon,
  CogIcon,
  Ghost,
  GlobeIcon,
  ic,
  KeyIcon,
  MachineIcon,
  ModelIcon,
  PlanIcon,
  PluginIcon,
  SecretField,
  Small,
  field,
  TasksIcon,
} from './ui.tsx'
import { Pick, type Page, APPEARANCE, LOOKS, shown, NumberValue, TextValue, Switch, Segments, numShown, DocValue, TriggerValue } from './Settings-Fields.tsx'

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  'How tasks work': PlanIcon,
  'Private instructions': PlanIcon,
  Agents: ModelIcon,
  Tasks: TasksIcon,
  'Task IDs': TasksIcon,
  'Coordinator timer': AutopilotIcon,
  'Time zone': ClockIcon,
  Machine: MachineIcon,
  Browser: GlobeIcon,
  Notify: ChatIcon,
  Notifications: BellIcon,
  Voice: ChatIcon,
  'Alerts and voice': BellIcon,
  Appearance: AppearanceIcon,
  Plugins: PluginIcon,
  Machines: MachineIcon,
  Secrets: KeyIcon,
}

/** every level defaults are set at: Everywhere, then each machine and its spaces */
export const levelsOf = (sections: SettingSection[]) => [...new Set(sections.flatMap((x) => (x.level && !x.global ? [x.level] : [])))]

/** the level Settings edits: the one picked, else the space it was opened from's, else Everywhere */
export function levelOf(sections: SettingSection[], ui: UI) {
  const levels = levelsOf(sections)
  const want = ui.settings?.level ?? ui.place
  return levels.includes(want) ? want : 'all'
}

/** a level's name: Everywhere, a machine's, or a space's (with its machine's, where there are more machines) */
export function levelName(level: string, sections: SettingSection[], snap: Pick<Snapshot, 'places' | 'machines'> = { places: [], machines: [] }) {
  if (level === 'all') return 'Everywhere'
  const [kind, key, space] = level.split(':')
  const machine = machineName(snap.machines, key)
  if (kind === 'm') return machine
  const name = snap.places.find((p) => p.id === level)?.name ?? (space === '~' ? 'home' : space)
  const machines = new Set(levelsOf(sections).filter((l) => l.startsWith('m:')))
  return machines.size > 1 ? `${name} · ${machine}` : name
}

/** what a level's defaults are, and what it follows where it sets none */
export function levelHint(level: string, snap: Pick<Snapshot, 'places' | 'machines'>) {
  if (level === 'all') return 'For every machine and space, unless one sets its own.'
  const [kind, key, space] = level.split(':')
  const machine = machineName(snap.machines, key)
  if (kind === 'm') return `For ${machine} and its spaces. The rest follows Everywhere.`
  return `For ${snap.places.find((p) => p.id === level)?.name ?? space}. The rest follows ${machine}, then Everywhere.`
}

/** Settings → Plugins with what failed on this screen too: a plugin of the human's own that threw here */
export function withPluginErrors(sections: SettingSection[], errors: Record<string, string>): SettingSection[] {
  if (!Object.keys(errors).length) return sections
  return sections.map((x) =>
    x.name !== 'Plugins'
      ? x
      : { ...x, rows: x.rows.map((r) => (errors[r.label] && !r.warn ? { ...r, warn: `Stopped on this screen: it threw:\n${errors[r.label]}` } : r)) },
  )
}

/** the list of pages, in groups: the defaults of the level picked (what agents are told, only words in their prompts,
 *  apart from how Shepherdr runs, with what is one for all), this device's own, and what is only shown */
export function groupsOf(sections: SettingSection[], ui: UI): { name: string; pages: Page[] }[] {
  const level = levelOf(sections, ui)
  // Present one delivery page without changing stored keys or the server/plugin section contract.
  const delivery = sections.find((x) => x.global && x.name === 'Alerts and voice')
  const scoped = sections
    .filter((x) => x.level === level && !x.global)
    .map(
      (x): Page =>
        x.name === 'Notify'
          ? {
              ...x,
              name: 'Notifications',
              targets: Object.fromEntries((delivery?.rows.filter((r) => !r.key.startsWith('voice.')) ?? []).map((r) => [r.key, delivery!.level ?? 'all'])),
              about:
                'All: every new coordinator message, question and alert. Needs me: questions and alerts. Off: none, and the space stays quiet. Task alerts reach you either way. Spaces can override the delivery rule here or from their sidebar menu. Device delivery below applies Everywhere.',
              rows: [
                ...x.rows.map((r) => ({ ...r, group: 'Delivery rules' })),
                ...(delivery?.rows.filter((r) => !r.key.startsWith('voice.')).map((r) => ({ ...r, group: 'Devices · Everywhere' })) ?? []),
              ],
            }
          : x,
    )
  const globals = sections
    .filter((x) => x.global)
    .map(
      (x): Page =>
        x === delivery
          ? {
              ...x,
              name: 'Voice',
              rows: x.rows.filter((r) => r.key.startsWith('voice.')),
            }
          : x,
    )
  const own = registry.settingsPages.filter((x) => x.when(ui)).map(({ name, about, Icon, View }): Page => ({ name, about, Icon, View, device: true, rows: [] }))
  return [
    { name: 'What agents are told', pages: scoped.filter((x) => x.told) },
    // what is one for all (alerts and voice) runs Shepherdr too, whatever level is picked: its page says so
    { name: 'How Lineclear runs', pages: [...scoped.filter((x) => !x.told), ...globals] },
    { name: 'This device', pages: [APPEARANCE, ...own] },
    { name: 'About', pages: sections.filter((x) => !x.level && !x.global) },
  ].filter((g) => g.pages.length)
}

/** where a page sits in the list of them (for ui.settings.section), or -1 where it doesn't show */
export const sectionOf = (name: string, sections: SettingSection[], ui: UI) =>
  groupsOf(sections, ui)
    .flatMap((g) => g.pages)
    .findIndex((p) => p.name === ({ Notify: 'Notifications', 'Alerts and voice': 'Voice' }[name] ?? name))

/** a machine's own Machine page (to open Settings on it): its section and level */
export function settingsPageOf(sections: SettingSection[], machine: string, ui: UI) {
  const level = `m:${machine}`
  if (!levelsOf(sections).includes(level)) return undefined
  const i = sectionOf('Machine', sections, { ...ui, settings: { section: 0, level } })
  return i < 0 ? undefined : { section: i, level }
}

/** a page's own icon: a plugin's, or its section's */
export const iconOf = (p: Page) => p.Icon ?? ICONS[p.name] ?? CogIcon

/** a phone's rounded group of rows, a shade lighter than the page under it in dark mode, as iOS's */
export const card = 'rounded-box bg-bg dark:bg-bubble'
/** a row's look: in a phone's group its line starts where its words do, as iOS's; on a wider screen a line between rows */
export const rowLook = (phone: boolean) =>
  phone
    ? 'relative flex min-h-12 items-center justify-between gap-3 px-4 py-2.5 not-first:before:absolute not-first:before:inset-x-0 not-first:before:top-0 not-first:before:left-4 not-first:before:h-px not-first:before:bg-line'
    : 'flex min-h-12 items-center justify-between gap-3 py-2 not-first:border-t not-first:border-line'
export const heading = (phone: boolean) => (phone ? 'px-4 pb-1.5 text-[0.8125rem] text-fg2' : 'pb-1 text-[0.75rem] font-medium text-fg3')

/** Appearance: System, Light or Dark, kept on this device */
function AppearancePick({ phone }: { phone: boolean }) {
  const now = useAppearance()
  return (
    <div role="radiogroup" aria-label="Appearance" className={phone ? clsx(card, 'overflow-hidden') : 'w-full'}>
      {APPEARANCES.map((a) => (
        <label key={a} className={clsx(rowLook(phone), 'group cursor-pointer has-focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)]', phone && 'press')}>
          <input type="radio" name="appearance" value={a} checked={now === a} onChange={() => setAppearance(a)} className="sr-only" />
          <span className="flex min-w-0 flex-col">
            {LOOKS[a].label}
            {LOOKS[a].hint ? <Small className="text-pretty">{LOOKS[a].hint}</Small> : null}
          </span>
          <CheckIcon className={clsx(ic, 'text-accent group-not-has-checked:invisible')} />
        </label>
      ))}
    </div>
  )
}

/** the rows whose few short choices sit side by side */
const SEGMENTS = new Set(['notify', 'review.mustFix'])

/** a row's control, by what its value is: on or off a switch, two or three short words segments, a number a stepper,
 *  free words a box, a list a menu; one with no other choice, or only shown,
 *  its words */
function Control({ row, phone, set, edit }: { row: SettingRow; phone: boolean; set: (value: string) => void; edit: () => void }) {
  const options = row.options ?? []
  const action = row.key in registry.settingActions
  const only = !row.num && !row.text && !action && options.length <= 1 && (options[0] ?? row.value) === row.value
  if (row.fixed || !row.key || only) return <span className="text-right text-pretty text-fg2 [overflow-wrap:anywhere]">{shown(row.value)}</span>
  if (row.num) return <NumberValue label={row.label} value={row.value} num={row.num} onEdit={edit} onSave={set} />
  if (row.text) return <TextValue label={row.label} value={row.value} onEdit={edit} onSave={set} />
  // an action (alerts: turn them on for this device) is a button, its row's value the words under its label
  if (action) return <Ghost onClick={() => set(options[0])}>{options[0]}</Ghost>
  if (options.length === 2 && options.includes('on') && options.includes('off'))
    return <Switch label={row.label} on={row.value === 'on'} onChange={(on) => set(on ? 'on' : 'off')} />
  if (SEGMENTS.has(row.key)) return <Segments label={row.label} value={row.value} options={options} onPick={set} fill={phone} />
  return <Pick label={row.label} plain={phone} value={row.value} options={options} onPick={set} />
}

/** a value set here that is what the row would follow anyway unsets it: it follows again */
const follows = (row: SettingRow, value: string) => (row.inherits && value === row.inherits.value ? null : value)

/** a level's secrets, by name: each replaced or removed, and new ones added, in masked boxes. Values never come here:
 *  they only go, once, to be kept on the main machine */
function SecretsList({ level, secrets, phone }: { level: string; secrets: { name: string; at: number }[]; phone: boolean }) {
  // the name being replaced, or '' for a new one; none: no box open
  const [open, setOpen] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [sure, setSure] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // another level's page: nothing half-typed comes along
  useEffect(() => {
    setOpen(null)
    setValue('')
    setSure(null)
  }, [level])
  const close = () => {
    setOpen(null)
    setName('')
    setValue('')
    setErr('')
  }
  const save = async (n: string, v: string | null) => {
    setBusy(true)
    setErr('')
    try {
      const r = (await act({ type: 'secret', level, name: n, value: v })) as { ok?: boolean; error?: string }
      if (r?.ok === false) setErr(r.error ?? "That didn't go through.")
      else if (v !== null) close()
      else setSure(null)
    } catch {
      setErr("That didn't go through: Lineclear can't be reached.")
    } finally {
      setBusy(false)
    }
  }
  const box = (n: string) => (
    <div className="flex w-full flex-col gap-2">
      <SecretField
        label={n ? `New value for ${n}` : 'Value'}
        value={value}
        onChange={setValue}
        onEnter={() => (n || name) && value && save(n || name.trim(), value)}
        autoFocus={!!n}
      />
      <div className="flex items-center justify-end gap-2">
        {err ? (
          <span role="status" className="mr-auto text-[0.75rem] text-need-fg phone:text-[0.8125rem]">
            {err}
          </span>
        ) : null}
        <Ghost onClick={close}>Cancel</Ghost>
        <Ghost
          disabled={busy || !value || (!n && !name.trim())}
          onClick={() => save(n || name.trim(), value)}
          className="bg-fg text-bg! shadow-none! enabled:hover:bg-fg"
        >
          Save
        </Ghost>
      </div>
    </div>
  )
  return (
    <div className="flex w-full flex-col gap-1.5">
      <dl className={phone ? card : undefined}>
        {secrets.map((x) => (
          <div key={x.name} className={clsx(rowLook(phone), open === x.name && 'flex-col items-stretch! gap-2.5 pb-3!')}>
            <dt className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono text-[0.8125rem] phone:text-[0.9375rem]">{x.name}</span>
              <Small>Saved {ago(x.at)}</Small>
            </dt>
            <dd className={clsx('flex shrink-0 items-center gap-1.5', open === x.name && 'w-full')}>
              {open === x.name ? (
                box(x.name)
              ) : sure === x.name ? (
                <>
                  <Ghost onClick={() => setSure(null)}>Keep</Ghost>
                  <Ghost disabled={busy} onClick={() => save(x.name, null)} className="text-need-fg!">
                    Remove it
                  </Ghost>
                </>
              ) : (
                <>
                  <Ghost
                    onClick={() => {
                      close()
                      setOpen(x.name)
                    }}
                  >
                    Replace
                  </Ghost>
                  <Ghost onClick={() => setSure(x.name)}>Remove</Ghost>
                </>
              )}
            </dd>
          </div>
        ))}
        {open === '' ? (
          <div className={clsx(rowLook(phone), 'flex-col items-stretch! gap-2 py-3!')}>
            <input
              aria-label="Name"
              placeholder="NAME, like GITHUB_TOKEN"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
              className={clsx(
                'min-h-10 w-full min-w-0 rounded-row bg-transparent px-3 py-[9px] font-mono placeholder:font-sans placeholder:text-fg3 coarse:min-h-11 phone:min-h-11 phone:text-[1rem]',
                field,
              )}
            />
            {box('')}
          </div>
        ) : (
          <div className={rowLook(phone)}>
            <dt className="min-w-0 flex-1 text-fg2">{secrets.length ? null : 'None here yet.'}</dt>
            <dd>
              <Ghost
                onClick={() => {
                  close()
                  setOpen('')
                }}
              >
                Add a secret
              </Ghost>
            </dd>
          </div>
        )}
      </dl>
      {err && open === null ? (
        <Small role="status" className="text-need-fg!">
          {err}
        </Small>
      ) : null}
      <p className={clsx('text-pretty text-fg3', phone ? 'px-4 text-[0.8125rem]' : 'text-[0.75rem]')}>
        Agents run commands with them by name, and ask for one in their chat when they need it.
      </p>
    </div>
  )
}

/** a page's settings: its rows under their group's heading (Tasks, Coordinators, Reviewer), and what it notes under them */
export function PageBody({
  page,
  phone,
  set,
  refused,
  clear,
  hint,
}: {
  page: Page
  phone: boolean
  set: (key: string, value: string | null) => void
  refused: (key: string) => string | undefined
  clear: (key: string) => void
  hint?: string
}) {
  const [pilotError, setPilotError] = useState('')
  const [running, setRunning] = useState(false)
  const groups: { name?: string; rows: Page['rows'] }[] = []
  for (const row of page.rows) {
    if (groups.length && groups.at(-1)!.name === row.group) groups.at(-1)!.rows.push(row)
    else groups.push({ name: row.group, rows: [row] })
  }
  // what is said under a row's label: where its value comes from, or a reset for one set here; then what went wrong
  const under = (row: SettingRow) => (
    <>
      {row.key in registry.settingActions ? <Small className="text-pretty">{row.value}</Small> : null}
      {row.hint ? <Small className="text-pretty">{row.hint}</Small> : null}
      {row.lineclear ? (
        <Small>
          <a className="text-accent underline" href={`${location.protocol}//${location.hostname}:7432${row.lineclear}`} target="_blank" rel="noreferrer">
            Open Lineclear Models
          </a>
        </Small>
      ) : null}
      {/* the exact words it adds to every new brief, as it is set now */}
      {row.line ? (
        <details className="text-[0.8125rem] text-fg2">
          <summary className="cursor-pointer">Brief wording</summary>
          <p className="text-pretty">Adds: “{row.line}”</p>
        </details>
      ) : null}
      {row.from ? <Small className="text-pretty">From {row.from}</Small> : null}
      {row.inherits ? (
        // set here: Reset, back to what it would be (its title says where that comes from)
        <Small className="text-pretty">
          <span className="font-medium text-accent">Set here</span>
          <span className="block">
            Inherits{' '}
            {row.multiline
              ? row.inherits.value
                ? 'private rules'
                : 'no private rules'
              : row.num
                ? numShown(row.inherits.value, row.num)
                : row.trigger
                  ? (row.trigger.presets.find((p) => p.value === row.inherits!.value)?.label ?? 'Custom rule')
                  : shown(row.inherits.value)}{' '}
            · {row.inherits.from}
          </span>
          {row.trigger && !row.trigger.presets.some((p) => p.value === row.inherits!.value) ? (
            <details>
              <summary className="cursor-pointer">Inherited rule</summary>
              <span className="[overflow-wrap:anywhere]">{row.inherits.value}</span>
            </details>
          ) : null}
          <button
            type="button"
            title={`Set here. Back to ${row.inherits.from === 'Default' ? 'the default' : row.inherits.from}'s`}
            onClick={() => set(row.key, null)}
            className="press-dim relative font-medium text-accent after:absolute after:-inset-x-1 after:-inset-y-1.5 coarse:after:-inset-y-3"
          >
            Reset to{' '}
            {row.multiline
              ? row.inherits.value
                ? 'private rules'
                : 'no private rules'
              : row.num
                ? numShown(row.inherits.value, row.num)
                : row.trigger
                  ? row.inherits.from === 'Default'
                    ? 'the default'
                    : `${row.inherits.from}'s`
                  : shown(row.inherits.value)}
          </button>
        </Small>
      ) : null}
      {row.warn ? <Small className="text-pretty whitespace-pre-line text-need-fg!">{row.warn}</Small> : null}
      {refused(row.key) ? (
        <Small role="status" className={clsx('text-pretty', !registry.settingActions[row.key] && 'text-need-fg!')}>
          {refused(row.key)}
        </Small>
      ) : null}
    </>
  )
  return (
    <div
      className={clsx(
        'flex w-full flex-col',
        phone ? 'gap-6 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+--spacing(8))]' : 'max-w-[720px] gap-6 px-6 pt-5 pb-8',
      )}
    >
      <div className={clsx('flex flex-col gap-1', phone && 'px-4')}>
        {phone ? null : <h2 className="text-[0.9375rem] font-semibold">{page.name}</h2>}
        {page.about ? <p className={clsx('text-pretty text-fg2', phone ? 'text-[0.9375rem]' : 'text-[0.8125rem]')}>{page.about}</p> : null}
        {hint ? <p className={clsx('text-pretty text-fg3', phone ? 'text-[0.9375rem]' : 'text-[0.8125rem]')}>{hint}</p> : null}
      </div>
      {page.name === 'Coordinator timer' && page.level?.startsWith('p:') ? (
        <div className="flex flex-col items-start gap-2">
          <Ghost
            disabled={running}
            onClick={async () => {
              setRunning(true)
              try {
                const result = await act({ type: 'autopilot-run', place: page.level! })
                setPilotError(result.error ?? '')
              } finally {
                setRunning(false)
              }
            }}
          >
            {running ? 'Queuing…' : 'Run now'}
          </Ghost>
          {pilotError ? (
            <p role="alert" className="text-need">
              {pilotError}
            </p>
          ) : null}
        </div>
      ) : null}
      {page === APPEARANCE ? <AppearancePick phone={phone} /> : null}
      {page.secrets && page.level ? <SecretsList level={page.level} secrets={page.secrets} phone={phone} /> : null}
      {page.View ? <page.View phone={phone} /> : null}
      {groups.map(({ name, rows }, g) => {
        const Group = name === 'Access and limits' ? 'details' : 'div'
        return (
          <Group key={name ?? g} className="w-full">
            {name === 'Access and limits' ? <summary className={clsx(heading(phone), 'cursor-pointer')}>Access and limits</summary> : null}
            {name && name !== 'Access and limits' ? <h3 className={heading(phone)}>{name}</h3> : null}
            <dl className={phone ? card : undefined}>
              {rows.map((row) =>
                row.doc || row.multiline ? (
                  <div key={row.key} className={clsx(rowLook(phone), 'flex-col items-stretch! gap-2.5 pb-3!', row.inherits && 'border-l-2 border-accent pl-3')}>
                    <dt className="flex min-w-0 flex-col">
                      {row.label}
                      {row.doc ? <Small className="text-pretty">What to do, how to judge progress, when to report or ask you, and when to stop.</Small> : null}
                      {under(row)}
                    </dt>
                    <dd>
                      <DocValue
                        label={row.label}
                        file={row.multiline ? 'Private · this role only' : 'HEARTBEAT.md'}
                        privateRules={row.multiline}
                        phone={phone}
                        value={row.value}
                        onSave={(x) => set(row.key, row.multiline ? follows(row, x) : x)}
                      />
                      {row.instructions ? (
                        <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed [overflow-wrap:anywhere]">{row.instructions}</p>
                      ) : null}
                    </dd>
                  </div>
                ) : row.trigger ? (
                  // a trigger: its words, next runs and picks under its label, as wide as the page
                  <div key={row.key} className={clsx(rowLook(phone), 'flex-col items-stretch! gap-2 pb-3!', row.inherits && 'border-l-2 border-accent pl-3')}>
                    <dt className="flex min-w-0 flex-col">
                      {row.label}
                      {under(row)}
                    </dt>
                    <dd>
                      <TriggerValue row={{ ...row, trigger: row.trigger }} phone={phone} onPick={(x) => set(row.key, follows(row, x))} />
                    </dd>
                  </div>
                ) : (
                  // on a phone, a row's segments fill a line of their own under its label
                  <div
                    key={row.key || row.label}
                    className={clsx(
                      rowLook(phone),
                      row.inherits && 'border-l-2 border-accent pl-3',
                      phone && SEGMENTS.has(row.key) && 'flex-col items-stretch! gap-2.5 pb-3!',
                    )}
                  >
                    <dt className="flex min-w-0 flex-1 flex-col">
                      {row.label}
                      {under(row)}
                    </dt>
                    <dd className={clsx('flex min-w-0 shrink-0 flex-col', phone && SEGMENTS.has(row.key) ? 'items-stretch' : 'max-w-[65%] items-end')}>
                      <Control row={row} phone={phone} set={(x) => set(row.key, follows(row, x))} edit={() => clear(row.key)} />
                    </dd>
                  </div>
                ),
              )}
            </dl>
          </Group>
        )
      })}
      {page.note ? (
        <figure className="w-full">
          <figcaption className={heading(phone)}>{page.noteTitle ?? 'Every new brief ends with'}</figcaption>
          <blockquote
            className={clsx(
              'text-pretty whitespace-pre-wrap text-fg2',
              phone ? clsx(card, 'px-4 py-3 text-[0.9375rem]') : 'rounded-box bg-hover px-3 py-2.5 text-[0.8125rem]',
            )}
          >
            {page.note}
          </blockquote>
        </figure>
      ) : null}
    </div>
  )
}
