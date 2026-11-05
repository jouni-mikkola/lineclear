// The demo's chats: what each place and task has said so far. Nothing here is real.
import { apart, type Chat, type Message } from '../../shared/types.ts'
import { demoJobs, demoTurn } from './activity.ts'
import { GTM, HP, LV, MAC, NAS, tasks, VM } from './data.ts'

let mid = 0
const m = (msg: Omit<Message, 'id'>): Message => ({ id: `m${++mid}`, ...msg })

export function chats(): Record<string, Chat> {
  let hides: Message
  const c = (key: string, cli: string, messages: Message[], extra: Partial<Chat> = {}): Chat => ({ key, cli, messages: apart(messages), ...extra })
  return Object.fromEntries(
    [
      c(VM, 'Claude Code', [
        m({ who: 'you', text: 'Free up some disk space.' }),
        m({
          who: 'agent',
          text: 'Removed six worktrees of merged tasks. 14 GB back.',
          artifact: { id: 'a6', v: 1 },
          reactions: [{ emoji: '🙌', by: 'me' }],
        }),
        m({ who: 'you', text: 'What needs me today?', reactions: [{ emoji: '👀', by: 'them' }] }),
        m({
          who: 'agent',
          text: 'Seven things. gtm asks whether to rerun CI on main, GTM-15 is done and asks to merge, HP-201 needs a call on Pinned, GTM-14 and LV-3 each wait on a question, the GTM-16 plan waits for your yes, and LV-4 asks how to show the devices. The week so far:',
          artifact: { id: 'a1', v: 1 },
          reactions: [{ emoji: '👍', by: 'me' }],
        }),
      ]),
      c(GTM, 'Claude Code', [
        m({
          who: 'agent',
          text: 'CI on main failed once on a flaky test. What should I do?',
          question: {
            id: 'f1',
            title: 'Rerun CI on main?',
            kind: 'Form',
            choices: [{ label: 'Rerun it' }, { label: 'Skip the flaky test' }, { label: 'Leave it for now' }],
            to: 'gtm',
          },
        }),
      ]),
      c(HP, 'Claude Code', [
        m({ who: 'you', text: 'How is HP-202 going?', reactions: [{ emoji: '👀', by: 'them' }] }),
        m({ who: 'agent', activity: demoTurn('gtm-t1') }),
        m({ who: 'agent', text: 'Halfway. Mute stops the mic track and the helper reads that as a hang-up. HP-201 needs a call from you.' }),
        m({ who: 'you', text: 'Post the release notes to Slack when it ships.' }),
        m({
          who: 'agent',
          secret: {
            id: 'secret:demo1',
            name: 'SLACK_BOT_TOKEN',
            why: 'To post the release notes in #releases. A bot token (xoxb-…) from the Slack app is enough.',
            levels: [
              { id: HP, label: 'herdr-projects' },
              { id: 'm:vm-str', label: 'vm-str' },
              { id: 'all', label: 'Everywhere' },
            ],
          },
        }),
      ]),
      c(MAC, 'Claude Code', [
        m({ who: 'you', text: 'Anything going on here?' }),
        m({ who: 'agent', text: 'One space here besides home. LV-3 is writing the upload route.' }),
      ]),
      c(NAS, 'Claude Code', [m({ who: 'you', text: 'Did the backups run?' }), m({ who: 'agent', text: 'Backups finished at 03:00. Nothing else running.' })]),
      c(LV, 'Claude Code', [
        (hides = m({ who: 'you', text: 'The upload button hides under the keyboard on my phone:' })),
        m({ who: 'you', file: { name: 'upload-page.svg', path: '~/inbox/lv/mf1a2b-upload-page.svg' } }),
        m({ who: 'you', file: { name: 'devices.csv', path: '~/inbox/lv/mf1a2c-devices.csv' } }),
        m({ who: 'agent', text: 'Got it, and the device list too. LV-3 moves the button above the keyboard.' }),
        m({ who: 'you', text: 'Where are we?' }),
        m({ who: 'agent', text: 'LV-3 is building the upload page; LV-4 waits.' }),
        // a reply, quoting the message it answers
        m({ who: 'agent', text: 'The button now sits above the keyboard on phones. Try it on yours.', reply: { id: hides.id, who: 'you', text: hides.text! } }),
      ]),
      c(
        'GTM-12/Agent',
        'Claude Code',
        [m({ who: 'you', text: 'Set up the Slack agent.' }), m({ who: 'agent', text: 'Done and merged two days ago. The bot answers in #gtm.' })],
        { finished: true },
      ),
      c('GTM-15/Agent', 'Claude Code', [
        m({ who: 'you', text: 'Fix the webhook signature check.', reactions: [{ emoji: '👍', by: 'them' }] }),
        m({ who: 'agent', activity: demoTurn('gtm15-t1') }),
        m({
          who: 'agent',
          text: 'Done. It now checks the raw body with a constant-time compare. A reviewer subagent found one issue (the body was re-encoded before the compare); fixed, and the checks pass.',
        }),
        m({
          who: 'agent',
          text: 'You asked to say yes before merging.',
          question: { id: 'f2', title: 'Merge GTM-15?', kind: 'Form', choices: [{ label: 'Merge' }, { label: 'Not yet' }], to: 'GTM-15 agent' },
        }),
      ]),
      c('GTM-16/Agent', 'Claude Code', [
        m({ who: 'you', text: 'Write docs for the skills folder.' }),
        m({
          who: 'agent',
          text: 'Here is my plan. Nothing in the repo changes until you say yes.',
          question: {
            id: 'f6',
            title: 'Plan for GTM-16',
            kind: 'Plan',
            steps: ['Add a Skills section to the README', 'One page per skill under docs/skills/', 'Print the docs link at the end of gtm init'],
            choices: [{ label: 'Approve the plan' }, { label: 'Send it back with a note' }],
            noteRequiredFor: 1,
            to: 'GTM-16 agent',
          },
        }),
      ]),
      c('GTM-14/Agent', 'Claude Code', [
        m({ who: 'you', text: 'Bundle the skills folder into the starter template.' }),
        m({
          who: 'agent',
          text: 'Copied the seven skills. Two things changed:\n\n- `gtm init` now copies `skills/` into new projects\n- the template README lists each skill\n\n```\n$ gtm init demo\n✓ 7 skills copied\n✓ README updated\n```\n\nRunning the check now.',
        }),
        m({
          who: 'agent',
          question: {
            id: 'f4',
            title: 'Allow: rm -rf template/skills/old?',
            kind: 'Form',
            choices: [{ label: 'Yes' }, { label: "Yes, and don't ask again in this project" }, { label: 'No, and tell it what to do instead' }],
            to: 'GTM-14 agent',
            asks: 'Claude Code asks',
          },
        }),
        m({ who: 'you', text: 'Also update the README.', waiting: true, waitsFor: 'menu' }),
      ]),
      c('HP-201/Agent', 'Claude Code', [
        m({ who: 'agent', text: 'Here is the board as it is now: the count says 3 with only 2 pinned.', artifact: { id: 'a5', v: 1 } }),
        m({
          who: 'agent',
          text: 'A pinned project was counted once per task. Fixed.',
          artifact: { id: 'a5', v: 2 },
        }),
        m({
          who: 'agent',
          text: 'One choice left.',
          question: {
            id: 'f3',
            ordinary: true,
            title: 'Where should Pinned live?',
            kind: 'Form',
            choices: [{ label: 'A filter on the filter row' }, { label: 'Its own tab' }],
            to: 'HP-201 agent',
          },
        }),
      ]),
      c('HP-204/Agent', 'Claude Code', [
        m({ who: 'you', text: `Dark mode for rendered pages\n\n${tasks().find((t) => t.id === 'HP-204')?.desc ?? ''}` }),
        m({ who: 'agent', text: 'Got it: dark pages, plan first. I’ll wait for your go.' }),
      ]),
      c('HP-203/Agent', 'Claude Code', [
        m({
          who: 'you',
          text:
            'Release 1.2.27\n\n' +
            (tasks().find((t) => t.id === 'HP-203')?.desc ?? '') +
            '\n\nQueued: this task waits for HP-202 to be done. Don’t start the work yet: reply in one line that you have the brief, and end your turn.',
        }),
        m({ who: 'agent', text: 'Got it: release 1.2.27 once HP-202 is done.' }),
      ]),
      c('GTM-17/Agent', 'Claude Code', [
        m({ who: 'you', text: `Changelog entry for the webhook fix\n\n${tasks().find((t) => t.id === 'GTM-17')?.desc ?? ''}` }),
        m({ who: 'agent', text: 'Got it. I’ll write the entry once you say go.' }),
      ]),
      c(
        'HP-202/Agent',
        'Codex',
        [
          m({ who: 'you', text: 'The voice call drops when I mute. Find out why.' }),
          m({ who: 'agent', activity: demoTurn('hp202-t1') }),
          m({ who: 'agent', text: 'Reading the call helper. Mute stops the mic track, and the helper takes that as a hang-up.' }),
          m({ who: 'you', text: 'Fix it, and check it with the voice tests.' }),
        ],
        { working: true, live: demoTurn('hp202-live', true), jobs: demoJobs() },
      ),
      c('LV-3/Agent', 'pi', [
        m({
          who: 'agent',
          text: 'Writing the upload route. Files go to the shared folder.',
          artifact: { id: 'a7', v: 1 },
        }),
        m({
          who: 'agent',
          question: {
            id: 'f5',
            title: 'Which upload limit?',
            kind: 'Question',
            choices: [
              { label: '50 MB per file', description: 'Fits photos and short videos' },
              { label: '500 MB per file', description: 'Fits long videos; slower on the NAS' },
              { label: 'No limit', description: 'Anything goes; the disk can fill up' },
            ],
            other: true,
            to: 'LV-3 agent',
          },
        }),
      ]),
      c('LV-4/Agent', 'Claude Code', [
        m({ who: 'you', text: 'Make a list of the kids devices.' }),
        m({
          who: 'agent',
          text: 'The data is wired up. One choice before I build the screen.',
          question: {
            id: 'f7',
            ordinary: true,
            title: 'How should the devices show?',
            kind: 'Form',
            choices: [
              { label: 'Cards per device, grouped by kid', description: 'Reads well on a phone' },
              { label: 'One sortable table', description: 'Denser; best on a desktop' },
            ],
            to: 'LV-4 agent',
          },
        }),
      ]),
    ].map((x) => [x.key, x]),
  )
}
