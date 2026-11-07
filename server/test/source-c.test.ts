import { stopSource, placeId, src } from './source-fixture.ts'
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

describe('attachments', () => {
  const chat = placeId.home()
  /** what the human sent, as the CLI's log has it */
  const said = (id: string, text: string) => {
    const ev = (src.chats as unknown as { events: Map<string, unknown[]> }).events
    ev.set(chat, [...(ev.get(chat) ?? []), { kind: 'user', id, at: Date.now(), text }])
  }
  const attach = (name: string, path: string) => `<attachment from="Elias" name="${name}" path="${path}"/>`

  test('each file is a message of its own, right after the text it came with', async () => {
    const shot = await src.upload(chat, 'shot.png', new Uint8Array([1, 2, 3]))
    const notes = await src.upload(chat, 'notes.pdf', new Uint8Array([4]))
    said('u1', `Look at this\n${attach('shot.png', shot)}\n${attach('notes.pdf', notes)}`)
    // the same name again, a new file
    const again = await src.upload(chat, 'shot.png', new Uint8Array([9]))
    expect(again).not.toBe(shot)
    said('u2', attach('shot.png', again))
    const msgs = src.chats.chat(chat).messages.filter((m) => m.id.startsWith('u'))
    expect(msgs.map((m) => [m.id, m.text ?? m.file?.name])).toEqual([
      ['u1', 'Look at this'],
      ['u1:0', 'shot.png'],
      ['u1:1', 'notes.pdf'],
      ['u2', 'shot.png'],
    ])
    expect(msgs[1].file?.path).toBe(shot)
  })
  test('a reply goes in quoting the message it answers, and reads back as a quote that jumps to it', async () => {
    const ev = (src.chats as unknown as { events: Map<string, unknown[]> }).events
    ev.get(chat)!.push({ kind: 'agent', id: 'r1', at: Date.now(), text: 'Tests pass on the branch. Want me to merge?' })
    const sent: string[] = []
    const send = src.agents.send
    src.agents.send = (async (_k: string, text: string) => (sent.push(text), { waiting: false })) as typeof send
    try {
      await src.act({ type: 'send', chat, text: 'Yes\nmerge it', reply: 'r1', cid: 'cr1' })
      // a message no longer there: the words go plain
      await src.act({ type: 'send', chat, text: 'Plain', reply: 'gone' })
    } finally {
      src.agents.send = send
    }
    expect(sent).toEqual([`<reply from="${src.user}" to="Tests pass on the branch. Want me to merge?">Yes\nmerge it</reply>`, 'Plain'])
    said('r2', sent[0])
    // the agent answers your reply with one of its own, quoting your words
    ev.get(chat)!.push({ kind: 'agent', id: 'r3', at: Date.now(), text: '<reply to="Yes merge it"/>\nMerged.' })
    // a reply to a file, with a file of its own and no words
    said('r4', `<reply from="Elias" to="shot.png"></reply>\n${attach('b.png', '/inbox/b.png')}`)
    const msgs = src.chats.chat(chat).messages
    const r2 = msgs.find((m) => m.id === 'r2')!
    expect(r2.text).toBe('Yes\nmerge it')
    expect(r2.reply).toEqual({ id: 'r1', who: 'agent', text: 'Tests pass on the branch. Want me to merge?' })
    expect(msgs.find((m) => m.id === 'r3')).toMatchObject({ text: 'Merged.', reply: { id: 'r2', who: 'you', text: 'Yes merge it' } })
    expect(msgs.find((m) => m.id === 'r4')).toMatchObject({ file: { name: 'b.png' }, reply: { who: 'you', text: 'shot.png', file: true } })
    // a quote of something no longer in the chat still shows, without a way to jump
    // (an older bracket line, from a log kept before tags)
    said('r5', '[Elias replied to "Long gone": Still?]')
    expect(src.chats.chat(chat).messages.find((m) => m.id === 'r5')).toMatchObject({ text: 'Still?', reply: { text: 'Long gone' } })
    expect(src.chats.chat(chat).messages.find((m) => m.id === 'r5')?.reply?.id).toBeUndefined()
    // a reply to an older "Done." keeps to it, though a newer one starts the same way
    ev.get(chat)!.push({ kind: 'agent', id: 'd1', at: Date.now(), text: 'Done.' }, { kind: 'agent', id: 'd2', at: Date.now(), text: 'Done.' })
    const sent2: string[] = []
    src.agents.send = (async (_k: string, text: string) => (sent2.push(text), { waiting: false })) as typeof send
    try {
      await src.act({ type: 'send', chat, text: 'Which one?', reply: 'd1' })
    } finally {
      src.agents.send = send
    }
    said('d3', sent2[0])
    expect(src.chats.chat(chat).messages.find((m) => m.id === 'd3')?.reply?.id).toBe('d1')
  })
  test('only files attached in that chat, from the inbox, are served', async () => {
    const shot = src.chats.chat(chat).messages.find((x) => x.id === 'u1:0')!.file!.path
    expect(await (await src.attachment(chat, shot))?.bytes()).toEqual(new Uint8Array([1, 2, 3]))
    // not in this chat
    expect(await src.attachment(placeId.space('elsewhere'), shot)).toBeNull()
    // never attached
    expect(await src.attachment(chat, join(process.env.LINECLEAR_HOME!, 'config.json'))).toBeNull()
    // attached, but leading out of the inbox: by dots or by a link
    const secret = join(process.env.LINECLEAR_HOME!, 'secret.txt')
    writeFileSync(secret, 'no')
    const dots = join(process.env.LINECLEAR_HOME!, 'inbox', 'x', '..', '..', 'secret.txt')
    mkdirSync(join(process.env.LINECLEAR_HOME!, 'inbox', 'x'), { recursive: true })
    const link = join(process.env.LINECLEAR_HOME!, 'inbox', 'x', 'mf1-link.txt')
    symlinkSync(secret, link)
    said('u4', `${attach('secret.txt', dots)}\n${attach('link.txt', link)}`)
    expect(await src.attachment(chat, dots)).toBeNull()
    expect(await src.attachment(chat, link)).toBeNull()
  })
  test('a file still in the message box shows there before it is sent, in its own chat only', async () => {
    const waiting = await src.upload(chat, 'draft.png', new Uint8Array([5]))
    expect(await (await src.attachment(chat, waiting))?.bytes()).toEqual(new Uint8Array([5]))
    expect(await src.attachment(placeId.space('elsewhere'), waiting)).toBeNull()
    // another file in that chat's inbox folder that leads out of it by a link is still refused
    const secret = join(process.env.LINECLEAR_HOME!, 'secret2.txt')
    writeFileSync(secret, 'no')
    const link = join(waiting, '..', 'mf2-link.txt')
    symlinkSync(secret, link)
    expect(await src.attachment(chat, link)).toBeNull()
  })
})

afterAll(stopSource)
