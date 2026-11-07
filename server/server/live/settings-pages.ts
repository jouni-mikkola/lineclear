import { cpus, totalmem } from 'node:os'
import type { SettingSection } from '../../shared/types.ts'
import { settingsBlock, settingsLines, type Said } from './prompts.ts'
import { agentRow } from './settings-catalog.ts'
import { defaultMaxTasks, kindOfLevel, defaultOf, CATALOG } from './settings-sections.ts'
import { SettingsRules } from './settings-ways.ts'
import type { MachineLimits, Level, LevelKind, Section } from './settings-types.ts'

/** under a machine's rows: why the defaults are what they are, in this machine's own numbers */
export function machineNote(l: MachineLimits, cores = cpus().length, memGb = Math.round(totalmem() / 2 ** 30)) {
  const load = (x: number | null) => (x === null ? 'off' : `${+(x * cores).toFixed(1)}`)
  const gb = (pct: number | null) => (pct === null ? 'off' : `${Math.round((memGb * pct) / 100)} GB`)
  const now = [
    l.max !== null || l.startLoad !== null
      ? `New tasks wait${l.max !== null ? ` while ${l.max} are at work` : ''}${l.max !== null && l.startLoad !== null ? ', or' : ''}${l.startLoad !== null ? ` while the load is over ${load(l.startLoad)}` : ''}${l.startMemory !== null ? ` or over ${gb(l.startMemory)} of memory is in use` : ''}.`
      : '',
    `Its coordinator hears when the load stays over ${load(l.alertLoad)} for 10 minutes, memory passes ${gb(l.alertMemory)}, home or /tmp is over ${l.alertDisk === null ? 'off' : `${l.alertDisk}%`} full${l.alertHerdr ? ', or herdr stops answering' : ''}.`,
  ].filter(Boolean)
  return {
    noteTitle: 'Why these defaults',
    note: [
      `This machine has ${cores} cores and ${memGb} GB of memory. ${now.join(' ')}`,
      '',
      `- ${defaultMaxTasks(cores)} tasks at once, cores minus 2: each task's checks and merges need cores of their own, and two stay free for one full check and the server.`,
      '- Load 1× cores to start: every core is busy then, so one more task only slows the rest.',
      "- Memory 80% to start: room for a test run's peak before the machine starts killing processes.",
      "- Load 1.5× cores for 10 minutes to alert: half again more work than cores, for longer than one test run's spike.",
      '- Memory and disk 90% to alert: close enough to full that something will soon fail.',
      '',
      'Waiting tasks show as Queued and start by themselves, oldest first; while load counts, one at a time, 30 seconds apart, so each one shows in the load. Only working tasks count. Lineclear never pauses a running task: when told, the coordinator decides.',
    ].join('\n'),
  }
}

/** the settings as pages and lines, for the web and for lineclear show */
export class Settings extends SettingsRules {
  /** every key with its value for a space (none: this machine) and where it comes from, as lineclear show prints
   *  them */
  lines(space?: string, host = 'this machine', lists?: { worker?: string[]; reviewer?: string[] }) {
    const l: Level = space ? { space } : 'machine'
    const name = { space: 'this space', machine: host, all: 'Everywhere', default: 'default' }
    const keys = (told: boolean) =>
      CATALOG.filter((s) => !!(s.told || s.prompt) === told).flatMap((s) =>
        s.rows
          .filter((r) => r.key !== 'alerts' && r.key !== 'backup.model')
          .map((r) => {
            const p = this.pick(r.key, l)
            // tasks and reviewers take their models from the space's ordered lists, so the stored model is not shown
            const list = r.key === 'task.model' ? lists?.worker : r.key === 'reviewer.model' ? lists?.reviewer : undefined
            if (list) return `${r.key.padEnd(22)} ${list.join(', then ')}  (Settings > Models)`
            return `${r.key.padEnd(22)} ${p.value}  (${name[p.from]})`
          }),
      )
    return `What agents are told (private launch instructions and new briefs):\n${keys(true).join('\n')}\n\nHow Lineclear runs:\n${keys(false).join('\n')}`
  }

  /** the pages of every level this machine holds: Everywhere (the main machine's, which its others share), this
   *  machine, and each of its spaces */
  sections(
    devices: string[],
    machines: { name: string; state: string }[],
    host = 'this machine',
    spaces: string[] = [],
    name = host,
    pushWarnings: string[] = [],
  ): SettingSection[] {
    const levels: { l: Level; id: string }[] = [
      { l: 'all', id: 'all' },
      { l: 'machine', id: `m:${host}` },
      ...spaces.map((space) => ({ l: { space } as Level, id: `p:${host}:${space}` })),
    ]
    const fromName = (f: LevelKind | 'default') => (f === 'machine' ? name : 'Everywhere')
    const above = (l: Level): Level | null => (l === 'all' ? null : l === 'machine' ? 'all' : 'machine')
    const rows = (s: Section, l: Level) => {
      // the words each row of How tasks work adds to a brief, as its Settings block has them at this level
      const told = s.told ? settingsLines('<id>', { ways: this.waysAt(l), reviewer: this.harnessAt('reviewer', l), by: this.setByAt(l) }) : []
      const text = (said: Said) => told.find((x) => x.said === said)?.text
      const lines: Record<string, string | undefined> = s.told
        ? {
            'brief.review': text('review'),
            'reviewer.agent': text('reviewer'),
            'review.mustFix': text('mustFix'),
            'review.rounds': text('rounds'),
            'brief.merge': text('merge'),
          }
        : {}
      return s.rows.map((r) => {
        if (r.key === 'alerts')
          return {
            ...r,
            value: devices.length ? devices.join(', ') : 'No device yet',
            warn: pushWarnings.length
              ? `${pushWarnings.length} device${pushWarnings.length === 1 ? '' : 's'} could not receive the last alert.\n${pushWarnings.slice(0, 3).join('\n')}${pushWarnings.length > 3 ? '\nMore details: lineclear doctor' : ''}`
              : undefined,
          }
        const p = this.pick(r.key, l)
        const here = p.from === kindOfLevel(l)
        const up = above(l)
        // set here: what a reset goes back to; not set here: where its value comes from
        const back = up ? this.pick(r.key, up) : { value: defaultOf(r.key) ?? '', from: 'default' as const }
        return {
          ...agentRow({ ...r, value: p.value }, (k) => this.pick(k, l).value),
          ...(lines[r.key] ? { line: lines[r.key] } : {}),
          ...(here
            ? { inherits: { value: back.value, from: back.from === 'default' && l === 'all' ? 'Default' : fromName(back.from) } }
            : l === 'all'
              ? {}
              : { from: fromName(p.from) }),
        }
      })
    }
    const note = (s: Section, l: Level) =>
      s.name === 'Private instructions'
        ? {
            noteTitle: 'When rules take effect',
            note: 'Used at the next start or restart. Saving leaves running agents alone. A resumed session may remember old rules: the new snapshot replaces those private rules. Task agents pass the reviewer snapshot from their own latest start to each review; restart the task agent to refresh it.',
          }
        : s.name === 'How tasks work'
          ? { note: settingsBlock('<id>', { ways: this.waysAt(l), reviewer: this.harnessAt('reviewer', l), by: this.setByAt(l) }) }
          : s.name === 'Machine'
            ? machineNote(this.machine(l === 'all' ? 'all' : 'machine'))
            : {}
    return [
      ...levels.flatMap(({ l, id }) =>
        CATALOG.filter((s) => (s.levels ?? ['all', 'machine', 'space']).includes(kindOfLevel(l))).map((s) => ({
          name: s.name,
          about: s.about,
          rows: rows(s, l),
          ...note(s, l),
          level: id,
          ...(s.levels?.length === 1 ? { global: true } : {}),
          ...(s.told || s.prompt ? { told: true } : {}),
          ...(l === 'all' ? {} : { machine: host }),
        })),
      ),
      {
        name: 'Machines',
        about: 'Every machine Lineclear reaches, and how it is now.',
        rows: machines.map((m) => ({ label: m.name, key: '', value: m.state, fixed: true })),
      },
    ]
  }
}
