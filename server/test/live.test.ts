import { agentLines, excerpt, findQuoted, line, matches, parseReply, parseUserLine, userLines, parseMenu, stripHidden, hidden } from './live-fixture.ts'
import { describe, expect, test } from 'bun:test'

describe('chat lines', () => {
  test('a reaction quotes the start of the message and reads back', () => {
    const l = line.react('Elias', '👍', 'PR #52 is ready to merge')
    expect(l).toBe('<reaction from="Elias" emoji="👍" to="PR #52 is ready to merge"/>')
    expect(parseUserLine(l)).toEqual({ kind: 'react', emoji: '👍', to: 'PR #52 is ready to merge' })
    expect(line.unreact('Elias', '👍', 'x')).toBe('<reaction-removed from="Elias" emoji="👍" to="x"/>')
    expect(parseUserLine(line.unreact('Elias', '👍', 'x'))?.kind).toBe('unreact')
  })
  test('any emoji from the full picker makes the same line, skin tones and joined ones too', () => {
    for (const e of ['🚀', '👍🏽', '🧑🏿\u200D💻', '❤️\u200D🔥', '🏳️\u200D🌈', '1️⃣', '🇸🇪']) {
      expect(parseUserLine(line.react('Elias', e, 'Done'))).toEqual({ kind: 'react', emoji: e, to: 'Done' })
      expect(parseUserLine(line.unreactFile('Elias', e, 'a.png', '/x/a.png'))).toEqual({ kind: 'unreact', emoji: e, to: 'a.png', path: '/x/a.png' })
      expect(agentLines(`<react emoji="${e}" to="Go"/>`).reactions).toEqual([{ emoji: e, to: 'Go' }])
      expect(agentLines(`[react ${e} to "Go"]`).reactions).toEqual([{ emoji: e, to: 'Go' }])
    }
  })
  test('long messages are quoted short, and still match', () => {
    const long = 'Seven things. gtm asks whether to rerun CI on main, GTM-15 is ready to merge, HP-201 needs a call on Pinned'
    const q = excerpt(long)
    expect(q.endsWith('…')).toBe(true)
    expect(matches(long, q)).toBe(true)
    expect(matches('Something else entirely', q)).toBe(false)
  })
  test('answers and attachments read back', () => {
    const answer = line.answer('Elias', 'Rerun CI on main?', 'Rerun it')
    expect(answer).toBe('<answer from="Elias" question="Rerun CI on main?">Rerun it</answer>')
    expect(parseUserLine(answer)).toEqual({ kind: 'answer', title: 'Rerun CI on main?', answer: 'Rerun it' })
    const attach = line.attach('Elias', 'screenshot.png', '~/inbox/screenshot.png')
    expect(attach).toBe('<attachment from="Elias" name="screenshot.png" path="~/inbox/screenshot.png"/>')
    expect(parseUserLine(attach)).toEqual({ kind: 'attach', name: 'screenshot.png', path: '~/inbox/screenshot.png' })
    // double quotes in a value turn curly, so the tag stays whole
    expect(line.answer('Elias', 'Say "go"', 'Go')).toBe('<answer from="Elias" question="Say “go”">Go</answer>')
    expect(parseUserLine('Just a message')).toBeNull()
    expect(parseUserLine('<b>bold</b>')).toBeNull()
  })
  test('the older [square bracket] lines still read back', () => {
    expect(parseUserLine('[Elias reacted 👍 to "PR #52 is ready to merge"]')).toEqual({ kind: 'react', emoji: '👍', to: 'PR #52 is ready to merge' })
    expect(parseUserLine('[Elias removed 👍 from a.png: /x/a.png]')).toEqual({ kind: 'unreact', emoji: '👍', to: 'a.png', path: '/x/a.png' })
    expect(parseUserLine('[Elias answered "Rerun CI on main?": Rerun it]')).toEqual({ kind: 'answer', title: 'Rerun CI on main?', answer: 'Rerun it' })
    expect(parseUserLine('[Elias attached screenshot.png: ~/inbox/screenshot.png]')).toEqual({
      kind: 'attach',
      name: 'screenshot.png',
      path: '~/inbox/screenshot.png',
    })
    expect(parseReply('[Elias replied to "Go": Yes\n[Elias attached a.png: /inbox/a.png]')).toBeNull()
    expect(parseReply('[Elias replied to "Go": Yes]\n[Elias attached a.png: /inbox/a.png]')).toMatchObject({
      to: 'Go',
      text: 'Yes',
      rest: ['[Elias attached a.png: /inbox/a.png]'],
    })
  })
  test('a reaction to a file names its path, so two files of one name stay apart', () => {
    const l = line.reactFile('Elias', '👍', 'screenshot.png', '/inbox/a-screenshot.png')
    expect(l).toBe('<reaction from="Elias" emoji="👍" file="screenshot.png" path="/inbox/a-screenshot.png"/>')
    expect(parseUserLine(l)).toEqual({ kind: 'react', emoji: '👍', to: 'screenshot.png', path: '/inbox/a-screenshot.png' })
    expect(parseUserLine(line.unreactFile('Elias', '👍', 'a.png', '/x/a.png'))).toMatchObject({ kind: 'unreact', path: '/x/a.png' })
    // a quoted message with a colon or quotes in it is still a message
    expect(parseUserLine(line.react('Elias', '👍', 'Note: say "done"'))).toEqual({ kind: 'react', emoji: '👍', to: 'Note: say “done”' })
    expect(agentLines('<react emoji="👀" file="shot.png" path="/inbox/b-shot.png"/>\nOn it.').reactions).toEqual([
      { emoji: '👀', to: 'shot.png', path: '/inbox/b-shot.png' },
    ])
    expect(agentLines('[react 👀 to shot.png: /inbox/b-shot.png]\nOn it.').reactions).toEqual([{ emoji: '👀', to: 'shot.png', path: '/inbox/b-shot.png' }])
  })
  test("the agent's own reactions come out of its reply", () => {
    const r = agentLines('<react emoji="👀" to="What needs me today?"/>\nLooking now.')
    expect(r.reactions).toEqual([{ emoji: '👀', to: 'What needs me today?' }])
    expect(r.text).toBe('Looking now.')
    // straight quotes an agent copied into its quote don't break it
    expect(agentLines('<react emoji="👍" to="Say "go" when ready"/>').reactions).toEqual([{ emoji: '👍', to: 'Say "go" when ready' }])
    expect(agentLines('[react 👀 to "What needs me today?"]\nLooking now.')).toEqual(r)
  })
  test('a reply quotes the start of the message it answers, and reads back with its files', () => {
    const l = line.reply('Elias', 'Tests pass on the branch. Want me to merge?', 'Yes, merge it')
    expect(l).toBe('<reply from="Elias" to="Tests pass on the branch. Want me to merge?">Yes, merge it</reply>')
    expect(parseReply(l)).toMatchObject({ to: 'Tests pass on the branch. Want me to merge?', text: 'Yes, merge it', rest: [] })
    // words over several lines, with tags and brackets of their own, and files after them
    const a = line.attach('Elias', 'a.png', '/inbox/a.png')
    const multi = `${line.reply('Elias', 'Say "go" when ready', 'Go.\nAlso check [this] and </reply> that')}\n${a}`
    expect(parseReply(multi)).toMatchObject({ to: 'Say “go” when ready', text: 'Go.\nAlso check [this] and </reply> that', rest: [a] })
    // a reply with only a file
    expect(parseReply(`${line.reply('Elias', 'shot.png', '')}\n${line.attach('Elias', 'b.png', '/inbox/b.png')}`)?.text).toBe('')
    expect(parseReply('Just words')).toBeNull()
    expect(parseReply(line.react('Elias', '👍', 'Go'))).toBeNull()
    // an agent's reply line is no reply of yours
    expect(parseReply('<reply to="Go"/>')).toBeNull()
  })
  test('words of a tag that run over several lines stay whole', () => {
    const say = line.answer('Elias', 'Colour?', 'Blue.\nAnd wider.')
    expect(userLines(`${say}\n${line.attach('Elias', 'a.png', '/a.png')}`)).toEqual([say, line.attach('Elias', 'a.png', '/a.png')])
    expect(parseUserLine(userLines(say)[0])).toEqual({ kind: 'answer', title: 'Colour?', answer: 'Blue.\nAnd wider.' })
    expect(userLines('<answer from="Elias" question="x">never closed\nhi')).toEqual(['<answer from="Elias" question="x">never closed', 'hi'])
    // words with a closing tag of their own on a line stay inside
    const own = line.answer('Elias', 'Colour?', 'Start\n<answer>Blue</answer>\nEnd')
    expect(userLines(`${own}\n${line.attach('Elias', 'a.png', '/a.png')}`)).toEqual([own, line.attach('Elias', 'a.png', '/a.png')])
    expect(parseUserLine(userLines(own)[0])).toMatchObject({ answer: 'Start\n<answer>Blue</answer>\nEnd' })
  })
  test("the agent's reply line comes out of its reply, the first one counts", () => {
    const r = agentLines('<reply to="What needs me today?"/>\n<react emoji="👀" to="Hi"/>\nThree things.')
    expect(r).toEqual({ text: 'Three things.', reactions: [{ emoji: '👀', to: 'Hi' }], reply: { to: 'What needs me today?' } })
    expect(agentLines('<reply file="shot.png" path="/inbox/b-shot.png"/>\nSeen it.').reply).toEqual({ to: 'shot.png', path: '/inbox/b-shot.png' })
    // its words inside the reply's tags
    expect(agentLines('<reply to="Hi">\nThree things.\n</reply>')).toEqual({ text: 'Three things.', reactions: [], reply: { to: 'Hi' } })
    expect(agentLines('<reply to="Hi">Three things.</reply>')).toEqual({ text: 'Three things.', reactions: [], reply: { to: 'Hi' } })
    expect(agentLines('No reply here.').reply).toBeUndefined()
    // a reply line inside its words stays words
    expect(agentLines('Write <reply to="x"/> on a line of its own.').text).toBe('Write <reply to="x"/> on a line of its own.')
    // the older form
    expect(agentLines('[reply to "What needs me today?"]\n[react 👀 to "Hi"]\nThree things.')).toEqual(r)
    expect(agentLines('[reply to shot.png: /inbox/b-shot.png]\nSeen it.').reply).toEqual({ to: 'shot.png', path: '/inbox/b-shot.png' })
    expect(agentLines('Write [reply to "x"] on a line of its own.').text).toBe('Write [reply to "x"] on a line of its own.')
  })
  test('a reply that is only <no-reply>why</no-reply> says nothing; anything more stays words', () => {
    expect(agentLines('<no-reply>SHE-72 merged, nothing to do</no-reply>').text).toBe('')
    expect(agentLines('\n  <no-reply>\n  SHE-72 merged\n</no-reply>\n').text).toBe('')
    expect(agentLines('<no-reply></no-reply>').text).toBe('')
    expect(agentLines('<no-reply/>').text).toBe('')
    expect(agentLines('`<No-Reply>merged</No-Reply>`').text).toBe('')
    expect(agentLines('<reply to="SHE-9 is ready"/>\n<no-reply>already on it</no-reply>').text).toBe('')
    expect(agentLines('[reply to "SHE-9 is ready"]\n<no-reply>already on it</no-reply>').text).toBe('')
    expect(agentLines('<react emoji="👍" to="SHE-50 is done"/>\n<no-reply>a thumbs up</no-reply>')).toEqual({
      text: '',
      reactions: [{ emoji: '👍', to: 'SHE-50 is done' }],
    })
    expect(agentLines('<no-reply>merged</no-reply>\nSHE-51 can start now.').text).toBe('<no-reply>merged</no-reply>\nSHE-51 can start now.')
    expect(agentLines('<no-reply>a</no-reply> <no-reply>b</no-reply>').text).toBe('<no-reply>a</no-reply> <no-reply>b</no-reply>')
    expect(agentLines('Write <no-reply>why</no-reply> when news needs nothing.').text).toBe('Write <no-reply>why</no-reply> when news needs nothing.')
    expect(agentLines('<no-reply>unclosed').text).toBe('<no-reply>unclosed')
    expect(parseUserLine('<no-reply>x</no-reply>')).toBeNull()
  })
  test('the older markers still say nothing: [[noted]], any [[...]], a lone [noted]', () => {
    expect(agentLines('[[noted]]').text).toBe('')
    expect(agentLines('\n[[noted]]\n').text).toBe('')
    expect(agentLines('[react 👍 to "SHE-50 is done"]\n[[noted]]')).toEqual({ text: '', reactions: [{ emoji: '👍', to: 'SHE-50 is done' }] })
    expect(agentLines('[[noted]]\nSHE-51 can start now.').text).toBe('[[noted]]\nSHE-51 can start now.')
    expect(agentLines('[Noted]').text).toBe('[Noted]')
    expect(agentLines('[[skip]]').text).toBe('')
    expect(agentLines('[noted]').text).toBe('')
    expect(agentLines('[[noted]] and more').text).toBe('[[noted]] and more')
    expect(agentLines('[Elias noted on "Send test event": Shorter]').text).toBe('[Elias noted on "Send test event": Shorter]')
    expect(parseUserLine('[[noted]]')).toBeNull()
  })
  test('a quote finds its message however it was copied: case, curly quotes, markdown, a shortened start', () => {
    const msgs = [
      { id: 'a', text: 'PR #52 is **ready** to merge. Shall I?' },
      { id: 'b', text: 'Something else' },
      { id: 'c', file: { name: 'shot.png', path: '/inbox/c-shot.png' } },
      { id: 'd', text: 'Something else' },
    ]
    expect(findQuoted(msgs, 'PR #52 is ready to merge')?.id).toBe('a')
    expect(findQuoted(msgs, 'pr #52 is ready…')?.id).toBe('a')
    expect(findQuoted(msgs, 'ready to merge. Shall I?')?.id).toBe('a')
    // the latest of two the same
    expect(findQuoted(msgs, 'Something else')?.id).toBe('d')
    expect(findQuoted(msgs, 'shot.png')?.id).toBe('c')
    expect(findQuoted(msgs, 'x', '/inbox/c-shot.png')?.id).toBe('c')
    // a whole reply line quoted back: its words count
    expect(findQuoted(msgs, '[Elias replied to "Go": Something else]')?.id).toBe('d')
    expect(findQuoted(msgs, '<reply from="Elias" to="Go">Something else</reply>')?.id).toBe('d')
    expect(findQuoted(msgs, 'Nothing like it')).toBeUndefined()
    expect(matches('Hello there', 'there')).toBe(false)
  })
  test("Lineclear's own words never show in the chat", () => {
    expect(hidden('GTM-15 was merged', 'news', { task: 'GTM-15', event: 'merged' })).toBe(
      '<lineclear><news task="GTM-15" event="merged">GTM-15 was merged</news></lineclear>',
    )
    expect(hidden('Go on', 'automation', { name: 'Fresh "board"' })).toBe('<lineclear><automation name="Fresh “board”">Go on</automation></lineclear>')
    expect(hidden('only instructions')).toBe('<lineclear>only instructions</lineclear>')
    expect(stripHidden(`${hidden('GTM-15 is ready', 'news')}\nhello`)).toBe('hello')
    expect(stripHidden(`${hidden('a > b', 'automation', { name: 'x > y' })}hello`)).toBe('hello')
    expect(stripHidden(`<lineclear>[news] GTM-15 is ready</lineclear>\nhello`)).toBe('hello')
    expect(stripHidden(hidden('only instructions'))).toBe('')
  })
})

describe('terminal menus', () => {
  test("Claude Code's permission menu becomes a question card", () => {
    const screen = [
      '╭──────────────────────────────────────────╮',
      '│ Bash command                             │',
      '│                                          │',
      '│   rm -rf template/skills/old             │',
      '│   Remove the old skills                  │',
      '│                                          │',
      '│ Do you want to proceed?                  │',
      '│ ❯ 1. Yes                                 │',
      "│   2. Yes, and don't ask again for rm     │",
      '│   3. No, and tell Claude what to do (esc)│',
      '╰──────────────────────────────────────────╯',
    ].join('\n')
    const m = parseMenu(screen)!
    expect(m.choices).toEqual(['Yes', "Yes, and don't ask again for rm", 'No, and tell Claude what to do'])
    expect(m.cursor).toBe(0)
    expect(m.title.startsWith('Allow: ')).toBe(true)
  })
  test("Codex's approval with a wrapped choice and the command", () => {
    const screen = [
      '  Would you like to run the following command?',
      '  Reason: May I run the tests outside the sandbox?',
      '  $ npm test',
      '› 1. Yes, proceed (y)',
      "  2. Yes, and don't ask again for commands that start with `npm",
      '     test` (p)',
      '  3. No, and tell Codex what to do differently (esc)',
      '  Press enter to confirm or esc to cancel',
    ].join('\n')
    const m = parseMenu(screen)!
    expect(m.title).toBe('Allow: npm test?')
    expect(m.choices).toHaveLength(3)
    expect(m.choices[1]).toBe("Yes, and don't ask again for commands that start with `npm test`")
  })
  test("Claude Code's own question: the whole question, and each choice's description apart from its label", () => {
    const screen = [
      '────────────────────────────────────────────────────────────────────────────────',
      ' ☐ Scope',
      '',
      '│ Should the rebuilt workflow also read the founders own LinkedIn profiles and',
      '│ posts, or only the company page as before?',
      '',
      '❯ 1. Company page only',
      '     Same as before: just the company page, nothing about the founders',
      '     themselves',
      '  2. Company page and founders',
      '     Also read each founder profile and recent posts',
      '  3. Type something.',
      '────────────────────────────────────────────────────────────────────────────────',
      '  4. Chat about this',
      '',
      'Enter to select · ↑/↓ to navigate · Esc to cancel',
    ].join('\n')
    const m = parseMenu(screen)!
    expect(m.title).toBe('Should the rebuilt workflow also read the founders own LinkedIn profiles and posts, or only the company page as before?')
    expect(m.choices).toEqual(['Company page only', 'Company page and founders', 'Type something.'])
    expect(m.descriptions).toEqual([
      'Same as before: just the company page, nothing about the founders themselves',
      'Also read each founder profile and recent posts',
      undefined,
    ])
  })
  test('a screen without a menu has none', () => {
    expect(parseMenu('❯ Try "fix lint errors"\n  ⏵⏵ bypass permissions on')).toBeNull()
  })
})
