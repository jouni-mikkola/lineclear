import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { act, chatName, getDraft, getState, holdReload, registry, setDraft, setOutbox, setUI, useDraft, useSnap, useUI } from '@client/kernel.ts'
import { priorOf, type Outgoing } from '@client/outbox.ts'
import {
  CheckIcon,
  FileIcon,
  ic,
  IconButton,
  KeyIcon,
  MicIcon,
  PageIcon,
  PlusIcon,
  Primary,
  roundBtn,
  SecretField,
  Sent,
  Tab,
  Tabs,
  UpIcon,
  XIcon,
} from '@client/ui.tsx'
import { canDictate, dictate, type Dictation } from '@client/dictation.ts'
import type { Chat, SecretAsk } from '@shared/types.ts'
import { buzz } from '@plugins/reactions/client.tsx'
import { pasted } from './paste.ts'
import { cancelReply } from './reply.ts'
import { CardShell, jumps } from './chat-cards.tsx'
import { newCid, deliver } from './chat-asks.tsx'

/* ---------- a secret an agent asked for ---------- */

/** a masked box for a secret an agent asked for by name, and where it is kept (its space, its machine, Everywhere).
 *  The value goes once to the main machine and is never kept here, as a draft or otherwise; the agent is told it is
 *  there, by name only */
export function SecretCard({ ask, chat }: { ask: SecretAsk; chat: Chat }) {
  const [value, setValue] = useState('')
  const [level, setLevel] = useState(ask.levels[0]?.id ?? 'all')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    if (!value || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = (await act({ type: 'secret', level, name: ask.name, value, card: { chat: chat.key, id: ask.id } })) as { ok?: boolean; error?: string }
      if (r?.ok === false) setErr(r.error ?? "That didn't go through.")
      else setValue('')
    } catch {
      setErr("That didn't go through: Lineclear can't be reached.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <CardShell title={`Secret: ${ask.name}`} icon={KeyIcon}>
      {ask.why ? <p className="text-pretty break-words">{ask.why}</p> : null}
      {ask.saved ? (
        <Sent>
          <CheckIcon className={ic} />
          <span className="min-w-0 truncate">Saved for {ask.saved}</span>
        </Sent>
      ) : (
        <>
          <SecretField label={ask.name} value={value} onChange={setValue} onEnter={save} />
          {ask.levels.length > 1 ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-[0.75rem] text-fg2 phone:text-[0.8125rem]">For</span>
              <Tabs label="Where it is kept">
                {ask.levels.map((l) => (
                  <Tab key={l.id} on={l.id === level} onClick={() => setLevel(l.id)}>
                    {l.label}
                  </Tab>
                ))}
              </Tabs>
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <span role="status" className={clsx('mr-auto text-[0.75rem] text-pretty phone:text-[0.8125rem]', err ? 'text-need' : 'text-fg3')}>
              {err || 'Agents use it by name, never seeing it.'}
            </span>
            <Primary soft disabled={busy || !value} onClick={save}>
              Save
            </Primary>
          </div>
        </>
      )}
    </CardShell>
  )
}

export const noFiles: { name: string; path?: string }[] = []

/** Talk to type: the box records what you say, then it lands in the box to edit */
let dictation: Dictation | null = null
function setDictation(value: typeof dictation): void {
  dictation = value
}

export function finishDictation() {
  setUI({ dictDone: true })
  dictation?.finish()
}

export function cancelDictation() {
  const d = dictation
  setDictation(null)
  setUI({ dict: null, dictDone: false })
  d?.cancel()
}

function boxOf(chatKey: string) {
  return document.querySelector<HTMLTextAreaElement>(`textarea[data-chat="${CSS.escape(chatKey)}"]`)
}

export function toggleDictation(chatKey: string) {
  const ui = getState().ui
  if (ui.dict === chatKey) return finishDictation()
  // a call has the microphone and the box: talk to type waits until it ends
  if (ui.call) return
  if (ui.dict) cancelDictation()
  // the words go where you were typing (in place of what you had selected), or else at the end
  const box = boxOf(chatKey)
  const at = box && document.activeElement === box ? [box.selectionStart, box.selectionEnd] : null
  // the box records instead of taking typing, so the keyboard goes down
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  setUI({ dict: chatKey, dictStarted: Date.now(), dictDone: false, focus: null, plus: null })
  setDictation(
    dictate((said) => {
      setDictation(null)
      if (getState().ui.dict !== chatKey) return
      const now = getDraft(chatKey) ?? ''
      const [from, to] = at && at[1] <= now.length ? at : [now.length, now.length]
      const before = now.slice(0, from)
      const after = now.slice(to)
      let caret = to
      if (said) {
        const words = (before && !/\s$/.test(before) ? ' ' : '') + said
        setDraft(chatKey, before + words + (after && !/^\s/.test(after) ? ' ' : '') + after)
        caret = before.length + words.length
      }
      setUI({ dict: null, dictDone: false })
      // the box comes back as a new textarea: the cursor goes into it right after the words, its line in view
      let tries = 10
      const back = () => {
        const el = boxOf(chatKey)
        if (!el) return --tries && requestAnimationFrame(back)
        el.focus()
        el.setSelectionRange(caret, caret)
      }
      requestAnimationFrame(back)
    }),
  )
}

export function Mic({ chatKey }: { chatKey: string }) {
  const on = useUI((u) => u.dict === chatKey)
  if (!canDictate()) return null
  return (
    <IconButton label="Talk to type" className={roundBtn} pressed={on} onClick={() => toggleDictation(chatKey)}>
      <MicIcon className={ic} />
    </IconButton>
  )
}

/** the line with the caret in full view in the message box, with the padding round it, so no fade is on it */
function reveal(el: HTMLTextAreaElement) {
  if (el.scrollHeight <= el.clientHeight || el.selectionStart !== el.selectionEnd) return
  const cs = getComputedStyle(el)
  const [pt, pb, pl, pr, lh] = [cs.paddingTop, cs.paddingBottom, cs.paddingLeft, cs.paddingRight, cs.lineHeight].map(parseFloat)
  if (!lh) return
  // which line the caret is on: the words up to it, wrapped as the box wraps them, in a copy nobody sees
  const copy = document.createElement('div')
  const props = [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'wordSpacing',
    'lineHeight',
    'tabSize',
    'textIndent',
    'textTransform',
    'whiteSpace',
    'overflowWrap',
    'wordBreak',
  ] as const
  for (const k of props) copy.style[k] = cs[k]
  Object.assign(copy.style, { position: 'absolute', top: '0', left: '-9999px', visibility: 'hidden', width: `${el.clientWidth - pl - pr}px` })
  copy.textContent = el.value.slice(0, el.selectionEnd)
  const caret = copy.appendChild(document.createElement('span'))
  caret.textContent = '\u200b'
  document.body.appendChild(copy)
  const line = Math.floor(caret.offsetTop / lh)
  copy.remove()
  const top = line * lh
  const bottom = pt + (line + 1) * lh + pb
  if (top < el.scrollTop) el.scrollTop = top
  else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
}

/** mark which ends of the message box have more words past them, for its fades */
function fades(el: HTMLElement) {
  // only words past the padding count: a box a few px short of its end (a phone showing the caret) has none below
  const cs = getComputedStyle(el)
  el.toggleAttribute('data-more-up', el.scrollTop > parseFloat(cs.paddingTop) + 1)
  el.toggleAttribute('data-more-down', el.scrollTop + el.clientHeight < el.scrollHeight - parseFloat(cs.paddingBottom) - 1)
}

/** in the message box while it replies, over the words: "Replying to" whom and the start of it on one line, with a
    small x to drop it; a tap on the line shows the message. It starts in line with the + under it, the x over send */
function ReplyStrip({ chatKey }: { chatKey: string }) {
  const q = useUI((u) => u.reply[chatKey])
  const snap = useSnap()
  if (!q) return null
  const name = q.who === 'you' ? 'You' : snap ? chatName(snap, chatKey) : 'Agent'
  return (
    <div data-reply-strip className="flex h-7 items-center gap-2 pr-0.75 pl-2.25 text-[0.8125rem] phone:h-8 phone:pr-2 phone:pl-3.5 phone:text-[0.875rem]">
      <div {...jumps(chatKey, q, `Replying to ${name}`)} className="min-w-0 flex-1 cursor-pointer truncate text-fg2">
        {/* a long name gives way, so some of the words always show */}
        Replying to <span className="inline-block max-w-[45%] truncate align-top font-medium text-fg">{name}</span>{' '}
        {q.file ? <FileIcon className="mr-1 inline size-3.5 align-[-2px]" /> : null}
        {q.artifact ? <PageIcon className="mr-1 inline size-3.5 align-[-2px]" /> : null}
        {q.text}
      </div>
      {/* taking the reply away keeps the keyboard up */}
      <button
        type="button"
        aria-label="Cancel reply"
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => cancelReply(chatKey)}
        className="hit grid size-7 shrink-0 place-items-center rounded-full text-fg3 hover:bg-hover hover:text-fg2"
      >
        <XIcon className={ic} />
      </button>
    </div>
  )
}

/** files from +, a paste or a drop: each uploads to the agent's machine and waits in the message box until it is sent */
export async function attach(chatKey: string, list: File[]) {
  if (!list.length) return
  const release = holdReload()
  let added: { name: string; path?: string }[]
  try {
    added = await Promise.all(
      list.map(async (f) => {
        const body = new FormData()
        body.append('chat', chatKey)
        body.append('file', f)
        const r = await fetch('api/upload', { method: 'POST', body, headers: { 'x-lineclear': '1' } })
          .then((x) => x.json())
          .catch(() => null)
        return { name: f.name, path: r?.path as string | undefined }
      }),
    )
  } finally {
    release()
  }
  setUI((u) => ({ plus: null, files: { ...u.files, [chatKey]: [...(u.files[chatKey] ?? []), ...added] } }))
}

export function Composer({ chatKey, placeholder, cli }: { chatKey: string; placeholder: string; cli: string }) {
  const [text, setText] = useDraft(chatKey)
  const files = useUI((u) => u.files[chatKey]) ?? noFiles
  const device = useUI((u) => u.device)
  const focused = useUI((u) => u.focus === chatKey)
  const keyboard = useUI((u) => u.keyboard)
  const plus = useUI((u) => u.plus === chatKey)
  const ref = useRef<HTMLTextAreaElement>(null)
  const live = useUI((u) => registry.composerLive.find((l) => l.when(u, chatKey)))
  const Idle = registry.composerIdle
  const Mic = registry.composerMic
  useEffect(() => {
    if (focused && device === 'desktop') ref.current?.focus()
  }, [focused, device])
  // a narrower box wraps the words too; a shorter one (a phone's keyboard coming up) keeps where you type in view
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      if (document.activeElement === el) reveal(el)
      fades(el)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [!!live])
  // its max height follows the screen's (a phone's keyboard coming or going): it fits it again at once, once the app
  // has taken the new height (viewport.ts)
  const [room, setRoom] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    const on = () => requestAnimationFrame(() => setRoom(vv?.height ?? innerHeight))
    vv?.addEventListener('resize', on)
    addEventListener('resize', on)
    return () => {
      vv?.removeEventListener('resize', on)
      removeEventListener('resize', on)
    }
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // the words grow the box upward, between buttons that stay put, up to its max height (CSS), then scroll inside.
    // Measuring at auto height loses where it was scrolled to: it scrolls back, then the line you type comes into full
    // view, padding and all (the browser alone stops short, under the fade)
    const top = el.scrollTop
    // measured at auto height, which is one line: what holds it keeps its height meanwhile, or the chat above would
    // grow for a moment, pull its newest message up out of view and let go of the bottom
    const hold = el.parentElement!
    hold.style.height = `${hold.offsetHeight}px`
    el.style.height = 'auto'
    // once it scrolls, it holds whole lines between its paddings, so at the end the line above shows only in the top
    // padding, where it fades: no line looks cut, and none under the fades is one you can read
    const cs = getComputedStyle(el)
    const [max, lh, pads] = [parseFloat(cs.maxHeight), parseFloat(cs.lineHeight), parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)]
    el.style.height = `${el.scrollHeight > max && lh ? pads + Math.floor((max - pads) / lh) * lh : el.scrollHeight}px`
    hold.style.height = ''
    el.scrollTop = top
    if (document.activeElement === el) reveal(el)
    fades(el)
    // and again when the box comes back after talking to type or a call: it is a new textarea then
  }, [text, width, room, !!live])
  const send = () => {
    const t = text.trim()
    if (!t && !files.length) return
    const reply = getState().ui.reply[chatKey]
    setText('')
    setUI((u) => {
      const { [chatKey]: _, ...replies } = u.reply
      // the + menu goes too (on a desktop Enter can send with it open)
      return { files: { ...u.files, [chatKey]: [] }, reply: replies, plus: u.plus === chatKey ? null : u.plus }
    })
    const out: Outgoing = {
      cid: newCid(),
      chat: chatKey,
      text: t,
      files: files.map((f) => ({ name: f.name, path: f.path ?? f.name })),
      reply,
      at: Date.now(),
      state: 'sending',
      prior: priorOf(getState().chats[chatKey]),
    }
    setOutbox((all) => [...all, out])
    deliver(out)
  }
  return (
    // what goes with the box (send, +, a file's x, its menu) leaves the box the focus: a phone's keyboard stays up
    <div data-kb data-keep-box className={clsx('mx-auto w-full max-w-read shrink-0 px-4 pt-2', keyboard && device === 'phone' ? 'pb-1.5' : 'pb-4')}>
      {registry.composerAbove.map(({ View }, i) => (
        <View key={i} chatKey={chatKey} cli={cli} />
      ))}
      {/* a pill: the corners are half its one-line height, so one line has round ends; taller, the buttons keep their
          size and spot in the bottom corners, with the same curve around them (like iMessage) */}
      <div data-composer className="round-box bg-bg p-1.5 shadow-box has-[textarea:focus]:shadow-box-focus">
        {/* what it replies to: one quiet line inside the box, over the words (like WhatsApp and Telegram) */}
        <ReplyStrip chatKey={chatKey} />
        <div data-btns className={live ? 'flex items-center gap-1' : 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-1'}>
          {live ? (
            <live.View chatKey={chatKey} />
          ) : (
            <>
              {registry.composerPlus ? (
                <IconButton label="Attach files and more" className={roundBtn} pressed={plus} onClick={() => setUI({ plus: plus ? null : chatKey })}>
                  <PlusIcon className={ic} />
                </IconButton>
              ) : null}
              <div className="relative col-start-2 flex min-w-0 self-stretch">
                <textarea
                  ref={ref}
                  name="message"
                  data-chat={chatKey}
                  data-kept
                  data-quiet
                  aria-label={placeholder}
                  rows={1}
                  value={text}
                  placeholder=""
                  onChange={(e) => setText(e.target.value)}
                  onPaste={(e) => {
                    // a screenshot or a copied file attaches, as + does; text pastes as text
                    const list = pasted(e.clipboardData)
                    if (!list.length) return
                    e.preventDefault()
                    attach(chatKey, list)
                  }}
                  onScroll={(e) => fades(e.currentTarget)}
                  // the caret moved (an arrow key, a tap, a letter typed, after which a phone scrolls to the caret
                  // itself, short of the padding): its line comes into full view
                  onSelect={(e) => {
                    reveal(e.currentTarget)
                    fades(e.currentTarget)
                  }}
                  onFocus={() => setUI({ focus: chatKey })}
                  onBlur={() => getState().ui.focus === chatKey && setUI({ focus: null })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && device === 'desktop' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      send()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      // a reply is dropped first, then the box lets go
                      if (getState().ui.reply[chatKey]) return cancelReply(chatKey)
                      ref.current?.blur()
                      setUI({ focus: null })
                    }
                  }}
                  className={clsx(
                    // at most 8 lines (less with a phone's keyboard up): past that it scrolls inside, an edge with more
                    // words past it fading out over its padding, so no line looks cut and every whole line stays crisp
                    // (the one you type too), the scrollbar only while it moves
                    'max-h-[min(calc(8lh+0.875rem),calc(var(--app-h,100dvh)*0.32))] min-h-[34px] w-full flex-1 resize-none self-center overflow-y-auto overscroll-y-contain bg-transparent py-[7px] pl-1.5 text-fg outline-none phone:max-h-[min(calc(8lh+1.25rem),calc(var(--app-h,100dvh)*0.32))] phone:min-h-11 phone:py-2.5',
                    '[--fade-down:0px] [--fade-up:0px] [mask-image:linear-gradient(transparent,#000_var(--fade-up),#000_calc(100%-var(--fade-down)),transparent)] data-more-down:[--fade-down:7px] data-more-up:[--fade-up:7px] phone:data-more-down:[--fade-down:10px] phone:data-more-up:[--fade-up:10px]',
                    !registry.composerPlus && 'pl-3',
                    text ? 'whitespace-pre-wrap' : 'whitespace-nowrap',
                  )}
                />
                {!text ? (
                  <span
                    aria-hidden="true"
                    className={clsx('pointer-events-none absolute inset-y-0 right-0 flex items-center text-fg3', registry.composerPlus ? 'left-1.5' : 'left-3')}
                  >
                    <span className="truncate">{placeholder}</span>
                  </span>
                ) : null}
              </div>
              <div data-btns className="col-start-3 flex items-center gap-1">
                {Mic ? <Mic chatKey={chatKey} /> : null}
                {text.trim() || files.length || !Idle ? (
                  <button
                    type="button"
                    aria-label="Send"
                    onClick={() => {
                      // a light tap from the phone as it goes, like ChatGPT's
                      if (matchMedia('(pointer: coarse)').matches) buzz()
                      send()
                    }}
                    className="press-dim relative grid size-[34px] shrink-0 place-items-center rounded-full bg-fg text-bg after:absolute after:-inset-1.5 phone:size-11"
                  >
                    <UpIcon className={ic} />
                  </button>
                ) : (
                  <Idle chatKey={chatKey} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** the message box has the focus (a phone's keyboard is up for it) */
export const boxFocused = () => !!document.activeElement?.matches('textarea[name=message]')
