import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  act,
  agentChat,
  closeArtifact,
  getState,
  listView,
  openArtifact,
  openItem,
  openSplit,
  setUI,
  splitClick,
  taskInMiddle,
  useSnap,
  useUI,
} from '@client/kernel.ts'
import { useDialogFocus } from '@client/focus.ts'
import { useMotion } from '@client/motion.ts'
import { isDark, useDark } from '@client/theme.ts'
import { BackIcon, ic, IconButton, Menu, OpenIcon, PageIcon, PanelIcon, SplitIcon, XIcon } from '@client/ui.tsx'
import type { Artifact, Chat, Message } from '@shared/types.ts'

export type Pick = { text: string; selector: string; component?: string; x: number; y: number }

const frameUrl = (id: string, v: number, full: boolean, device: string, part = '', theme = '') =>
  `api/artifacts/${encodeURIComponent(id)}${part}?v=${v}${full ? '&full=1' : ''}&device=${device}${theme ? `&theme=${theme}` : ''}`

/** the version whose HTML a version shows (one that brought only data shows the HTML before it) */
const htmlOf = (a: Artifact, n: number) => a.versions.find((x) => x.n === n)?.html ?? n

/* ---------- an artifact in the side panel ---------- */

const SHOWN = 'shepherdr.panelArtifacts'
/** the artifact each side panel shows, by "place:<id>" (its Artifacts list) or "chat:<key>" (a task's Artifacts tab),
 *  remembered on this device */
let shownIn: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(SHOWN) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
})()
function setShownIn(value: typeof shownIn): void {
  shownIn = value
}

const shownListeners = new Set<() => void>()

export function setShown(key: string, id: string | null) {
  const { [key]: _, ...rest } = shownIn
  setShownIn(id ? { ...rest, [key]: id } : rest)
  try {
    localStorage.setItem(SHOWN, JSON.stringify(shownIn))
  } catch {
    /* private window: the list shows again next time */
  }
  shownListeners.forEach((l) => l())
}

/** the artifact a side panel shows, while it is still kept */
export function useShown(key: string) {
  const id = useSyncExternalStore(
    (l) => {
      shownListeners.add(l)
      return () => shownListeners.delete(l)
    },
    () => shownIn[key],
  )
  return useSnap()?.artifacts?.find((a) => a.id === id)
}

/** Show an artifact beside the chat: in the Artifacts list on the right (whatever its chips show; a phone's
 *  Artifacts tab), or, on a desktop where an open task's chat covers that list, in the task's own Artifacts tab (a
 *  phone or tablet has no column for it: the task gives way to the list) */
export function showInPanel(id: string) {
  const { ui, snap } = getState()
  if (!snap) return
  const g = agentChat(ui, snap)
  if (ui.viewer) closeArtifact()
  if (ui.device === 'desktop' && ui.task && g && !taskInMiddle(ui, snap)) {
    setShown(`chat:${g.chat}`, id)
    return openItem('artifacts')
  }
  setShown(`list:${listView(ui, snap).key}`, id)
  setUI(
    ui.device === 'phone'
      ? { task: null, tab: 'artifacts', pick: null, plus: null, menu: false }
      : { task: ui.task && !taskInMiddle(ui, snap) ? null : ui.task, side: 'artifacts' },
  )
}

const onResize = (l: () => void) => {
  addEventListener('resize', l)
  return () => removeEventListener('resize', l)
}
/** the window's height; on a touch screen at its tallest for its width, so a keyboard or a browser's toolbar coming
 *  and going doesn't resize every card in the chat (turning it does) */
let tallest = { w: 0, h: 0 }
function setTallest(value: typeof tallest): void {
  tallest = value
}

const useWindowHeight = () =>
  useSyncExternalStore(onResize, () => {
    if (!matchMedia('(pointer: coarse)').matches) return innerHeight
    if (innerWidth !== tallest.w || innerHeight > tallest.h) setTallest({ w: innerWidth, h: innerHeight })
    return tallest.h
  })

/** how tall each page last said it is, so a card scrolled back into the chat doesn't jump */
const heights = new Map<string, number>()

/** a person just tapped or typed, and not in another frame: a tap inside a frame marks the app as touched too (the
 *  browser's user activation), a script can't; where the browser can't tell, the frame must have the focus */
function touchedNow(frame: HTMLIFrameElement | null) {
  const other = document.activeElement instanceof HTMLIFrameElement && document.activeElement !== frame
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
  return !other && (ua ? ua.isActive : document.activeElement === frame)
}

/** An artifact's page in a sealed frame: scripts and forms run, never with this app's origin, and it loads nothing. */
export function ArtifactFrame({
  art,
  v,
  full,
  markup,
  onPick,
  onMore,
}: {
  art: Artifact
  v: number
  full?: boolean
  markup?: boolean
  onPick?: (p: Pick) => void
  /** more of the page is below what shows */
  onMore?: (more: boolean) => void
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const device = useUI((u) => u.device)
  // in the chat it is as tall as its page, up to most of the screen; the rest scrolls inside it
  const cap = Math.round(useWindowHeight() * (device === 'phone' ? 0.7 : 0.75))
  const known = `${art.id}:${htmlOf(art, v)}:${device}${full ? ':full' : ''}`
  const [h, setH] = useState(() => heights.get(known) ?? 96)
  // the version in the frame's address: a newer one with the same page only brings data, which goes in without a reload
  const [loaded, setLoaded] = useState(v)
  /** the version whose data is in the frame */
  const has = useRef(v)
  const last = useRef(0)
  const page = htmlOf(art, v)
  const pageLoaded = htmlOf(art, loaded)
  // it opens in the app's light or dark, and is told when that changes, without a reload
  const dark = useDark()
  const opened = useMemo(() => (isDark() ? 'dark' : 'light'), [loaded, full, device])
  const theme = dark ? 'dark' : 'light'
  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ shepherdr: 'theme', theme }, '*')
  }, [theme])
  useEffect(() => {
    if (v === has.current) return
    if (page !== pageLoaded) {
      has.current = v
      return setLoaded(v)
    }
    has.current = v
    fetch(frameUrl(art.id, v, false, device, '/data'))
      .then((r) => r.json())
      .then((r: { data?: unknown }) => has.current === v && ref.current?.contentWindow?.postMessage({ shepherdr: 'data', data: r.data ?? null }, '*'))
      .catch(() => has.current === v && setLoaded(v))
  }, [art.id, v, page, pageLoaded, device])
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || !e.data || typeof e.data !== 'object') return
      const d = e.data as { shepherdr?: string; h?: number; stuck?: boolean; grows?: boolean; text?: string; url?: string; more?: boolean } & Pick
      if (d.shepherdr === 'more') onMore?.(!!d.more)
      if (d.shepherdr === 'height' && d.h) {
        // one that grows with its frame (100vh) starts from scratch each time, so it settles the same each time
        if (d.stuck) heights.delete(known)
        else if (!d.grows) heights.set(known, d.h)
        setH(d.h)
      }
      // a page speaks for you only right after you tapped or typed in it: the browser's own mark of a person's touch,
      // which no script can make; at most once every two seconds, and on one line (it can't write a chat line of its own)
      if (d.shepherdr === 'send' && typeof d.text === 'string' && d.text.trim() && touchedNow(ref.current) && Date.now() - last.current > 2000) {
        last.current = Date.now()
        const text = d.text
          .replace(/\s*[\r\n]+\s*/g, ' ')
          .trim()
          .slice(0, 2000)
        act({ type: 'artifact-send', place: art.place, artifact: art.id, v, text })
          .then((r: { to?: string }) => ref.current?.contentWindow?.postMessage({ shepherdr: 'sent', text, to: r?.to }, '*'))
          .catch(() => undefined)
      }
      // a web link opens in a tab of its own, from a tap in the page, never with this app as its opener
      if (d.shepherdr === 'open' && typeof d.url === 'string' && /^https?:\/\//i.test(d.url) && touchedNow(ref.current))
        window.open(d.url, '_blank', 'noopener,noreferrer')
      if (d.shepherdr === 'pick' && markup && onPick) onPick({ text: d.text ?? '', selector: d.selector, component: d.component, x: d.x, y: d.y })
    }
    addEventListener('message', on)
    return () => removeEventListener('message', on)
  }, [art.id, art.place, v, known, markup, onPick, onMore])
  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ shepherdr: 'markup', on: !!markup }, '*')
  }, [markup])
  // a fixed-size design fits whole within the cap
  useEffect(() => {
    if (!full) ref.current?.contentWindow?.postMessage({ shepherdr: 'cap', h: cap }, '*')
  }, [cap, full])
  return (
    <iframe
      ref={ref}
      title={art.title}
      sandbox="allow-scripts allow-forms"
      loading={full ? undefined : 'lazy'}
      src={frameUrl(art.id, loaded, !!full, device, '', opened)}
      onLoad={() => {
        if (theme !== opened) ref.current?.contentWindow?.postMessage({ shepherdr: 'theme', theme }, '*')
        if (markup) ref.current?.contentWindow?.postMessage({ shepherdr: 'markup', on: true }, '*')
        if (!full) ref.current?.contentWindow?.postMessage({ shepherdr: 'cap', h: cap }, '*')
        // newer data came while it was still loading (or loaded again): it gets that data now
        if (has.current !== loaded) {
          const want = has.current
          fetch(frameUrl(art.id, want, false, device, '/data'))
            .then((r) => r.json())
            .then((r: { data?: unknown }) => has.current === want && ref.current?.contentWindow?.postMessage({ shepherdr: 'data', data: r.data ?? null }, '*'))
            .catch(() => undefined)
        }
      }}
      className={clsx('block w-full border-0 bg-transparent', full && 'h-full')}
      style={full ? undefined : { height: Math.min(Math.max(h, 24), cap) }}
    />
  )
}

/** An artifact filling a side panel at its width, under its own bar: back to the list, full screen, and close */
export function PanelArtifact({ art, onBack, onClose }: { art: Artifact; onBack: () => void; onClose: () => void }) {
  return (
    <div role="region" aria-label={art.title} className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line py-1 pr-2 pl-1 coarse:py-0.5">
        <IconButton label="Back to Artifacts" className="rounded-full!" onClick={onBack}>
          <BackIcon className={ic} />
        </IconButton>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <div className="min-w-0 shrink truncate font-semibold">{art.title}</div>
          <div className="shrink-0 text-xs text-fg2 tabular-nums phone:text-sm">v{art.v}</div>
        </div>
        <IconButton label="Open full screen" className="rounded-full!" onClick={() => openArtifact(art.id)}>
          <OpenIcon className={ic} />
        </IconButton>
        <IconButton label="Close" className="rounded-full!" onClick={onClose}>
          <XIcon className={ic} />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <ArtifactFrame art={art} v={art.v} full />
        </div>
      </div>
    </div>
  )
}

/** An artifact filling a split view's pane, at its latest */
export function SplitArtifact({ artifactId }: { artifactId: string }) {
  const art = useSnap()?.artifacts?.find((a) => a.id === artifactId)
  return art ? (
    <div className="absolute inset-0">
      <ArtifactFrame art={art} v={art.v} full />
    </div>
  ) : null
}

/** The newest post of an artifact: the whole width of the chat, the page edge to edge under one slim row (its title,
 *  version and Open). The row has the sender's bubble shade and the card a bubble's corners, the small one pointing at
 *  whoever sent it, so it reads as theirs as plainly as a bubble does. */
function ArtifactPanel({ art, you, from, className }: { art: Artifact; you: boolean; from: string; className?: string | false }) {
  const [more, setMore] = useState(false)
  const desktop = useUI((u) => u.device === 'desktop')
  return (
    <div
      data-card
      data-you={you ? '' : undefined}
      className={clsx(
        'relative w-full cursor-default overflow-hidden bg-bg',
        className,
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--line2)]',
        you ? 'rounded-bubble rounded-br-[6px]' : 'rounded-bubble rounded-bl-[6px]',
      )}
    >
      <div className={clsx('flex items-center gap-2 py-1 pr-1 pl-3 text-[0.75rem] text-fg2 phone:py-0 phone:text-[0.8125rem]', you ? 'bg-reply' : 'bg-bubble')}>
        <PageIcon className={ic} />
        <button
          type="button"
          onClick={(e) => (splitClick(e) ? openSplit({ kind: 'artifact', id: art.id }) : openArtifact(art.id))}
          className="min-w-0 flex-1 self-stretch truncate text-left font-medium text-fg"
        >
          {art.title}
        </button>
        <span className="max-w-[55%] shrink-0 truncate tabular-nums">
          {/* a phone's narrow card keeps its title: where it is from gives way */}
          <span className="phone:hidden">{from} · </span>v{art.v} · {art.when}
        </span>
        <IconButton label="Show in side panel" onClick={() => showInPanel(art.id)}>
          <PanelIcon className={ic} />
        </IconButton>
        {desktop ? (
          <IconButton label="Open in split view" onClick={() => openSplit({ kind: 'artifact', id: art.id })}>
            <SplitIcon className={ic} />
          </IconButton>
        ) : null}
        <IconButton label="Open full screen" onClick={() => openArtifact(art.id)}>
          <OpenIcon className={ic} />
        </IconButton>
      </div>
      <ArtifactFrame art={art} v={art.v} onMore={setMore} />
      {/* the page goes on below: it scrolls inside the card */}
      {more ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-bg to-transparent" /> : null}
    </div>
  )
}

/** the newest post of an artifact in a chat shows it; earlier ones fold to a line, so a chat never repeats big frames */
export function ArtifactCard({ msg, chat, from }: { msg: Message; chat: Chat; from: string }) {
  const snap = useSnap()!
  const post = msg.artifact
  if (!post) return null
  const art = snap.artifacts?.find((a) => a.id === post.id)
  const later = chat.messages.slice(chat.messages.indexOf(msg) + 1).some((m) => m.artifact?.id === post.id)
  // under the words it came with (a message of its own, on its own)
  const gap = msg.text && 'mt-2'
  if (!art)
    return (
      <div
        className={clsx(
          gap,
          'flex max-w-full items-center gap-2 rounded-full px-3.5 py-2 text-[0.8125rem] text-fg3 shadow-[inset_0_0_0_1px_var(--line)] phone:text-[0.9375rem]',
        )}
      >
        <PageIcon className={ic} />
        This artifact was deleted.
      </div>
    )
  if (later)
    return (
      <button
        type="button"
        onClick={() => openArtifact(art.id, post.v)}
        className={clsx(
          gap,
          'flex max-w-full items-center gap-2 rounded-full px-3.5 py-2 text-left text-[0.8125rem] text-fg2 shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-hover phone:min-h-11 phone:text-[0.9375rem]',
        )}
      >
        <PageIcon className={ic} />
        <b className="min-w-0 flex-1 truncate font-medium text-fg">{art.title}</b>
        <span className="shrink-0 text-fg3 tabular-nums">v{post.v} · newer below</span>
      </button>
    )
  return <ArtifactPanel art={art} you={msg.who === 'you'} from={msg.who === 'you' ? 'You' : from} className={gap} />
}

/** the viewer over the whole screen: it pushes in on a phone and fades in wider, takes the focus and keeps Tab in it,
 *  and gives the focus back when it closes */
export function ViewerShell({ label, phone, children }: { label: string; phone: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useMotion(ref, phone ? 'page' : 'fade')
  // a phone has no keyboard to move: nothing takes the focus there (it would only show a ring)
  useDialogFocus(ref, { focus: !phone })
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-40 flex bg-bg">
      {children}
    </div>
  )
}

export function Popover({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Menu
      label={label}
      onClose={onClose}
      className="absolute top-full right-0 z-21 mt-1.5 max-h-[60dvh] w-max max-w-[min(320px,calc(100vw-24px))] origin-top-right overflow-y-auto"
    >
      {children}
    </Menu>
  )
}
