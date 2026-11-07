import type { Message } from '../../shared/types.ts'
import { stripHidden } from './agents.ts'
import { parseUserLine } from './chatlines.ts'
import { parseReply, userLines } from './chatquotes.ts'
import { shownAs } from './chats-helpers.ts'

/** what a line of yours in the log says: its words, the title of an answer or secret it carries, its files, and the
 *  message it answers */
export function yourParts(text: string, replyTo: (quoted: string, path?: string, line?: string) => Message['reply']) {
  const r = parseReply(text)
  const reply = r ? replyTo(r.to, undefined, r.line) : undefined
  const files: { name: string; path: string }[] = []
  let answered: string | undefined
  const body = (r ? [...userLines(r.text), ...r.rest] : userLines(text))
    .flatMap((ln) => {
      const p = parseUserLine(ln)
      if (!p) return [ln]
      if (p.kind === 'attach') {
        files.push({ name: p.name, path: p.path })
        return []
      }
      const s = shownAs(p)!
      answered = s.title ?? answered
      return [s.text]
    })
    .join('\n')
  return { body: stripHidden(body), answered, files, reply }
}

/** your message as the chat shows it: its words, then each file as a message of its own (the first one keeps the
 *  message's own id when there are no words, and carries the reply then) */
export function yourMessages(
  id: string,
  at: number,
  { body, answered, files, reply }: ReturnType<typeof yourParts>,
  extra: Partial<Message>,
  newSession?: boolean,
): Message[] {
  const words = !!(body || answered)
  const out: Message[] = words ? [{ id, who: 'you', at, text: body || undefined, answered, reply, newSession: newSession || undefined, ...extra }] : []
  files.forEach((file, i) =>
    out.push({
      id: i || words ? `${id}:${i}` : id,
      who: 'you',
      at,
      file,
      ...extra,
      newSession: (!i && !words && newSession) || undefined,
      reply: !i && !words ? reply : undefined,
    }),
  )
  return out
}
