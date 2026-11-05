import clsx from 'clsx'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { Status, Report } from '@shared/types.ts'
import { TALKING, type Sample } from './meter.ts'

/** Voice waveform: no Heroicon exists for it */
export function WaveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-none stroke-current', className)} strokeWidth={1.6} strokeLinecap="round">
      <path d="M2.5 7v2M5 5v6M8 3v10M11 5v6M13.5 7v2" />
    </svg>
  )
}

/** A muted microphone: the Heroicon microphone, struck through. No Heroicon exists for it */
export function MicOffIcon({ className }: { className?: string }) {
  const gap = useId()
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-current', className)}>
      <mask id={gap}>
        <rect width="16" height="16" fill="white" />
        <path d="M2 2l12 12" stroke="black" strokeWidth={3.5} />
      </mask>
      <g mask={`url(#${CSS.escape(gap)})`}>
        <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 1 0 4 0V3a2 2 0 0 0-2-2Z" />
        <path d="M4.5 7A.75.75 0 0 0 3 7a5.001 5.001 0 0 0 4.25 4.944V13.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.556A5.001 5.001 0 0 0 13 7a.75.75 0 0 0-1.5 0 3.5 3.5 0 1 1-7 0Z" />
      </g>
      <path d="M2.5 2.5l11 11" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

/** A keyboard: keys cut out of a rounded box. No Heroicon exists for it */
export function KeyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-current', className)}>
      <path
        fillRule="evenodd"
        d="M14 6a4 4 0 0 1-4.899 3.899l-1.955 1.955a.5.5 0 0 1-.353.146H5v1.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2.293a.5.5 0 0 1 .146-.353l3.955-3.955A4 4 0 1 1 14 6Zm-4-2a.75.75 0 0 0 0 1.5.5.5 0 0 1 .5.5.75.75 0 0 0 1.5 0 2 2 0 0 0-2-2Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function KeyboardIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-current', className)}>
      <path
        fillRule="evenodd"
        d="M3 3.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2ZM3.5 5.25h1.5v1.25h-1.5ZM6 5.25h1.5v1.25h-1.5ZM8.5 5.25h1.5v1.25h-1.5ZM11 5.25h1.5v1.25h-1.5ZM3.5 7.5h1.5v1.25h-1.5ZM6 7.5h1.5v1.25h-1.5ZM8.5 7.5h1.5v1.25h-1.5ZM11 7.5h1.5v1.25h-1.5ZM5 9.75h6v1.25H5Z"
      />
    </svg>
  )
}

/** A window with its left panel filled: shows or hides the sidebar. No Heroicon exists for it */
export function SidebarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-current', className)}>
      <path
        fillRule="evenodd"
        d="M4 2.5h8A2.5 2.5 0 0 1 14.5 5v6a2.5 2.5 0 0 1-2.5 2.5H4A2.5 2.5 0 0 1 1.5 11V5A2.5 2.5 0 0 1 4 2.5Zm3 1.5h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7V4Z"
      />
    </svg>
  )
}

/** A window with its right panel filled: shows or hides the task panel. No Heroicon exists for it */
export function PanelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-current', className)}>
      <path
        fillRule="evenodd"
        d="M12 2.5H4A2.5 2.5 0 0 0 1.5 5v6A2.5 2.5 0 0 0 4 13.5h8a2.5 2.5 0 0 0 2.5-2.5V5A2.5 2.5 0 0 0 12 2.5ZM9 4H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h5V4Z"
      />
    </svg>
  )
}

/** a pull request: two branches joining. No Heroicon exists for it */
export function PrIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={clsx('size-4 shrink-0 fill-none stroke-current', className)}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="4" cy="3.5" r="1.75" />
      <circle cx="4" cy="12.5" r="1.75" />
      <circle cx="12" cy="12.5" r="1.75" />
      <path d="M4 5.25v5.5M12 10.75V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6" />
    </svg>
  )
}

/** a changed file: lines added and taken out. No Heroicon exists for it */
export function DiffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx('size-4 shrink-0 fill-none stroke-current', className)} strokeWidth={1.5} strokeLinecap="round">
      <path d="M8 2v6.5M4.75 5.25h6.5M4.75 12.5h6.5" />
    </svg>
  )
}

/** Shepherdr's mark: a shepherd's crook at a slight lean, its staff running off the bottom (public/icon.svg too) */
export function CrookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={clsx('shrink-0 fill-none stroke-current', className)} strokeWidth={4.5} strokeLinecap="round">
      <path transform="rotate(12 16 16)" d="M21 40V12a7 7 0 0 0-14 0v2.5" />
    </svg>
  )
}

/* Places' marks, as Slack's channels have theirs: lucide's outline icons (24px, stroke 2), drawn as they are. No
   Heroicon is a channel's # or an outline server */
const outline = (className?: string) => clsx('size-4 shrink-0 fill-none stroke-current', className)

/** a project: a channel's # */
export function HashIcon({ className }: { className?: string }) {
  return (
    <svg data-icon="hash" viewBox="0 0 24 24" aria-hidden="true" className={outline(className)} strokeWidth={2} strokeLinecap="round">
      <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
    </svg>
  )
}

/** a machine: two server units stacked, a light on each */
export function ServerIcon({ className }: { className?: string }) {
  return (
    <svg data-icon="server" viewBox="0 0 24 24" aria-hidden="true" className={outline(className)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="8" x="2" y="2" rx="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" />
      <path d="M6 6h.01M6 18h.01" />
    </svg>
  )
}

/** All machines: layers stacked */
export function LayersIcon({ className }: { className?: string }) {
  return (
    <svg data-icon="layers" viewBox="0 0 24 24" aria-hidden="true" className={outline(className)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m2 12 9.17 4.17a2 2 0 0 0 1.66 0L22 12M2 17l9.17 4.17a2 2 0 0 0 1.66 0L22 17" />
    </svg>
  )
}

/** Pinned's heading: a pin standing up */
export function PinnedIcon({ className }: { className?: string }) {
  return (
    <svg data-icon="pin" viewBox="0 0 24 24" aria-hidden="true" className={outline(className)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  )
}

/** a section of the sidebar without an emoji: a folder, as outlined as the server and pin beside it */
export function SectionIcon({ className }: { className?: string }) {
  return (
    <svg data-icon="section" viewBox="0 0 24 24" aria-hidden="true" className={outline(className)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}

/** a place's mark by its level: All machines' layers, a machine's server, a project's # */
export function PlaceIcon({ level, className }: { level: number; className?: string }) {
  const Icon = level === 0 ? LayersIcon : level === 1 ? ServerIcon : HashIcon
  return <Icon className={className} />
}

export const ic = 'size-4 shrink-0'

/** an Apple keyboard says ⌘ and ⌃; any other says Ctrl for both (the shortcuts take either) */
const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
export const SHIFT = apple ? '⇧' : 'Shift'
export const MOD = apple ? '⌘' : 'Ctrl'
export const CTRL = apple ? '⌃' : 'Ctrl'
export const ALT = apple ? '⌥' : 'Alt'
/** a shortcut written out: "⌘K" on a Mac, "Ctrl+K" elsewhere */
export const shortcut = (mod: string, key: string) => (mod.length > 1 ? `${mod}+${key}` : `${mod}${key}`)

/** one fade for anything greyed out */
export const dimmed = 'disabled:cursor-default disabled:opacity-40'

/** a text box's edge: a hairline, a shade darker while you type in it (the message box's look), never a bright ring */
export const field = 'shadow-[inset_0_0_0_1px_var(--line2)] outline-none focus:shadow-box-focus'

/** the chat box's own buttons are circles the size of the send button, like the round header buttons */
export const roundBtn = 'size-[34px]! rounded-full! phone:size-11!'

export function Waves({ className }: { className?: string }) {
  return (
    <span className={clsx('wv', className)} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

/** minutes and seconds since a moment, ticking: "0:42" */
export function useElapsed(since: number) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const STEP = 5 // a 3px bar and a 2px gap, like the small wave
const EVERY = 70 // ms per new bar

/**
 * A live wave: bars come in on the right as the voice is heard and drift left, fading out at the left edge. Your
 * voice draws in the text colour, the agent's in green, quiet in grey. With reduced motion nothing drifts: a still row
 * of bars only changes colour with who is talking, drawn again only then.
 */
export function LiveWave({ sample, label, className }: { sample: () => Sample; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = ref.current!
    const g = el.getContext('2d')
    if (!g) return
    const still = matchMedia('(prefers-reduced-motion: reduce)')
    const bars: Sample[] = []
    let peak: Sample = { level: 0, who: null }
    let last = performance.now()
    let colours = { you: '', agent: '', quiet: '' }
    let read = 0
    let frame = 0
    /** what the still row last drew: drawn again only when it changes */
    let drawn = ''
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      const dpr = devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr)
        el.height = Math.round(h * dpr)
        drawn = ''
      }
      // the theme's colours, looked up again now and then (light and dark swap them)
      if (now - read > 1000) {
        const cs = getComputedStyle(el)
        colours = { you: cs.getPropertyValue('--fg'), agent: cs.getPropertyValue('--ready'), quiet: cs.getPropertyValue('--fg3') }
        read = now
      }
      const s = sample()
      if (s.level >= peak.level || !peak.who) peak = s
      const who = s.level > TALKING ? s.who : null
      const key = `${w}x${h} ${who} ${colours[who ?? 'quiet']}`
      if (still.matches && key === drawn) return
      drawn = still.matches ? key : ''
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const bar = (x: number, level: number, who: Sample['who']) => {
        const bh = Math.max(3, Math.round(level * h))
        g.fillStyle = who ? colours[who] : colours.quiet
        g.beginPath()
        g.roundRect(x, (h - bh) / 2, 3, bh, 1.5)
        g.fill()
      }
      if (still.matches) {
        const n = Math.min(24, Math.floor(w / STEP))
        for (let i = 0; i < n; i++) bar(w - (i + 1) * STEP + 2, 0.3, who)
        return
      }
      while (now - last >= EVERY) {
        bars.push(peak)
        peak = { level: 0, who: null }
        last += EVERY
        if (bars.length > 400) bars.splice(0, bars.length - 400)
      }
      const drift = ((now - last) / EVERY) * STEP
      for (let i = 0; i < bars.length; i++) {
        const x = w - (bars.length - i) * STEP - drift + 2
        if (x < -STEP) continue
        const b = bars[i]
        bar(x, b.level, b.level > TALKING ? b.who : null)
      }
      // before the first sounds come in, a calm row of dots fills the rest
      for (let x = w - (bars.length + 1) * STEP - drift + 2; x > -STEP; x -= STEP) bar(x, 0, null)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [sample])
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className={clsx('h-6 min-w-0 [mask-image:linear-gradient(to_right,transparent,black_--spacing(8))]', className)}
    />
  )
}

const STATUS_WORD: Record<Status, string> = {
  need: 'Needs you',
  ready: 'Ready',
  merging: 'Merging',
  work: 'Working',
  idle: 'Stopped',
  queued: 'Queued',
  todo: 'To do',
  done: 'Done',
  off: "Can't reach",
}

/** A status mark; a working one with `p` fills its pie that far (the % done its agent reported). `frozen`: the %
 *  an agent waiting on you stopped at, said to screen readers where no pie shows it */
export function Dot({ s, halo, p, frozen, className }: { s: Status; halo?: boolean; p?: number; frozen?: Report; className?: string }) {
  const pie = s === 'work' && p !== undefined
  return (
    <span
      className={clsx('dot', s, halo && 'halo', className)}
      style={pie ? ({ '--p': `${Math.max(4, p)}%` } as CSSProperties) : undefined}
      aria-label={pie ? `${STATUS_WORD[s]}, ${p}% done` : frozen ? `${STATUS_WORD[s]}, ${frozen.progress}% done` : STATUS_WORD[s]}
      role="img"
    />
  )
}

/** The minutes left an agent reported, counted down: "~6 min", "~1 h 20 min", "<1 min" */
function minutesLeft(eta: number) {
  if (eta < 1) return '<1 min'
  if (eta < 60) return `~${eta} min`
  const h = Math.floor(eta / 60)
  const m = eta % 60
  return h >= 10 || !m ? `~${h} h` : `~${h} h ${m} min`
}

/** The minutes left as few letters as fit under a dot: "<1m", "12m", "2h" */
function etaShort(eta: number) {
  return eta < 1 ? '<1m' : eta < 60 ? `${eta}m` : `${Math.round(eta / 60)}h`
}

/**
 * A task row's status mark: working, the dot's pie shows the % done and the minutes left sit small under it, in the
 * dot's orange, level with the status line, centred on the dot without widening its column; the status line keeps
 * the row's whole width. Anything else is the dot alone; frozen while it waits on you, the % it stopped at stays in its
 * pie (still working) or, on the needs-you mark, for screen readers: its line says what it asks.
 */
export function TaskDot({ s, w }: { s: Status; w?: Report }) {
  const dot = <Dot s={s} p={w?.progress} frozen={w?.paused ? w : undefined} />
  if (s !== 'work' || !w || w.paused || w.eta === undefined) return dot
  return (
    <span className="mt-[3px] flex w-3.5 shrink-0 flex-col items-center self-stretch phone:mt-1 phone:w-4">
      {dot}
      <span aria-hidden className="mt-auto text-[0.625rem]/4 font-semibold whitespace-nowrap text-work tabular-nums phone:text-[0.6875rem]/5">
        {etaShort(w.eta)}
      </span>
      <span className="sr-only">{`, about ${minutesLeft(w.eta).replace(/^~/, '')} left`}</span>
    </span>
  )
}

/** The quiet words at the end of an agent's status line. In a header: the minutes left ("~12 min", "~12 min left" when
 *  wide), or frozen while it waits on you, the % it stopped at. In a row nothing: the minutes sit under the dot, which keeps the %. */
export function reportEnd(w: Report, head: boolean, left: boolean) {
  if (!head) return ''
  if (w.paused) return `${w.progress}%`
  return w.eta !== undefined ? `${minutesLeft(w.eta)}${left ? ' left' : ''}` : ''
}
