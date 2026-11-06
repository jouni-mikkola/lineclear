// coordinator timer's heartbeat, as OpenClaw's: on its trigger's time rule (Settings → coordinator timer: every 30 minutes, all day), a
// coordinator on coordinator timer gets one fixed prompt in its own session: go through its HEARTBEAT.md, its standing
// checklist in plain words, and act on what needs it, or else reply with only <no-reply> (the chat shows nothing). Only
// while it is idle: a busy one gets it once its turn is over. None while its HEARTBEAT.md is empty and no news waits.
// News its trigger's event rules name (all news by default) wakes the coordinator at once; other news waits here and
// comes with the next heartbeat.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HOME, readJson, writeJson } from '../store.ts'
import { nextRun } from './trigger.ts'

/** a place's HEARTBEAT.md, in Lineclear's own folder (a worker's for another machine's places, on the main machine):
 *  never a path for the coordinator, whose machine may not have it. It reads the checklist in its heartbeat and with
 *  lineclear heartbeat, and edits it with lineclear heartbeat set, or the human in Settings */
export const heartbeatFile = (place: string) => join(HOME, 'heartbeat', `${place.replace(/[^\w.-]+/g, '-')}.md`)

/** the checklist a coordinator starts with, by what it does: a space's work; a home space's its machine's too; the
 *  main machine's home space's every machine's overview too */
export function firstChecklist(role: 'space' | 'home' | 'main') {
  const machine = [
    'Disk, memory and load: clean up only what is safely finished, pause tasks only when it struggles.',
    'Spaces whose tasks are stuck, or that have queued work and room to start it.',
  ]
  const items =
    role === 'space'
      ? [
          'Tasks stuck or stalled: look at their chat, then nudge them, stop them or tell the human.',
          'Main red on GitHub: one small fix-forward task, unless one is at work.',
          'Queued or To do tasks that may start now: start them.',
          'Ready tasks whose brief says they merge themselves but haven’t: see them through.',
          'Live links the human uses still answer.',
        ]
      : role === 'home'
        ? machine
        : [
            ...machine,
            'Anything waiting on the human across machines: alert only what can’t wait.',
            'A machine whose herdr stopped answering, or whose home space went quiet.',
          ]
  return [
    '# Heartbeat',
    '',
    'What to check each heartbeat. Edit it in Settings → coordinator timer, or ask your coordinator to.',
    '',
    ...items.map((x) => `- ${x}`),
    '',
    '## Goals',
    '',
    '- (this place’s goals, for the coordinator to keep in mind)',
    '',
  ].join('\n')
}

interface Beat {
  /** the last heartbeat, or when it went on coordinator timer: the next is the time rule's first after it */
  last?: number
  /** news its event rules let wait for the next heartbeat, oldest first */
  held?: string[]
}

/** the most of HEARTBEAT.md one wake carries into the chat */
const WAKE_CHARS = 4000

export class Heartbeats {
  private s: Record<string, Beat> = readJson('heartbeats.json', {})

  private save() {
    writeJson('heartbeats.json', this.s)
  }

  private of(place: string) {
    return (this.s[place] ??= {})
  }

  /** its HEARTBEAT.md: the first checklist for its role until there is one (written: `keep`) */
  read(place: string, role: 'space' | 'home' | 'main', keep = false) {
    const f = heartbeatFile(place)
    if (existsSync(f)) return readFileSync(f, 'utf8')
    const first = firstChecklist(role)
    if (keep) this.write(place, first)
    return first
  }

  write(place: string, text: string) {
    const f = heartbeatFile(place)
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, text.endsWith('\n') || !text ? text : `${text}\n`)
  }

  last(place: string) {
    return this.s[place]?.last
  }

  /** Coordinator timer went on: the first heartbeat is the time rule's first from now. Off: forgotten */
  switched(place: string, on: boolean, now = Date.now()) {
    if (on) this.of(place).last = now
    else delete this.s[place]
    this.save()
  }

  /** the next heartbeat by its time rule (in a zone), or nothing (no time rule, or it is over) */
  next(place: string, rule: string, zone: string, now = Date.now()) {
    return nextRun(rule, zone, this.s[place]?.last ?? now)
  }

  /** is a heartbeat due: its time rule's first run after the last has come. One first seen starts counting now. Whether the coordinator is idle is the caller's to say. */
  due(place: string, rule: string, zone: string, now = Date.now()) {
    const b = this.of(place)
    if (!b.last) {
      b.last = now
      this.save()
      return false
    }
    const at = nextRun(rule, zone, b.last)
    return at !== undefined && at <= now
  }

  /** news no longer waits for a heartbeat: machine news never wakes an AI, and a heartbeat is its checklist only
   *  (quiet.ts). Kept so the callers stay as they were. */
  hold(_place: string, _line: string) {}

  held(place: string) {
    return this.s[place]?.held ?? []
  }

  /** the heartbeat prompt, with the news that waited; it counts as given. None when its checklist is empty and no news
   *  waits: the rule starts again. */
  beat(place: string, role: 'space' | 'home' | 'main', now = Date.now()): string | undefined {
    // on disk from now on, as the human and the coordinator see and edit it
    const list = this.read(place, role, true).trim()
    const b = this.of(place)
    b.last = now
    delete b.held
    this.save()
    return list
      ? heartbeatPrompt(
          list.length > WAKE_CHARS
            ? `${list.slice(0, WAKE_CHARS)}\n[cut: HEARTBEAT.md is ${list.length} characters; only the first ${WAKE_CHARS} are read. Shorten it with lineclear heartbeat set.]`
            : list,
        )
      : undefined
  }
}

/** the fixed heartbeat prompt, with the checklist itself in it: the coordinator may run on another machine than the
 *  file */
function heartbeatPrompt(list: string, held: string[] = []) {
  return [
    list
      ? `Heartbeat. Go through your HEARTBEAT.md: act on what needs it, by your coordinator timer rules and any limits it sets. Don't redo or repeat old work from earlier in this chat. To change it: lineclear heartbeat set.\n\nYour HEARTBEAT.md:\n${list}`
      : 'Heartbeat. Your HEARTBEAT.md is empty: only the news below.',
    ...(held.length
      ? [`News since the last heartbeat, which your trigger let wait (act on it by your coordinator timer rules):\n${held.map((x) => `- ${x}`).join('\n')}`]
      : []),
    'If nothing needs you, reply with only <no-reply>heartbeat: nothing to do</no-reply>.',
  ].join('\n\n')
}
