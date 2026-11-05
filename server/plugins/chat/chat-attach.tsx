import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from 'react'
import { registry, setUI, useSnap, useStore, useUI } from '@client/kernel.ts'
import {
  CameraIcon,
  CheckIcon,
  Count,
  dimmed,
  DownIcon,
  FileIcon,
  ic,
  IconButton,
  LiveWave,
  Menu,
  MenuItem,
  MenuSeparator,
  roundBtn,
  useElapsed,
  XIcon,
} from '@client/ui.tsx'
import { dictSample } from '@client/dictation.ts'
import { extOf, isImage } from '@shared/files.ts'
import { EDGE } from '@client/gestures.ts'
import { named } from './paste.ts'
import { jumpTo } from './reply.ts'
import { AgentControls } from '@client/restart.tsx'
import { boxFocused, noFiles, attach, cancelDictation, finishDictation } from './chat-composer.tsx'
import { fileUrl } from './chat-asks.tsx'
import { useChat } from './chat-bubbles.tsx'
import { NewAt } from './chat-messages.tsx'

function blurBox() {
  if (boxFocused()) (document.activeElement as HTMLElement).blur()
}

function Pending({ f, chatKey, onRemove }: { f: { name: string; path?: string }; chatKey: string; onRemove: () => void }) {
  const [broken, setBroken] = useState(false)
  const path = f.path
  const picture = !!path && isImage(f.name) && !broken
  const ext = extOf(f.name)
  return (
    <div role="listitem" className="relative h-16 shrink-0 phone:h-[72px]">
      {picture ? (
        <button
          type="button"
          aria-label={`Open ${f.name}`}
          onClick={() => {
            // full screen, the keyboard goes down (the box keeps it for its other buttons)
            blurBox()
            setUI({ photo: { chat: chatKey, file: { name: f.name, path } } })
          }}
          className="relative block size-16 overflow-hidden rounded-box bg-bubble after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--line)] phone:size-[72px]"
        >
          <img src={fileUrl(chatKey, path)} alt={f.name} draggable={false} onError={() => setBroken(true)} className="size-full object-cover" />
        </button>
      ) : (
        <div title={f.name} className="flex h-full w-[184px] items-center gap-2.5 rounded-box bg-bubble pr-8 pl-2.5 phone:w-[200px]">
          <span className="grid size-10 shrink-0 place-items-center rounded-[calc(var(--box-radius)-var(--spacing)*2.5)] bg-bg text-fg2">
            <FileIcon className={ic} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[0.8125rem] phone:text-[0.9375rem]">{f.name}</span>
            <span className="block text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{ext ? `${ext.toUpperCase()} file` : 'File'}</span>
          </span>
        </div>
      )}
      {/* dark and ringed, so it shows on any picture in light and dark; taking a file out keeps the keyboard up */}
      <button
        type="button"
        aria-label={`Remove ${f.name}`}
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        className="absolute top-1 right-1 grid size-[22px] place-items-center rounded-full bg-black/60 after:absolute after:-inset-1 after:rounded-full text-white shadow-[0_0_0_1.5px_rgb(255_255_255/0.85)] backdrop-blur-sm hover:bg-black/75"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}

/** files waiting in the message box, in a row that scrolls sideways: a picture as a thumbnail you can open full
 *  screen, anything else as a small tile, each with a round x to take it out */
export function Attachments({ chatKey }: { chatKey: string }) {
  const files = useUI((u) => u.files[chatKey]) ?? noFiles
  const row = useRef<HTMLDivElement>(null)
  const count = useRef(files.length)
  // a file just added scrolls into view at the end of the row
  useLayoutEffect(() => {
    const el = row.current
    if (el && files.length > count.current) el.scrollLeft = el.scrollWidth
    count.current = files.length
  }, [files.length])
  useEffect(() => {
    // a mouse wheel scrolls the row sideways, since it has no scrollbar to grab
    const el = row.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [files.length > 0])
  if (!files.length) return null
  const remove = (f: (typeof files)[number]) => setUI((u) => ({ files: { ...u.files, [chatKey]: (u.files[chatKey] ?? []).filter((x) => x !== f) } }))
  return (
    <div
      ref={row}
      role="list"
      aria-label="Attached files"
      className="-mx-4 mb-2 flex gap-2 overflow-x-auto overscroll-x-contain px-4 motion-safe:scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {files.map((f, i) => (
        <Pending key={`${f.path ?? f.name}-${i}`} f={f} chatKey={chatKey} onRemove={() => remove(f)} />
      ))}
    </div>
  )
}

/** The + menu: attachments close it; plugin settings can stay open. Launch controls open the restart sheet. */
function PlusOpen({ chatKey, file, photo }: { chatKey: string; file: RefObject<HTMLInputElement | null>; photo: RefObject<HTMLInputElement | null> }) {
  const phone = useUI((u) => u.device === 'phone')
  const snap = useSnap()
  const close = () => setUI({ plus: null })
  const screenshot = async () => {
    close()
    if (phone) return photo.current?.click()
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const track = stream.getVideoTracks()[0]
      const video = document.createElement('video')
      video.srcObject = stream
      await video.play()
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')!.drawImage(video, 0, 0)
      track.stop()
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      if (!blob) return
      attach(chatKey, [named(new File([blob], '', { type: 'image/png' }), new Date())])
    } catch {
      /* cancelled */
    }
  }
  const cli = useChat(chatKey)?.cli ?? 'Agent'
  const settings = snap ? registry.composerSettings.filter((x) => x.when(snap, chatKey)) : []
  return (
    <Menu label="Attach files and more" tabs onClose={close} className="mb-2 w-fit max-w-full origin-bottom-left">
      <MenuItem
        icon={<FileIcon className={ic} />}
        onClick={() => {
          close()
          file.current?.click()
        }}
      >
        File or photo
      </MenuItem>
      <MenuItem icon={<CameraIcon className={ic} />} onClick={screenshot}>
        {phone ? 'Take a photo' : 'Screenshot'}
      </MenuItem>
      <MenuSeparator />
      <AgentControls chatKey={chatKey} cli={cli} />
      {settings.map(({ View }, i) => (
        <View key={i} chatKey={chatKey} />
      ))}
    </Menu>
  )
}

/** the + menu, and the device's file pickers it opens: they stay once the menu has closed, to hear what was picked */
export function PlusMenu({ chatKey }: { chatKey: string }) {
  const open = useUI((u) => u.plus === chatKey)
  const file = useRef<HTMLInputElement>(null)
  const photo = useRef<HTMLInputElement>(null)
  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    attach(chatKey, Array.from(e.target.files ?? []))
    e.target.value = ''
  }
  return (
    <>
      <input ref={file} type="file" name="file" data-chat={chatKey} multiple hidden onChange={upload} />
      <input ref={photo} type="file" name="photo" accept="image/*" capture="environment" hidden onChange={upload} />
      {open ? <PlusOpen chatKey={chatKey} file={file} photo={photo} /> : null}
    </>
  )
}

/** While you talk to type the box records: Cancel, a red dot and the time, the live wave of your voice, Done */
export function DictationBox() {
  const ui = useUI()
  const t = useElapsed(ui.dictStarted)
  return (
    <>
      <IconButton label="Cancel" className={roundBtn} onClick={cancelDictation}>
        <XIcon className={ic} />
      </IconButton>
      <p className="flex shrink-0 items-center gap-2 pr-1 pl-2 text-[0.8125rem] text-fg2 tabular-nums phone:text-[0.9375rem]">
        <span aria-hidden="true" className="size-2 rounded-full bg-need motion-safe:animate-pulse" />
        <span role="status" className="sr-only">
          {ui.dictDone ? 'Putting it in the box' : 'Recording'}
        </span>
        {t}
      </p>
      <LiveWave sample={dictSample} label="Your voice" className="mr-1.5 flex-1" />
      <button
        type="button"
        aria-label="Done: put it in the box"
        disabled={ui.dictDone}
        onClick={() => finishDictation()}
        className={clsx(
          'press-dim relative grid size-[34px] shrink-0 place-items-center rounded-full bg-fg text-bg after:absolute after:-inset-1.5 phone:size-11',
          dimmed,
        )}
      >
        <CheckIcon className={ic} />
      </button>
    </>
  )
}

/** how far up (px) counts as reading back: the chat stops following new replies, and the jump to the latest shows */
const AWAY = 80
/** how long a jump to a message may glide (a slow phone takes its time) */
const JUMP_GLIDE = 2000

/** how far (px) a finger moves before its way is known: sideways (a reply, the drawer) or up and down (a scroll) */
const SLOP = 24

/** a tap on what goes with the message box (inside data-keep-box: send, +, a file's x, a reaction) leaves the box the
 *  focus, so a phone's keyboard stays up, as in iMessage and Slack; a text field there still takes it */
export function keepBox(e: Event) {
  const t = e.target as HTMLElement
  if (boxFocused() && t.closest?.('[data-keep-box]') && !t.closest('input, textarea, select, [contenteditable=true]')) e.preventDefault()
}

/** a chat opens at its newest message and follows new ones (pages growing too) while you are at the bottom. Scrolled
    up, a round arrow jumps back down, counting the replies that came in meanwhile, and a New line marks where they
    begin (like WhatsApp and Slack); what you send clears it. */
/** how far up from the newest message a chat was read, kept across a reload for a new build (the tab's own storage) */
function scrollKeep(chatKey: string, left: number) {
  try {
    sessionStorage.setItem(`shepherdr.scroll.${chatKey}`, String(Math.round(left)))
  } catch {
    /* private window: it opens at the newest message */
  }
}

function scrollKept(chatKey: string): number | null {
  try {
    const v = sessionStorage.getItem(`shepherdr.scroll.${chatKey}`)
    sessionStorage.removeItem(`shepherdr.scroll.${chatKey}`)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function StickToBottom({ chatKey, children }: { chatKey: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  /** until when a jump to a message (a quote's, an alert's link) is still gliding to it */
  const jumping = useRef(0)
  const [away, setAway] = useState(false)
  const [newAt, setNewAt] = useState<string | null>(null)
  // the agent's messages, and how many of them you had seen at the bottom
  const replies = useStore((s) =>
    (s.chats[chatKey]?.messages ?? [])
      .filter((m) => m.who === 'agent' && !m.waiting)
      .map((m) => m.id)
      .join('\n'),
  )
  const ids = replies ? replies.split('\n') : []
  /** the replies you had in view at the bottom: the others came in while you read further up */
  const read = useRef<Set<string> | null>(null)
  read.current ??= new Set(ids)
  const unseen = ids.filter((id) => !read.current!.has(id))
  /** you read to the bottom since the line was drawn: new ones later start a new line */
  const caughtUp = useRef(false)
  useEffect(() => {
    if (!away) {
      for (const id of ids) read.current!.add(id)
      caughtUp.current = true
    } else if (unseen.length && (!newAt || caughtUp.current)) {
      setNewAt(unseen[0])
      caughtUp.current = false
    }
  }, [replies, away])
  const unread = away ? unseen.length : 0
  // what you send scrolls the chat down to it, wherever you were
  const sentAt = useStore((s) => s.outbox.reduce((n, o) => (o.chat === chatKey ? Math.max(n, o.at) : n), 0))
  const seen = useRef(sentAt)
  useLayoutEffect(() => {
    if (sentAt <= seen.current) return
    seen.current = sentAt
    pinned.current = true
    setNewAt(null)
    box.current!.scrollTop = box.current!.scrollHeight
  }, [sentAt])
  useLayoutEffect(() => {
    const el = box.current!
    el.scrollTop = el.scrollHeight
    // read further up when the screen reloaded for a new build: back where you were, as far from the newest message
    // (held there while the chat draws in, its newest messages last)
    let back = scrollKept(chatKey)
    const placeBack = () => {
      if (back === null || el.scrollHeight - el.clientHeight < back) return
      pinned.current = false
      el.scrollTop = el.scrollHeight - el.clientHeight - back
      lastTop.current = el.scrollTop
      setAway(true)
    }
    placeBack()
    const settled = back === null ? undefined : setTimeout(() => (back = null), 1500)
    const keepScroll = () => {
      if (!pinned.current) scrollKeep(chatKey, el.scrollHeight - el.scrollTop - el.clientHeight)
    }
    addEventListener('shepherdr:reloading', keepScroll)
    // read further up, the chat keeps its bottom edge where it was as the box gets shorter or taller (the message box
    // growing as you type, the keyboard): what was just above the message box stays just above it, as in iMessage
    let height = el.clientHeight
    const keep = () => {
      if (back !== null) return placeBack()
      if (pinned.current) el.scrollTop = el.scrollHeight
      // (not while a jump glides up: setting it stops the glide)
      else if (performance.now() > jumping.current) el.scrollTop += height - el.clientHeight
      height = el.clientHeight
    }
    const ro = new ResizeObserver(keep)
    ro.observe(inner.current!)
    // and when the box itself gets shorter (the keyboard opens), the newest message stays in view: at once, so what
    // glides with the keyboard (viewport.ts) starts from the right place
    ro.observe(el)
    addEventListener('app-resized', keep)
    // a jump to a message (a quote's, an alert's, find's): its glide starts near the bottom, so no taking hold of it
    // again on the way, nor keeping the bottom edge (what draws late, a slow phone or a busy page, would stop it short)
    const glide = () => {
      pinned.current = false
      jumping.current = performance.now() + JUMP_GLIDE
    }
    el.addEventListener('chat-jump', glide)
    return () => {
      ro.disconnect()
      removeEventListener('app-resized', keep)
      removeEventListener('shepherdr:reloading', keepScroll)
      clearTimeout(settled)
      el.removeEventListener('chat-jump', glide)
    }
  }, [])
  // an alert's link: once this chat shows its card, the card comes into view, lit up, its buttons ready
  const jump = useStore((s) => s.ui.jump)
  const msgs = useStore((s) => s.chats[chatKey]?.messages)
  useEffect(() => {
    const m = jump ? msgs?.find((x) => x.id === jump || x.question?.id === jump) : undefined
    if (!m) return
    // after the chat has settled at its newest message
    const t = setTimeout(() => {
      if (jumpTo(chatKey, m.id, { card: !!m.question && m.question.id === jump })) setUI({ jump: null })
    }, 120)
    return () => clearTimeout(t)
  }, [jump, msgs])
  // as in iMessage, scrolling the chat keeps a phone's keyboard up: it goes down only when the finger drags down past
  // the message box into the keyboard, or on a plain tap on the chat
  const swipe = useRef<{ x: number; y: number; scroll?: boolean } | null>(null)
  const lastTop = useRef(0)
  const toBottom = () => {
    const el = box.current!
    pinned.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          const left = el.scrollHeight - el.scrollTop - el.clientHeight
          // only a scroll up lets go of the bottom: a picture loading grows the list under a scroll on its way down,
          // and the chat must still end at the newest message, not short of it under the arrow
          if (left < AWAY) pinned.current ||= performance.now() > jumping.current
          else if (el.scrollTop < lastTop.current) pinned.current = false
          lastTop.current = el.scrollTop
          setAway(!pinned.current)
        }}
        onTouchStart={(e) => {
          const t = e.touches[0]
          // one from the screen's edge is the screen's (the drawer, going back), even as a thumb's arc dips down
          const edge = t.clientX - e.currentTarget.getBoundingClientRect().left < EDGE
          swipe.current = e.touches.length === 1 && boxFocused() && !edge ? { x: t.clientX, y: t.clientY } : null
        }}
        onTouchMove={(e) => {
          const from = swipe.current
          const t = e.touches[0]
          if (!from || !t) return
          // a sideways swipe (a reply, the drawer) is never a drag into the keyboard
          const dx = Math.abs(t.clientX - from.x)
          const dy = Math.abs(t.clientY - from.y)
          if (!from.scroll && Math.max(dx, dy) > SLOP) {
            if (dx > dy) return void (swipe.current = null)
            from.scroll = true
          }
          // down past the bottom of the box, onto the keyboard
          const kb = document.activeElement?.closest('[data-composer]')?.getBoundingClientRect().bottom
          if (kb !== undefined && t.clientY > kb) {
            swipe.current = null
            blurBox()
          }
        }}
        onClick={(e) => {
          if (!matchMedia('(pointer: coarse)').matches || !boxFocused() || !getSelection()?.isCollapsed) return
          if ((e.target as HTMLElement).closest('a, button, input, textarea, select, label, iframe, [role=button], [role=menuitem], [contenteditable=true]'))
            return
          blurBox()
        }}
        className="flex min-h-0 flex-1 touch-pan-y touch-pinch-zoom flex-col overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        <div ref={inner} data-kb className="flex flex-1 flex-col">
          <NewAt.Provider value={newAt}>{children}</NewAt.Provider>
        </div>
      </div>
      {/* read further up, the chat fades out at the bottom, so the arrow sits on the fade, not on crisp words (like
          ChatGPT) */}
      {away ? (
        <div
          aria-hidden="true"
          data-fade-under-jump
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-b from-transparent to-bg to-55%"
        />
      ) : null}
      {away ? (
        <button
          type="button"
          aria-label={unread ? `${unread} new ${unread === 1 ? 'reply' : 'replies'}: jump to the latest` : 'Jump to the latest'}
          onClick={toBottom}
          // in the middle, over the gap between the two sides' bubbles, as in ChatGPT and Slack
          className="absolute bottom-2 left-1/2 z-10 grid size-10 -translate-x-1/2 place-items-center rounded-full bg-bg text-fg2 shadow-menu hover:text-fg phone:size-11"
        >
          <DownIcon className={ic} />
          {/* centred on the button's edge at its top right, a ring of the page around it so it reads clear of the
              button's shadow */}
          <Count n={unread} className="absolute -top-0.75 -right-0.75 shadow-[0_0_0_2px_var(--bg)] phone:-top-1 phone:-right-1" />
        </button>
      ) : null}
    </div>
  )
}
