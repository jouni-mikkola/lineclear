import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { herdr, type AgentInfo, type AgentStatus, type HerdrError } from './herdr.ts'
import { claudeHome, claudeLogPath } from './readers/find.ts'
import type { Said } from './readers/hooks.ts'
import * as task from './mfs.ts'
import { q, runSync } from './box.ts'
import type { AgentRecord, Hold } from './agents-helpers.ts'

export async function isolatedReady(
  kind: string,
  inspect: () => Promise<Pick<AgentInfo, 'agent' | 'interactive_ready'> | undefined>,
  pause = () => new Promise<void>((resolve) => setTimeout(resolve, 500)),
  attempts = 120,
) {
  for (let i = 0; i < attempts; i++) {
    const info = await inspect()
    if (info?.agent === kind && info.interactive_ready === true) return
    await pause()
  }
  throw new Error(`${kind} did not become ready inside its isolation. Coordinator timer was not started.`)
}

/** Herdr starts a canonical command in the pane's shell. A login profile may have
 * replaced its PATH or aliased that command: use a clean non-login sh and verify
 * its actual process environment BEFORE asking Herdr to start any agent. */
export const isolatedShellCommand = (wrapper: string) =>
  `exec /usr/bin/env PATH=${q(`${dirname(wrapper)}:/usr/local/bin:/usr/bin:/bin`)} ENV=/dev/null /bin/sh -i`
export async function isolatedShell(
  pane: string,
  wrapper: string,
  io = {
    idle: herdr.paneIdle,
    text: herdr.paneText,
    keys: herdr.paneKeys,
    info: herdr.processInfo,
    read: (file: string) => readFileSync(file, 'utf8'),
    pause: () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
  },
) {
  const path = `${dirname(wrapper)}:/usr/local/bin:/usr/bin:/bin`
  let idle = false
  for (let i = 0; i < 100; i++) {
    if (await io.idle(pane)) {
      idle = true
      break
    }
    await io.pause()
  }
  if (!idle) throw new Error('The isolated launch shell did not become ready. No agent was started.')
  await io.text(pane, isolatedShellCommand(wrapper))
  await io.keys(pane, ['enter'])
  for (let i = 0; i < 100; i++) {
    const pid = (await io.info(pane)).shell_pid
    try {
      const argv = io.read(`/proc/${pid}/cmdline`).split('\0').filter(Boolean)
      const env = io.read(`/proc/${pid}/environ`).split('\0')
      if (argv.length === 2 && argv[0] === '/bin/sh' && argv[1] === '-i' && env.includes(`PATH=${path}`) && env.includes('ENV=/dev/null')) return
    } catch {
      /* shell is replacing itself */
    }
    await io.pause()
  }
  throw new Error('Could not verify the clean isolated launch shell. No agent was started.')
}

/** a Claude Code session, copied into the project folder of the cwd it resumes in (Claude Code looks for it only
 *  there) from wherever it was written on that machine; its log path, or nothing when there is none */
export function carryClaudeSession(id: string, cwd: string): string | undefined {
  const to = claudeLogPath(cwd, id)
  const sh = `[ -e "$1" ] && exit 0; src=$(ls -t "$2"/*/"$3.jsonl" 2>/dev/null | head -n 1); [ -n "$src" ] || exit 1; mkdir -p "$(dirname "$1")" && cp "$src" "$1"`
  return runSync(['/bin/sh', '-c', sh, 'carry', task.unmirrored(to), task.unmirrored(join(claudeHome(), 'projects')), id]).code === 0 ? to : undefined
}

/**
 * The one place an agent's status is decided. What the agent reports of itself wins: its CLI's own hooks today (Claude
 * Code, readers/hooks.ts), OSC 7501's program status once herdr passes that on (then only `said` changes). herdr's
 * reading of its screen counts where the agent reports nothing (Codex, pi, one started before hooks), and for a menu
 * up between turns that no hook tells of (a rate-limit or login menu), where typed text could pick an option.
 */
export function statusFrom(said: Said | undefined, seen: AgentStatus | 'gone'): AgentStatus | 'gone' {
  if (seen === 'gone' || !said) return seen
  if (said.helper) return 'blocked'
  if (said.state !== 'idle') return said.state
  return seen === 'done' || seen === 'blocked' ? seen : 'idle'
}

/** what a refusal from herdr means for what you send: a menu is up, or the agent just started and herdr doesn't count
 *  it as its named agent yet ("agent shep-all is not an active named agent"); anything else, it can't go in */
export function holdFrom(e: unknown): Hold | undefined {
  const code = (e as HerdrError).code
  if (code === 'agent_blocked') return 'menu'
  if (code === 'agent_not_found' || code === 'agent_not_ready' || code === 'agent_not_running') return 'start'
  if (/not an active named agent/.test((e as Error)?.message ?? '')) return 'start'
  return undefined
}

/**
 * Whether a restart may resume the agent's session. Claude Code stops with "No conversation found with session ID" when
 * `--resume` names a session it has no log for (the agent never got a turn in, or the log was cleared), and what was
 * queued for it is never read. Such an agent starts a session of its own instead; the others resume as before.
 */
export function canResume(old: Pick<AgentRecord, 'kind' | 'cwd' | 'sessionId' | 'logs' | 'isolation'>, cwd: string): boolean {
  if (old.kind !== 'claude' || old.isolation) return !!(old.sessionId || old.logs.length)
  const id = old.sessionId
  return !!id && ([old.cwd, cwd].some((d) => existsSync(claudeLogPath(d, id))) || carryClaudeSession(id, cwd) !== undefined)
}
