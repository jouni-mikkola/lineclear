import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Ghost, ic, IconButton, Primary, Small, XIcon } from '@client/ui.tsx'
import type { BrowserDown, BrowserNote, BrowserPick, BrowserUp, FrameMeta } from '@shared/browser.ts'
import { fit, toPanel, type Rect, type Size } from './input.ts'

export type State = Extract<BrowserDown, { type: 'state' }>

/** agent-browser's own page size, which Fit goes back to */
export const DESKTOP = { w: 1280, h: 720 }
/** the agent counts as busy in the browser this long after its last command */
export const BUSY_MS = 8000

/** notes not sent yet, by task: they stay while you look at another item or task */
export const kept = new Map<string, BrowserNote[]>()

/** what the key box holds, so a phone's Backspace has something to take */
export const HELD = ' '

/** the shots of notes not sent yet, by their small copy's address */
export const shots = new Map<string, Blob>()
export const drop = (p: BrowserPick) => {
  if (!p.thumb) return
  shots.delete(p.thumb)
  URL.revokeObjectURL(p.thumb)
}

/** a note's shot, into the task chat's inbox on the task's machine (where it goes in as an attached file) */
export async function upload(chatKey: string, blob: Blob, element: string) {
  const slug =
    element
      .replace(/"[^"]*"?/g, '')
      .trim()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'element'
  const body = new FormData()
  body.append('chat', chatKey)
  body.append('file', new File([blob], `note-${slug}.png`, { type: 'image/png' }))
  const r = (await fetch('api/upload', { method: 'POST', body, headers: { 'x-lineclear': '1' } })
    .then((x) => x.json())
    .catch(() => null)) as { path?: string } | null
  return r?.path ?? null
}

/** the link to the task's browser: frames go straight to the canvas, the rest into state. A task on another machine
 *  may share its stream on the tailnet: then frames and your input go straight there, and only the rest through the
 *  server (a stream that can't be reached falls back to the server's) */
export function useLink(task: string, onFrame: (data: string, meta: FrameMeta) => void, onPicked: (m: Extract<BrowserDown, { type: 'picked' }>) => void) {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ended, setEnded] = useState(false)
  const [hover, setHover] = useState<Rect | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const direct = useRef<{ url: string; ws: WebSocket; open: boolean } | null>(null)
  /** links that could not be reached, and when: not tried again for a while */
  const failed = useRef(new Map<string, number>())
  const driver = useRef<State['driver']>('agent')
  const frame = useRef(onFrame)
  const picked = useRef(onPicked)
  frame.current = onFrame
  picked.current = onPicked
  useEffect(() => {
    let gone = false
    let wait = 500
    let timer: ReturnType<typeof setTimeout>
    const open = () => {
      const url = new URL(`api/browser?task=${encodeURIComponent(task)}`, location.href)
      url.protocol = url.protocol.replace('http', 'ws')
      const s = new WebSocket(url)
      ws.current = s
      s.onopen = () => (wait = 500)
      s.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as BrowserDown
        if (m.type === 'frame') return frame.current(m.data, m.metadata)
        if (m.type === 'state') {
          setState(m)
          driver.current = m.driver
          if (m.connected) setError(null)
          straight(m.direct)
        } else if (m.type === 'error') {
          setError(m.message)
          // closed with its task: no coming back for it
          if (m.gone) {
            gone = true
            setEnded(true)
          }
        } else if (m.type === 'picked') picked.current(m)
        else if (m.type === 'hover') setHover(m.box)
      }
      s.onclose = () => {
        if (gone) return
        // the server restarts after an update: come back
        timer = setTimeout(open, wait)
        wait = Math.min(wait * 2, 8000)
      }
    }
    /** frames straight from the task's machine, when it shares them and they can be reached */
    const straight = (url?: string) => {
      if (direct.current?.url === url) return
      direct.current?.ws.close()
      direct.current = null
      if (!url || Date.now() - (failed.current.get(url) ?? 0) < 30_000) return
      const d = { url, ws: new WebSocket(url), open: false }
      direct.current = d
      d.ws.onopen = () => {
        d.open = true
        ws.current?.send(JSON.stringify({ type: 'direct', on: true } satisfies BrowserUp))
      }
      d.ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as { type?: string; data?: string; metadata?: FrameMeta }
        if (m.type === 'frame' && m.data && m.metadata) frame.current(m.data, m.metadata)
      }
      d.ws.onclose = () => {
        if (direct.current !== d) return
        direct.current = null
        failed.current.set(url, Date.now())
        if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: 'direct', on: false } satisfies BrowserUp))
      }
    }
    open()
    return () => {
      gone = true
      clearTimeout(timer)
      ws.current?.close()
      direct.current?.ws.close()
      direct.current = null
    }
  }, [task])
  const send = useCallback((m: BrowserUp) => {
    // your input goes straight to the task's machine when its frames come that way, and only while you drive
    const d = direct.current
    if (d?.open && m.type.startsWith('input_')) {
      if (driver.current === 'you') d.ws.send(JSON.stringify(m))
      return
    }
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m))
  }, [])
  /** start it again: the error goes until the server says how it went */
  const retry = useCallback(() => {
    setError(null)
    send({ type: 'start' })
  }, [send])
  return { state, error, ended, hover, setHover, send, retry }
}

/** latest frame wins: one decoding at a time, the newest waiting */
export function useCanvas() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const bitmap = useRef<ImageBitmap | null>(null)
  const busy = useRef(false)
  const next = useRef<string | null>(null)
  const [meta, setMeta] = useState<FrameMeta>()
  const width = useRef(DESKTOP.w)
  const [box, setBox] = useState({ w: 0, h: 0 })
  // the page's size in CSS px: its width as agent-browser says, its height from the picture itself (the height it
  // reports can be the window's, taller than the page)
  const [page, setPage] = useState<Size>(DESKTOP)
  const rect = fit(box, page)

  const draw = useCallback(() => {
    const c = canvas.current
    const b = bitmap.current
    if (!c || !b) return
    const dpr = devicePixelRatio || 1
    const w = c.clientWidth
    const h = c.clientHeight
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const r = fit({ w, h }, { w: b.width, h: b.height })
    g.imageSmoothingQuality = 'high'
    g.drawImage(b, r.x, r.y, r.w, r.h)
  }, [])

  const decode = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    while (next.current) {
      const data = next.current
      next.current = null
      try {
        const blob = await (await fetch(`data:image/jpeg;base64,${data}`)).blob()
        const b = await createImageBitmap(blob)
        bitmap.current?.close()
        bitmap.current = b
        const w = width.current || b.width
        const h = Math.round((b.height * w) / b.width)
        setPage((was) => (was.w === w && was.h === h ? was : { w, h }))
        draw()
      } catch {
        /* a broken frame: the next one will do */
      }
    }
    busy.current = false
  }, [draw])

  const onFrame = useCallback(
    (data: string, m: FrameMeta) => {
      next.current = data
      width.current = m.deviceWidth
      decode()
      // the overlay only moves when the page scrolls or changes size
      setMeta((was) =>
        was &&
        was.deviceWidth === m.deviceWidth &&
        was.deviceHeight === m.deviceHeight &&
        was.scrollOffsetX === m.scrollOffsetX &&
        was.scrollOffsetY === m.scrollOffsetY
          ? was
          : m,
      )
    },
    [decode],
  )

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight })
      draw()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [draw])

  /** part of the frame on screen (viewport px) as a picture: a note's shot is what you saw */
  const crop = useCallback(async (r: Rect, of: Size): Promise<Blob | null> => {
    const b = bitmap.current
    if (!b) return null
    const sx = b.width / of.w
    const sy = b.height / of.h
    const c = new OffscreenCanvas(Math.max(1, Math.round(r.w * sx)), Math.max(1, Math.round(r.h * sy)))
    c.getContext('2d')!.drawImage(b, r.x * sx, r.y * sy, r.w * sx, r.h * sy, 0, 0, c.width, c.height)
    return c.convertToBlob({ type: 'image/png' })
  }, [])

  return { canvas, stage, meta, page, rect, box, onFrame, crop, hasFrame: () => !!bitmap.current }
}

/** the element under the pointer, outlined, in Mark up */
export function Outline({ r, rect, page }: { r: Rect; rect: Rect; page: { w: number; h: number } }) {
  const a = toPanel({ x: r.x, y: r.y }, rect, page)
  const b = toPanel({ x: r.x + r.w, y: r.y + r.h }, rect, page)
  return (
    <div
      className="pointer-events-none absolute rounded-[3px] bg-focus/10 outline-2 outline-focus"
      style={{ left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y }}
    />
  )
}

/** a numbered pin, as Mark up's on pages */
export function Pin({ n, x, y, waiting }: { n: number; x: number; y: number; waiting?: boolean }) {
  return (
    <span
      className={clsx(
        // Mark up's numbered mark, ringed in the page colour
        'pointer-events-none absolute grid h-[18px] min-w-[18px] -translate-1/2 place-items-center rounded-full bg-focus px-[5px] text-[0.6875rem] font-semibold text-white tabular-nums shadow-[0_0_0_2px_var(--bg)] phone:h-[22px] phone:min-w-[22px] phone:text-[0.8125rem]',
        waiting && 'motion-safe:animate-pulse',
      )}
      style={{ left: x, top: y }}
    >
      {n}
    </span>
  )
}

export function Notes({
  notes,
  draft,
  sent,
  annotate,
  onDraft,
  onAdd,
  onDrop,
  onRemove,
  onSend,
}: {
  notes: BrowserNote[]
  draft: { pick?: BrowserPick; error?: string; comment: string } | null
  sent: string | null
  annotate: boolean
  onDraft: (s: string) => void
  onAdd: () => void
  onDrop: () => void
  onRemove: (i: number) => void
  onSend: () => void
}) {
  const count = notes.length + (draft?.pick && draft.comment.trim() ? 1 : 0)
  // a finger taps, a mouse clicks
  const touch = matchMedia('(pointer: coarse)').matches
  return (
    <div className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-line p-3">
      {sent ? <Small className="text-ready">{sent}</Small> : null}
      {notes.length ? (
        <ol className="flex flex-col gap-1.5">
          {notes.map((n, i) => (
            <li key={i} className="flex items-start gap-2 text-[0.8125rem]/5 phone:text-[0.875rem]/5">
              <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-focus px-[5px] text-[0.6875rem] font-semibold text-white tabular-nums phone:mt-px phone:h-[22px] phone:min-w-[22px] phone:text-[0.8125rem]">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-fg2">{n.pick.element}</div>
                <div className="text-fg">{n.comment}</div>
              </div>
              <IconButton label={`Remove note ${i + 1}`} onClick={() => onRemove(i)}>
                <XIcon className={ic} />
              </IconButton>
            </li>
          ))}
        </ol>
      ) : null}
      {draft ? (
        <div className="flex flex-col gap-2 rounded-box bg-bubble p-2.5">
          {draft.error ? (
            <Small className="text-need">{draft.error}</Small>
          ) : !draft.pick ? (
            <Small>Looking at what you tapped…</Small>
          ) : (
            <>
              <div className="flex items-start gap-2.5">
                {draft.pick.thumb ? (
                  <img
                    src={draft.pick.thumb}
                    alt=""
                    className="max-h-16 max-w-24 shrink-0 rounded-[calc(var(--box-radius)-var(--spacing)*2.5)] object-contain shadow-[0_0_0_1px_var(--line2)]"
                  />
                ) : null}
                <div className="min-w-0 flex-1 text-[0.8125rem]/5 phone:text-[0.875rem]/5">
                  <div className="truncate font-medium text-fg">{draft.pick.element}</div>
                  <div className="truncate font-mono text-[0.75rem] text-fg3">{draft.pick.selector}</div>
                </div>
              </div>
              <input
                name="browser-note"
                aria-label={`Note ${notes.length + 1}`}
                autoFocus
                placeholder="What should change?"
                value={draft.comment}
                onChange={(e) => onDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') onAdd()
                  if (e.key === 'Escape') onDrop()
                }}
                className="h-8 min-w-0 rounded-full bg-bg px-3 text-[0.8125rem] shadow-[inset_0_0_0_1px_var(--line2)] outline-none focus:shadow-box-focus phone:h-11 phone:text-[1rem]"
              />
            </>
          )}
          <div className="flex gap-2">
            {draft.pick ? (
              <Ghost disabled={!draft.comment.trim()} onClick={onAdd}>
                Add note
              </Ghost>
            ) : null}
            <Ghost onClick={onDrop}>Drop</Ghost>
          </div>
        </div>
      ) : annotate && !sent ? (
        <Small>
          {notes.length
            ? `${touch ? 'Tap' : 'Click'} something else to add a note.`
            : `${touch ? 'Tap' : 'Click'} something on the page to leave a note on it.`}
        </Small>
      ) : null}
      {count ? (
        <div>
          <Primary onClick={onSend}>Send {count === 1 ? '1 note' : `${count} notes`} to the agent</Primary>
        </div>
      ) : null}
    </div>
  )
}
