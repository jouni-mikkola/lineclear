import clsx from 'clsx'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { goChat, has, registry, setUI, useStore, useUI, type UI } from '@client/kernel.ts'
import { keyOf, type Outgoing } from '@client/outbox.ts'
import { CheckIcon, FileIcon, ic, LinkButton } from '@client/ui.tsx'
import { extOf, isImage } from '@shared/files.ts'
import type { Chat, Message } from '@shared/types.ts'
import { openBar } from '@plugins/reactions/client.tsx'
import { Fold } from './fold.tsx'
import { Markdown } from './markdown.tsx'
import { canReply, isArtifact, jumpTo, startReply } from './reply.ts'
import { usePicked, useHold, Quote, SwipeHint, Beside, PendingMenu, SessionLine, From, YourText } from './chat-cards.tsx'
import { Card, pressable, touchFor, tucks, waitLine, FileTile, NotSent, fileUrl } from './chat-asks.tsx'

/** out: what you just sent, not back from the agent's log yet (last: its last bubble, which says when it failed) */
export function Bubble({ msg, chat, from, out, last }: { msg: Message; chat: Chat; from: string; out?: Outgoing; last?: boolean }) {
  const you = msg.who === 'you'
  // an artifact's card on its own is held, reacted to and replied to as a whole, like a bubble
  const art = isArtifact(msg)
  const canReact = has('reactions') && !msg.waiting && !out && !!(msg.text || msg.file || art)
  const replies = canReply(msg, out)
  const picked = usePicked(msg.id, chat.key)
  const selecting = useUI((u) => u.selecting === msg.id)
  const text = useRef<HTMLDivElement>(null)
  // one on its way isn't a message yet: a hold (or ⋯ with a mouse) offers only to take it out
  const [menu, setMenu] = useState(false)
  const pending = out && out.state !== 'failed' ? out : undefined
  // a finger holds a message to react (like iMessage) and slides it right to reply; Select text in the bar lets it
  // select instead, until a tap elsewhere
  const hold = useHold(
    canReact && !selecting ? (at) => openBar(chat.key, msg.id, at) : pending ? () => setMenu(true) : null,
    replies && !selecting ? () => startReply(chat.key, msg) : null,
  )
  useEffect(() => {
    if (!selecting) return
    if (text.current) getSelection()?.selectAllChildren(text.current)
    const off = (e: globalThis.PointerEvent) => !text.current?.contains(e.target as Node) && setUI({ selecting: null })
    addEventListener('pointerdown', off)
    return () => removeEventListener('pointerdown', off)
  }, [selecting])
  const keys = canReact
    ? {
        onKeyDown: (e: KeyboardEvent) => e.key === 'Enter' && e.target === e.currentTarget && openBar(chat.key, msg.id),
        tabIndex: 0,
        'aria-label': 'Message: press Enter to react',
      }
    : {}
  // a file waiting to go in shows faded, without a line saying so
  const body = !!(msg.text || msg.answered || msg.waiting)
  const reacted = !!msg.reactions?.length
  const edge = registry.messageEdge.map(({ View }, i) => <View key={i} msg={msg} chat={chat} />)
  // reactions sit on the bubble's bottom right corner, yours and the agent's alike (like iMessage and WhatsApp); a row
  // wider than a short bubble grows toward the middle of the screen, never off it
  const pills = reacted ? <div className="relative -mt-2 flex max-w-full flex-wrap justify-end gap-1 self-end pr-2.5 pl-1 phone:-mt-2.5">{edge}</div> : null
  // a reply's quote rides on its first part: the words, or the file when there are none
  const quote = msg.reply ? <Quote q={msg.reply} chat={chat.key} from={from} you={you} /> : null
  const wide = !!msg.artifact
  const parts = registry.messageParts.map(({ View }, i) => <View key={i} msg={msg} chat={chat} from={from} />)
  const unit = (anchor: ReactNode, quoted?: boolean) => (
    <div
      data-msg={msg.id}
      data-chat={chat.key}
      data-you={you ? '' : undefined}
      className={clsx(
        'group/msg relative flex flex-col',
        you ? 'self-end' : 'self-start',
        // an artifact's card keeps the chat's width, less the room for the smiley and reply arrow beside it (a folded
        // one is as wide as its line)
        art
          ? 'max-w-full has-[[data-card]]:w-full pointer-fine:has-[[data-card]]:w-[calc(100%-4rem)]'
          : !wide
            ? 'max-w-full'
            : you
              ? 'max-w-[88%]'
              : 'max-w-[92%] phone:max-w-[96%]',
      )}
    >
      {replies ? <SwipeHint /> : null}
      {quoted ? quote : null}
      {anchor}
      {pills}
      <Beside msg={msg} chat={chat.key} you={you} picked={picked || menu} react={canReact} reply={replies} more={pending && (() => setMenu(true))} />
      {pending && menu ? <PendingMenu out={pending} onClose={() => setMenu(false)} /> : null}
    </div>
  )
  return (
    <>
      {msg.newSession ? <SessionLine /> : null}
      {/* yours on the right, the agent's on the left and a little wider: long replies keep a readable line on a phone */}
      {/* on its way it shows faded, like one waiting, and settles once it is in */}
      {/* data-whole: the message with its parts (a question's card), which an alert's link brings into view */}
      <div
        data-whole={msg.id}
        data-chat={chat.key}
        className={clsx(
          'flex flex-col transition-opacity duration-200',
          you ? 'items-end self-end' : 'items-start self-start',
          // something big (an artifact) takes the chat's whole width; the words above it keep a bubble's
          wide ? 'w-full' : you ? 'max-w-[88%]' : 'max-w-[92%] phone:max-w-[96%]',
          (msg.waiting || out?.state === 'sending') && 'opacity-60',
        )}
      >
        {/* the chat is with one agent, so its name shows only when someone else asks (the CLI's own question) */}
        {!you && msg.question?.asks ? <From>{`${from} · ${msg.question.asks}`}</From> : null}
        {msg.card
          ? unit(
              <Card
                card={msg.card}
                chat={chat.key}
                at={msg.at}
                press={hold}
                keys={msg.card.task ? undefined : keys}
                className={clsx(
                  canReact && !selecting && clsx(pressable, 'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]'),
                  touchFor(replies && !selecting),
                  picked && 'shadow-[inset_0_0_0_1.5px_var(--line2),0_0_0_2px_var(--bg)]',
                )}
              />,
            )
          : body
            ? unit(
                <div
                  data-anchor
                  {...keys}
                  {...hold}
                  className={clsx(
                    // mirrored round corners: the small one points at whoever wrote it. Slack's 15/22 message text
                    'relative max-w-full min-w-0 text-[0.9375rem]/[1.375rem] text-pretty px-3.5 py-2 phone:px-4 phone:py-2.5 phone:text-base/6',
                    you ? 'rounded-bubble rounded-br-[6px] bg-reply' : 'rounded-bubble rounded-bl-[6px] bg-bubble',
                    you ? 'self-end' : 'self-start',
                    // on a touch screen a hold reacts (or offers Remove), so it doesn't start selecting text or a link's preview
                    ((canReact && !selecting) || pending) && clsx(pressable, 'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]'),
                    // after Select text it selects, though the app's chrome around it doesn't
                    selecting && 'select-text',
                    touchFor(replies && !selecting),
                    picked ? 'shadow-[inset_0_0_0_1.5px_var(--line2),0_0_0_2px_var(--bg)]' : quote && tucks,
                  )}
                >
                  {msg.answered ? (
                    <div className="text-[0.75rem] text-fg2 phone:text-[0.8125rem]">
                      <CheckIcon className="inline size-3.5 align-[-2px]" /> {msg.answered}
                      {/* answered on its copy in the space's chat: a link there */}
                      {msg.elsewhere ? (
                        <>
                          {' in '}
                          <LinkButton onClick={() => goChat(msg.elsewhere!.chat)}>{msg.elsewhere.name}</LinkButton>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {msg.waiting ? (
                    <div className="text-[0.75rem] text-fg2 phone:text-[0.8125rem]">
                      {msg.waitsFor === 'menu' ? (
                        <>
                          Waiting for your answer above. {(() => {
                            const blocker = chat.messages.findLast((m) => m.question?.sent === undefined && !!m.question && !m.waiting)
                            return blocker ? <LinkButton onClick={() => jumpTo(chat.key, blocker.id, { card: true })}>Go to question</LinkButton> : null
                          })()}
                        </>
                      ) : (
                        waitLine(msg.waitsFor)
                      )}
                    </div>
                  ) : null}
                  {msg.text ? (
                    <div ref={text} data-text>
                      {you ? (
                        <YourText text={msg.text} />
                      ) : (
                        <Fold id={msg.id}>
                          <Markdown text={msg.text} />
                        </Fold>
                      )}
                    </div>
                  ) : null}
                </div>,
                true,
              )
            : null}
        {msg.file
          ? unit(
              <div
                data-anchor
                {...hold}
                className={clsx(
                  'relative max-w-full select-none [-webkit-touch-callout:none]',
                  (canReact || pending) && pressable,
                  touchFor(replies),
                  you ? 'self-end' : 'self-start',
                )}
              >
                <FileTile name={msg.file.name} chat={chat.key} path={msg.file.path} tucked={!body && !!quote} />
              </div>,
              !body,
            )
          : null}
        {art
          ? unit(
              <div
                data-anchor
                {...keys}
                {...hold}
                className={clsx(
                  'relative flex w-full flex-col items-start',
                  canReact && clsx(pressable, 'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]'),
                  touchFor(replies),
                )}
              >
                {parts}
              </div>,
            )
          : null}
        {!body && !msg.file && !art && reacted ? <div className="mt-1.5 flex gap-1">{edge}</div> : null}
        {art ? null : parts}
        {out?.state === 'failed' && last ? <NotSent out={out} /> : null}
      </div>
    </>
  )
}
export let touched = 0
export function setTouched(value: typeof touched): void {
  touched = value
}

/** a picture on its own, with no words: it shows as a tile, and the viewer pages through every one in the chat */
export const isPicture = (m: Message) => !!m.file && !m.text && !m.answered && isImage(m.file.name)

/** how pictures sent together lie: one keeps its shape; two or three sit in a row, four in a square, five or six in
 *  two rows of three, and past six the sixth says +N (like WhatsApp and Telegram) */
export function albumRows(n: number) {
  return n <= 3 ? [n] : n === 4 ? [2, 2] : n === 5 ? [3, 2] : [3, 3]
}

/** one picture in an album, a message of its own: a tap opens it full screen; a hold (or the smiley on it, with a
 *  mouse) reacts, and its reactions sit in its bottom right corner */
function Tile({
  msg,
  chat,
  you,
  radius,
  single,
  more,
  out,
}: {
  msg: Message
  chat: Chat
  you: boolean
  radius: string
  single: boolean
  more: number
  out?: Outgoing
}) {
  const f = msg.file!
  // a picture this browser can't show (HEIC on most desktops) is a file tile, or a small one in an album
  const [broken, setBroken] = useState(false)
  // one on its way isn't a message yet: nothing to react to
  const canReact = has('reactions') && !msg.waiting && !out
  const replies = canReply(msg, out)
  const picked = usePicked(msg.id, chat.key)
  // one on its way offers only Remove, as a bubble does
  const [menu, setMenu] = useState(false)
  const pending = out && out.state !== 'failed' ? out : undefined
  const hold = useHold(
    canReact ? (at) => openBar(chat.key, msg.id, at) : pending ? () => setMenu(true) : null,
    replies ? () => startReply(chat.key, msg) : null,
  )
  const edge = msg.reactions?.length ? registry.messageEdge.map(({ View }, i) => <View key={i} msg={msg} chat={chat} />) : null
  const smiley = (beside: boolean) => (
    <>
      <Beside
        msg={msg}
        chat={chat.key}
        you={you}
        picked={picked || menu}
        react={canReact}
        reply={replies}
        more={pending && (() => setMenu(true))}
        name={f.name}
        over={!beside}
      />
      {pending && menu ? <PendingMenu out={pending} onClose={() => setMenu(false)} /> : null}
    </>
  )
  // on its own it is a file tile like any other file, its reactions on its bottom right corner as on a bubble
  if (broken && single)
    return (
      <div data-msg={msg.id} data-chat={chat.key} data-you={you ? '' : undefined} className="group/msg relative flex max-w-full flex-col">
        <div
          data-anchor
          {...hold}
          className={clsx('relative max-w-full select-none [-webkit-touch-callout:none]', (canReact || pending) && pressable, touchFor(replies))}
        >
          <FileTile name={f.name} chat={chat.key} path={f.path} />
        </div>
        {edge ? <div className="relative -mt-2 flex max-w-full flex-wrap justify-end gap-1 self-end pr-2.5 pl-1 phone:-mt-2.5">{edge}</div> : null}
        {smiley(true)}
      </div>
    )
  const frame =
    'relative block overflow-hidden bg-bubble after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--line)]'
  return (
    <div data-msg={msg.id} data-chat={chat.key} data-you={you ? '' : undefined} className={clsx('group/msg relative min-w-0', !single && 'h-(--tile) flex-1')}>
      {broken ? (
        <a
          data-anchor
          href={fileUrl(chat.key, f.path, true)}
          download={f.name}
          aria-label={`Download ${f.name}`}
          {...hold}
          style={{ borderRadius: radius }}
          className={clsx(
            frame,
            'grid size-full place-items-center text-fg2 select-none [-webkit-touch-callout:none] hover:text-fg',
            (canReact || pending) && pressable,
            touchFor(replies),
          )}
        >
          <span className="grid justify-items-center gap-0.5 text-[0.6875rem] phone:text-[0.75rem]">
            <FileIcon className={ic} />
            {extOf(f.name).toUpperCase()}
          </span>
        </a>
      ) : (
        <button
          data-anchor
          type="button"
          aria-label={more ? `Open ${f.name} and ${more - 1} more` : `Open ${f.name}`}
          {...hold}
          // one on its way isn't a message yet: it opens on its own, like a file in the message box
          onClick={() => setUI({ photo: out ? { chat: chat.key, file: f } : { chat: chat.key, msg: msg.id } })}
          style={{ borderRadius: radius }}
          className={clsx(
            frame,
            'select-none [-webkit-touch-callout:none]',
            (canReact || pending) && pressable,
            touchFor(replies),
            !single && 'size-full',
            picked && 'outline-2 outline-offset-2 outline-(--line2)',
          )}
        >
          <img
            src={fileUrl(chat.key, f.path)}
            alt={f.name}
            draggable={false}
            onError={() => setBroken(true)}
            className={single ? 'block max-h-32 max-w-44 min-h-16 min-w-16 object-cover phone:max-h-36 phone:max-w-48' : 'size-full object-cover'}
          />
          {more ? (
            <span className="absolute inset-0 grid place-items-center bg-black/45 text-[1.25rem] font-semibold text-white tabular-nums">+{more}</span>
          ) : null}
        </button>
      )}
      {/* reactions sit in the tile's corner: an album has no bubble edge of its own to hang them from */}
      {edge ? (
        <div className="pointer-events-none absolute right-1 bottom-1 flex w-max max-w-[calc(var(--tile,100%)*3)] flex-wrap-reverse justify-end gap-1 *:pointer-events-auto">
          {edge}
        </div>
      ) : null}
      {smiley(false)}
    </div>
  )
}

/** pictures sent together: small tiles about the size of the ones in the message box, side by side, the album's outer
 *  corners rounded like a bubble's (the small one points at whoever sent them) */
export function Album({ msgs, chat, from, out, last: lastPart }: { msgs: Message[]; chat: Chat; from: string; out?: Outgoing; last?: boolean }) {
  const you = msgs[0].who === 'you'
  const rows = albumRows(msgs.length)
  const cols = Math.max(...rows)
  // the sixth tile is covered too: +N counts every picture not seen
  const more = msgs.length > 6 ? msgs.length - 5 : 0
  const big = 'var(--bubble-radius)'
  const small = '4px'
  let i = 0
  return (
    <>
      {msgs[0].newSession ? <SessionLine /> : null}
      <div
        role="group"
        data-slide
        aria-label={msgs.length > 1 ? `${msgs.length} pictures` : undefined}
        style={msgs.length > 1 ? ({ '--cols': cols } as CSSProperties) : undefined}
        className={clsx(
          'relative flex max-w-full flex-col gap-[3px] [--tile:--spacing(21)] phone:[--tile:--spacing(22)]',
          msgs.length > 1 && 'w-[calc(var(--tile)*var(--cols)+3px*(var(--cols)-1))]',
          you ? 'self-end' : 'self-start',
          'transition-opacity duration-200',
          (msgs[0].waiting || out?.state === 'sending') && 'opacity-60',
        )}
      >
        {canReply(msgs[0], out) ? <SwipeHint /> : null}
        {msgs[0].reply ? <Quote q={msgs[0].reply} chat={chat.key} from={from} you={you} /> : null}
        {rows.map((len, r) => (
          <div key={r} className={clsx('flex gap-[3px]', you && 'justify-end')}>
            {Array.from({ length: len }, (_, c) => {
              const m = msgs[i++]
              const last = r === rows.length - 1
              // the album's outer corners are a bubble's; the ones between tiles are small
              const radius = [
                !r && !c ? big : small,
                !r && c === len - 1 ? big : small,
                last && c === len - 1 ? (you ? '6px' : big) : small,
                last && !c ? (you ? big : '6px') : small,
              ].join(' ')
              return <Tile key={keyOf(m)} msg={m} chat={chat} you={you} radius={radius} single={msgs.length === 1} more={i === 6 ? more : 0} out={out} />
            })}
          </div>
        ))}
      </div>
      {out?.state === 'failed' && lastPart ? <NotSent out={out} className="-mt-2.5 self-end" /> : null}
    </>
  )
}

export type Shot = { file: { name: string; path: string }; msg?: Message }

/** what the viewer pages through: every picture in the chat, or the ones still waiting in the message box */
export function shotsOf(photo: NonNullable<UI['photo']>, chat: Chat | undefined, waiting: { name: string; path?: string }[]): Shot[] {
  if (photo.msg) return (chat?.messages ?? []).filter(isPicture).map((m) => ({ file: m.file!, msg: m }))
  return waiting.filter((f) => f.path && isImage(f.name)).map((f) => ({ file: { name: f.name, path: f.path! } }))
}

/* ---------- composer ---------- */

export function useChat(key: string) {
  return useStore((s) => s.chats[key])
}

export type Pt = { x: number; y: number }
/** the dark space between two pictures as they slide past */
export const GAP = 16
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
export const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
export const MAX_ZOOM = 5
