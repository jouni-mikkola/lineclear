// Fictional data for the demo source: the same world the frozen prototype shows, so a reviewer can put the
// build and the prototype side by side. Nothing here is real.
import type { Artifact, Machine, MachineHealth, Place, SettingSection, Task, TaskAgent } from '../../shared/types.ts'
import { Settings } from '../live/settings.ts'
import { pluginCatalog, pluginsPage } from '../plugins.ts'
import type { PluginEntry } from '../plugin-list.ts'

export const DEMO_HOST = 'vm-str'

/** each machine's numbers: vm-str busy enough that a new task waits, mac's disk past its alert limit */
const HEALTH: Record<string, MachineHealth> = {
  'vm-str': {
    meters: [
      { name: 'CPU', pct: 112, detail: 'load 17.9 on 16 cores', level: 'busy' },
      { name: 'Memory', pct: 58, detail: '18 GB of 31 GB', level: 'ok' },
      { name: 'Disk', pct: 64, detail: 'home 64%', level: 'ok' },
    ],
    herdr: true,
    working: 4,
    max: 5,
    held: 1,
    heldWhy: 'Waiting for the machine',
    at: '14:31',
  },
  mac: {
    meters: [
      { name: 'CPU', pct: 18, detail: 'load 1.8 on 10 cores', level: 'ok' },
      { name: 'Memory', pct: 41, detail: '13 GB of 32 GB', level: 'ok' },
      { name: 'Disk', pct: 92, detail: 'home 92% · /tmp 92%', level: 'over' },
      { name: 'GPU', pct: 7, detail: 'Apple M2 Pro · memory 12%', level: 'ok' },
    ],
    herdr: true,
    working: 1,
    max: 5,
    held: 0,
    at: '14:31',
  },
}

export function places(): Place[] {
  return [
    { id: VM, name: 'home', machine: 'vm-str', home: true, level: 0, status: 'need', chat: VM },
    { id: 'p:vm-str:gtm', name: 'gtm', machine: 'vm-str', level: 2, status: 'need', chat: 'p:vm-str:gtm', githubRemote: true },
    {
      id: 'p:vm-str:herdr-projects',
      name: 'herdr-projects',
      machine: 'vm-str',
      level: 2,
      status: 'need',
      chat: 'p:vm-str:herdr-projects',
      githubRemote: true,
    },
    { id: MAC, name: 'home', machine: 'mac', home: true, level: 1, status: 'need', chat: MAC },
    {
      id: 'p:mac:lilla-varlden',
      name: 'lilla-varlden',
      machine: 'mac',
      level: 2,
      status: 'need',
      chat: 'p:mac:lilla-varlden',
      githubRemote: false,
    },
    { id: NAS, name: 'home', machine: 'nas', home: true, level: 1, status: 'off', chat: NAS, unreachableSince: '14:02' },
  ]
}

/** the machines, as headings over their spaces */
export function machines(): Machine[] {
  return [
    { id: 'm:vm-str', machine: 'vm-str', name: 'vm-str', status: 'idle', health: HEALTH['vm-str'] },
    { id: 'm:mac', machine: 'mac', name: 'mac', status: 'idle', health: HEALTH.mac },
    { id: 'm:nas', machine: 'nas', name: 'nas', status: 'off', unreachableSince: '14:02' },
  ]
}

/** each machine's home space: vm-str's is the main machine's, with every machine's overview */
export const VM = 'p:vm-str:~'
export const MAC = 'p:mac:~'
export const NAS = 'p:nas:~'

export const GTM = 'p:vm-str:gtm'
export const HP = 'p:vm-str:herdr-projects'
export const LV = 'p:mac:lilla-varlden'

const agent = (task: string, cli: string, status: TaskAgent['status'], age: string, note: string): TaskAgent => ({
  chat: `${task}/Agent`,
  role: 'Agent',
  cli,
  status,
  age,
  note,
})

export const STATE_LABEL = { need: 'Needs you', ready: 'Ready', merging: 'Merging', work: 'Working', queued: 'Queued', todo: 'To do', done: 'Done' } as const

export function tasks(): Task[] {
  const list: Omit<Task, 'state' | 'on' | 'created'>[] & Partial<Task>[] = [
    {
      id: 'GTM-15',
      name: 'Fix webhook signature check',
      status: 'ready',
      place: GTM,
      sub: 'Ready to merge',
      age: '12m',
      branch: 'work/15-webhook-sig',
      pr: { number: 48, url: 'https://github.com/eliasstravik/gtm/pull/48' },
      agent: agent('GTM-15', 'Claude Code', 'ready', '12m', 'Ready to merge'),
      desc: 'The webhook handler compares signatures with !==, which leaks timing and breaks on re-encoded bodies. Check the raw body with a constant-time compare.',
      said: 'It now checks the raw body with a constant-time compare. A reviewer subagent found one issue; fixed.',
      state: 'Ready · 12m ago',
      on: 'Claude Code',
      created: 'today 09:12 by gtm (you asked in chat)',
    },
    {
      id: 'GTM-18',
      name: 'Rate limit the webhook',
      status: 'merging',
      place: GTM,
      sub: 'Checks running · ~3m',
      age: '4m',
      branch: 'work/18-webhook-rate-limit',
      pr: { number: 49, url: 'https://github.com/eliasstravik/gtm/pull/49' },
      agent: agent('GTM-18', 'Claude Code', 'merging', '4m', 'Checks running · ~3m'),
      said: 'The webhook takes at most 20 calls a minute per sender; more get a 429 with Retry-After.',
    },
    {
      id: 'GTM-14',
      name: 'Bundle skills into the template',
      status: 'need',
      place: GTM,
      sub: 'Asks permission',
      age: '3m',
      agent: agent('GTM-14', 'Claude Code', 'need', '3m', 'Asks permission'),
      report: { msg: 'Moving the skills into the template', progress: 62, eta: 4, paused: true },
    },
    {
      id: 'GTM-16',
      name: 'Docs for the skills folder',
      status: 'need',
      place: GTM,
      sub: 'Plan to approve',
      age: '1m',
      plan: ['Add a Skills section to the README', 'One page per skill under docs/skills/', 'Print the docs link at the end of gtm init'],
      agent: agent('GTM-16', 'Claude Code', 'need', '1m', 'Plan to approve'),
    },
    {
      id: 'GTM-17',
      name: 'Changelog for the webhook fix',
      status: 'todo',
      place: GTM,
      sub: '',
      age: '20m',
      agent: agent('GTM-17', 'Claude Code', 'todo', '20m', ''),
      desc: "Add a changelog entry for the webhook signature fix in GTM-15, in the same plain words as the others. Don't start yet, wait for a go. Report done and wait for my yes before merging.",
      state: 'To do · added 20m ago',
      created: 'today 09:30 by gtm (you asked in chat)',
    },
    {
      id: 'GTM-12',
      name: 'Slack agent setup',
      status: 'done',
      place: GTM,
      sub: 'Merged',
      age: '2d',
      doneAt: Date.now() - 2 * 86_400_000,
      pr: { number: 45, url: 'https://github.com/eliasstravik/gtm/pull/45' },
      agent: agent('GTM-12', 'Claude Code', 'done', '2d', 'Merged'),
      said: 'The Slack agent answers in #gtm.',
      facts: 'PR #45 · commit 4be1c09 · checks passed (bun run test, GitHub) · review: nothing found · not proven: a real Slack workspace',
    },
    {
      id: 'HP-201',
      name: 'Pinned count is off',
      status: 'need',
      place: HP,
      sub: 'Keep Pinned as a filter, or a tab?',
      age: '2m',
      branch: 'work/201-pinned-count',
      agent: agent('HP-201', 'Claude Code', 'need', '2m', 'Keep Pinned as a filter, or a tab?'),
      desc: 'The Pinned count says 3 with only 2 pinned projects.',
      said: 'A pinned project was counted once per task. Fixed; one choice left for you.',
      state: 'Needs you · 2m ago',
      on: 'Claude Code',
      created: 'today 10:40 by herdr-projects',
    },
    {
      id: 'HP-202',
      name: 'Voice call drops on mute',
      status: 'work',
      place: HP,
      sub: 'Reading the call helper',
      age: '8m',
      agent: agent('HP-202', 'pi', 'work', '8m', 'Reading the call helper'),
      report: { msg: 'Tracing why mute ends the call', progress: 40, eta: 12 },
    },
    {
      id: 'HP-203',
      name: 'Release 1.2.27',
      status: 'queued',
      place: HP,
      sub: 'After HP-202',
      age: '1h',
      after: ['HP-202'],
      agent: agent('HP-203', 'Claude Code', 'queued', '1h', 'After HP-202'),
      desc: 'Cut release 1.2.27 with the voice call fix in it: bump the version, write the changelog and tag it. Report done and wait for my yes before merging.',
      state: 'Queued · 1h ago',
      created: 'today 09:50 by herdr-projects (you asked in chat)',
    },
    {
      id: 'HP-204',
      name: 'Dark mode for rendered pages',
      status: 'todo',
      place: HP,
      sub: '',
      age: '1d',
      agent: agent('HP-204', 'Claude Code', 'todo', '1d', ''),
      desc: "Pages rendered in chat stay light in dark mode. Give them the app’s dark colours when the screen is dark, without changing how they look in light mode. Don't start yet, wait for a go. Then plan first and wait for my yes.",
      state: 'To do · added 1d ago',
      created: 'yesterday 17:05 by herdr-projects (you asked in chat)',
    },
    {
      id: 'LV-3',
      name: 'Upload page for files',
      status: 'need',
      place: LV,
      sub: 'Question for you',
      age: '21m',
      agent: agent('LV-3', 'pi', 'need', '21m', 'Question for you'),
    },
    {
      id: 'LV-4',
      name: 'Kids devices list',
      status: 'need',
      place: LV,
      sub: 'Cards or one table?',
      age: '5m',
      agent: agent('LV-4', 'Claude Code', 'need', '5m', 'Cards or one table?'),
    },
    // archived: out of every list and count, in gtm's Archived view and search
    {
      id: 'GTM-9',
      name: 'Retry failed enrichments',
      status: 'done',
      place: GTM,
      sub: 'Merged',
      age: '9d',
      archived: Date.now() - 9 * 86_400_000,
      state: 'Archived · 9d ago',
      agent: agent('GTM-9', 'Claude Code', 'done', '9d', 'Retry failed enrichments'),
    },
    {
      id: 'GTM-11',
      name: 'Try a second CRM',
      status: 'need',
      place: GTM,
      sub: 'Stopped',
      age: '3d',
      archived: Date.now() - 3 * 86_400_000,
      state: 'Archived · 3d ago',
      agent: agent('GTM-11', 'pi', 'need', '3d', 'Stopped'),
    },
  ]
  const projectName = (id: string) => id.split(':').pop()!
  return list.map((t) => ({
    state: STATE_LABEL[t.status!],
    on: t.agent?.cli ?? 'Claude Code',
    created: `by ${projectName(t.place!)}`,
    desc: 'No brief yet.',
    ...t,
  })) as Task[]
}

/** the demo's time zone, Everywhere: it reads the same on any machine */
const DEMO_ZONE = 'Europe/Stockholm'

/** the demo agents' artifacts (their pages are in artifacts.ts), newest first */
export function artifacts(): Artifact[] {
  const one = (id: string, title: string, place: string, by: string, when: string, at: number, extra: Partial<Artifact> = {}): Artifact => ({
    id,
    title,
    place,
    v: 1,
    at,
    when,
    by,
    keeper: by,
    thumb: true,
    versions: [{ n: 1, when, by, html: 1 }],
    ...extra,
  })
  const now = Date.now()
  return [
    one('a5', 'Board with the fixed count', HP, 'HP-201 agent', '2m', now - 120_000, {
      v: 2,
      versions: [
        { n: 2, when: '2m', by: 'HP-201 agent', note: 'Pinned counted once', html: 2 },
        { n: 1, when: '9m', by: 'HP-201 agent', html: 1 },
      ],
    }),
    one('a7', 'Upload page draft', LV, 'LV-3 agent', '21m', now - 21 * 60_000),
    one('a6', 'Disk use on vm-str', VM, 'home', '1h', now - 3_600_000),
    one('a1', 'This week across machines', VM, 'home', '3h', now - 3 * 3_600_000, {
      v: 3,
      versions: [
        { n: 3, when: '3h', by: 'home', html: 1, what: 'data' },
        { n: 2, when: '1d', by: 'home', html: 1, what: 'data' },
        { n: 1, when: '2d', by: 'home', html: 1 },
      ],
    }),
    one('a8', 'Onboarding deck', GTM, 'gtm', '2d', now - 2 * 86_400_000),
  ]
}

/** what the demo's attached files hold */
export const FILES: Record<string, () => Blob> = {
  '~/inbox/lv/mf1a2b-upload-page.svg': () =>
    new Blob(
      [
        `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844" viewBox="0 0 390 844"><rect width="390" height="844" fill="#f4f4f5"/><rect width="390" height="96" fill="#fff"/><text x="24" y="70" font-family="system-ui" font-size="22" font-weight="600" fill="#18181b">Upload files</text><rect x="24" y="128" width="342" height="180" rx="16" fill="#fff" stroke="#d4d4d8" stroke-dasharray="6 6"/><text x="195" y="224" text-anchor="middle" font-family="system-ui" font-size="16" fill="#71717a">Drop files here</text><rect x="24" y="336" width="342" height="56" rx="12" fill="#fff"/><text x="44" y="370" font-family="system-ui" font-size="15" fill="#18181b">devices.csv · 12 KB</text><rect x="0" y="508" width="390" height="336" fill="#d1d5db"/><g fill="#fff">${Array.from({ length: 30 }, (_, i) => `<rect x="${8 + (i % 10) * 38}" y="${528 + Math.floor(i / 10) * 64}" width="32" height="50" rx="6"/>`).join('')}</g><rect x="24" y="486" width="342" height="52" rx="26" fill="#2563eb" opacity="0.85"/><text x="195" y="518" text-anchor="middle" font-family="system-ui" font-size="16" font-weight="600" fill="#fff">Upload</text></svg>`,
      ],
      { type: 'image/svg+xml' },
    ),
  '~/inbox/lv/mf1a2c-devices.csv': () => new Blob(['name,model,last seen\nhall,Pixel 9,today\noffice,iPhone 17,yesterday\n'], { type: 'text/csv' }),
}

/** Replies the demo agents give once a question is answered. */
export const REPLIES: Record<string, string> = {
  f1: 'On it. Rerunning CI on main now.',
  f2: 'Merged into main.',
  f3: 'Going with that. Building it now.',
  f4: 'Thanks, carrying on.',
  f5: 'Going with that.',
  f6: 'Thanks. Building it now.',
  f7: 'Going with that. Building it now.',
}

/** each demo machine's defaults: a few set (high effort on vm-str, gtm's tasks on pi, mac's max 3 tasks); the main
 *  one's Everywhere is the other's too */
export function settingStores() {
  return {
    'vm-str': new Settings({ everywhere: { 'time.zone': DEMO_ZONE }, machine: { 'task.effort': 'high' }, spaces: { gtm: { 'task.agent': 'pi' } } }),
    mac: new Settings({ everywhere: { 'time.zone': DEMO_ZONE }, machine: { 'machine.maxTasks': '3' }, spaces: {} }),
  }
}

/** the live catalog at its levels, as an install shows it; alerts on two devices */
/** the plugins of the demo install (a build with plugins of your own shows its own): the base ones, voice replaced by
 *  one of the human's own, and a stand-up plugin of theirs (none failing: the screen would say so at its top, over
 *  every screen the tests measure) */
const DEMO_PLUGINS: PluginEntry[] = [
  ...['places', 'coordinators', 'tasks', 'chat', 'reactions', 'artifacts', 'terminal', 'worktree', 'health', 'alerts', 'keyboard'].map((name) => ({
    name,
    from: 'base' as const,
    on: true,
  })),
  { name: 'voice', from: 'user', overrides: true, on: true },
  { name: 'standup', from: 'user', on: true },
]

export function settings(stores = settingStores(), pluginsOff: string[] = []): SettingSection[] {
  const r = (label: string, value: string, key: string, more: Partial<SettingSection['rows'][number]> = {}) => ({ label, value, key, ...more })
  const devices = ['This phone', 'this Mac']
  const own = (x: SettingSection) => !['Plugins', 'Machines'].includes(x.name)
  return [
    ...stores['vm-str'].sections(devices, [], null, 'vm-str', ['~', 'gtm', 'herdr-projects'], 'vm-str').filter(own),
    ...stores.mac.sections(devices, [], null, 'mac', ['~', 'lilla-varlden'], 'mac').filter((x) => own(x) && x.machine === 'mac'),
    pluginsPage(
      (pluginCatalog.some((p) => p.from === 'user') ? pluginCatalog : DEMO_PLUGINS).map((p) => ({ ...p, on: p.on && !pluginsOff.includes(p.name) })),
      pluginsOff,
    ),
    {
      name: 'Machines',
      about: 'Every machine Lineclear reaches, and how it is now.',
      rows: [
        r('vm-str', 'Main · reachable', '', { fixed: true }),
        r('mac', 'Reachable', '', { fixed: true }),
        r('nas', "Can't reach since 14:02", '', { fixed: true }),
      ],
    },
  ]
}

export const ASKS: Record<string, string> = { [GTM]: 'f1' }

/** the secrets the demo keeps: names and when, with values no one sees */
export function secrets() {
  const day = 86_400_000
  return {
    all: { OPENAI_API_KEY: { value: 'demo', at: Date.now() - 12 * day } },
    'm:vm-str': { GITHUB_TOKEN: { value: 'demo', at: Date.now() - 3 * day } },
    [GTM]: { STRIPE_SECRET_KEY: { value: 'demo', at: Date.now() - 2 * 3_600_000 }, HUBSPOT_TOKEN: { value: 'demo', at: Date.now() - 30 * day } },
  }
}

/** each machine's folders under home, for adding a project: a trailing * marks a repo */
export const FOLDERS: Record<string, string[]> = {
  'vm-str': ['dev/gtm*', 'dev/herdr-projects*', 'dev/lineclear*', 'dev/website*', 'dev/scratch', 'dev/scratch/ideas', 'Documents', 'notes'],
  mac: ['dev/lilla-varlden*', 'dev/recipes*', 'Desktop', 'Documents'],
}
