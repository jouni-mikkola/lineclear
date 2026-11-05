import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { act, setUI } from '@client/kernel.ts'
import { AWAY, buzz, SPRING, useMotion } from '@client/motion.ts'
import { useDialogFocus } from '@client/focus.ts'
import { CopyIcon, ic, MenuItem, PlusIcon, ReplyIcon, SelectIcon } from '@client/ui.tsx'
import type { Message } from '@shared/types.ts'
import { canReply, startReply } from '@plugins/chat/reply.ts'
import { quickRow, remember, tone } from './emoji.ts'

const WHO = { them: 'Agent', me: 'You', both: 'You and agent' }

/** the quick row: your most used, then the favourites, in this device's skin tone */
export const quick = () => quickRow(tone())

export const mine = (msg: Message, emoji: string) => !!msg.reactions?.some((r) => r.emoji === emoji && r.by !== 'them')

/** send a reaction: yours added, or taken back if it is yours already */
function send(chat: string, msg: string, emoji: string) {
  remember(emoji)
  return act({ type: 'react', chat, message: msg, emoji })
}

/** react and close the bar or picker */
export function react(chat: string, msg: string, emoji: string) {
  setUI({ pick: null, pickAll: false })
  return send(chat, msg, emoji)
}

/** where the hold was and how the bar was opened: a touch lifts the message and offers Reply, Copy and Select */
let opened: { x: number; y: number; touch: boolean } | null = null
function setOpened(value: typeof opened): void {
  opened = value
}

/** open the bar for a message; `at` is where a finger held it */
export function openBar(chat: string, msg: string, at?: { x: number; y: number; touch: boolean }) {
  setOpened(at ?? null)
  setUI({ pick: msg, pickChat: chat, pickAll: false, selecting: null })
}

/** open the full picker (from the bar, or over a picture) */
export const openPicker = (chat: string, msg: string) => setUI({ pick: msg, pickChat: chat, pickAll: true })

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** yours, the one look everywhere: a pill on a bubble, an emoji in the bar or the picker */
const YOURS = 'bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg))]'

/* ---------- on the bubble ---------- */

/** the reactions on a message: pills on its bubble's bottom right corner; tapping one toggles yours */
export function Pills({ msg, chat }: { msg: Message; chat: { key: string } }) {
  return (msg.reactions ?? []).map((r) => {
    const yours = r.by !== 'them'
    return (
      <button
        key={r.emoji}
        type="button"
        aria-label={`${r.emoji} from ${WHO[r.by].toLowerCase()}`}
        // a phone's keyboard stays up (chat's keepBox)
        data-keep-box
        aria-pressed={yours}
        onClick={() => react(chat.key, msg.id, r.emoji)}
        className={clsx(
          // a ring of the page's colour cuts each pill out of the bubble's edge; on a phone a finger finds it 8px above
          // and below too, 44px in all
          "relative inline-flex h-6 items-center gap-[3px] rounded-full px-[7px] text-[0.8125rem] phone:h-7 phone:px-2 phone:text-[0.9375rem] phone:after:absolute phone:after:-inset-y-2 phone:after:inset-x-0 phone:after:content-['']",
          yours
            ? clsx(YOURS, 'shadow-[0_0_0_2px_var(--bg),inset_0_0_0_1.5px_var(--accent)]')
            : 'bg-bg shadow-[0_0_0_2px_var(--bg),inset_0_0_0_1px_var(--line2)] hover:bg-[color-mix(in_srgb,var(--fg)_4%,var(--bg))]',
          r.pending && 'opacity-50',
        )}
      >
        {r.emoji}
        {r.by === 'both' ? <small className="text-[0.6875rem] text-fg2 tabular-nums phone:text-[0.75rem]">2</small> : null}
      </button>
    )
  })
}
export const yoursRing = 'aria-pressed:bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg))] aria-pressed:shadow-[inset_0_0_0_1.5px_var(--accent)]'

/* ---------- placing a popup next to the message ---------- */

export const anchorOf = (chat: string | null, msg: string) => {
  const sel = `[data-msg="${CSS.escape(msg)}"]${chat ? `[data-chat="${CSS.escape(chat)}"]` : ''}`
  return document.querySelector<HTMLElement>(sel) ?? document.querySelector<HTMLElement>(`[data-msg="${CSS.escape(msg)}"]`)
}

/** over the message (under it when there's no room), on its outer side, inside the screen */
export function useNextTo(ref: RefObject<HTMLElement | null>, chat: string, msg: string, deps: unknown[], off = false) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || off) return
    const put = () => {
      const m = 8
      const vw = document.documentElement.clientWidth
      const vh = visualViewport?.height ?? innerHeight
      const w = el.offsetWidth
      const h = el.offsetHeight
      const box = anchorOf(chat, msg)?.querySelector<HTMLElement>('[data-anchor]')
      const a = box?.getBoundingClientRect()
      let x = (vw - w) / 2
      let y = vh - h - 24
      if (a) {
        x = box!.closest('[data-you]') ? a.right - w : a.left
        if (a.top - h - m >= m) y = a.top - h - m
        else if (a.bottom + m + h <= vh - m) y = a.bottom + m
        // a message taller than the screen: by the finger that held it
        else if (opened) y = opened.y - h - 24 >= m ? opened.y - h - 24 : opened.y + 24
        else y = Math.max(a.top, m)
      }
      el.style.left = `${Math.round(Math.min(Math.max(m, x), vw - w - m))}px`
      el.style.top = `${Math.round(Math.min(Math.max(m, y), vh - h - m))}px`
      el.style.visibility = 'visible'
    }
    put()
    addEventListener('resize', put)
    return () => removeEventListener('resize', put)
  }, deps)
}

export const close = () => setUI({ pick: null, pickAll: false })

/** closes on Escape: before the app's own keys see it, so a picture under the picker stays open */
export function useEscape(close: () => void) {
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      close()
    }
    addEventListener('keydown', on, true)
    return () => removeEventListener('keydown', on, true)
  })
}

/** the shade behind a popup: a tap on it closes the popup; the finger lifting off the hold that opened it doesn't */
export function Backdrop({ dim, z }: { dim?: boolean; z: string }) {
  const down = useRef(false)
  const ref = useRef<HTMLDivElement>(null)
  // the sheets' shade, fading in and out with it
  useMotion(ref, 'fade')
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={clsx('fixed inset-0', z, dim && 'bg-black/35')}
      onPointerDown={() => (down.current = true)}
      onClick={() => down.current && close()}
      onWheel={close}
    />
  )
}

/* ---------- the bar ---------- */

/** the quick row and + for every emoji */
function Row({ msg, chat, pick, first }: { msg: Message; chat: string; pick: (e: string) => void; first?: RefObject<HTMLButtonElement | null> }) {
  return (
    <div role="group" aria-label="Reactions" className="flex gap-0.5 rounded-full bg-bg p-1 shadow-menu">
      {quick().map((e, i) => (
        <button
          key={e}
          ref={i ? undefined : first}
          type="button"
          aria-label={`React ${e}`}
          aria-pressed={mine(msg, e)}
          onClick={() => pick(e)}
          className={clsx(
            'grid size-9 place-items-center rounded-full text-[1.25rem] hover:bg-hover coarse:size-11 phone:size-11 phone:text-[1.375rem]',
            yoursRing,
          )}
        >
          {e}
        </button>
      ))}
      <button
        type="button"
        aria-label="More emoji"
        onClick={() => openPicker(chat, msg.id)}
        className="grid size-9 place-items-center rounded-full bg-sel text-fg2 hover:text-fg coarse:size-11 phone:size-11"
      >
        <PlusIcon className={ic} />
      </button>
    </div>
  )
}

/** with a mouse or the keyboard: the bar beside the message, the chat left as it is (like Slack and WhatsApp on the web) */
function Beside({ msg, chat }: { msg: Message; chat: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  useNextTo(ref, chat, msg.id, [msg.id])
  useEscape(close)
  // it springs out like a menu, and hands the focus back when it closes
  useMotion(ref, 'menu')
  useDialogFocus(ref, { focus: false })
  useEffect(() => {
    // from the keyboard, the first emoji takes the focus; a mouse leaves it where it is
    if (!opened) first.current?.focus({ preventScroll: true })
    // the chat moving under it: the bar would point at the wrong place
    addEventListener('scroll', close, true)
    return () => removeEventListener('scroll', close, true)
  }, [])
  return (
    <>
      <Backdrop z="z-40" />
      <div
        ref={ref}
        role="dialog"
        aria-label="React"
        className={clsx('invisible fixed z-40 flex', msg.who === 'you' ? 'origin-bottom-right justify-end' : 'origin-bottom-left justify-start')}
      >
        <Row msg={msg} chat={chat} first={first} pick={(e) => react(chat, msg.id, e)} />
      </div>
    </>
  )
}

/** gaps: the bar above the message, the menu below it, and the screen's edge */
const ABOVE = 12
const BELOW = 8
const EDGE = 8

/** On a touch screen, like iMessage and Telegram: the message lifts out of the chat, which dims and blurs behind it.
    Your emoji sit above it and the menu below it, on its side, inside the screen; the message moves to make room, and
    one too tall to fit shows the part the finger held. Picking anything, or a tap outside, sets it back down. */
function Lifted({ msg, chat }: { msg: Message; chat: string }) {
  const root = useRef<HTMLDivElement>(null)
  const shade = useRef<HTMLDivElement>(null)
  const lift = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  // how far the message moved from its place in the chat, to go back
  const moved = useRef(0)
  const leaving = useRef(false)
  const you = msg.who === 'you'
  const text = msg.text ?? ''

  useLayoutEffect(() => {
    const anchor = anchorOf(chat, msg.id)?.querySelector<HTMLElement>('[data-anchor]')
    const r = root.current!
    const l = lift.current!
    const b = bar.current!
    const m = menu.current
    if (!anchor) return close()
    const pad = getComputedStyle(r)
    const vw = r.clientWidth
    const top = parseFloat(pad.paddingTop) + EDGE
    const bottom = r.clientHeight - parseFloat(pad.paddingBottom) - EDGE
    // its place in the chat, before the press shrank it
    const at = anchor.getBoundingClientRect()
    const w = anchor.offsetWidth
    const h = anchor.offsetHeight
    const x0 = at.left + at.width / 2 - w / 2
    const y0 = at.top + at.height / 2 - h / 2
    const bh = b.offsetHeight
    // a short screen (the keyboard up): the message shrinks to make room, down to a line; below that the menu gives way,
    // so the emoji always fit
    const room = (menu: number) => bottom - top - bh - ABOVE - menu
    const least = Math.min(h, 40)
    let mh = m ? m.offsetHeight + BELOW : 0
    if (m && room(mh) < least) {
      m.style.display = 'none'
      mh = 0
    }
    const shown = Math.max(Math.min(h, room(mh)), Math.min(least, room(0)), 0)
    // too tall to fit: the part around the finger
    const cut = h > shown ? Math.min(Math.max((opened?.y ?? y0) - y0 - shown / 2, 0), h - shown) : 0
    // the bar stays on screen before all else
    const y = Math.max(Math.min(y0 + cut, bottom - mh - shown), top + bh + ABOVE)
    moved.current = y0 + cut - y

    const copy = anchor.cloneNode(true) as HTMLElement
    for (const a of ['data-anchor', 'data-pressing', 'tabindex', 'title', 'aria-label']) copy.removeAttribute(a)
    copy.style.cssText = `width:${w}px;margin:0;box-shadow:none;transform:translateY(${-cut}px)`
    l.replaceChildren(copy)
    Object.assign(l.style, { left: `${x0}px`, top: `${y}px`, width: `${w}px`, height: `${shown}px` })
    // a cut edge fades out
    if (shown < h)
      l.style.maskImage = `linear-gradient(${cut ? 'transparent, #000 24px' : '#000, #000'}, ${cut + shown < h ? '#000 calc(100% - 24px), transparent' : '#000, #000'})`
    const side = (el: HTMLElement) => {
      const ew = el.offsetWidth
      el.style.left = `${Math.min(Math.max(EDGE, you ? x0 + w - ew : x0), vw - ew - EDGE)}px`
    }
    side(b)
    b.style.top = `${y - ABOVE - bh}px`
    if (m) {
      side(m)
      m.style.top = `${y + shown + BELOW}px`
    }
    r.style.visibility = 'visible'
    anchor.style.visibility = 'hidden'
    getSelection()?.removeAllRanges()

    shade.current!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
    if (still()) {
      for (const el of [b, m]) el?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
    } else {
      // from where it sat, pressed down, up into place; the bar and menu grow out of its side
      l.animate([{ transform: `translateY(${moved.current}px) scale(.96)` }, { transform: 'none' }], { duration: 420, easing: SPRING })
      b.animate(
        [
          { opacity: 0, transform: 'scale(.5)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 360, easing: SPRING },
      )
      b.querySelectorAll('button').forEach((e, i) =>
        e.animate(
          [
            { opacity: 0, transform: 'scale(.3)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 320, delay: 30 + i * 20, easing: SPRING, fill: 'backwards' },
        ),
      )
      // the menu springs out like every menu
      m?.animate(
        [
          { opacity: 0, transform: 'scale(.9)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 280, easing: SPRING },
      )
    }
    // the screen changing under it (turned, the keyboard): it would point at the wrong place
    const gone = () => close()
    visualViewport?.addEventListener('resize', gone)
    addEventListener('resize', gone)
    return () => {
      anchor.style.visibility = ''
      visualViewport?.removeEventListener('resize', gone)
      removeEventListener('resize', gone)
    }
  }, [msg.id])

  /** set the message back down, then do what was picked */
  const leave = (then: () => void = close) => {
    if (leaving.current) return
    leaving.current = true
    const ms = still() ? 120 : 200
    const opt = { duration: ms, easing: AWAY, fill: 'forwards' as const }
    shade.current?.animate([{ opacity: 1 }, { opacity: 0 }], opt)
    if (!still()) lift.current?.animate([{ transform: 'none' }, { transform: `translateY(${moved.current}px)` }], opt)
    for (const el of [bar.current, menu.current]) el?.animate([{ opacity: 1 }, { opacity: 0, transform: still() ? 'none' : 'scale(.85)' }], opt)
    setTimeout(then, ms)
  }
  useEscape(() => leave())
  const pick = (e: string) => {
    if (leaving.current) return
    buzz()
    send(chat, msg.id, e)
    leave()
  }
  const down = useRef(false)

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="React"
      // held while typing, the keyboard stays up through it (chat's keepBox)
      data-keep-box
      className="invisible fixed inset-x-0 top-0 z-40 h-[var(--app-h,100dvh)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] select-none [-webkit-touch-callout:none]"
    >
      {/* a tap outside sets it down; the finger lifting off the hold that opened it doesn't */}
      <div
        ref={shade}
        aria-hidden="true"
        onPointerDown={() => (down.current = true)}
        onClick={() => down.current && leave()}
        onWheel={close}
        className="absolute inset-0 touch-none bg-black/20 backdrop-blur-[10px] dark:bg-black/45"
      />
      <div ref={lift} aria-hidden="true" className="pointer-events-none absolute overflow-hidden" />
      <div ref={bar} className={clsx('absolute', you ? 'origin-bottom-right' : 'origin-bottom-left')}>
        <Row msg={msg} chat={chat} pick={pick} />
      </div>
      {canReply(msg) ? (
        <div ref={menu} role="menu" aria-label="Message" className={clsx('popover absolute w-56', you ? 'origin-top-right' : 'origin-top-left')}>
          <MenuItem icon={<ReplyIcon className={ic} />} onClick={() => startReply(chat, msg)}>
            Reply
          </MenuItem>
          {text ? (
            <>
              <MenuItem
                icon={<CopyIcon className={ic} />}
                onClick={() => {
                  // in the tap itself: Safari copies only then
                  navigator.clipboard?.writeText(text).catch(() => {})
                  leave()
                }}
              >
                Copy
              </MenuItem>
              {/* an update card is one short line: Copy takes it all */}
              {msg.card ? null : (
                <MenuItem icon={<SelectIcon className={ic} />} onClick={() => leave(() => setUI({ pick: null, pickAll: false, selecting: msg.id }))}>
                  Select text
                </MenuItem>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function Bar({ msg, chat }: { msg: Message; chat: string }) {
  return opened?.touch ? <Lifted msg={msg} chat={chat} /> : <Beside msg={msg} chat={chat} />
}
