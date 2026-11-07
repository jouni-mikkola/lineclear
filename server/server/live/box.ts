// Another machine, reached over SSH. Lineclear is installed once, on the main machine; every other machine saved in
// herdr's Remote (herdr machine list) is run from it by a worker process of its own (machines.ts), with LINECLEAR_BOX
// naming the machine. In that worker, everything that touches the machine goes through here: herdr's API rides herdr's
// own remote bridge (herdr.ts), commands (git, gh) and file reads run over one shared SSH connection
// (a ControlMaster), and the CLIs' logs are mirrored to the main machine as they grow (mirror.ts). The machine itself
// needs only herdr, git, perl and the agent CLIs, plus the small helper Lineclear puts there (helper/, install.ts).
import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { quote, sshArgs } from '../../../src/ssh.ts'
import { secretFileId } from './secret-paths.ts'
import { DEFAULT_PORT, readJson } from '../store.ts'
import type { Machines } from './machines.ts'

export interface BoxInfo {
  /** herdr's label for it: the machine's name in Lineclear */
  label: string
  /** the SSH target herdr reaches it by (a host, user@host, an ~/.ssh/config alias) */
  target: string
  /** its herdr session */
  session: string
  /** herdr's path there */
  herdr: string
  /** its home folder */
  home: string
  /** its login PATH, with the helper's bin first */
  path: string
  /** uname -s: Linux, Darwin */
  os: string
  /** a machine reached without SSH, by its own herdr socket (a second herdr session standing for it): its commands run here */
  socket?: string
}

/** the machine this worker runs, or nothing: this is the main machine's own process */
export const BOX: BoxInfo | null = process.env.LINECLEAR_BOX ? (JSON.parse(process.env.LINECLEAR_BOX) as BoxInfo) : null

const machine = new AsyncLocalStorage<BoxInfo | null>()

/** Runs `fn` for a task's machine: every command, file read and herdr call in it goes to that machine (null: the server's own). */
export const onMachine = <T>(info: BoxInfo | null, fn: () => T): T => machine.run(info, fn)

/** the machine the code runs for now: the one `onMachine` named, else this process's own box */
export const box = (): BoxInfo | null => {
  const m = machine.getStore()
  return m === undefined ? BOX : m
}

/** the box when it is reached over SSH; a box with a herdr socket of its own is local */
export const remoteBox = (): BoxInfo | null => {
  const b = box()
  return remote(b) ? b : null
}

/** whether the box is reached over SSH (a box with a herdr socket of its own is local) */
const remote = (b: BoxInfo | null): b is BoxInfo => !!b && !b.socket

/** the helper's folder on a machine: its lineclear command, hooks, inbox, skills (helper/, install.ts) */
export const helperDir = (home: string) => join(home, '.lineclear', 'helper')

/** the home folder of the machine this process works on */
export const boxHome = () => box()?.home ?? homedir()

/** where the SSH connections keep their shared master: short, a socket path has a length limit */
const control = () => {
  const dir = join(process.env.LINECLEAR_MAIN_HOME ?? join(homedir(), '.lineclear'), 'ssh')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return join(dir, '%C')
}

/** ssh to a target with the shared connection (ssh.ts) */
export const sshTo = (target: string, script: string, opts: { tty?: boolean; extra?: string[] } = {}) =>
  sshArgs(process.env, target, script, { ...opts, control: control() })

/** a command line on the box: its PATH (the helper's bin first), in cwd, with env */
function script(b: BoxInfo, argv: string[], o: { cwd?: string; env?: Record<string, string> } = {}) {
  const env = Object.entries({ PATH: b.path, ...o.env })
    .map(([k, v]) => `${k}=${quote(v)}`)
    .join(' ')
  return `${o.cwd ? `cd ${quote(o.cwd)} || exit 1; ` : ''}export ${env}; exec ${argv.map(quote).join(' ')}`
}

export interface Ran {
  code: number
  out: string
  err: string
}

export interface RunOpts {
  cwd?: string
  env?: Record<string, string>
  stdin?: string | Uint8Array
  timeoutMs?: number
}

/** run a command on the box (or here, when there is no box) */
export function run(argv: string[], o: RunOpts = {}): Promise<Ran> {
  const b = box()
  const ssh = remote(b) ? b : null
  return spawnRan(ssh ? sshTo(ssh.target, script(ssh, argv, o)) : argv, { ...o, local: !ssh })
}

/** a command line run to its end: its output, or code 124 when `timeoutMs` passed first */
async function spawnRan(
  cmd: string[],
  o: { cwd?: string; env?: Record<string, string>; stdin?: string | Uint8Array; timeoutMs?: number; local?: boolean },
): Promise<Ran> {
  const p = Bun.spawn(cmd, {
    cwd: o.local ? o.cwd : undefined,
    stdin: o.stdin === undefined ? 'ignore' : Buffer.from(o.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
    env: o.local ? { ...process.env, ...o.env } : process.env,
  })
  let timedOut = false
  const t = o.timeoutMs ? setTimeout(() => ((timedOut = true), p.kill()), o.timeoutMs) : null
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (t) clearTimeout(t)
  return { code: timedOut ? 124 : code, out, err: timedOut ? `${err}\ntimed out` : err }
}

/** the stable build's bin: an agent of any project, the Lineclear repo's included, runs this `lineclear`, never its own checkout's */
const stableBin = (data: string) => (existsSync(join(data, 'builds', 'current', 'bin', 'lineclear')) ? join(data, 'builds', 'current', 'bin') : '')

/** who an agent is to the lineclear command, and where that command is: here Lineclear's own bin and server; on
 *  another machine the helper's bin first on its own PATH (its command finds the way back by itself) */
export function agentEnv(chat: string, root: string, data = process.env.LINECLEAR_MAIN_HOME ?? join(homedir(), '.lineclear')): Record<string, string> {
  const b = box()
  const credential = { LINECLEAR_SECRET_FILE: join(helperDir(b?.home ?? homedir()), 'credentials', secretFileId(chat)) }
  if (remote(b))
    return {
      ...credential,
      LINECLEAR_CHAT: chat,
      LINECLEAR_URL: '',
      LINECLEAR_COMMAND: join(helperDir(b.home), 'bin', 'lineclear'),
      LINECLEAR_MACHINE: b.label,
      PATH: b.path,
    }
  // The listening live server owns these agents, never an inherited CLI target (which may be a demo).
  return {
    ...credential,
    LINECLEAR_CHAT: chat,
    LINECLEAR_COMMAND: join(root, 'bin', 'lineclear'),
    LINECLEAR_URL: `http://127.0.0.1:${readJson<{ port?: number }>('server.json', {}).port ?? process.env.LINECLEAR_PORT ?? DEFAULT_PORT}`,
    PATH: [join(root, 'bin'), stableBin(data), process.env.PATH ?? ''].filter(Boolean).join(':'),
  }
}

// Tasks that another machine's worker runs: a command on the main machine goes to that worker, and the machine itself
// says who runs its tasks when its own list is empty.

/** the file in a worker machine's data folder naming the machine that runs its tasks (JSON string) */
export const RUN_BY = 'run-by'

/** "desktop:OMA-91" or "OMA-91@desktop" names a task on one machine; a bare id names none. This machine's own name drops out. */
export function machineRef(ref: string): { machine?: string; id: string } {
  const at = ref.lastIndexOf('@')
  const colon = ref.indexOf(':')
  const [machine, id] = colon > 0 ? [ref.slice(0, colon), ref.slice(colon + 1)] : at > 0 ? [ref.slice(at + 1), ref.slice(0, at)] : [undefined, ref]
  // a title or a sentence is no reference: only a task id after the machine counts
  if (!machine || !/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(id)) return { id: ref }
  return machine.toLowerCase() !== (process.env.LINECLEAR_MACHINE ?? hostname()).split('.')[0]?.toLowerCase() ? { machine, id } : { id }
}

/** `task show|tell|close|merge|delete <id>` for a task a worker runs: its answer, or undefined when no worker has it. `machine` (from "machine:id") picks the worker, and rest[0] is the bare id. */
export async function forwardTask(
  peers: Machines | null,
  sub: string | undefined,
  rest: string[],
  opts: Record<string, string[]>,
  flags: Set<string>,
  chat?: string,
  machine?: string,
): Promise<string | undefined> {
  const named = machine ? peers?.byName(machine) : undefined
  if (machine && !named) throw new Error(`No machine called ${machine}.`)
  const l = named ?? (sub && rest[0] ? peers?.owner(rest[0]) : undefined)
  if (!peers || !l || !sub) return undefined
  const args = ['task', sub, ...rest, ...Object.entries(opts).flatMap(([k, vs]) => vs.flatMap((v) => [`--${k}`, v])), ...[...flags].map((k) => `--${k}`)]
  return runOn(peers, l, args, chat)
}

/** a command line run on another machine's worker: its answer, or its refusal as an error */
export async function runOn(peers: Machines, l: NonNullable<ReturnType<Machines['owner']>>, args: string[], chat?: string): Promise<string> {
  const r = await peers.fetch(l, '/api/cli', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args, chat }),
    signal: AbortSignal.timeout(20_000),
  })
  const b = (await r.json().catch(() => ({}))) as { out?: string; code?: number; error?: string }
  if (!r.ok) throw new Error(b.error ?? `${l.rec.machine} said ${r.status}`)
  if (b.code) throw new Error((b.out ?? '').trim())
  return (b.out ?? '').trim()
}

/** what an empty task list says */
export function noTasks(): string {
  const by = readJson<string>(RUN_BY, '')
  return by ? `No tasks here: this machine's tasks are run by ${by}. Run "lineclear task list" there.` : 'No tasks.'
}
