// The adapter's other half: herdr's own forwarding to a machine saved in herdr, and this machine's room.
// A call is the same call with `--machine <label-or-id>`; Lineclear keeps no script for it.
import { readFileSync } from 'node:fs'
import { availableParallelism, freemem, loadavg, totalmem } from 'node:os'
import type { Room } from '../../shared/types.ts'
import { adapter, type Call, HerdrError, rpc } from './herdr.ts'

/** the same call on a machine saved in herdr: `herdr --machine <label-or-id> <command>`, herdr's own forwarding over its
 *  saved SSH connection. A method the command line has no command for (ping) is refused */
function forwarded(machine: string): Call {
  return async <T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000) => {
    // the command line has no snapshot: its agents are the agent list
    if (method === 'session.snapshot') return { snapshot: await forwarded(machine)<{ agents: unknown[] }>('agent.list') } as T
    const args = forwardArgs(method, params)
    if (!args) throw new HerdrError('unsupported', `herdr has no command for ${method}`)
    const p = Bun.spawn(['herdr', '--machine', machine, ...args], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    })
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    if (method === 'pane.read' && code === 0) return { read: { text: out } } as T // the command prints the text itself
    let frame: { result?: T; error?: { code: string; message: string } } = {}
    try {
      frame = JSON.parse(out.trim() || err) // herdr prints an error on stderr
    } catch {
      /* no JSON: the command failed before herdr answered */
    }
    if (frame.error) throw new HerdrError(frame.error.code, frame.error.message)
    if (code === 0 && !out.trim()) return {} as T // the typing commands print nothing when they worked
    if (code !== 0 || !('result' in frame)) throw new HerdrError('unreachable', `herdr could not reach ${machine} for ${method}`)
    return frame.result as T
  }
}

/** a method's parameters as the arguments of its herdr command; undefined when there is no such command */
export function forwardArgs(method: string, p: Record<string, unknown>): string[] | undefined {
  const s = (k: string) => String(p[k])
  const flag = (name: string, k: string) => (p[k] === undefined || p[k] === null ? [] : [`--${name}`, String(p[k])])
  const focus = p.focus === true ? ['--focus'] : ['--no-focus']
  const env = Object.entries((p.env as Record<string, string> | undefined) ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`])
  const from = [...flag('workspace', 'workspace_id'), ...flag('cwd', 'cwd')]
  const rest = (p.args as string[] | undefined) ?? []
  switch (method) {
    case 'agent.list':
      return ['agent', 'list']
    case 'agent.get':
      return ['agent', 'get', s('target')]
    case 'agent.start':
      return [
        'agent',
        'start',
        s('name'),
        '--kind',
        s('kind'),
        '--pane',
        s('pane_id'),
        ...flag('timeout', 'timeout_ms'),
        ...(rest.length ? ['--', ...rest] : []),
      ]
    case 'agent.rename':
      return ['agent', 'rename', s('target'), s('name')]
    case 'agent.prompt':
      return ['agent', 'prompt', s('target'), s('text')]
    case 'agent.send_keys':
      return ['agent', 'send-keys', s('target'), ...(p.keys as string[])]
    case 'workspace.list':
      return ['workspace', 'list']
    case 'workspace.create':
      return ['workspace', 'create', ...flag('label', 'label'), ...flag('cwd', 'cwd'), ...env, ...focus]
    case 'workspace.rename':
      return ['workspace', 'rename', s('workspace_id'), s('label')]
    case 'workspace.close':
      return ['workspace', 'close', s('workspace_id')]
    case 'tab.create':
      return ['tab', 'create', ...flag('workspace', 'workspace_id'), ...flag('label', 'label'), ...flag('cwd', 'cwd'), ...env, ...focus]
    case 'tab.list':
      return ['tab', 'list', ...flag('workspace', 'workspace_id')]
    case 'pane.list':
      return ['pane', 'list', ...flag('workspace', 'workspace_id')]
    case 'pane.close':
      return ['pane', 'close', s('pane_id')]
    case 'pane.send_keys':
      return ['pane', 'send-keys', s('pane_id'), ...(p.keys as string[])]
    case 'pane.send_text':
      return ['pane', 'send-text', s('pane_id'), s('text')]
    case 'pane.layout':
      return ['pane', 'layout', ...flag('pane', 'pane_id')]
    case 'pane.process_info':
      return ['pane', 'process-info', ...flag('pane', 'pane_id')]
    case 'pane.read':
      return ['pane', 'read', s('pane_id'), ...flag('source', 'source'), ...flag('format', 'format'), ...flag('lines', 'lines')]
    case 'worktree.create':
      return ['worktree', 'create', ...from, ...flag('branch', 'branch'), ...flag('base', 'base'), ...flag('path', 'path'), ...flag('label', 'label'), ...focus]
    case 'worktree.open':
      return ['worktree', 'open', ...from, ...flag('path', 'path'), ...flag('label', 'label'), ...focus]
    case 'worktree.remove':
      return ['worktree', 'remove', ...flag('workspace', 'workspace_id'), ...(p.force === true ? ['--force'] : [])]
    case 'notification.show':
      return ['notification', 'show', s('title'), ...flag('body', 'body')]
    default:
      return undefined
  }
}

/** the room from a load, the text of /proc/meminfo and a core count */
export function parseRoom(load: number, meminfo: string, cores: number): Room | undefined {
  const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(meminfo)?.[1])
  const [freeKb, totalKb] = [kb('MemAvailable'), kb('MemTotal')]
  return Number.isNaN(load + freeKb + totalKb + cores) ? undefined : { load, cores, freeKb, totalKb }
}

/** this machine's room, for its snapshot: /proc on Linux, the os module's counts elsewhere (macOS has no /proc) */
export function room(platform: string = process.platform): Room | undefined {
  try {
    if (platform === 'linux') return parseRoom(loadavg()[0], readFileSync('/proc/meminfo', 'utf8'), availableParallelism())
    return { load: loadavg()[0], cores: availableParallelism(), freeKb: Math.round(freemem() / 1024), totalKb: Math.round(totalmem() / 1024) }
  } catch {
    return undefined
  }
}

/** every call of the adapter, here (the socket) or on a machine saved in herdr (its forwarding) */
export const herdrOn = (machine?: string) => adapter(machine ? forwarded(machine) : rpc)
