import clsx from 'clsx'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { act, useUI } from '@client/kernel.ts'
import { FitIcon, Ghost, ic, IconButton, PageBackIcon, PageForwardIcon, MarkUpIcon, ReloadIcon, Small, UnfitIcon } from '@client/ui.tsx'
import { shortUrl, type BrowserDown, type BrowserNote, type BrowserPick } from '@shared/browser.ts'
import type { Task } from '@shared/types.ts'
import { keyEvent, modifiers, pinAt, shotRect, toPage } from './input.ts'
import { useCanvas, kept, shots, useLink, BUSY_MS, DESKTOP, HELD, type State, upload, drop, Outline, Pin, Notes } from './browser-state.tsx'

export function BrowserView({ task, chatKey }: { task: Task; chatKey: string }) {
  const ui = useUI()
  const phone = ui.device === 'phone'
  const touch = ui.device !== 'desktop'
  const cv = useCanvas()
  const [notes, setNotesState] = useState<BrowserNote[]>(() => kept.get(task.id) ?? [])
  const [draft, setDraft] = useState<{
    id: number
    at: { x: number; y: number }
    tap: { x: number; y: number }
    pick?: BrowserPick
    error?: string
    comment: string
  } | null>(null)
  const [annotate, setAnnotate] = useState(() => (kept.get(task.id)?.length ?? 0) > 0)
  const [address, setAddress] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const picks = useRef(0)
  const keys = useRef<HTMLTextAreaElement>(null)
  const setNotes = (f: (n: BrowserNote[]) => BrowserNote[]) =>
    setNotesState((was) => {
      const n = f(was)
      kept.set(task.id, n)
      return n
    })
  const drafted = useRef(draft)
  drafted.current = draft
  // what the page said about your tap; its shot is cropped from the frame on screen, and goes to the task's machine
  // only with the notes
  const onPicked = async (m: Extract<BrowserDown, { type: 'picked' }>) => {
    const d = drafted.current
    if (!d || d.id !== m.id) return
    if (!m.pick) return setDraft({ ...d, error: m.error ?? 'Nothing there to note.' })
    const r = shotRect(m.pick, d.tap, cv.page)
    const blob = r ? await cv.crop(r, cv.page).catch(() => null) : null
    const thumb = blob ? URL.createObjectURL(blob) : undefined
    if (blob && thumb) shots.set(thumb, blob)
    setDraft((x) => (x && x.id === m.id ? { ...x, pick: { ...m.pick!, thumb } } : x))
  }
  const link = useLink(task.id, cv.onFrame, onPicked)
  const st = link.state
  const you = st?.driver === 'you'
  const busy = !you && st?.agentAgo !== undefined && st.agentAgo < BUSY_MS
  const fitted = !!st && (st.viewport.w !== DESKTOP.w || st.viewport.h !== DESKTOP.h)

  // "busy" fades on its own once the agent stops
  const [, tick] = useState(0)
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => tick((n) => n + 1), BUSY_MS)
    return () => clearTimeout(t)
  }, [busy, st])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 2200)
    return () => clearTimeout(t)
  }, [hint])

  const local = (e: { clientX: number; clientY: number }) => {
    const r = cv.stage.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onPage = (e: { clientX: number; clientY: number }) => toPage(local(e), cv.rect, cv.page)

  /* ---------- your input, while you drive ---------- */

  const lastMove = useRef(0)
  const mouse = (e: ReactPointerEvent<HTMLDivElement>, eventType: 'mousePressed' | 'mouseReleased' | 'mouseMoved') => {
    const p = onPage(e)
    if (!p) return
    const button = eventType === 'mouseMoved' ? (e.buttons & 1 ? 'left' : 'none') : (['left', 'middle', 'right'][e.button] ?? 'left')
    link.send({
      type: 'input_mouse',
      eventType,
      x: p.x,
      y: p.y,
      button,
      clickCount: eventType === 'mouseMoved' ? 0 : Math.max(1, e.detail),
      modifiers: modifiers(e),
    })
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (annotate) return pickAt(e)
    if (!you) {
      if (e.pointerType !== 'touch') setHint('Take over to use the page')
      return
    }
    if (e.pointerType === 'touch') return
    // the click is the page's: the key box keeps the focus
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (!touch) keys.current?.focus({ preventScroll: true })
    mouse(e, 'mousePressed')
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return
    const now = performance.now()
    if (now - lastMove.current < 30) return
    lastMove.current = now
    if (annotate) {
      const p = onPage(e)
      if (p) link.send({ type: 'hover', x: p.x, y: p.y })
      return
    }
    if (you) mouse(e, 'mouseMoved')
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (annotate || !you || e.pointerType === 'touch') return
    mouse(e, 'mouseReleased')
  }

  // wheel and touch need listeners that may stop the page behind from scrolling
  useEffect(() => {
    const el = cv.stage.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!you || annotate) return
      e.preventDefault()
      const p = onPage(e)
      if (p) link.send({ type: 'input_mouse', eventType: 'mouseWheel', x: p.x, y: p.y, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: modifiers(e) })
    }
    const touches = (eventType: string) => (e: TouchEvent) => {
      if (!you || annotate) return
      e.preventDefault()
      const touchPoints = [...e.touches].flatMap((t) => {
        const p = onPage(t)
        return p ? [{ ...p, id: t.identifier }] : []
      })
      link.send({ type: 'input_touch', eventType, touchPoints })
    }
    const start = touches('touchStart')
    const move = touches('touchMove')
    const end = touches('touchEnd')
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('touchstart', start, { passive: false })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end, { passive: false })
    el.addEventListener('touchcancel', end, { passive: false })
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  })

  /** keys go in from a hidden text box: a key press as itself; what a phone keyboard or a paste types, as text */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (!you || e.nativeEvent.isComposing || e.key === 'Unidentified' || e.key === 'Process') return
    // paste goes in as text (onPaste)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') return
    const k = keyEvent(e, 'keyDown')
    if (!k) return
    e.preventDefault()
    link.send(k)
  }
  const onKeyUp = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (!you || e.nativeEvent.isComposing) return
    const k = keyEvent(e, 'keyUp')
    if (k) link.send(k)
  }

  /** what a phone keyboard typed into the key box (its keys often come as "Unidentified"): the box holds one space, so
   *  Backspace shows as that space gone, and a new line as Enter */
  const tap = (key: string, code: string) => {
    for (const t of ['keyDown', 'keyUp'] as const) {
      const k = keyEvent({ key, code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, t)
      if (k) link.send(k)
    }
  }
  const typed = (v: string) => {
    if (!v.startsWith(HELD)) return tap('Backspace', 'Backspace')
    v.slice(HELD.length)
      .split('\n')
      .forEach((part, i) => {
        if (i) tap('Enter', 'Enter')
        if (part) link.send({ type: 'text', text: part })
      })
  }

  /* ---------- annotate ---------- */

  const pickAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = onPage(e)
    if (!p) return
    // a draft with words in it stays until it is added or dropped
    if (draft?.comment.trim()) return setHint('Add or drop this note first')
    const id = ++picks.current
    setDraft({ id, at: local(e), tap: p, comment: '' })
    link.setHover(null)
    link.send({ type: 'pick', id, x: p.x, y: p.y })
  }

  const addDraft = () => {
    if (!draft?.pick || !draft.comment.trim()) return
    const n = { comment: draft.comment.trim(), pick: draft.pick }
    setNotes((ns) => [...ns, n])
    setDraft(null)
  }

  const sending = useRef(false)
  const sendNotes = async () => {
    const all = draft?.pick && draft.comment.trim() ? [...notes, { comment: draft.comment.trim(), pick: draft.pick }] : notes
    if (!all.length || !st || sending.current) return
    sending.current = true
    try {
      await sendAll(all, st)
    } finally {
      sending.current = false
    }
  }
  const sendAll = async (all: BrowserNote[], st: State) => {
    const out = await Promise.all(
      all.map(async (n) => {
        const blob = n.pick.thumb && shots.get(n.pick.thumb)
        const shot = blob ? await upload(chatKey, blob, n.pick.element) : null
        return { comment: n.comment, pick: { ...n.pick, thumb: undefined, ...(shot ? { shot } : {}) } }
      }),
    )
    await act({ type: 'browser-notes', chat: chatKey, url: st.url, title: st.title || undefined, viewport: st.viewport, notes: out })
    all.forEach((n) => drop(n.pick))
    if (draft?.pick) drop(draft.pick)
    setNotes(() => [])
    setDraft(null)
    setAnnotate(false)
    setSent(`${all.length === 1 ? '1 note' : `${all.length} notes`} sent to the agent.`)
    setTimeout(() => setSent(null), 3000)
  }

  const toggleAnnotate = () => {
    setAnnotate((a) => !a)
    link.setHover(null)
    if (annotate && !draft?.comment.trim()) {
      if (draft?.pick) drop(draft.pick)
      setDraft(null)
    }
  }

  const go = () => {
    if (address === null) return
    const url = address.trim()
    setAddress(null)
    if (url) link.send({ type: 'go', url })
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  const fitPanel = () => link.send(fitted ? { type: 'viewport', ...DESKTOP } : { type: 'viewport', w: Math.round(cv.box.w), h: Math.round(cv.box.h) })

  const pins = [...notes.map((n) => n.pick), ...(draft?.pick ? [draft.pick] : [])]
  const showing = st?.connected && cv.hasFrame()
  const shown = st ? (address ?? (st.url && st.url !== 'about:blank' ? shortUrl(st.url) : '')) : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* the address and the way about */}
      {/* as tall as the other items' bars */}
      <div className="flex min-h-9 shrink-0 items-center gap-1 border-b border-line px-1.5 phone:min-h-11">
        <IconButton label="Back" disabled={!you} onClick={() => link.send({ type: 'back' })}>
          <PageBackIcon className={ic} />
        </IconButton>
        {phone ? null : (
          <IconButton label="Forward" disabled={!you} onClick={() => link.send({ type: 'forward' })}>
            <PageForwardIcon className={ic} />
          </IconButton>
        )}
        <IconButton label="Reload" disabled={!you} onClick={() => link.send({ type: 'reload' })}>
          <ReloadIcon className={ic} />
        </IconButton>
        <input
          name="address"
          aria-label="Address"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          readOnly={!you}
          placeholder={you ? 'Type an address' : 'No page yet'}
          value={shown}
          onFocus={(e) => {
            if (!you) return
            setAddress(st?.url && st.url !== 'about:blank' ? st.url : '')
            requestAnimationFrame(() => e.target.select())
          }}
          onBlur={() => setAddress(null)}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') go()
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
          }}
          className="h-7 min-w-0 flex-1 truncate rounded-full bg-bubble px-3 text-[0.8125rem] text-fg outline-none placeholder:text-fg3 read-only:text-fg2 focus:shadow-box-focus phone:h-10 phone:text-[1rem]"
        />
        <IconButton label={annotate ? 'Done marking up' : 'Mark up: point at things on the page to leave notes'} pressed={annotate} onClick={toggleAnnotate}>
          <MarkUpIcon />
        </IconButton>
      </div>

      {/* who drives */}
      <div
        className={clsx(
          'flex min-h-9 shrink-0 items-center gap-2 pr-1.5 pl-3 text-[0.8125rem] phone:min-h-11 phone:text-[0.875rem]',
          you ? 'bg-accent/8' : 'bg-well',
        )}
        aria-live="polite"
      >
        <span
          className={clsx('size-2 shrink-0 rounded-full', you ? 'bg-accent' : busy ? 'bg-work motion-safe:animate-pulse' : 'bg-muted')}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 truncate">
          <span className="font-medium text-fg">{you ? 'You’re driving' : 'Agent is driving'}</span>
          <span className="text-fg3">{you ? ' · the agent waits' : busy ? ' · at work' : ' · idle'}</span>
        </div>
        <IconButton label={fitted ? `Back to ${DESKTOP.w}×${DESKTOP.h}` : 'Fit the page to this panel'} pressed={fitted} disabled={!you} onClick={fitPanel}>
          {fitted ? <UnfitIcon className={ic} /> : <FitIcon className={ic} />}
        </IconButton>
        {you ? <Ghost onClick={() => link.send({ type: 'handback' })}>Hand back</Ghost> : <Ghost onClick={() => link.send({ type: 'take' })}>Take over</Ghost>}
      </div>

      {/* the page */}
      <div
        ref={cv.stage}
        role="application"
        aria-label={`The shared browser${st?.url ? `: ${st.url}` : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => annotate && link.setHover(null)}
        onContextMenu={(e) => you && e.preventDefault()}
        className={clsx(
          'relative min-h-0 flex-1 overflow-hidden bg-well select-none',
          annotate ? 'cursor-crosshair' : you ? 'cursor-default' : 'cursor-not-allowed',
          (you || annotate) && 'touch-none',
        )}
      >
        <canvas ref={cv.canvas} className="absolute inset-0 size-full" aria-hidden="true" />
        {annotate || you ? (
          <div
            className={clsx('pointer-events-none absolute outline-2 -outline-offset-2', annotate ? 'outline-focus outline-dashed' : 'outline-accent')}
            style={{ left: cv.rect.x, top: cv.rect.y, width: cv.rect.w, height: cv.rect.h }}
          />
        ) : null}
        {annotate && link.hover ? <Outline r={link.hover} rect={cv.rect} page={cv.page} /> : null}
        {annotate &&
          pins.map((p, i) => {
            const at = pinAt(p, st?.url ?? '', cv.meta, cv.rect, cv.page)
            return at ? <Pin key={i} n={i + 1} x={at.x} y={at.y} /> : null
          })}
        {annotate && draft && !draft.pick && !draft.error ? <Pin n={notes.length + 1} x={draft.at.x} y={draft.at.y} waiting /> : null}
        <textarea
          ref={keys}
          name="browser-keys"
          aria-label="Type into the page"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          tabIndex={you ? 0 : -1}
          className="pointer-events-none absolute top-0 left-0 size-px opacity-0"
          value={HELD}
          onFocus={(e) => e.target.setSelectionRange(HELD.length, HELD.length)}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onChange={(e) => you && typed(e.target.value)}
          onPaste={(e) => {
            e.preventDefault()
            const t = e.clipboardData.getData('text')
            if (you && t) link.send({ type: 'text', text: t })
          }}
        />
        {!showing ? (
          // over the canvas, which may still hold the last page (often a white one)
          <div className="absolute inset-0 grid place-items-center bg-well p-6 text-center">
            <div className="flex max-w-xs flex-col items-center gap-3">
              <Small className={clsx('text-pretty', link.error ? 'text-need-fg' : 'text-fg3')}>
                {link.error ?? (st && !st.connected ? 'The browser is closed.' : 'Starting the browser…')}
              </Small>
              {!link.ended && (link.error || (st && !st.connected)) ? <Ghost onClick={link.retry}>{link.error ? 'Try again' : 'Open it again'}</Ghost> : null}
            </div>
          </div>
        ) : null}
        {hint ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
            <div className="rounded-full bg-fg px-3 py-1.5 text-[0.8125rem] text-bg shadow-toast">{hint}</div>
          </div>
        ) : null}
      </div>

      {touch && you && !annotate ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
          <Ghost onClick={() => keys.current?.focus()}>Keyboard</Ghost>
          <Small>Type into the page with your keyboard.</Small>
        </div>
      ) : null}

      {annotate || notes.length || sent ? (
        <Notes
          notes={notes}
          draft={draft}
          sent={sent}
          annotate={annotate}
          onDraft={(comment) => setDraft((d) => (d ? { ...d, comment } : d))}
          onAdd={addDraft}
          onDrop={() => {
            if (draft?.pick) drop(draft.pick)
            setDraft(null)
          }}
          onRemove={(i) => {
            drop(notes[i].pick)
            setNotes((ns) => ns.filter((_, j) => j !== i))
          }}
          onSend={sendNotes}
        />
      ) : null}
    </div>
  )
}

/** why a task has no browser to show: merged, the plugin off on its machine, or agent-browser missing there */
export function browserOff(t: Task): string | null {
  if (t.status === 'done') return `${t.id} is done: its browser was closed.`
  if (!t.browser) return "The shared browser is off on this task's machine."
  return t.browser.ready ? null : (t.browser.hint ?? "The shared browser isn't installed on this task's machine.")
}
