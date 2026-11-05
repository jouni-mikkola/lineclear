import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  act,
  artifactsIn,
  closeArtifact,
  closeSheet,
  filterOf,
  listView,
  matches,
  openArtifact,
  openSplit,
  placeOf,
  setDraft,
  setFilter,
  setUI,
  togglePanel,
  useDraftOf,
  useSnap,
  useStore,
  useUI,
} from '@client/kernel.ts'
import { ListChips } from '@client/chips.tsx'
import { DictationBox, toggleDictation, useChat } from '@plugins/chat/client.tsx'
import { canDictate } from '@client/dictation.ts'
import { useDark } from '@client/theme.ts'
import {
  CheckIcon,
  ClockIcon,
  dimmed,
  Empty,
  FilterBox,
  Ghost,
  ic,
  IconButton,
  List,
  MarkBadge,
  MarkUpIcon,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MicIcon,
  MoreIcon,
  PageIcon,
  PanelIcon,
  Row,
  SplitIcon,
  roundBtn,
  RowText,
  TextBox,
  UpIcon,
  XIcon,
} from '@client/ui.tsx'
import type { Artifact, Task } from '@shared/types.ts'
import { type Pick, ViewerShell, Popover, showInPanel, ArtifactFrame, useShown, PanelArtifact, setShown } from './artifacts-frame.tsx'

/** An artifact full screen: the page has the room, its versions sit at the top, and the box at the bottom writes to
 *  its keeper (or, after a tap in Mark up, notes on what you picked). A newer version swaps in while you look. */
export function Viewer() {
  const v = useUI((u) => u.viewer)
  const device = useUI((u) => u.device)
  const dict = useUI((u) => u.dict)
  const snap = useSnap()
  // what you write to its keeper, kept like any draft (talk to type writes it too)
  const draft = useDraftOf(v ? `art:${v.artifact}` : '')
  const art = v && snap?.artifacts?.find((a) => a.id === v.artifact)
  const [markup, setMarkup] = useState(false)
  const [pick, setPick] = useState<Pick | null>(null)
  const [menu, setMenu] = useState<'versions' | 'more' | 'delete' | null>(null)
  const [said, setSaid] = useState('')
  const [fresh, setFresh] = useState<number | null>(null)
  /** the latest version this viewer has shown, of which artifact */
  const seen = useRef<{ id: string; v: number } | null>(null)
  // a version no longer kept (the last 20 are) shows the latest, and says so
  const gone = !!(art && v?.v && !art.versions.some((x) => x.n === v.v))
  const shown = gone ? art?.v : (v?.v ?? art?.v)
  useEffect(() => {
    setMarkup(false)
    setPick(null)
    setMenu(null)
    setSaid('')
    setFresh(null)
  }, [v?.artifact])
  // following the latest: say so when a new version comes in
  useEffect(() => {
    if (!art) return
    const was = seen.current
    seen.current = { id: art.id, v: art.v }
    if (!v?.v && was?.id === art.id && art.v > was.v) setFresh(art.v)
  }, [art?.id, art?.v, v?.v])
  useEffect(() => {
    if (!fresh) return
    const t = setTimeout(() => setFresh(null), 4000)
    return () => clearTimeout(t)
  }, [fresh])
  if (!v) return null
  const phone = device === 'phone'
  if (!art || !shown)
    return (
      <div role="dialog" aria-modal="true" aria-label="Artifact" className="fixed inset-0 z-40 grid place-items-center bg-black/35 p-6" onClick={closeArtifact}>
        <div className="rounded-box bg-bg px-5 py-4 shadow-dialog">{snap ? 'This artifact was deleted.' : 'Opening…'}</div>
      </div>
    )
  const key = `art:${art.id}`
  const text = draft ?? ''
  const setText = (t: string) => setDraft(key, t)
  const ver = art.versions.find((x) => x.n === shown)
  const send = async () => {
    const t = text.trim()
    if (!t) return
    const last = pick?.selector.split(' > ').pop() ?? ''
    const target = pick ? `${pick.text ? `"${pick.text.slice(0, 60)}" ` : ''}(${last}${pick.component ? ` in ${pick.component}` : ''})` : undefined
    const r = (await act(
      pick
        ? { type: 'artifact-note', place: art.place, artifact: art.id, v: shown, note: t, target }
        : { type: 'artifact-say', place: art.place, artifact: art.id, v: shown, text: t },
    ).catch(() => ({ ok: false }))) as {
      ok?: boolean
      to?: string
      error?: string
    }
    if (r.ok === false) return setSaid(r.error ?? "That didn't go through. Try again.")
    setText('')
    setPick(null)
    setMarkup(false)
    setSaid(`Sent to ${r.to ?? art.keeper}. A new version shows here when it's in.`)
  }
  const del = async () => {
    const r = (await act({ type: 'artifact-delete', place: art.place, artifact: art.id }).catch(() => ({ ok: false }))) as
      | { ok?: boolean; error?: string }
      | undefined
    if (r?.ok === false) {
      setMenu(null)
      return setSaid(r.error ?? "Couldn't delete it. Try again.")
    }
    closeArtifact()
  }
  // round, like every header's buttons; grey circles on a phone
  const barBtn = phone ? 'rounded-full! bg-bubble' : 'rounded-full!'
  return (
    <ViewerShell label={art.title} phone={phone}>
      {/* the whole screen is the page's, but for a slim bar on top and the box to its keeper below */}
      <div className="flex w-full min-w-0 flex-col overflow-hidden pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line pt-[calc(env(safe-area-inset-top)+--spacing(1))] pr-2 pb-1 pl-4 phone:gap-2 phone:px-3">
          <IconButton label="Close" onClick={closeArtifact} className={clsx(barBtn, 'desktop:hidden tablet:hidden')}>
            <XIcon className={ic} />
          </IconButton>
          {/* the title whole first, then the version and when, cut short; a phone's bar has room for them only under it */}
          <div className="flex min-w-0 flex-1 items-baseline gap-2 phone:flex-col phone:items-stretch phone:gap-0">
            <div className="min-w-0 truncate font-semibold phone:leading-5">{art.title}</div>
            <div className="min-w-0 shrink-[100] truncate text-xs text-fg2 tabular-nums phone:text-[0.8125rem]/4">
              v{shown} · {ver?.by ?? art.by} · {ver?.when ?? art.when}
            </div>
          </div>
          <div className="relative">
            <IconButton
              label="Versions"
              aria-haspopup="menu"
              aria-expanded={menu === 'versions'}
              className={clsx(barBtn, 'w-auto! px-2 gap-1 inline-flex!')}
              onClick={() => setMenu(menu === 'versions' ? null : 'versions')}
            >
              <ClockIcon className={ic} />
              <span className="phone:hidden">Version </span>
              <span>v{shown}</span>
            </IconButton>
            {menu === 'versions' ? (
              <Popover onClose={() => setMenu(null)} label="Versions">
                <MenuLabel>Versions</MenuLabel>
                {art.versions.map((x) => (
                  <MenuItem
                    key={x.n}
                    role="menuitemradio"
                    aria-checked={x.n === shown}
                    icon={x.n === shown ? <CheckIcon className={ic} /> : <span className={ic} />}
                    hint={x.when}
                    onClick={() => {
                      setMenu(null)
                      setPick(null)
                      openArtifact(art.id, x.n === art.v ? undefined : x.n)
                    }}
                  >
                    <span className="block min-w-0 truncate">
                      v{x.n}
                      {x.n === art.v ? ' · latest' : ''}
                      {x.note ? ` · ${x.note}` : x.what === 'data' ? ' · new data' : x.what === 'title' ? ' · new title' : ''}
                    </span>
                  </MenuItem>
                ))}
              </Popover>
            ) : null}
          </div>
          <IconButton
            label={markup ? 'Done marking up' : 'Mark up'}
            pressed={markup}
            className={clsx(barBtn, 'w-auto! px-2 gap-1 inline-flex! aria-pressed:bg-[color-mix(in_srgb,var(--accent)_16%,var(--bg))]')}
            onClick={() => {
              setMarkup(!markup)
              if (markup) setPick(null)
            }}
          >
            <MarkUpIcon />
            <span className="phone:hidden">{markup ? 'Done' : 'Mark up'}</span>
          </IconButton>
          <div className="relative">
            <IconButton
              label="More"
              aria-haspopup="menu"
              aria-expanded={menu === 'more' || menu === 'delete'}
              className={barBtn}
              onClick={() => setMenu(menu ? null : 'more')}
            >
              <MoreIcon className={ic} />
            </IconButton>
            {menu === 'more' || menu === 'delete' ? (
              <Popover onClose={() => setMenu(null)} label="More">
                <MenuLabel>Made in {placeOf(snap!, art.place).name}</MenuLabel>
                <MenuSeparator />
                {menu === 'more' ? (
                  <MenuItem icon={<PanelIcon className={ic} />} onClick={() => showInPanel(art.id)}>
                    {phone ? 'Show in Artifacts tab' : 'Show in side panel'}
                  </MenuItem>
                ) : null}
                {menu === 'more' && device === 'desktop' ? (
                  <MenuItem icon={<SplitIcon className={ic} />} onClick={() => openSplit({ kind: 'artifact', id: art.id })}>
                    Open in split view
                  </MenuItem>
                ) : null}
                {menu === 'more' ? (
                  <MenuItem className="text-need!" onClick={() => setMenu('delete')}>
                    Delete artifact
                  </MenuItem>
                ) : (
                  <MenuItem className="text-need!" onClick={del}>
                    Delete “{art.title}” for good
                  </MenuItem>
                )}
              </Popover>
            ) : null}
          </div>
          {/* beside the chat, at the side panel's width, to keep chatting while you look */}
          <IconButton label="Show in side panel" onClick={() => showInPanel(art.id)} className="rounded-full! phone:hidden">
            <PanelIcon className={ic} />
          </IconButton>
          <IconButton label="Close" onClick={closeArtifact} className="rounded-full! phone:hidden">
            <XIcon className={ic} />
          </IconButton>
        </div>
        {gone ? (
          <div className="shrink-0 bg-well px-4 py-1.5 text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">
            v{v.v} is no longer kept, only the last 20 versions are. This is the latest.
          </div>
        ) : v.v && v.v !== art.v ? (
          <div className="flex shrink-0 items-center gap-2 bg-well px-4 py-1.5 text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">
            <span className="min-w-0 flex-1 truncate">
              An older version: v{v.v} of {art.v}.
            </span>
            <button type="button" className="shrink-0 font-medium text-focus hover:underline" onClick={() => openArtifact(art.id)}>
              Show the latest
            </button>
          </div>
        ) : null}
        <div className={clsx('relative min-h-0 flex-1', markup && 'cursor-crosshair outline-2 -outline-offset-[6px] outline-focus outline-dashed')}>
          <div className="absolute inset-0">
            <ArtifactFrame art={art} v={shown} full markup={markup} onPick={(p) => setPick(p)} />
          </div>
          {pick ? <MarkBadge x={pick.x} y={pick.y} /> : null}
          {fresh ? (
            <div
              role="status"
              className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-fg px-3 py-1 text-[0.8125rem] font-medium text-bg shadow-toast phone:text-[0.9375rem]"
            >
              Updated to v{fresh}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 border-t border-line px-3 pt-2 pb-[max(env(safe-area-inset-bottom),--spacing(2))]">
          {pick ? (
            <div className="flex items-center gap-1.5 pb-1.5 text-[0.75rem] text-fg2 phone:text-[0.8125rem]">
              <span className="min-w-0 flex-1 truncate">
                A note on <b className="font-medium text-fg">{pick.text ? `“${pick.text.slice(0, 40)}”` : 'what you picked'}</b>
              </span>
              <button type="button" className="shrink-0 font-medium text-focus hover:underline" onClick={() => setPick(null)}>
                Not on that
              </button>
            </div>
          ) : said ? (
            <div role="status" className="pb-1.5 text-[0.75rem] text-fg2 phone:text-[0.8125rem]">
              {said}
            </div>
          ) : markup ? (
            <div className="pb-1.5 text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{device === 'desktop' ? 'Click' : 'Tap'} what should change.</div>
          ) : null}
          {/* the chat's message box: a pill, the same round buttons */}
          <div className="round-box flex items-end gap-1 bg-bg p-1.5 pl-3.5 shadow-box has-[textarea:focus]:shadow-box-focus phone:pl-4">
            {dict === key ? (
              <DictationBox />
            ) : (
              <>
                <TextBox
                  label={pick ? 'Note' : `Message ${art.keeper}`}
                  data-chat={key}
                  value={text}
                  onChange={(t) => {
                    setText(t)
                    if (said) setSaid('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !phone) {
                      e.preventDefault()
                      send()
                    }
                    // the box lets go first; Esc again closes the viewer
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      e.currentTarget.blur()
                    }
                  }}
                  placeholder={pick ? 'What should change?' : phone ? 'Ask for a change…' : `Ask ${art.keeper} for a change…`}
                  className="max-h-40 min-h-[34px] min-w-0 flex-1 bg-transparent py-[7px] outline-none placeholder:text-fg3 phone:min-h-11 phone:py-2.5 phone:text-[1rem]"
                />
                {canDictate() ? (
                  <IconButton label="Talk to type" className={roundBtn} onClick={() => toggleDictation(key)}>
                    <MicIcon className={ic} />
                  </IconButton>
                ) : null}
                <button
                  type="button"
                  aria-label={pick ? 'Send the note' : 'Send'}
                  disabled={!text.trim()}
                  onClick={send}
                  className={clsx(
                    'press-dim relative grid size-[34px] shrink-0 place-items-center rounded-full bg-fg text-bg after:absolute after:-inset-1.5 phone:size-11',
                    dimmed,
                  )}
                >
                  <UpIcon className={ic} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </ViewerShell>
  )
}

/** The check's picture of it, in the screen's own theme */
function Thumb({ art }: { art: Artifact }) {
  const [broken, setBroken] = useState(false)
  const dark = useDark()
  const box = 'h-9 w-12 shrink-0 overflow-hidden rounded-row bg-well outline-1 -outline-offset-1 outline-line2 phone:h-11 phone:w-14'
  if (!art.thumb || broken)
    return (
      <span className={clsx(box, 'grid place-items-center text-fg3')}>
        <PageIcon className={ic} />
      </span>
    )
  const url = (dark: boolean) => `api/artifacts/${encodeURIComponent(art.id)}/thumb?v=${art.v}${dark ? '&dark=1' : ''}`
  return (
    <span className={box}>
      <img src={url(dark)} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover object-top" />
    </span>
  )
}

/** The lists' artifacts, newest first: what their chips hold (placeId, the place picked, is for plugins of old) */
export function ArtifactList(_: { placeId: string }) {
  const snap = useSnap()!
  const view = useStore((s) => listView(s.ui, snap))
  const open = useUI((u) => u.viewer?.artifact)
  const value = useUI((u) => u.filter[`${view.search}|artifacts`] ?? '')
  const q = useUI((u) => filterOf(u, view.search, 'artifacts'))
  // its key, where there is a keyboard
  const keys = useUI((u) => u.device === 'desktop' || u.kb)
  // one space shown: its own artifacts need no name of where they are
  const one = view.level === 2 ? snap.places.find((p) => p.id === view.chips[0]) : undefined
  const key = `list:${view.key}`
  // one shown in the panel, from anywhere, takes the list's place
  const shown = useShown(key)
  const all = artifactsIn(snap, view)
  const whereOf = (a: Artifact) => {
    const at = placeOf(snap, a.place)
    return a.place !== one?.id && at.id === a.place ? at.name : null
  }
  // by its title, the task (or coordinator) that made it, and the place it lives in
  const list = q ? all.filter((a) => matches(q, a.title, a.by, whereOf(a) ?? undefined)) : all
  if (shown)
    return (
      <PanelArtifact
        art={shown}
        onBack={() => setShown(key, null)}
        // closed, the panel goes back to what shows beside the chat most: the tasks (a phone's chat)
        onClose={() => {
          setShown(key, null)
          setUI((u) => (u.device === 'phone' ? { tab: 'chat' } : { side: 'tasks' }))
        }}
      />
    )
  if (!all.length && !q)
    return (
      <>
        <ListChips alone />
        <Empty className="pt-3">
          No artifacts yet. Ask {one ? one.name : 'a coordinator'} for one: a report, a dashboard, a draft screen. Every agent can make them.
        </Empty>
      </>
    )
  return (
    <>
      <FilterBox
        label="Filter artifacts"
        hint={keys ? 'F' : undefined}
        value={value}
        onChange={(v) => setFilter(view.search, 'artifacts', v)}
        onKey={(e) => {
          if (e.key === 'Enter' && list[0]) {
            e.preventDefault()
            openArtifact(list[0].id)
          }
        }}
      >
        <ListChips />
      </FilterBox>
      {list.length ? (
        <List className="pt-1">
          {list.map((a) => {
            const where = whereOf(a)
            return (
              <Row key={a.id} two sel={open === a.id} onActivate={() => openArtifact(a.id)} className="gap-3! py-2!">
                <Thumb art={a} />
                <RowText
                  sub={
                    <>
                      {where ? <span className="text-fg3">{where} · </span> : null}v{a.v} · {a.by} · {a.when}
                    </>
                  }
                >
                  {a.title}
                </RowText>
              </Row>
            )
          })}
        </List>
      ) : (
        <Empty className="pt-3 text-fg3">No artifacts match “{q}”. Try another search or change the filters.</Empty>
      )}
    </>
  )
}

/** A chat's artifacts, newest first: the ones it made or updated, and any posted in it */
function useChatArtifacts(chatKey: string) {
  const all = useSnap()?.artifacts
  const chat = useChat(chatKey)
  return useMemo(() => {
    const posted = new Set(chat?.messages.flatMap((m) => (m.artifact ? [m.artifact.id] : [])))
    return (all ?? []).filter((a) => a.chats?.includes(chatKey) || posted.has(a.id))
  }, [all, chat, chatKey])
}

/** The artifacts of one chat, from its ⋯: a task's in its side panel, a coordinator's in place of its chat */
function ChatArtifacts({ chatKey }: { chatKey: string }) {
  const list = useChatArtifacts(chatKey)
  const open = useUI((u) => u.viewer?.artifact)
  if (!list.length) return <Empty className="pt-3">No artifacts in this chat yet. Ask for one: a report, a dashboard, a draft screen.</Empty>
  return (
    <List className="pt-1.5">
      {list.map((a) => (
        <Row key={a.id} two sel={open === a.id} onActivate={() => openArtifact(a.id)} className="gap-3! py-2!">
          <Thumb art={a} />
          <RowText
            sub={
              <>
                v{a.v} · {a.when}
              </>
            }
          >
            {a.title}
          </RowText>
        </Row>
      ))}
    </List>
  )
}

/** A coordinator chat flipped to its artifacts: the list, and the way back to the chat */
export function PlaceArtifacts({ chatKey }: { chatKey: string }) {
  return (
    <div className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain">
      <div className="mx-auto w-full max-w-[720px] pb-4">
        <div className="flex items-center justify-between gap-2 px-4 pt-3 phone:px-5">
          <h2 className="text-[0.8125rem] font-medium text-fg2 phone:text-[0.9375rem]">Artifacts in this chat</h2>
          <Ghost onClick={() => setUI({ arts: null })}>Back to the chat</Ghost>
        </div>
        <ChatArtifacts chatKey={chatKey} />
      </div>
    </div>
  )
}

/** Artifacts in a coordinator's ⋯, under Terminal: greyed while its chat has none, and opens all the same, to say so */
export function PlaceArtifactsItem({ place }: { place: { chat: string } }) {
  const on = useUI((u) => u.arts === place.chat)
  const off = !on && !useChatArtifacts(place.chat).length
  return (
    <MenuItem
      icon={<PageIcon className={ic} />}
      data-off={off ? '' : undefined}
      className={clsx(off && 'text-fg3')}
      onClick={() => setUI({ arts: on ? null : place.chat, term: null, menu: false, plus: null, pick: null })}
    >
      {on ? 'Back to the chat' : 'Artifacts'}
    </MenuItem>
  )
}

/** a task's Artifacts tab: its chat's, or one shown in the panel */
export function TaskArtifacts({ chatKey }: { chatKey: string }) {
  const key = `chat:${chatKey}`
  const shown = useShown(key)
  const device = useUI((u) => u.device)
  if (!shown) return <ChatArtifacts chatKey={chatKey} />
  return (
    <PanelArtifact art={shown} onBack={() => setShown(key, null)} onClose={() => (setShown(key, null), device === 'desktop' ? togglePanel() : closeSheet())} />
  )
}

/** a task's side panel item: greyed while its chat has none and none is shown there */
export function useTaskOff(task: Task) {
  const none = !useChatArtifacts(task.agent?.chat ?? '').length
  const shown = useShown(`chat:${task.agent?.chat ?? ''}`)
  return none && !shown ? `${task.id}'s chat has no artifacts yet.` : null
}
