import clsx from 'clsx'
import { useEffect, useRef, type ComponentType, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { setOutbox, useUI } from '@client/kernel.ts'
import type { Outgoing } from '@client/outbox.ts'
import { DeleteIcon, field, FileIcon, ic, Menu, MenuItem, MoreIcon, PageIcon, PlanIcon, QuestionIcon, ReplyIcon, SmileIcon } from '@client/ui.tsx'
import type { Message, Question, ReplyQuote } from '@shared/types.ts'
import { buzz, openBar } from '@plugins/reactions/client.tsx'
import { EDGE } from '@client/gestures.ts'
import { jumpTo, startReply } from './reply.ts'

/* ---------- messages ---------- */

/** Human messages, including full task briefs and generated settings, exactly as written. */
export function YourText({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap wrap-anywhere">{text}</div>
}

/** the reaction bar is open on this message (one bubble redraws when it opens, not every one) */
export const usePicked = (id: string, chat: string) => useUI((u) => u.pick === id && (u.pickChat ?? chat) === chat)

export function From({ children }: { children: ReactNode }) {
  return <div className="mb-0.5 text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{children}</div>
}

type At = { x: number; y: number; touch: boolean }
/** when a finger last scrolled the chat, its fling included: a finger that lands on a moving chat stops it, it doesn't
    hold a message. The chat following a reply as it comes in doesn't count. */
export let scrolled = 0
export function setScrolled(value: typeof scrolled): void {
  scrolled = value
}

/** Telegram's timing: nothing for the first 120 ms (a tap, or a scroll starting), then the bubble eases down over the
    rest of the hold and it opens; slower than a tap, quicker than Safari's own long press */
const HOLD = 380
/** how far the chat slides left to show every message's time (like iMessage) */
const PEEK = 80

/** how far a message slides right before letting go replies to it (like WhatsApp and Telegram) */
const SWIPE = 64

/** on a touch screen, holding a message (or tapping it twice) does fn, with a light tap from the phone; sliding it
    right replies (swipe), sliding it left shows every message's time while the finger stays; scrolling, a tap on a link or a picture, a swipe from the screen's edge and a mouse are left
    alone */
export function useHold(fn: ((at: At) => void) | null, swipe: (() => void) | null = null) {
  const r = useRef<{
    x: number
    y: number
    touch: boolean
    fired: boolean
    last: number
    el?: HTMLElement
    timer?: ReturnType<typeof setTimeout>
    slide?: 'on' | 'peek' | 'off'
    dx: number
    armed?: boolean
  }>({
    x: 0,
    y: 0,
    touch: false,
    fired: false,
    last: 0,
    dx: 0,
  })
  const cancel = () => {
    clearTimeout(r.current.timer)
    r.current.el?.removeAttribute('data-pressing')
  }
  /** the message the finger slides: its bubble with what hangs off it, or the album a picture is in, and the reply
      arrow beside it */
  const row = () =>
    (r.current.slide === 'peek'
      ? r.current.el?.closest<HTMLElement>('[data-messages]')
      : (r.current.el?.closest<HTMLElement>('[data-slide]') ?? r.current.el?.closest<HTMLElement>('[data-msg]'))) ?? null
  const slideBack = () => {
    const el = row()
    const dx = r.current.dx
    r.current.slide = undefined
    r.current.dx = 0
    if (!el || !dx) return
    el.style.removeProperty('translate')
    el.style.removeProperty('--swipe')
    el.style.removeProperty('--peek')
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      el.animate([{ translate: `${dx}px 0` }, { translate: '0 0' }], { duration: 220, easing: 'cubic-bezier(.25, 1.12, .4, 1)' })
  }
  useEffect(() => cancel, [])
  if (!fn && !swipe) return {}
  const fire = () => {
    cancel()
    r.current.fired = true
    buzz()
    fn?.({ x: r.current.x, y: r.current.y, touch: true })
  }
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      cancel()
      const touch = e.pointerType !== 'mouse'
      const again = touch && Date.now() - r.current.last < 300 && Math.hypot(e.clientX - r.current.x, e.clientY - r.current.y) < 24
      r.current = { ...r.current, x: e.clientX, y: e.clientY, touch, fired: false, el: e.currentTarget, slide: undefined, dx: 0, armed: false }
      // a swipe from the screen's edge is the screen's (it goes back, or opens the places)
      if (!touch || Date.now() - scrolled < 250 || e.clientX < EDGE) return
      r.current.armed = true
      if (!fn) return
      if (again) {
        r.current.last = 0
        return fire()
      }
      // pressed in by about 15px across, like Telegram: the same feel on a short bubble and a wide one
      const el = e.currentTarget
      el.style.setProperty('--press', String(Math.max(0.9, (el.offsetWidth - 15) / el.offsetWidth)))
      el.setAttribute('data-pressing', '')
      r.current.timer = setTimeout(fire, HOLD)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const dx = e.clientX - r.current.x
      const dy = e.clientY - r.current.y
      if (Math.hypot(dx, dy) > 10) cancel()
      if (!r.current.armed || r.current.fired || r.current.slide === 'off') return
      if (!r.current.slide) {
        if (Math.hypot(dx, dy) < 10) return
        // mostly rightwards: a reply; leftwards: every message's time; up or down is a scroll, and the browser has it
        if (Math.abs(dx) < Math.abs(dy) * 1.5 || (dx > 0 && !swipe)) return void (r.current.slide = 'off')
        r.current.slide = dx > 0 ? 'on' : 'peek'
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }
      const el = row()
      if (!el) return
      if (r.current.slide === 'peek') {
        // the chat follows the finger left as far as the times need, then holds back
        const x = Math.min(0, dx >= -PEEK ? dx : -PEEK + (dx + PEEK) * 0.25)
        r.current.dx = x
        el.style.translate = `${x}px 0`
        el.style.setProperty('--peek', String(Math.min(1, -x / PEEK)))
        return
      }
      // it follows the finger to the mark, then holds back
      const x = Math.max(0, dx <= SWIPE ? dx : SWIPE + (dx - SWIPE) * 0.25)
      if (x >= SWIPE && r.current.dx < SWIPE) buzz()
      r.current.dx = x
      el.style.translate = `${x}px 0`
      el.style.setProperty('--swipe', String(Math.min(1, x / SWIPE)))
    },
    onPointerUp: () => {
      cancel()
      if (r.current.slide === 'peek') {
        r.current.fired = true
        r.current.last = 0
        slideBack()
        return
      }
      if (r.current.slide === 'on') {
        const go = r.current.dx >= SWIPE
        // the tap that ends a slide opens nothing
        r.current.fired = true
        r.current.last = 0
        slideBack()
        if (go) swipe?.()
        return
      }
      r.current.last = r.current.touch && !r.current.fired ? Date.now() : 0
    },
    onPointerCancel: () => {
      cancel()
      slideBack()
      r.current.last = 0
    },
    // the tap that ends a hold opens nothing
    onClickCapture: (e: MouseEvent) => {
      if (!r.current.fired) return
      e.preventDefault()
      e.stopPropagation()
      r.current.fired = false
    },
    // a long press on Android also asks for the browser's own menu
    onContextMenu: (e: MouseEvent) => r.current.touch && e.preventDefault(),
    // sideways swipes on it are its own, not the screen's (gestures.ts)
    'data-hold': '',
  }
}

/** a tap on a quote (or the box's reply line) jumps to the message it answers and lights it up; a div with the
    button role, not a button: a button leaves its width out of its parent's */
export function jumps(chat: string, q: ReplyQuote, label: string) {
  if (!q.id) return {}
  const jump = (e: { stopPropagation(): void }) => {
    e.stopPropagation()
    jumpTo(chat, q.id!)
  }
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': `${label}: ${q.text}. Show it`,
    onClick: jump,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      jump(e)
    },
  }
}

/** the quote on a reply: one line of the message it answers, in that message's own shade, tucked under the top of the
    reply (like Messenger and iMessage). It takes no width of its own: the message stays as wide as its bubble (so
    reactions and the buttons beside it stay by it) and a long quote reaches past a short reply toward the middle.
    loose: on its own, not tucked (a card answered in the chat quotes the message that answered it) */
export function Quote({
  q,
  chat,
  from,
  you,
  loose,
  label = 'Replying to',
}: {
  q: ReplyQuote
  chat: string
  from: string
  you: boolean
  loose?: boolean
  label?: string
}) {
  const name = q.who === 'you' ? 'You' : q.who === 'agent' ? from : null
  return (
    <div className={clsx('relative flex', loose ? 'min-w-0' : '-mb-2 w-0 min-w-full', you ? 'justify-end' : 'justify-start')}>
      <div
        {...jumps(chat, q, `${label} ${name ?? 'a message'}`)}
        data-quote
        className={clsx(
          'truncate rounded-bubble px-3 text-[0.8125rem] text-fg2 phone:text-[0.875rem]',
          // the reply covers its bottom 8px: the words sit in the part that shows
          loose ? 'min-w-0 py-1 phone:py-1.5' : 'max-w-[min(18rem,calc(100vw-5rem))] shrink-0 pt-1 pb-3 phone:pt-1.5 phone:pb-3.5',
          q.who === 'you' ? 'bg-reply' : 'bg-bubble',
          loose ? null : you ? 'mr-2' : 'ml-2',
          q.id && 'cursor-pointer hover:text-fg',
        )}
      >
        {name ? <span className="mr-0.5 font-medium">{name} </span> : null}
        {q.file ? <FileIcon className="mr-1 inline size-3.5 align-[-2px]" /> : null}
        {q.artifact ? <PageIcon className="mr-1 inline size-3.5 align-[-2px]" /> : null}
        {q.text}
      </div>
    </div>
  )
}

/** the reply arrow that comes in beside a message as a finger slides it right */
export function SwipeHint() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 right-full mr-2 grid size-8 -translate-y-1/2 scale-[calc(0.5+0.5*var(--swipe,0))] place-items-center rounded-full bg-bubble text-fg2 opacity-[var(--swipe,0)] pointer-fine:hidden"
    >
      <ReplyIcon className={ic} />
    </span>
  )
}

/** with a mouse, a smiley and a reply arrow beside the message (like Slack and WhatsApp on the web) */
export function Beside({
  msg,
  chat,
  you,
  picked,
  react,
  reply,
  more,
  name,
  over,
}: {
  msg: Message
  chat: string
  you: boolean
  picked: boolean
  react: boolean
  reply: boolean
  more?: () => void
  name?: string
  over?: boolean
}) {
  if (!react && !reply && !more) return null
  const btn = over
    ? 'grid size-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70'
    : 'grid size-7 place-items-center rounded-full text-fg3 hover:bg-hover hover:text-fg2'
  return (
    <div
      className={clsx(
        'absolute hidden items-center gap-0.5 transition-opacity focus-within:opacity-100 pointer-fine:flex',
        over ? 'top-1 right-1 gap-1' : clsx('top-1.5', you ? 'right-full mr-1 flex-row-reverse' : 'left-full ml-1'),
        picked ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100',
      )}
    >
      {react ? (
        <button
          type="button"
          aria-label={name ? `React to ${name}` : 'React'}
          onClick={(e) => openBar(chat, msg.id, e.detail ? { x: e.clientX, y: e.clientY, touch: false } : undefined)}
          className={clsx(btn, picked && !over && 'bg-hover text-fg2')}
        >
          <SmileIcon className={ic} />
        </button>
      ) : null}
      {reply ? (
        <button type="button" aria-label={name ? `Reply to ${name}` : 'Reply'} onClick={() => startReply(chat, msg)} className={btn}>
          <ReplyIcon className={ic} />
        </button>
      ) : null}
      {more ? (
        <button
          type="button"
          aria-label={name ? `More for ${name}` : 'More'}
          aria-haspopup="menu"
          onClick={more}
          className={clsx(btn, picked && !over && 'bg-hover text-fg2')}
        >
          <MoreIcon className={ic} />
        </button>
      ) : null}
    </div>
  )
}

/** take one you sent out of the chat, its words and files with it */
export const removeOut = (cid: string) => setOutbox((all) => all.filter((o) => o.cid !== cid))

/** a hold on one still on its way (or ⋯ beside it, with a mouse): Remove takes it out, should it never come back. It
 *  opens above it: what is on its way is always at the end of the chat, over the box */
export function PendingMenu({ out, onClose }: { out: Outgoing; onClose: () => void }) {
  return (
    <Menu label="Message" onClose={onClose} className="absolute right-0 bottom-full z-21 mb-1.5 w-max min-w-0! origin-bottom-right">
      <MenuItem
        icon={<DeleteIcon className={ic} />}
        onClick={() => {
          onClose()
          removeOut(out.cid)
        }}
      >
        Remove
      </MenuItem>
    </Menu>
  )
}

export function SessionLine() {
  return (
    <div className="flex items-center gap-3 text-[0.75rem] font-medium text-fg3 phone:text-[0.8125rem]" role="separator">
      <span className="h-px flex-1 bg-line" />
      New session
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

export const cardBox =
  'relative flex max-w-full items-center gap-2 self-start rounded-box px-3 py-2 text-left text-[0.9375rem] shadow-[inset_0_0_0_1px_var(--line2)]'
/** the card's words on one line: cut short with an ellipsis where the chat is narrow, what follows them kept whole */
export const cardLine = 'flex min-w-0 items-baseline whitespace-nowrap'
export const cardAside = 'shrink-0 text-[0.8125rem] text-fg2'

export const NOW: Record<string, string> = { done: 'done', work: 'working', ready: 'ready', merging: 'merging', queued: 'queued' }

/** a task's pull request on its card: a link of its own (the card itself opens the task), so it is no <a> inside the
    card's button */
export function PrOnCard({ pr, className }: { pr: { number: number; url: string }; className?: string }) {
  const open = (e: { stopPropagation(): void; preventDefault(): void }) => {
    e.stopPropagation()
    e.preventDefault()
    window.open(pr.url, '_blank', 'noopener')
  }
  return (
    <span
      role="link"
      tabIndex={0}
      data-pr={pr.number}
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(e)}
      onPointerDown={(e) => e.stopPropagation()}
      className={clsx('inline-block font-medium text-focus tabular-nums hover:underline', className)}
    >
      PR #{pr.number}
    </span>
  )
}

/* ---------- question cards: forms, a CLI's own questions, plans ---------- */

/** a question's card: one width whatever its choices (the chat's width on a phone), its title in a header under a
 *  question mark, or a list for a plan. The title wraps onto as many lines as it needs, the mark on its first line */
export type CardSource = { id: string; title?: string }

export function CardShell({
  title,
  plan,
  icon,
  action,
  source,
  children,
}: {
  title: string
  plan?: boolean
  icon?: ComponentType<{ className?: string }>
  action?: ReactNode
  source?: CardSource
  children: ReactNode
}) {
  const Icon = icon ?? (plan ? PlanIcon : QuestionIcon)
  return (
    <div data-card className="mt-2 w-[440px] max-w-full cursor-default overflow-hidden rounded-box bg-bg shadow-[inset_0_0_0_1px_var(--line2)]">
      {source ? (
        <div data-card-source className="px-3 pt-2 text-[0.8125rem] break-words text-fg2">
          <span className="font-semibold">{source.id}</span>
          {source.title ? ` · ${source.title}` : ''}
        </div>
      ) : null}
      <div className="flex items-start gap-2 border-b border-line py-2 pr-2 pl-3 text-[0.9375rem]">
        <Icon className={clsx(ic, 'mt-[3px] text-fg2')} />
        <b data-card-title className="min-w-0 flex-1 font-semibold text-pretty break-words">
          {title}
        </b>
        {action}
      </div>
      <div className="flex flex-col gap-2 p-3">{children}</div>
    </div>
  )
}

export const noteBox = clsx(
  'min-h-10 w-full resize-none rounded-row bg-transparent px-3 py-[9px] placeholder:text-fg3 coarse:min-h-11 phone:min-h-11 phone:text-[1rem]',
  field,
)

/** how a card was answered: a pick (or an Other answer) on it, a message in the chat, or the CLI's own terminal */
export function answeredHow(q: Question) {
  if (q.via === 'chat') return 'Answered in chat'
  if (q.via === 'terminal') return 'Answered in the terminal'
  return q.sent === -1 && !q.said ? 'Answered' : `Sent to ${q.to}`
}
