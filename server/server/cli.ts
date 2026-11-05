// The shepherdr command: sends its words to the Shepherdr server on this machine and prints the answer.
// Inside an agent's terminal, LINECLEAR_CHAT says which agent is asking.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_PORT, HOME, readJson } from './store.ts'

/** values shorter than this aren't masked: they would garble everything else */
const MASKED_MIN = 4
const MASK = '********'

const capability = process.env.LINECLEAR_SECRET_CAPABILITY
delete process.env.LINECLEAR_SECRET_CAPABILITY
const all = process.argv.slice(2)
// Where the server is: the address in LINECLEAR_URL, else the port in LINECLEAR_PORT or server.json (the server runs
// here), else the helper's socket (a machine whose server runs elsewhere keeps a tunnel to it there), else the default port
const port = process.env.LINECLEAR_PORT || readJson<{ port?: number }>('server.json', {}).port
const sock = join(HOME, 'helper', 'main.sock')
const unix = !process.env.LINECLEAR_URL && !port && existsSync(sock) ? sock : undefined
const url = process.env.LINECLEAR_URL || (unix ? 'http://localhost' : `http://127.0.0.1:${port || DEFAULT_PORT}`)
// lineclear secret run NAME … -- <command>: only the names go to Shepherdr; the command runs here, with the values in
// its environment. lineclear secret env writes them to a file here. Neither prints a value
const secret = all[0] === 'secret' ? all[1] : undefined
const cut = all.indexOf('--')
const command = secret === 'run' && cut > 0 ? all.slice(cut + 1) : []
const args = secret === 'run' && cut > 0 ? all.slice(0, cut) : all
if (args[0] === 'card') args[0] = 'ask' // the full command names the chat card `card`: `ask` is its Inbox's
if (secret === 'run' && !command.length) {
  process.stderr.write('Put the command after --: lineclear secret run NAME [NAME …] -- <command> [its words]\n')
  process.exit(1)
}
// the words that take a text on stdin: a secret to keep, a new HEARTBEAT.md (never secret run's: that is its command's)
const stdin =
  (secret === 'set' || secret === 'elevenlabs' || (args[0] === 'heartbeat' && args[1] === 'set')) && !process.stdin.isTTY ? await Bun.stdin.text() : undefined

// lineclear merge waits for its merge to end, merged or stopped with a reason, however long the check line is. A call
// that gets no answer (Shepherdr restarted, or its link dropped) is sent again: it joins the same merge, or says it is
// merged already. Only after MERGE_TOTAL without an answer does it stop, and say so.
const merge = args[0] === 'merge' || (args[0] === 'task' && args[1] === 'merge')
const wait = merge ? Number(process.env.LINECLEAR_MERGE_WAIT ?? 30 * 60_000) : 0
const total = Number(process.env.LINECLEAR_MERGE_TOTAL ?? 3 * 3_600_000)
const startedAt = Date.now()

async function call() {
  const r = await fetch(`${url}/api/cli`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(capability ? { authorization: `Bearer ${capability}` } : {}) },
    body: JSON.stringify({ args, chat: process.env.LINECLEAR_CHAT, cwd: process.cwd(), stdin }),
    signal: wait ? AbortSignal.timeout(wait) : undefined,
    ...(unix ? { unix } : {}),
  } as RequestInit)
  return (await r.json()) as { out: string; code: number; secrets?: Record<string, string> }
}

// a Shepherdr that restarts is waited for this long; one that never comes back is not a merge to wait on
const RESTART_GRACE = 120_000
let down = 0
let j: Awaited<ReturnType<typeof call>>
for (;;) {
  try {
    j = await call()
    // Shepherdr is stopping for an update: the merge is asked again of the one that comes up
    if (merge && j.out.includes('Lineclear is restarting') && Date.now() - startedAt < RESTART_GRACE) {
      await Bun.sleep(Math.min(5000, wait))
      continue
    }
    break
  } catch (e) {
    // a call that waited its time out is sent again at once; one that could not connect, after a pause
    const timedOut = (e as Error).name === 'TimeoutError'
    down = timedOut ? 0 : down || Date.now()
    if (merge && Date.now() - startedAt < total && (!down || Date.now() - down < RESTART_GRACE)) {
      if (!timedOut) await Bun.sleep(Math.min(5000, wait))
      continue
    }
    if (merge) {
      process.stderr.write(noAnswer(Date.now() - startedAt, args[0] === 'merge' ? args[1] : args[2]))
      process.exit(1)
    }
    process.stderr.write(
      `Cannot reach the lineclear command at ${url}. Check the target URL or use this session's installed helper. Do not start another server to repair routing.\n`,
    )
    process.exit(2)
  }
}
if (j.secrets && secret === 'run') process.exit(await run(command, j.secrets))
if (j.secrets && secret === 'env') {
  const f = envFile(args, j.secrets)
  await new Promise<void>((done) => process.stdout.write(f.out, () => done()))
  process.exit(f.code)
}
// a pipe takes its bytes after write returns: exit only once they are out, or a reader gets the first 64 KiB
await new Promise<void>((done) => process.stdout.write(j.out, () => done()))
process.exit(j.code)

/** what to say when lineclear merge heard nothing back for good (the helper's shepherdr says the same) */
function noAnswer(ms: number, id = '<id>') {
  return `lineclear merge ${id} got no answer from Lineclear in ${Math.round(ms / 1000)} s (it may have restarted). Its merge may still finish: lineclear task show ${id} says Merged, or what stopped it.\n`
}

/** lineclear secret run: the command, with the values in its environment; what it prints comes through with each value
 *  masked, as 1Password's op run does, so one a command prints by mistake still lands in no terminal or chat */
async function run(command: string[], secrets: Record<string, string>) {
  let c: Bun.Subprocess<'inherit', 'pipe', 'pipe'>
  try {
    c = Bun.spawn(command, { stdin: 'inherit', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...secrets } })
  } catch (e) {
    process.stderr.write(`Couldn't run ${command[0]}: ${(e as Error).message}\n`)
    return 127
  }
  const values = Object.values(secrets).filter((v) => v.length >= MASKED_MIN)
  await Promise.all([masked(c.stdout, process.stdout, values), masked(c.stderr, process.stderr, values)])
  const code = await c.exited
  return c.signalCode ? 128 + ({ SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 } as Record<string, number>)[c.signalCode] || 1 : code
}

/** a stream as it comes, each value masked; what may be the start of one waits for what follows */
async function masked(from: ReadableStream<Uint8Array>, to: NodeJS.WriteStream, values: string[]) {
  const dec = new TextDecoder()
  const all = [...values].sort((a, b) => b.length - a.length)
  const mask = (s: string) => all.reduce((x, v) => x.split(v).join(MASK), s)
  // how much of the end could begin a value
  const held = (s: string) => {
    for (let k = Math.min((all[0]?.length ?? 1) - 1, s.length); k > 0; k--) if (all.some((v) => v.length > k && s.endsWith(v.slice(0, k)))) return k
    return 0
  }
  const reader = from.getReader()
  let buf = ''
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    buf = mask(buf + dec.decode(r.value, { stream: true }))
    const keep = held(buf)
    to.write(buf.slice(0, buf.length - keep))
    buf = buf.slice(buf.length - keep)
  }
  to.write(mask(buf + dec.decode()))
}

/** lineclear secret env: each NAME=value in the file (--file, .env by default), in place of its old line, the file
 *  readable by you only; refused where git would keep it (the helper's shepherdr does the same) */
function envFile(args: string[], secrets: Record<string, string>) {
  const i = args.findIndex((a) => a === '--file' || a.startsWith('--file='))
  const name = i < 0 ? '.env' : args[i].startsWith('--file=') ? args[i].slice(7) : args[i + 1]
  if (!name) return { out: 'lineclear secret env NAME [NAME …] [--file .env]\n', code: 1 }
  const file = resolve(name)
  const git = (...a: string[]) => spawnSync('git', ['-C', dirname(file), ...a], { stdio: 'ignore' })
  const repo = git('rev-parse', '--is-inside-work-tree')
  if (repo.error) return { out: `git isn't here to check that it ignores ${name}: nothing written.\n`, code: 1 }
  if (repo.status === 0 && git('check-ignore', '-q', file).status !== 0)
    return { out: `${name} is not ignored by git: add it to .gitignore first, so the secret never lands in git.\n`, code: 1 }
  // a link (or a second name of another file) would carry it into that file
  if (existsSync(file) && (lstatSync(file).isSymbolicLink() || lstatSync(file).nlink > 1))
    return { out: `${name} is a link: name a plain file, so the secret lands nowhere else.\n`, code: 1 }
  const names = Object.keys(secrets)
  const old = existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((l, n, a) => !(n === a.length - 1 && !l) && !names.some((k) => new RegExp(`^\\s*(export\\s+)?${k}\\s*=`).test(l)))
    : []
  // readable by you only before a value goes in: a new file from the start, an old one first
  const text = `${[...old, ...names.map((k) => `${k}=${envValue(secrets[k])}`)].join('\n')}\n`
  if (existsSync(file)) {
    chmodSync(file, 0o600)
    writeFileSync(file, text)
  } else writeFileSync(file, text, { mode: 0o600, flag: 'wx' })
  return { out: `Wrote ${names.join(', ')} to ${name} (readable by you only; git ignores it). Never print or commit it.\n`, code: 0 }
}

/** a value as a .env file holds it: as it is, in single quotes (nothing in it is read), or in double quotes */
function envValue(v: string) {
  if (/^[\w@%+:,./-]*$/.test(v)) return v
  if (!/['\n\r]/.test(v)) return `'${v}'`
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`
}
