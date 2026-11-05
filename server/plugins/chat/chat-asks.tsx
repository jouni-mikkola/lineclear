import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { act, getState, goChat, has, holdReload, openTask, setOutbox, setUI, taskOf, useDraft, useSnap } from '@client/kernel.ts'
import { priorOf, reasonOf, SEND_TIMEOUT, type Outgoing } from '@client/outbox.ts'
import { AlertIcon, CheckIcon, Dot, DownloadIcon, FileIcon, ic, LinkButton, MachineIcon, ModeIcon, Primary, RestartIcon, Sent, TextBox } from '@client/ui.tsx'
import { extOf } from '@shared/files.ts'
import { modeName, type CardAsk, type Chat, type Message, type Question, type UpdateCard } from '@shared/types.ts'
import { answeredBy } from './reply.ts'
import { type CardSource, CardShell, noteBox, answeredHow, Quote, type useHold, cardBox, cardLine, cardAside, NOW, PrOnCard, removeOut } from './chat-cards.tsx'

/** space: a copy of a task's question on its needs-you card in that space's chat, answered there */
export function QuestionCard({
  q,
  chat,
  msg,
  from,
  space,
  source,
}: {
  q: Question
  chat: Chat
  msg: string
  from: string
  space?: string
  source?: CardSource
}) {
  // Unmarked cards always require a deliberate pick and Send, including all approval prompts.
  const [sel, setSel] = useState<number[]>([])
  // half-typed notes survive a reload
  const [note, setNote] = useDraft(`card:${chat.key}:${q.id}`)
  const [other, setOther] = useDraft(`card-other:${chat.key}:${q.id}`)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const [composing, setComposing] = useState(false)
  const [err, setErr] = useState('')
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const sent = q.sent !== undefined
  const by = answeredBy(q, chat, msg)
  // a plan sent back says what to change in the note
  const needNote = q.noteRequiredFor !== undefined && sel[0] === q.noteRequiredFor
  const picked = sel.length > 0 || !!other.trim()
  // Positive opt-in, plus structural exclusions: unknown kinds and older/plugin cards remain confirmed.
  const ordinary =
    q.ordinary === true &&
    (q.kind === 'Form' || q.kind === 'Question') &&
    !q.multi &&
    !q.terminal &&
    !q.screen &&
    !q.steps &&
    !q.reject &&
    !q.noNote &&
    q.noteRequiredFor === undefined &&
    !q.id.startsWith('menu:')
  const immediate = ordinary && !sent && !composing && !note && !other
  const choose = (j: number) => setSel(q.multi ? (sel.includes(j) ? sel.filter((x) => x !== j) : [...sel, j]) : [j])
  const send = async (reject = false, choice = sel[0] ?? -1) => {
    if (sent || sending.current) return
    // sending a plan back needs a note: the box says so and takes the focus
    if (needNote && !note.trim()) return noteRef.current?.focus()
    sending.current = true
    setBusy(true)
    setErr('')
    let accepted = false
    try {
      const r = await act({
        type: 'answer',
        chat: chat.key,
        question: q.id,
        choice: reject ? -1 : choice,
        choices: q.multi ? (reject ? [] : sel) : undefined,
        note: note.trim() || undefined,
        other: other.trim() || undefined,
        space,
      })
      if (r?.ok === false) setErr(r.error ?? "That didn't go through.")
      else {
        accepted = true
        setNote('')
        setOther('')
      }
    } catch (e) {
      setErr(reasonOf(e))
    } finally {
      // Keep a successful answer locked until the server's answered snapshot arrives.
      if (!accepted) {
        sending.current = false
        setBusy(false)
      }
    }
  }
  useEffect(() => {
    if (composing) noteRef.current?.focus()
  }, [composing])
  return (
    <CardShell title={q.title} plan={q.kind === 'Plan'} source={source}>
      {q.screen ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-fg2">{q.screen}</pre> : null}
      {q.terminal && has('terminal') ? (
        <button type="button" className="text-left text-accent" onClick={() => setUI({ term: chat.key, arts: null, kb: true })}>
          Open terminal
        </button>
      ) : null}
      {q.steps ? (
        <ol className="flex list-decimal flex-col gap-0.5 pl-5">
          {q.steps.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      ) : null}
      {immediate && !sent ? <p className="text-[0.8125rem] text-fg2">Choose an answer to send it now.</p> : null}
      {q.choices.map((c, j) => {
        const on = sent ? q.sent === j : sel.includes(j)
        return (
          <button
            key={j}
            type="button"
            aria-pressed={immediate ? undefined : on}
            disabled={sent || busy}
            onClick={() => {
              if (immediate) {
                setSel([j])
                void send(false, j)
              } else choose(j)
            }}
            className="group press relative flex min-h-10 w-full items-center gap-2.5 rounded-row px-3 py-2 text-left shadow-[inset_0_0_0_1px_var(--line2)] enabled:hover:bg-hover disabled:cursor-default disabled:opacity-40 aria-pressed:shadow-[inset_0_0_0_1.5px_var(--fg)] disabled:aria-pressed:opacity-100 coarse:min-h-11 phone:min-h-12"
          >
            {immediate ? null : (
              <span
                aria-hidden="true"
                className={clsx(
                  'size-4 shrink-0 shadow-[inset_0_0_0_1.5px_var(--fg3)] group-aria-pressed:shadow-[inset_0_0_0_5px_var(--fg)]',
                  q.multi ? 'rounded-[4px]' : 'rounded-full',
                )}
              />
            )}
            {c.description ? (
              <span>
                <span className="block">{immediate ? `Send: ${c.label}` : c.label}</span>
                <span className="block text-[0.75rem]/[18px] text-fg2 phone:text-[0.8125rem]/5">{c.description}</span>
              </span>
            ) : immediate ? (
              `Send: ${c.label}`
            ) : (
              c.label
            )}
          </button>
        )
      })}
      {q.other && !sent ? (
        <input
          name="other"
          disabled={busy}
          data-kept
          aria-label="Other answer"
          className={noteBox}
          placeholder="Other: type your own answer…"
          value={other}
          onChange={(e) => {
            setOther(e.target.value)
            // a typed answer replaces the choices
            if (e.target.value.trim()) setSel([])
          }}
        />
      ) : null}
      {sent ? (
        <Sent>
          <CheckIcon className={ic} />
          <span className="shrink-0">{q.elsewhere?.label ?? answeredHow(q)}</span>
          {/* answered on its other copy: a link to that chat */}
          {q.elsewhere ? <LinkButton onClick={() => goChat(q.elsewhere!.chat)}>{q.elsewhere.name}</LinkButton> : null}
          {/* the words it was answered with, on one line (a message in the chat shows as its quote, below) */}
          {q.said && q.via !== 'chat' ? <span className="min-w-0 truncate text-fg2">“{q.said.replace(/\s+/g, ' ')}”</span> : null}
        </Sent>
      ) : null}
      {/* the message that answered it, as a reply's quote: a tap jumps to it */}
      {by ? <Quote q={by} chat={chat.key} from={from} you={false} loose label="Answered by" /> : null}
      {sent || (q.terminal && !q.choices.length) ? null : (
        <>
          {immediate ? (
            <button type="button" disabled={busy} className="min-h-11 text-left text-accent" onClick={() => setComposing(true)}>
              Add a note
            </button>
          ) : null}
          {(!q.other || ordinary) && !q.noNote && !immediate ? (
            <TextBox
              ref={noteRef}
              name="note"
              disabled={busy}
              data-kept
              label="Note"
              className={noteBox}
              placeholder={needNote ? 'Your note for the agent (needed to send it back)' : 'Add a note (optional)'}
              value={note}
              onChange={setNote}
            />
          ) : null}
          <div className="flex items-center justify-end gap-2">
            {err ? (
              <span role="alert" className="mr-auto text-[0.75rem] text-need phone:text-[0.8125rem]">
                {err}
              </span>
            ) : null}
            {q.reject ? (
              <button type="button" disabled={busy} onClick={() => send(true)}>
                {q.reject}
              </button>
            ) : null}
            {!immediate ? (
              <Primary soft disabled={busy || !picked} onClick={() => send()}>
                Send
              </Primary>
            ) : null}
            {busy ? (
              <span role="status" className="text-[0.8125rem] text-fg2">
                Sending…
              </span>
            ) : null}
          </div>
        </>
      )}
    </CardShell>
  )
}

/** a plain question, with no choices: its words, and a reply to it that goes to the task's agent */
function ReplyOnCard({
  ask,
  reply,
  task,
  space,
  source,
}: {
  ask: CardAsk
  reply: NonNullable<CardAsk['reply']>
  task: string
  space: string
  source: CardSource
}) {
  const [text, setText] = useDraft(`card-reply:${ask.chat}:${reply.id}`)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const send = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await act({ type: 'send', chat: ask.chat, text: text.trim(), reply: reply.id, space })
      if (r?.ok === false) setErr(r.error ?? "That didn't go through.")
      else setText('')
    } catch {
      setErr("That didn't go through.")
    } finally {
      setBusy(false)
    }
  }
  const a = ask.answered
  return (
    <CardShell title={`${task} asks`} source={source}>
      <div data-ask-text className="line-clamp-6 break-words whitespace-pre-wrap">
        {reply.text}
      </div>
      {a ? (
        <Sent>
          <CheckIcon className={ic} />
          <span className="shrink-0">{a.where === 'space' ? 'Answered here ·' : 'Answered in'}</span>
          <LinkButton onClick={() => goChat(ask.chat)}>{`${task} chat`}</LinkButton>
          {a.text ? <span className="min-w-0 truncate text-fg2">“{a.text.replace(/\s+/g, ' ')}”</span> : null}
        </Sent>
      ) : ask.open ? (
        <>
          <TextBox name="reply" data-kept label={`Reply to ${task}`} className={noteBox} placeholder="Type something…" value={text} onChange={setText} />
          <div className="flex items-center justify-end gap-2">
            {err ? (
              <span role="alert" className="mr-auto text-[0.75rem] text-need phone:text-[0.8125rem]">
                {err}
              </span>
            ) : null}
            <Primary soft disabled={busy || !text.trim()} onClick={send}>
              Send
            </Primary>
          </div>
        </>
      ) : null}
    </CardShell>
  )
}

/** what a needs-you card's task asks, answered here as in the task's own chat: its question cards as they stand there,
    or the agent's plain question with a reply box */
function AskOnCard({ ask, task, taskTitle, space }: { ask: CardAsk; task: string; taskTitle?: string; space: string }) {
  // the cards answer into the task's chat; the words that answered one show on it
  const chat: Chat = { key: ask.chat, cli: '', messages: [] }
  const source = { id: task, title: taskTitle }
  if (ask.questions) return ask.questions.map((q) => <QuestionCard key={q.id} q={q} chat={chat} msg={q.id} from={task} space={space} source={source} />)
  return ask.reply ? <ReplyOnCard ask={ask} reply={ask.reply} task={task} space={space} source={source} /> : null
}

/** Shepherdr's update card about a task: one line, a dot, its id and a few words; a tap opens the task, where its
    summary is; held (or the smiley beside it) it reacts, like a message. A mode card marks when the place's
    coordinator went on a mode; a restart card what its agent started again on; a machine's health or a red main says
    what happened. Those open nothing */
export function Card({
  card: c,
  chat,
  press,
  keys,
  className,
}: {
  card: UpdateCard
  chat: string
  at?: number
  press?: ReturnType<typeof useHold>
  keys?: object
  className?: string
}) {
  const snap = useSnap()!
  // a machine's health: what crossed its limit (red) or came back under it
  if (c.health)
    return (
      <div data-anchor data-health-card={c.health.level} {...press} {...keys} className={clsx(cardBox, className)}>
        <MachineIcon className={clsx(ic, 'shrink-0', c.health.level === 'over' ? 'text-need' : 'text-fg2')} />
        <span className={cardLine}>
          <span className="truncate">
            <b className="font-semibold">{c.health.machine}</b> {c.text}
          </span>
        </span>
      </div>
    )
  // the project's main went red on GitHub
  if (c.red)
    return (
      <div data-anchor data-red-card {...press} {...keys} className={clsx(cardBox, className)}>
        <Dot s="need" className="shrink-0" />
        <span className={cardLine}>
          <span className="truncate">
            <b className="font-semibold">{c.red}</b> {c.text}
          </span>
        </span>
      </div>
    )
  // its agent started again: on what
  if (c.restart)
    return (
      <div data-anchor data-restart-card {...press} {...keys} className={clsx(cardBox, className)}>
        <RestartIcon className={clsx(ic, 'shrink-0 text-fg2')} />
        <span className={cardLine}>
          <span className="truncate">{c.text}</span>
        </span>
      </div>
    )
  if (!c.task)
    return (
      <div data-anchor data-mode-card={c.mode} {...press} {...keys} className={clsx(cardBox, className)}>
        <ModeIcon className={clsx(ic, 'shrink-0 text-fg2')} />
        <span className={cardLine}>
          <span className="truncate">
            <b className="font-semibold">{c.mode ? modeName(c.mode) : ''}</b> {c.text}
          </span>
        </span>
      </div>
    )
  const t = taskOf(snap, c.task)
  const task = c.task
  const line = (
    <button type="button" data-anchor {...press} onClick={() => openTask(task)} className={clsx(cardBox, 'hover:bg-hover', className)}>
      <Dot s={c.status ?? 'idle'} className="shrink-0" />
      <span className={cardLine}>
        <span className="truncate">
          <b className="font-semibold">{c.task}</b> {c.text}
        </span>
        {t && t.status !== c.status ? <span className={cardAside}>&nbsp;· now {NOW[t.status] ?? t.status}</span> : null}
        {c.pr ? (
          // set apart like a task row's
          <span className={cardAside}>
            &nbsp;· <PrOnCard pr={c.pr} />
          </span>
        ) : null}
      </span>
    </button>
  )
  if (!c.ask) return line
  return (
    <>
      {line}
      <AskOnCard ask={c.ask} task={task} taskTitle={t?.name} space={chat} />
    </>
  )
}

/** a bubble held down eases in, and springs back if let go early; with reduced motion it stays still */
export const pressable =
  'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:data-pressing:scale-(--press) motion-safe:data-pressing:delay-120 motion-safe:data-pressing:duration-260'

/** a message that slides right to reply leaves sideways moves to the page; others let the browser have them (and
    skip its wait for a second tap) */
export const touchFor = (slides: boolean) => (slides ? 'touch-pan-y touch-pinch-zoom' : 'touch-manipulation')

/** what sits on a quote's bottom edge: a ring in the page colour, so a reply in the same shade still shows its edge */
export const tucks = 'shadow-[0_0_0_2px_var(--bg)]'

/** why one you sent waits: a busy agent takes it at once, so only a menu (typing could pick an option), an agent still
 *  starting, a CLI command mid-turn or a machine out of reach hold it */
export function waitLine(why: Message['waitsFor']) {
  if (why === 'menu') return 'Waiting for your answer above.'
  if (why === 'start') return 'Goes in once the agent has started'
  if (why === 'turn') return 'Goes in once the agent finishes this step'
  return 'Goes in once it can be reached'
}

/* ---------- attachments: each one a message of its own; pictures as small tiles side by side, anything else as a file tile ---------- */

export const fileUrl = (chat: string, path: string, download = false) =>
  `api/file?chat=${encodeURIComponent(chat)}&path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`

export function FileTile({ name, chat, path, tucked }: { name: string; chat: string; path: string; tucked?: boolean }) {
  const ext = extOf(name)
  return (
    <div className={clsx('flex w-[280px] max-w-full items-center gap-1 rounded-box bg-bubble p-1.5', tucked && tucks)}>
      <a href={fileUrl(chat, path)} target="_blank" rel="noopener" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-row p-1 hover:bg-hover">
        <span className="grid size-10 shrink-0 place-items-center rounded-[calc(var(--row-radius)-var(--spacing))] bg-bg text-fg2">
          <FileIcon className={ic} />
        </span>
        <span className="min-w-0">
          <span className="block truncate">{name}</span>
          <span className="block text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{ext ? `${ext.toUpperCase()} file` : 'File'}</span>
        </span>
      </a>
      <a
        href={fileUrl(chat, path, true)}
        download={name}
        aria-label={`Download ${name}`}
        className="hit grid size-9 shrink-0 place-items-center rounded-full text-fg2 hover:bg-hover phone:size-11"
      >
        <DownloadIcon className={ic} />
      </a>
    </div>
  )
}

/** an id of the screen's own (randomUUID needs https, and a tailnet link may be plain http) */
export const newCid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/* ---------- sending: it shows at once, and settles once it is in ---------- */

export async function deliver(o: Outgoing) {
  const patch = (p: (x: Outgoing) => Partial<Outgoing>) => setOutbox((all) => all.map((x) => (x.cid === o.cid ? { ...x, ...p(x) } : x)))
  // a reload now would cut it off on its way
  const release = holdReload()
  try {
    const r = (await act(
      { type: 'send', chat: o.chat, text: o.text, attachments: o.files.map((f) => f.path), cid: o.cid, reply: o.reply?.id },
      AbortSignal.timeout(SEND_TIMEOUT),
    )) as {
      waiting?: boolean
      waitsFor?: Outgoing['waitsFor']
      at?: number
    }
    // the chat may already show it waiting (queued) or gone in: that knows better than the answer
    const serverAt = typeof r?.at === 'number' ? r.at : undefined
    patch((x) => ({
      state: 'sent',
      error: undefined,
      serverAt,
      ...(x.queued || x.wentAt ? {} : { waiting: r?.waiting || undefined, waitsFor: (r?.waiting && r.waitsFor) || undefined }),
    }))
  } catch (e) {
    patch((x) => (x.state === 'sending' ? { state: 'failed', error: reasonOf(e) } : {}))
  } finally {
    release()
  }
}

/** send again what didn't go through; it moves down to the end, like a new message. One that went in but never showed
 *  goes as a new message (its old id is spent: the server would take it as sent already). */
function retry(cid: string) {
  const s = getState()
  const o = s.outbox.find((x) => x.cid === cid)
  if (!o) return
  const again: Outgoing = {
    ...o,
    cid: o.lost ? newCid() : o.cid,
    state: 'sending',
    error: undefined,
    lost: undefined,
    waiting: undefined,
    waitsFor: undefined,
    queued: undefined,
    serverAt: undefined,
    wentAt: undefined,
    busyAt: undefined,
    at: Date.now(),
    prior: priorOf(s.chats[o.chat]),
  }
  setOutbox((all) => all.map((x) => (x.cid === cid ? again : x)))
  deliver(again)
}

/** under what didn't go through: why, and Retry or Remove; the words stay in the bubble. One that went in but never came
 *  back from the agent's log says so calmly: it may well have reached the agent */
export function NotSent({ out, className }: { out: Outgoing; className?: string }) {
  const btn = 'relative font-medium text-fg after:absolute after:-inset-x-1.5 after:-inset-y-2.5 hover:underline'
  return (
    <div
      role="alert"
      className={clsx(
        'mt-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-[0.75rem] phone:text-[0.8125rem]',
        out.lost ? 'text-fg2' : 'text-need',
        className,
      )}
    >
      {out.lost ? (
        <span>Not delivered</span>
      ) : (
        <span className="flex items-center gap-1.5">
          <AlertIcon className="size-3.5 shrink-0" />
          Not sent. {out.error}
        </span>
      )}
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <button type="button" className={btn} onClick={() => retry(out.cid)}>
          Retry
        </button>
        <span aria-hidden="true" className="text-fg3">
          ·
        </span>
        <button type="button" className={btn} onClick={() => removeOut(out.cid)}>
          Remove
        </button>
      </span>
    </div>
  )
}
