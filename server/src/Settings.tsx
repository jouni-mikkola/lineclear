import clsx from 'clsx'
import { useLayoutEffect, useRef, useState } from 'react'
import { machineName } from '@shared/types.ts'
import { act, registry, setUI, useSnap, useUI } from './kernel.ts'
import { usePluginErrors } from './guard.tsx'
import { PlacesToggle } from './Frame.tsx'
import { Stack } from './Stack.tsx'
import { useAppearance } from './theme.ts'
import { BackIcon, Head, ic, IconButton, NextIcon, PhoneTop, PlaceIcon, RoundButton, Who, XIcon } from './ui.tsx'
import { groupsOf, withPluginErrors, levelOf, levelsOf, levelName, PageBody, levelHint, card, heading, iconOf } from './Settings-Pages.tsx'
import { Pick, APPEARANCE, LOOKS } from './Settings-Fields.tsx'
export { shown, Pick, TextValue, Switch } from './Settings-Fields.tsx'
export { withPluginErrors, sectionOf, settingsPageOf, rowLook } from './Settings-Pages.tsx'

export default function Settings() {
  const ui = useUI()
  const snap = useSnap()!
  const s = ui.settings!
  const groups = groupsOf(withPluginErrors(snap.settings, usePluginErrors()), ui)
  const pages = groups.flatMap((g) => g.pages)
  const sec = Math.min(s.section ?? 0, pages.length - 1)
  const page = pages[sec]
  // a page that comes or goes (a tablet's Keyboard shortcuts, once a key is pressed) keeps the one shown in view
  const names = pages.map((p) => p.name).join('\n')
  const shownPage = useRef({ names, name: page.name })
  useLayoutEffect(() => {
    const was = shownPage.current
    shownPage.current = { names, name: page.name }
    if (was.names === names || s.section === null) return
    const i = pages.findIndex((p) => p.name === was.name)
    if (i >= 0 && i !== sec) {
      shownPage.current.name = was.name
      setUI({ settings: { ...s, section: i } })
    }
  })
  const phone = ui.device === 'phone'
  const tablet = ui.device === 'tablet'
  const appearance = useAppearance()
  // what was refused, by page and key: each machine's page has the same keys
  const [refused, setRefused] = useState<Record<string, string>>({})
  const at = (key: string) => `${page.level ?? ''}|${key}`
  const level = levelOf(snap.settings, ui)
  const levels = levelsOf(snap.settings)
  const name = (l: string) => levelName(l, snap.settings, snap)
  const pickLevel = (l: string) => setUI({ settings: { ...s, level: l } })
  // the picker is the sidebar's tree: Everywhere, then each machine with its spaces under it, in its order
  const order = ['all', ...(snap.machines ?? []).flatMap((m) => [m.id, ...snap.places.filter((p) => p.machine === m.machine).map((p) => p.id)])]
  const rank = (l: string) => (order.includes(l) ? order.indexOf(l) : Infinity)
  const tree = [...levels].sort((a, b) => rank(a) - rank(b))
  const inTree = (l: string) => {
    return { depth: l === 'all' ? 0 : l.startsWith('m:') ? 1 : 2, name: name(l) }
  }
  const levelPick = (where: string) =>
    levels.length > 1 ? (
      <Pick
        label="Editing"
        value={level}
        options={tree}
        show={name}
        depth={inTree}
        icon={(l) => <PlaceIcon level={inTree(l).depth} className={clsx(ic, 'text-fg2')} />}
        onPick={pickLevel}
        ordered
        left={where !== 'phone'}
        plain={where === 'phone'}
        className={where === 'nav' ? 'px-0.5' : undefined}
      />
    ) : null
  const set = async (key: string, value: string | null) => {
    const own = registry.settingActions[key]
    if (own) {
      setRefused((r) => ({ ...r, [at(key)]: '' }))
      const said = await own()
      setRefused((r) => ({ ...r, [at(key)]: said }))
      return
    }
    // set at the page's level: a machine's or a space's goes to that machine
    const r = (await act({ type: 'setting', key, value, ...((page.targets?.[key] ?? page.level) ? { place: page.targets?.[key] ?? page.level } : {}) })) as {
      ok?: boolean
      error?: string
      waiting?: boolean
    }
    setRefused((x) => ({
      ...x,
      [at(key)]: r?.ok === false ? (r.error ?? 'Refused.') : r?.waiting ? `Set once ${machineName(snap.machines, page.machine)} is back.` : '',
    }))
  }
  const close = () => setUI({ settings: null })
  const scroller = useRef<HTMLDivElement>(null)
  const go = (section: number) => {
    setUI({ settings: { ...s, section } })
    // a new section starts at its top
    requestAnimationFrame(() => scroller.current && (scroller.current.scrollTop = 0))
  }
  const clear = (key: string) => refused[at(key)] && setRefused((r) => ({ ...r, [at(key)]: '' }))
  const body = (
    <>
      <div className={clsx('flex min-w-0 flex-wrap items-center gap-2 border-b border-line px-6 py-3', phone && 'px-4')}>
        <span className="text-fg2">Editing:</span>
        {page.device ? (
          <span>This device</span>
        ) : page.global || !page.level ? (
          <span>Everywhere</span>
        ) : (
          (levelPick(phone ? 'phone' : 'content') ?? <span>{name(level)}</span>)
        )}
      </div>
      <PageBody
        key={`${page.level ?? ''}|${page.name}`}
        page={page}
        phone={phone}
        set={set}
        refused={(key) => refused[at(key)]}
        clear={clear}
        hint={
          page.rows.some((r) => r.key === 'space.base')
            ? 'This repository’s branch for new tasks.'
            : page.level && !page.global && page.name !== 'Task IDs'
              ? levelHint(page.level, snap)
              : undefined
        }
      />
    </>
  )

  if (phone) {
    const list = (
      <div className="flex min-h-0 flex-1 flex-col">
        <PhoneTop
          left={
            <RoundButton label="Back" onClick={close}>
              <BackIcon className={ic} />
            </RoundButton>
          }
          name="Settings"
        />
        <nav aria-label="Sections" className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain bg-canvas">
          <div className="flex flex-col gap-6 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+--spacing(8))]">
            {/* which level's defaults the two groups below set */}
            {levels.length > 1 ? (
              <div className={clsx(card, 'flex min-h-12 items-center justify-between gap-3 px-4')}>
                <span>Editing:</span>
                {levelPick('phone')}
              </div>
            ) : null}
            {groups.map((g) => (
              <div key={g.name}>
                <h3 className={heading(true)}>{g.name}</h3>
                <ul className={clsx(card, 'overflow-hidden')}>
                  {g.pages.map((p) => {
                    const Icon = iconOf(p)
                    return (
                      <li
                        key={p.name}
                        className="relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-11 not-first:before:h-px not-first:before:bg-line"
                      >
                        <button type="button" onClick={() => go(pages.indexOf(p))} className="press flex min-h-12 w-full items-center gap-3 px-4 text-left">
                          <Icon className={clsx(ic, 'text-fg2')} />
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          {p === APPEARANCE ? <span className="text-fg2">{LOOKS[appearance].label}</span> : null}
                          <NextIcon className={clsx(ic, 'text-fg3')} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      </div>
    )
    const back = () => setUI({ settings: { ...s, section: null } })
    return (
      <section aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
        <Stack
          base={list}
          top={
            s.section === null ? null : (
              <section aria-label={page.name} className="flex min-h-0 flex-1 flex-col">
                <PhoneTop
                  left={
                    <RoundButton label="Back" onClick={back}>
                      <BackIcon className={ic} />
                    </RoundButton>
                  }
                  name={page.name}
                  kind={page.device ? 'This device' : page.global ? 'Everywhere' : page.level ? name(page.level) : undefined}
                />
                <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain bg-canvas">{body}</div>
              </section>
            )
          }
          topKey={s.section === null ? null : page.name}
          onBack={back}
        />
      </section>
    )
  }

  return (
    <section aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
      <Head>
        {/* on a tablet it slid in like a page: Back, at the start */}
        {tablet ? (
          <IconButton label="Back" onClick={close}>
            <BackIcon className={ic} />
          </IconButton>
        ) : null}
        <PlacesToggle when="closed" drawer />
        <Who name="Settings" />
        {tablet ? null : (
          <IconButton label="Close" onClick={close}>
            <XIcon className={ic} />
          </IconButton>
        )}
      </Head>
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Sections" className="flex touch-pan-y flex-col gap-4 overflow-y-auto overscroll-contain border-r border-line px-2 py-3">
          {groups.map((g) => (
            <div key={g.name} className="flex flex-col gap-px">
              <h3 className="px-2.5 pb-1 text-[0.75rem] font-medium text-fg3">{g.name}</h3>
              {g.pages.map((p) => {
                const Icon = iconOf(p)
                const i = pages.indexOf(p)
                return (
                  <button
                    key={p.name}
                    type="button"
                    aria-current={sec === i ? 'page' : undefined}
                    onClick={() => go(i)}
                    className="press flex h-8 items-center gap-2 rounded-row px-2.5 text-left text-fg2 hover:bg-hover aria-[current=page]:bg-sel aria-[current=page]:text-fg coarse:h-11"
                  >
                    <Icon className={ic} />
                    <span className="min-w-0 truncate">{p.name}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div ref={scroller} className="touch-pan-y overflow-y-auto overscroll-contain">
          {body}
        </div>
      </div>
    </section>
  )
}
