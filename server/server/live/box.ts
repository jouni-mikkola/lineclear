// Another machine, reached over SSH. Shepherdr is installed once, on the main machine; every other machine saved in
// herdr's Remote (herdr machine list) is run from it by a worker process of its own (machines.ts), with LINECLEAR_BOX
// naming the machine. In that worker, everything that touches the machine goes through here: herdr's API rides herdr's
// own remote bridge (herdr.ts), commands (git, gh, agent-browser) and file reads run over one shared SSH connection
// (a ControlMaster), and the CLIs' logs are mirrored to the main machine as they grow (mirror.ts). The machine itself
// needs only herdr, git, perl and the agent CLIs, plus the small helper Shepherdr puts there (helper/, install.ts).
import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { secretFileId } from './secret-paths.ts'
import { DEFAULT_PORT, readJson } from '../store.ts'
import type { Machines } from './machines.ts'

export interface BoxInfo {
  /** herdr's label for it: the machine's name in Shepherdr */
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

/** the helper's folder on a machine: its shepherdr command, hooks, inbox, skills (helper/, install.ts) */
export const helperDir = (home: string) => join(home, '.lineclear', 'helper')

/** the home folder of the machine this process works on */
export const boxHome = () => box()?.home ?? homedir()

/** where the SSH connections keep their shared master: short, a socket path has a length limit */
const control = () => {
  const dir = join(process.env.LINECLEAR_MAIN_HOME ?? join(homedir(), '.lineclear'), 'ssh')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return join(dir, '%C')
}

/** what holds an SSH connection open (a tunnel, a forward): it ends with the connection, where a plain sleep would
 *  stay on the machine for good, one more on every restart. A byte written now and then fails once the connection is
 *  gone; watching $PPID can't tell, since exe.dev's sshd hands sessions to a root init that never ends */
const HOLD = 'while printf . 2>/dev/null; do sleep 30; done'

/** single-quoted for a POSIX shell */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** ssh to a target with the shared connection; the remote command runs under /bin/sh, whatever the login shell is */
export function sshArgs(target: string, script: string, opts: { tty?: boolean; extra?: string[] } = {}): string[] {
  return [
    'ssh',
    // first: ssh keeps the first value it is given
    ...(opts.extra ?? []),
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=4',
    '-o',
    'ControlMaster=auto',
    '-o',
    'ControlPersist=600',
    '-o',
    `ControlPath=${control()}`,
    opts.tty ? '-tt' : '-T',
    target,
    `/bin/sh -c ${q(script)}`,
  ]
}

/** a command line on the box: its PATH (the helper's bin first), in cwd, with env */
export function script(b: BoxInfo, argv: string[], o: { cwd?: string; env?: Record<string, string> } = {}) {
  const env = Object.entries({ PATH: b.path, ...o.env })
    .map(([k, v]) => `${k}=${q(v)}`)
    .join(' ')
  return `${o.cwd ? `cd ${q(o.cwd)} || exit 1; ` : ''}export ${env}; exec ${argv.map(q).join(' ')}`
}

export interface Ran {
  code: number
  out: string
  err: string
}

/** git reads that change nothing: the tick's many askers share one ssh call to the box for them */
const GIT_READS = new Set([
  'rev-parse',
  'symbolic-ref',
  'status',
  'log',
  'diff',
  'show-ref',
  'cat-file',
  'merge-base',
  'rev-list',
  'for-each-ref',
  'ls-files',
  'ls-tree',
  'show',
  'merge-tree',
])
export const GIT_READ_SHARE_MS = 2000
const GIT_READ_FORMS: Record<string, (args: string[]) => boolean> = {
  worktree: (a) => a[0] === 'list',
  remote: (a) => a[0] === 'get-url',
  config: (a) => a[0]?.startsWith('--get') === true || a[0] === '--name-only',
  branch: (a) => a[0] === '--show-current',
}
export const isGitRead = (cmd: string[]) => cmd[0] === 'git' && (GIT_READS.has(cmd[1] ?? '') || (GIT_READ_FORMS[cmd[1] ?? '']?.(cmd.slice(2)) ?? false))

const shared = new Map<string, { gen: number; at: number; ran: Promise<Ran> }>()
/** counts every other command's start and end: a shared read is only good while this has not moved since it began */
let writes = 0

/** A read many callers ask for at once costs one ssh call per `shareMs`: the same command and folder get the same answer. */
function runShared(argv: string[], o: RunOpts, shareMs: number): Promise<Ran> {
  const key = JSON.stringify([argv, o.cwd, o.env, o.timeoutMs])
  const now = Date.now()
  const hit = shared.get(key)
  if (hit && hit.gen === writes && now - hit.at < shareMs) return hit.ran
  for (const [k, v] of shared) if (now - v.at >= shareMs) shared.delete(k)
  const entry = { gen: writes, at: now, ran: runNow(argv, o) }
  shared.set(key, entry)
  return entry.ran
}

export interface RunOpts {
  cwd?: string
  env?: Record<string, string>
  stdin?: string | Uint8Array
  timeoutMs?: number
  /** a read-only command whose answer may be shared for this many ms (only on a box, where each call is an ssh round trip) */
  shareMs?: number
}

/** run a command on the box (or here, when there is no box) */
export function run(argv: string[], o: RunOpts = {}): Promise<Ran> {
  if (remote(box()) && o.shareMs && o.stdin === undefined) return runShared(argv, o, o.shareMs)
  // a git command that may write changes what a shared read sees, when it starts and when it ends
  if (argv[0] !== 'git' || isGitRead(argv)) return runNow(argv, o)
  writes++
  return runNow(argv, o).finally(() => writes++)
}

async function runNow(argv: string[], o: RunOpts): Promise<Ran> {
  const b = box()
  const ssh = remote(b) ? b : null
  const cmd = ssh ? sshArgs(ssh.target, script(ssh, argv, o)) : argv
  const p = Bun.spawn(cmd, {
    cwd: ssh ? undefined : o.cwd,
    stdin: o.stdin === undefined ? 'ignore' : Buffer.from(o.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
    env: ssh ? process.env : { ...process.env, ...o.env },
  })
  let timedOut = false
  const t = o.timeoutMs ? setTimeout(() => ((timedOut = true), p.kill()), o.timeoutMs) : null
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (t) clearTimeout(t)
  return { code: timedOut ? 124 : code, out, err: timedOut ? `${err}\ntimed out` : err }
}

/** the same, waiting for it: only for the few reads that code expects at once (a file's text, whether it is there) */
export function runSync(
  argv: string[],
  o: { cwd?: string; env?: Record<string, string>; stdin?: string | Uint8Array; timeoutMs?: number } = {},
): { code: number; out: Buffer; err: string } {
  const b = box()
  const ssh = remote(b) ? b : null
  const cmd = ssh ? sshArgs(ssh.target, script(ssh, argv, o)) : argv
  const r = Bun.spawnSync(cmd, {
    cwd: ssh ? undefined : o.cwd,
    stdin: o.stdin === undefined ? 'ignore' : Buffer.from(o.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: o.timeoutMs ?? 30_000,
    env: ssh ? process.env : { ...process.env, ...o.env },
  })
  return { code: r.exitCode ?? 1, out: r.stdout ?? Buffer.alloc(0), err: r.stderr?.toString() ?? '' }
}

/** a long-running command on the box (a log mirror, a tunnel): its process */
export function spawnOn(b: BoxInfo, argv: string[], o: { extra?: string[]; stdin?: 'pipe' | 'ignore' } = {}) {
  return Bun.spawn(sshArgs(b.target, script(b, argv), { extra: o.extra }), { stdin: o.stdin ?? 'ignore', stdout: 'pipe', stderr: 'pipe' })
}

/** the stable build's bin: an agent of any project, the Lineclear repo's included, runs this `lineclear`, never its own checkout's */
const stableBin = (data: string) => (existsSync(join(data, 'builds', 'current', 'bin', 'lineclear')) ? join(data, 'builds', 'current', 'bin') : '')

/** who an agent is to the shepherdr command, and where that command is: here Shepherdr's own bin and server; on
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

/** a port on the box, reached here: a local port forwarded over SSH to its 127.0.0.1 (a browser's stream, its
 *  DevTools). Kept while it is used; close() ends it */
export async function forward(b: BoxInfo, port: number): Promise<{ port: number; close(): void }> {
  const free = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
  const local = free.port
  free.stop(true)
  const p = Bun.spawn(
    sshArgs(b.target, HOLD, { extra: ['-o', 'ControlPath=none', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${local}:127.0.0.1:${port}`] }),
    { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
  )
  // ready once the port answers
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise<boolean>((res) => {
      Bun.connect({
        hostname: '127.0.0.1',
        port: local,
        socket: { open: (s) => (s.end(), res(true)), error: () => res(false), connectError: () => res(false), data() {} },
      }).catch(() => res(false))
    })
    if (ok) break
    if (p.exitCode !== null) throw new Error(`Could not reach port ${port} on ${b.label}`)
    await Bun.sleep(100)
  }
  return { port: local, close: () => p.kill() }
}

// Tasks that another machine's worker runs: a command on the main machine goes to that worker, and the machine itself
// says who runs its tasks when its own list is empty.

/** the file in a worker machine's data folder naming the machine that runs its tasks (JSON string) */
const RUN_BY = 'run-by'

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

/** tells a machine that this one runs its tasks, so its own task list and doctor can say so */
export function tellRunBy(target: string): void {
  const me = (process.env.LINECLEAR_MACHINE ?? hostname()).split('.')[0]
  Bun.spawn(sshArgs(target, `printf '"%s"' ${q(me ?? '')} > "$HOME/.lineclear/${RUN_BY}"`), { stdout: 'ignore', stderr: 'ignore' })
}
