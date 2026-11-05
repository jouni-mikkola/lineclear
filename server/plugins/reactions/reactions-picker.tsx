import clsx from 'clsx'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { setUI, useStore, useUI } from '@client/kernel.ts'
import { moveTo, project, settleMs, useMotion } from '@client/motion.ts'
import { useDialogFocus } from '@client/focus.ts'
import { follow as followFinger, mayPanDown } from '@client/gestures.ts'
import { ClockIcon, ic, SearchIcon } from '@client/ui.tsx'
import type { Message } from '@shared/types.ts'
import { frequent, loadEmoji, search, setTone, tone, TONES, withTone, type Emoji, type Group } from './emoji.ts'
import { yoursRing, useNextTo, useEscape, close, react, Backdrop, mine, anchorOf, Bar } from './reactions-bar.tsx'

/** every emoji to pick from: a search, a skin tone, the groups (frequently used first) as tabs over one scrolling grid,
 *  and (with a hint) the one under the pointer named at the foot. The reactions' picker, and anything else picking one
 *  (a machine's emoji). */
export function EmojiChooser({
  onPick,
  chosen,
  focus,
  hint,
}: {
  onPick: (e: string) => void
  chosen?: (e: string) => boolean
  focus?: boolean
  hint?: string
}) {
  const grid = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [q, setQ] = useState('')
  const [skin, setSkin] = useState(tone)
  const [tones, setTones] = useState(false)
  const [on, setOn] = useState(0)
  const [hover, setHover] = useState<Emoji | null>(null)
  const used = useMemo(() => frequent(), [])
  useEffect(() => {
    loadEmoji().then(setGroups)
    // a phone keeps its keyboard down until you tap the search
    if (focus) input.current?.focus({ preventScroll: true })
  }, [focus])

  const named = useMemo(() => new Map(groups?.flatMap((g) => g.list.map((x) => [x.e, x] as const))), [groups])
  const found = useMemo(() => (groups && q.trim() ? search(groups, q) : null), [groups, q])
  const sections: { name: string; icon?: string; list: Emoji[] }[] = [
    ...(used.length ? [{ name: 'Frequently used', list: used.map((e) => named.get(e) ?? { e, tone: false, name: e, codes: '', words: '' }) }] : []),
    ...(groups ?? []),
  ]
  const pick = (x: Emoji) => onPick(x.tone ? withTone(x.e, skin) : x.e)
  const jump = (i: number) => {
    const s = grid.current?.querySelectorAll<HTMLElement>('section')[i]
    if (s && grid.current) grid.current.scrollTop = s.offsetTop - grid.current.offsetTop
    setOn(i)
  }
  const follow = () => {
    const g = grid.current
    if (!g) return
    const all = [...g.querySelectorAll<HTMLElement>('section')]
    let i = 0
    all.forEach((s, j) => s.offsetTop - g.offsetTop <= g.scrollTop + 8 && (i = j))
    if (i !== on) setOn(i)
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && found?.[0]) {
      e.preventDefault()
      e.stopPropagation()
      pick(found[0])
    }
  }
  const cell = (x: Emoji, key: string) => {
    const e = x.tone ? withTone(x.e, skin) : x.e
    return (
      <button
        key={key}
        type="button"
        aria-label={x.name}
        aria-pressed={chosen?.(e) ?? false}
        onClick={() => pick(x)}
        onPointerEnter={() => setHover(x)}
        onFocus={() => setHover(x)}
        className={clsx(
          'grid aspect-square place-items-center rounded-full text-[1.5rem] leading-none hover:bg-hover focus-visible:bg-hover phone:text-[1.625rem]',
          yoursRing,
        )}
      >
        {e}
      </button>
    )
  }
  const gridCls = 'grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] px-2 phone:grid-cols-[repeat(auto-fill,minmax(44px,1fr))]'

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 p-2 pb-1">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-sel px-3 text-fg3 focus-within:shadow-box-focus coarse:h-11 phone:h-11">
          <SearchIcon className={ic} />
          <input
            ref={input}
            name="emoji-search"
            aria-label="Search emoji"
            placeholder="Search emoji"
            autoComplete="off"
            enterKeyHint="go"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={keys}
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg3 phone:text-[1rem]"
          />
        </label>
        <button
          type="button"
          aria-label="Skin tone"
          aria-expanded={tones}
          onClick={() => setTones(!tones)}
          className="grid size-9 shrink-0 place-items-center rounded-full text-[1.25rem] hover:bg-hover aria-expanded:bg-sel coarse:size-11 phone:size-11"
        >
          {TONES[skin]}
        </button>
      </div>
      {tones ? (
        <div role="group" aria-label="Skin tone" className="flex shrink-0 justify-end gap-0.5 px-2 pb-1">
          {TONES.map((t, i) => (
            <button
              key={t}
              type="button"
              aria-label={i ? `Skin tone ${i}` : 'No skin tone'}
              aria-pressed={i === skin}
              onClick={() => {
                setSkin(i)
                setTone(i)
                setTones(false)
              }}
              className="grid size-9 place-items-center rounded-full text-[1.25rem] hover:bg-hover aria-pressed:bg-sel coarse:size-11 phone:size-11"
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
      {!found ? (
        <div role="tablist" aria-label="Emoji groups" className="flex shrink-0 justify-between border-b border-line px-1.5">
          {sections.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={i === on}
              aria-label={s.name}
              onClick={() => jump(i)}
              className="group grid h-9 min-w-0 flex-1 place-items-center rounded-full text-[1.0625rem] text-fg3 hover:bg-hover aria-selected:text-fg coarse:h-11 phone:h-11"
            >
              <span className="relative grid h-full place-items-center">
                {s.icon ? (
                  <span className="opacity-55 grayscale group-aria-selected:opacity-100 group-aria-selected:grayscale-0">{s.icon}</span>
                ) : (
                  <ClockIcon className={ic} />
                )}
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full group-aria-selected:bg-fg" />
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {/* dragging the emoji puts the keyboard away, like a list on iOS: the sheet grows back to show more */}
      <div
        ref={grid}
        onScroll={follow}
        onTouchMove={() => document.activeElement === input.current && input.current?.blur()}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2"
      >
        {!groups ? (
          <div className="p-6 text-center text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">Loading emoji…</div>
        ) : found ? (
          found.length ? (
            <div className={clsx(gridCls, 'pt-1')}>{found.slice(0, 160).map((x) => cell(x, x.e))}</div>
          ) : (
            <div className="p-6 text-center text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">No emoji found for “{q.trim()}”</div>
          )
        ) : (
          sections.map((s) => (
            // a group off screen isn't drawn until scrolled to: two thousand emoji stay light on a phone
            <section key={s.name} aria-label={s.name} className="[contain-intrinsic-size:auto_480px] [content-visibility:auto]">
              <h3 className="sticky top-0 z-[1] bg-bg/95 px-3 pt-2 pb-1 text-[0.75rem] font-medium text-fg2 phone:text-[0.8125rem]">{s.name}</h3>
              <div className={gridCls}>{s.list.map((x) => cell(x, `${s.name}:${x.e}`))}</div>
            </section>
          ))
        )}
      </div>
      {hint ? (
        <div className="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-[0.75rem] text-fg2" aria-hidden="true">
          {hover ? (
            <>
              <span className="text-[1.125rem]">{hover.tone ? withTone(hover.e, skin) : hover.e}</span>
              <span className="truncate">{hover.name}</span>
            </>
          ) : (
            hint
          )}
        </div>
      ) : null}
    </>
  )
}

/* ---------- the full picker ---------- */

function Picker({ msg, chat, sheet }: { msg: Message; chat: string; sheet: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useNextTo(ref, chat, msg.id, [msg.id, sheet], sheet)
  useEscape(close)
  // Tab stays in it, and the focus goes back when it closes (a phone's keeps its keyboard down: nothing takes the focus)
  useDialogFocus(ref, { focus: false })
  // opened while typing, a phone's sheet takes the screen the keyboard had; the box gets it back with the pick (in the
  // tap itself, so a phone brings its keyboard up again), or as the sheet closes (above)
  const typing = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const box = document.activeElement
    if (!sheet || !(box instanceof HTMLTextAreaElement) || box.name !== 'message') return
    typing.current = box
    box.blur()
  }, [])
  // a sheet slides up and drags down to close; beside a message it springs out like a menu
  useMotion(ref, sheet ? 'sheet' : 'menu')
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (!sheet || !mayPanDown(e.target, el)) return
    const h = el.offsetHeight
    followFinger(e.nativeEvent, {
      axis: 'y',
      sign: 1,
      move: (d) => (el.style.transform = `translateY(${d > 0 ? d : d * 0.2}px)`),
      end: ({ d, v }) => {
        const away = project(d, v) > h * 0.35 && v > -0.1
        void moveTo(el, { transform: `translateY(${away ? h : 0}px)` }, away ? settleMs(h - d, v, 340) : 300).then(() => {
          if (!away) return void (el.style.transform = '')
          el.dataset.gone = ''
          close()
        })
      },
      cancel: () => (el.style.transform = ''),
    })
  }
  const pick = (e: string) => {
    typing.current?.focus({ preventScroll: true })
    return react(chat, msg.id, e)
  }

  return (
    <>
      <Backdrop z="z-[60]" dim={sheet} />
      <div
        ref={ref}
        role="dialog"
        aria-label="Pick an emoji"
        onPointerDown={drag}
        className={clsx(
          'fixed z-[60] flex flex-col overflow-hidden bg-bg',
          sheet
            ? // on what is visible: above the keyboard while searching, back down when it closes
              'inset-x-0 top-[calc(var(--app-h,100dvh)-var(--sheet-h))] h-(--sheet-h) rounded-t-box pb-[env(safe-area-inset-bottom)] shadow-dialog [--sheet-h:min(62dvh,480px,calc(var(--app-h,100dvh)-48px))] motion-safe:transition-[top,height] motion-safe:duration-250 motion-safe:ease-out'
            : 'invisible h-[420px] max-h-[calc(100dvh-16px)] w-[360px] max-w-[calc(100vw-16px)] rounded-box shadow-menu',
        )}
      >
        {/* the sheets' grabber */}
        {sheet ? (
          <div aria-hidden="true" className="flex h-5 shrink-0 justify-center pt-1.5">
            <div className="h-1 w-9 rounded-full bg-line2" />
          </div>
        ) : null}
        <EmojiChooser onPick={pick} chosen={(e) => mine(msg, e)} focus={!sheet} hint={sheet ? undefined : 'Pick an emoji to react'} />
      </div>
    </>
  )
}

/** the open bar or picker, for the message it was opened on */
export function Popup() {
  const ui = useUI()
  const chatKey = ui.pickChat ?? (ui.pick ? (anchorOf(null, ui.pick)?.dataset.chat ?? null) : null)
  const msg = useStore((s) => (chatKey && ui.pick ? s.chats[chatKey]?.messages.find((m) => m.id === ui.pick) : undefined))
  // the message went away (a reload), or the chat changed under it
  useEffect(() => {
    if (ui.pick && !msg) setUI({ pick: null, pickAll: false })
  }, [ui.pick, msg])
  if (!ui.pick || !msg || !chatKey) return null
  if (ui.pickAll) return <Picker key={msg.id} msg={msg} chat={chatKey} sheet={ui.device === 'phone' || !!ui.photo || !anchorOf(chatKey, msg.id)} />
  // over a picture opened full screen, its own row reacts
  if (ui.photo) return null
  return <Bar key={msg.id} msg={msg} chat={chatKey} />
}
