import {
  agentLines,
  excerpt,
  findQuoted,
  line,
  matches,
  parseReply,
  parseUserLine,
  userLines,
  parseMenu,
  Automations,
  T,
  readJson,
  writeJson,
  stripHidden,
  hidden,
} from './live-fixture.ts'
import { beforeEach, describe, expect, test } from 'bun:test'
import { nextRuns } from '../server/live/trigger.ts'

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
  test('answers, attachments, artifact sends, words and notes read back', () => {
    const answer = line.answer('Elias', 'Rerun CI on main?', 'Rerun it')
    expect(answer).toBe('<answer from="Elias" question="Rerun CI on main?">Rerun it</answer>')
    expect(parseUserLine(answer)).toEqual({ kind: 'answer', title: 'Rerun CI on main?', answer: 'Rerun it' })
    const attach = line.attach('Elias', 'screenshot.png', '~/inbox/screenshot.png')
    expect(attach).toBe('<attachment from="Elias" name="screenshot.png" path="~/inbox/screenshot.png"/>')
    expect(parseUserLine(attach)).toEqual({ kind: 'attach', name: 'screenshot.png', path: '~/inbox/screenshot.png' })
    // double quotes in a value turn curly, so the tag stays whole
    const art = line.artifact('Weekly "board"', 'wk3n', 2)
    expect(line.artifactSend('Elias', art, 'Pinned colour: Accent')).toBe(
      '<artifact-sent from="Elias" title="Weekly “board”" artifact="wk3n" version="2">Pinned colour: Accent</artifact-sent>',
    )
    expect(parseUserLine(line.artifactSend('Elias', art, 'Pinned colour: Accent'))).toEqual({
      kind: 'artifact-send',
      title: 'Weekly “board”',
      text: 'Pinned colour: Accent',
    })
    expect(parseUserLine(line.artifactSay('Elias', line.artifact('Board', 'ab12', 1), 'Bars in <b>blue</b>'))).toEqual({
      kind: 'artifact-say',
      title: 'Board',
      text: 'Bars in <b>blue</b>',
    })
    const note = line.note('Elias', line.artifact('Board', 'ab12', 3), '"Send" (button.primary)', 'Bigger')
    expect(note).toBe('<artifact-note from="Elias" title="Board" artifact="ab12" version="3" on="“Send” (button.primary)">Bigger</artifact-note>')
    expect(parseUserLine(note)).toEqual({ kind: 'note', target: '“Send” (button.primary) in "Board"', note: 'Bigger' })
    expect(parseUserLine(line.note('Elias', line.artifact('Board', 'ab12', 3), undefined, 'Bigger'))).toEqual({
      kind: 'note',
      target: '"Board"',
      note: 'Bigger',
    })
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
    expect(parseUserLine('[Elias sent from "Board" (artifact wk3n v2): Pinned colour: Accent]')).toEqual({
      kind: 'artifact-send',
      title: 'Board',
      text: 'Pinned colour: Accent',
    })
    expect(parseUserLine('[Elias sent from "Board": Pinned colour: Accent]')).toEqual({ kind: 'artifact-send', title: 'Board', text: 'Pinned colour: Accent' })
    expect(parseUserLine('[Elias wrote about "Board" (artifact ab12 v1): Bars in blue]')).toEqual({
      kind: 'artifact-say',
      title: 'Board',
      text: 'Bars in blue',
    })
    expect(parseUserLine('[Elias noted on "Send" (button.primary): Bigger]')?.kind).toBe('note')
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
    const say = line.artifactSay('Elias', line.artifact('Board', 'ab12', 1), 'Bars in blue.\nAnd wider.')
    expect(userLines(`${say}\n${line.attach('Elias', 'a.png', '/a.png')}`)).toEqual([say, line.attach('Elias', 'a.png', '/a.png')])
    expect(parseUserLine(userLines(say)[0])).toEqual({ kind: 'artifact-say', title: 'Board', text: 'Bars in blue.\nAnd wider.' })
    expect(userLines('<answer from="Elias" question="x">never closed\nhi')).toEqual(['<answer from="Elias" question="x">never closed', 'hi'])
    // words with a closing tag of their own on a line stay inside
    const own = line.artifactSay('Elias', line.artifact('Board', 'ab12', 1), 'Start\n<artifact-comment>Blue</artifact-comment>\nEnd')
    expect(userLines(`${own}\n${line.attach('Elias', 'a.png', '/a.png')}`)).toEqual([own, line.attach('Elias', 'a.png', '/a.png')])
    expect(parseUserLine(userLines(own)[0])).toMatchObject({ text: 'Start\n<artifact-comment>Blue</artifact-comment>\nEnd' })
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

describe('triggers', () => {
  const Z = 'Europe/Stockholm'
  // Wednesday 28 Oct 2026, 10:40 in Stockholm (CET, UTC+1)
  const now = Date.UTC(2026, 9, 28, 9, 40)
  const rule = (x: string) => T.timeRule(x)
  test('a time rule is kept on one line, counting from 2026-01-01 without its own DTSTART; nonsense says how to write one', () => {
    expect(rule('FREQ=MINUTELY;INTERVAL=30')).toBe('DTSTART:20260101T000000 RRULE:FREQ=MINUTELY;INTERVAL=30')
    expect(rule('RRULE:FREQ=DAILY;BYHOUR=9\nEXDATE:20261224T090000')).toBe('DTSTART:20260101T000000 RRULE:FREQ=DAILY;BYHOUR=9 EXDATE:20261224T090000')
    expect(rule('once 2026-11-02 9:00')).toBe('once 2026-11-02 09:00')
    expect(rule('off')).toBe('off')
    expect(() => rule('sometimes')).toThrow('iCalendar RRULE')
    // plain words are the coordinator's to turn into a rule: rrule's reader would drop "from 8 to 18" without a word
    expect(() => rule('every 30 minutes from 8 to 18')).toThrow('turn the human')
    expect(() => rule('FREQ=SECONDLY')).toThrow('Once a minute at most')
  })
  test("in words, in the time zone's own times, with the next runs", () => {
    const words = (x: string) => T.timeWords(rule(x), Z, now)
    expect(words('FREQ=MINUTELY;INTERVAL=30;BYHOUR=8,9,10,11,12,13,14,15,16,17,18,19,20,21;BYDAY=MO,TU,WE,TH,FR')).toBe(
      'Every 30 minutes, 8:00-22:00, Monday to Friday (Stockholm)',
    )
    expect(words('FREQ=MINUTELY;INTERVAL=90')).toBe('Every 90 minutes (Stockholm)')
    expect(words('FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;BYHOUR=16;BYMINUTE=0')).toBe('Every other week, Friday at 16:00 (Stockholm)')
    expect(words('FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=9;BYMINUTE=0')).toBe('The last Friday of the month at 9:00 (Stockholm)')
    expect(words('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;BYHOUR=17;BYMINUTE=0')).toBe('The last weekday of the month at 17:00 (Stockholm)')
    expect(words('DTSTART:20261201T000000 RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0;UNTIL=20261231T000000 EXDATE:20261224T090000')).toBe(
      'Every day at 9:00, from 1 Dec 2026, until 31 Dec 2026, except 24 Dec (Stockholm)',
    )
    expect(words('once 2026-11-02 9:00')).toBe('Once, Monday 2 Nov 2026 at 9:00 (Stockholm)')
    // 10:40 in Stockholm: the next half hour is 11:00 there, not UTC's
    expect(T.nextWords(rule('FREQ=MINUTELY;INTERVAL=30'), Z, now)).toEqual(['Today 11:00', 'Today 11:30', 'Today 12:00'])
    expect(T.nextRun(rule('FREQ=MINUTELY;INTERVAL=30'), Z, now)).toBe(Date.UTC(2026, 9, 28, 10, 0))
    expect(T.nextWords(rule('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0'), Z, now)).toEqual(['Tomorrow 9:00', 'Fri 30 Oct 9:00', 'Mon 2 Nov 9:00'])
    expect(T.nextWords(rule('FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=9;BYMINUTE=0'), Z, now)).toEqual(['Fri 30 Oct 9:00', 'Fri 27 Nov 9:00', 'Fri 25 Dec 9:00'])
    // a once in the past is over
    expect(nextRuns(rule('once 2026-10-01 9:00'), Z, now)).toEqual([])
    // every so many minutes on some days only: the days are kept here, as rrule gets them wrong or loops for ever
    const workdays = rule('FREQ=MINUTELY;INTERVAL=30;BYHOUR=8,9,10,11,12,13,14,15,16,17;BYDAY=MO,TU,WE,TH,FR')
    expect(nextRuns(workdays, Z, Date.UTC(2026, 9, 26, 16, 0), 3)).toEqual([
      Date.UTC(2026, 9, 26, 16, 30),
      Date.UTC(2026, 9, 27, 7, 0),
      Date.UTC(2026, 9, 27, 7, 30),
    ])
    expect(nextRuns(workdays, Z, Date.UTC(2026, 9, 30, 17, 0), 1)).toEqual([Date.UTC(2026, 10, 2, 7, 0)]) // Friday evening: Monday 8:00
    expect(nextRuns(rule('FREQ=MINUTELY;INTERVAL=30;BYHOUR=10,11;BYDAY=SA,SU'), Z, now, 1)).toEqual([Date.UTC(2026, 9, 31, 9, 0)])
    expect(nextRuns(rule('DTSTART:20261025T000000 RRULE:FREQ=MINUTELY;INTERVAL=30;BYHOUR=8;BYDAY=MO'), Z, now, 1)).toEqual([Date.UTC(2026, 10, 2, 7, 0)])
    expect(nextRuns(rule('FREQ=MINUTELY;INTERVAL=30;BYHOUR=8;BYMONTHDAY=15'), Z, now, 3)).toEqual([
      Date.UTC(2026, 10, 15, 7, 0),
      Date.UTC(2026, 10, 15, 7, 30),
      Date.UTC(2026, 11, 15, 7, 0),
    ])
    expect(() => rule('FREQ=MINUTELY;INTERVAL=30;BYDAY=MO;COUNT=5')).toThrow('UNTIL')
    // what rrule's own words leave out is said too
    expect(words('FREQ=HOURLY;BYMINUTE=0,30;BYSETPOS=-1')).toContain("only the last of each hour's times")
  })
  test('event rules: all news, none, or events with filters; matched by space, branch and title', () => {
    expect(T.eventRules('all news')).toEqual([{ event: 'news' }])
    expect(T.eventRules('none')).toEqual([])
    const r = T.eventRules('ready, merged branch=release/* title="fix it"')
    expect(r).toEqual([{ event: 'ready' }, { event: 'merged', branch: 'release/*', title: 'fix it' }])
    expect(T.eventsText(r)).toBe('ready, merged branch=release/* title="fix it"')
    expect(T.eventWords(T.eventRules('needs you or main red space=gtm'))).toBe('When a task needs you or main goes red in gtm')
    // a quoted title keeps its commas and its "and"
    expect(T.eventRules('merged title="salt and pepper, please"')).toEqual([{ event: 'merged', title: 'salt and pepper, please' }])
    expect(T.eventRules(T.eventsText(T.eventRules('merged title="salt,pepper"')))).toEqual([{ event: 'merged', title: 'salt,pepper' }])
    expect(() => T.eventRules('lunch')).toThrow('No event')
    expect(T.matches(r, { event: 'merged', branch: 'release/2.1', title: 'Fix it now' })).toBe(true)
    expect(T.matches(r, { event: 'merged', branch: 'work/1-x', title: 'Fix it now' })).toBe(false)
    expect(T.matches(T.eventRules('all news'), { event: 'health' })).toBe(true)
    expect(T.matches([], { event: 'ready' })).toBe(false)
  })
  test('old schedules become time rules', () => {
    expect(T.fromSchedule('every 30m')).toBe(rule('FREQ=MINUTELY;INTERVAL=30'))
    expect(T.fromSchedule('weekdays 9:00')).toBe(rule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0'))
    expect(T.fromSchedule('mon,fri 16:00')).toBe(rule('FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=16;BYMINUTE=0'))
    expect(T.fromSchedule('cron "0 9 * * 1-5"')).toBe(rule('FREQ=DAILY;BYMINUTE=0;BYHOUR=9;BYDAY=MO,TU,WE,TH,FR'))
    expect(T.fromSchedule('once 2026-11-02 9:00')).toBe('once 2026-11-02 09:00')
    expect(T.fromSchedule('whenever')).toBeUndefined()
  })
})

describe('automations', () => {
  const Z = 'Europe/Stockholm'
  const at = (s: string) => new Date(s).getTime()
  // each test starts with none saved: one that failed leaves none behind for the next
  beforeEach(() => writeJson('automations.json', []))
  test('due on its time rule, in the time zone: once per run', () => {
    const a = new Automations()
    const x = a.add(
      { place: 'p:x:due', name: 'Morning', trigger: { time: T.timeRule('FREQ=DAILY;BYHOUR=9;BYMINUTE=0') }, task: { title: 'Look around' } },
      at('2026-10-26T06:00:00Z'),
    )
    // 9:00 in Stockholm is 8:00 UTC
    expect(a.dueNow(Z, at('2026-10-26T07:59:00Z'))).toEqual([])
    expect(a.dueNow(Z, at('2026-10-26T08:00:00Z'))).toEqual([x])
    a.fired(x, { task: 'G-1' }, at('2026-10-26T08:00:00Z'), true)
    expect(a.dueNow(Z, at('2026-10-26T08:00:30Z'))).toEqual([])
    expect(a.dueNow(Z, at('2026-10-27T08:00:00Z'))).toEqual([x])
    a.remove('p:x:due', 'Morning')
    // a run on an event just after its time takes no run of its time rule's place
    const y = a.add(
      { place: 'p:x:due', name: 'Both', trigger: { time: T.timeRule('once 2026-10-28 9:00'), on: [{ event: 'merged' }] }, task: { title: 'Both' } },
      at('2026-10-27T00:00:00Z'),
    )
    a.fired(y, { task: 'G-2' }, at('2026-10-28T08:00:01Z'))
    expect(a.dueNow(Z, at('2026-10-28T08:00:30Z'))).toEqual([y])
    a.remove('p:x:due', 'Both')
  })
  test('what Tasks lists at the bottom: its trigger in words and next runs, paused ones too', () => {
    const a = new Automations()
    a.add({
      place: 'p:x:gtm',
      name: 'Flaky tests',
      trigger: { time: T.timeRule('FREQ=DAILY;BYHOUR=7;BYMINUTE=0') },
      task: { title: 'Rerun the flaky test suite', desc: 'Three times.' },
    })
    a.add({ place: 'p:x:gtm', name: 'Changelog', trigger: { on: [{ event: 'merged' }] }, task: { title: 'Update the changelog' } })
    a.pause('p:x:gtm', 'Changelog', false)
    const now = at('2026-10-28T09:40:00Z')
    expect(a.view('p:x:gtm', Z, now)).toEqual([
      {
        name: 'Flaky tests',
        when: 'Every day at 7:00 (Stockholm)',
        what: 'Rerun the flaky test suite',
        brief: 'Three times.',
        on: true,
        time: 'DTSTART:20260101T000000 RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=0',
        next: ['Tomorrow 7:00', 'Fri 30 Oct 7:00', 'Sat 31 Oct 7:00'],
        runs: [],
      },
      { name: 'Changelog', when: 'When a task is merged', what: 'Update the changelog', on: false, events: 'merged', next: [], runs: [] },
    ])
    expect(() => a.add({ place: 'p:x:gtm', name: 'x', trigger: {}, task: { title: 'y' } })).toThrow('--when')
    expect(() => a.add({ place: 'p:x:gtm', name: 'x', trigger: { time: T.timeRule('FREQ=DAILY') }, task: { title: '' } })).toThrow('--task')
  })
  test('events: its own space unless a rule names another, with filters', () => {
    const a = new Automations()
    const x = a.add({
      place: 'p:x:shop',
      name: 'Release notes',
      trigger: { on: T.eventRules('merged branch=release/*') },
      task: { title: 'Write release notes' },
    })
    expect(a.on({ event: 'merged', branch: 'release/2' }, 'p:x:shop')).toEqual([x])
    expect(a.on({ event: 'merged', branch: 'work/2-x' }, 'p:x:shop')).toEqual([])
    expect(a.on({ event: 'merged', branch: 'release/2' }, 'p:x:other')).toEqual([])
    const y = a.add({ place: 'p:x:shop', name: 'Watch gtm', trigger: { on: T.eventRules('failed space=gtm') }, task: { title: 'Look at gtm' } })
    expect(a.on({ event: 'failed' }, 'p:x:gtm')).toEqual([y])
    // the machine struggling: whatever space it is told in
    const z = a.add({ place: 'p:x:shop', name: 'Clean up', trigger: { on: T.eventRules('health') }, task: { title: 'Free some disk' } })
    expect(a.on({ event: 'health' }, 'p:x:')).toEqual([z])
  })
  test('once runs at its time, then turns itself off; its runs are kept, newest first', () => {
    const a = new Automations()
    const x = a.add(
      { place: 'p:x:once', name: 'Once', trigger: { time: T.timeRule('once 2026-11-02 9:00') }, task: { title: 'One go' } },
      at('2026-10-28T00:00:00Z'),
    )
    expect(a.dueNow(Z, at('2026-11-02T07:59:00Z'))).toEqual([])
    expect(a.dueNow(Z, at('2026-11-02T10:00:00Z'))).toEqual([x]) // missed while down: it runs once it can
    a.fired(x, { task: 'G-1' }, Date.now(), true)
    expect(x.on).toBe(false)
    a.fired(x, { error: 'No project' })
    expect(a.view('p:x:once', Z)[0].runs.map((r) => r.task ?? r.error)).toEqual(['No project', 'G-1'])
    // made again under its name: its runs stay
    a.add({ place: 'p:x:once', name: 'Once', trigger: { time: T.timeRule('FREQ=DAILY;BYHOUR=9') }, task: { title: 'Every day' } })
    expect(a.view('p:x:once', Z)[0].runs).toHaveLength(2)
  })
  test('automations from before triggers become time and event rules once; unreadable ones are dropped', () => {
    writeJson('automations.json', [
      { id: 'a', place: 'p:x:old', name: 'Daily', schedule: 'daily 9:00', task: { title: 'Daily' }, on: true },
      { id: 'b', place: 'p:x:old', name: 'On merge', when: 'merged', task: { title: 'Changelog' }, on: true },
      { id: 'c', place: 'p:x:old', name: 'Odd', schedule: 'sometimes', task: { title: 'Odd' }, on: true },
      { id: 'd', place: 'p:x:old', name: 'Missed', schedule: 'once 2026-10-27 9:00', task: { title: 'Missed' }, on: true },
    ])
    const a = new Automations()
    expect(a.list.map((x) => [x.name, x.trigger])).toEqual([
      ['Daily', { time: T.timeRule('FREQ=DAILY;BYHOUR=9;BYMINUTE=0') }],
      ['On merge', { on: [{ event: 'merged' }] }],
      ['Missed', { time: 'once 2026-10-27 09:00' }],
    ])
    // a once missed while Lineclear was down still runs; a daily one counts from now
    expect(a.dueNow(Z, at('2026-10-28T10:00:00Z')).map((x) => x.name)).toEqual(['Missed'])
    expect(readJson<unknown[]>('automations.json', []).some((x) => 'schedule' in (x as object))).toBe(false)
    writeJson('automations.json', [])
  })
})
