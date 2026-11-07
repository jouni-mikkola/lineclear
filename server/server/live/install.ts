// Putting Lineclear's small helper on another machine, and checking that machine (lineclear doctor). Runs on the main
// machine. A machine saved in herdr's Remote needs only herdr, git, perl and the agent CLIs: Lineclear copies the rest
// over SSH into ~/.lineclear/helper there, and again whenever Lineclear's own copy of it changed (an update):
//   bin/lineclear        the lineclear command for agents there: it talks to Lineclear through an SSH tunnel
//   skill/               Lineclear's skills, which agents there read
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, relative } from 'node:path'
import { ROOT } from '../root.ts'
import { quote } from '../../../src/ssh.ts'
import { helperDir, RUN_BY, sshTo, type BoxInfo } from './box.ts'
import { herdrCli } from './herdr.ts'

/** a machine as herdr saved it (herdr machine list --json) */
export interface Saved {
  id: string
  label: string
  target: string
  session: string
  enabled: boolean
}

async function herdrJson<T, F>(args: string[], fallback: F): Promise<T | F> {
  try {
    return JSON.parse((await herdrCli(args))?.out ?? '') as T
  } catch {
    return fallback
  }
}

/** every machine saved in herdr's Remote that is turned on; null when herdr could not be read (not an empty list) */
export const savedMachines = async () =>
  (await herdrJson<Saved[], null>(['machine', 'list', '--json'], null))?.filter((m) => m.enabled !== false && m.label) ?? null

/** whether herdr reaches each: "reachable", or what is wrong */
export const machineStatus = async () =>
  Object.fromEntries(
    (await herdrJson<{ label: string; status: string; error: string | null }[], never[]>(['machine', 'status', '--json'], [])).map((m) => [m.label, m]),
  )

/** a command on a machine over the shared SSH connection, before a worker for it runs */
async function onMachine(target: string, script: string, o: { stdin?: Uint8Array | string; timeoutMs?: number } = {}) {
  const p = Bun.spawn(sshTo(target, script), { stdin: o.stdin === undefined ? 'ignore' : Buffer.from(o.stdin), stdout: 'pipe', stderr: 'pipe' })
  const t = setTimeout(() => p.kill(), o.timeoutMs ?? 60_000)
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  clearTimeout(t)
  return { code, out, err: err.trim() }
}

/** what a machine has: where things are, and which tools it lacks */
export interface Probe {
  home: string
  os: string
  arch: string
  path: string
  herdr: string
  tools: Record<string, boolean>
  helper: string
}

/** the probe, a script that runs on the machine and prints one JSON object */
export const PROBE = `
js() { printf '"%s"' "$(printf %s "$1" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g')"; }
lp=$("\${SHELL:-/bin/sh}" -lc 'echo "@@$PATH@@"' 2>/dev/null </dev/null | sed -n 's/.*@@\\(.*\\)@@.*/\\1/p' | tail -n 1)
[ -n "$lp" ] || lp="$PATH"
lp="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$lp"
PATH="$lp"
printf '{"home":%s,"os":%s,"arch":%s,"path":%s,"tools":{' "$(js "$HOME")" "$(js "$(uname -s)")" "$(js "$(uname -m)")" "$(js "$lp")"
sep=
for t in herdr git perl gh claude pi tar; do
  c=$(command -v $t 2>/dev/null) || continue
  printf '%s"%s":%s' "$sep" "$t" "$(js "$c")"
  sep=,
done
if perl -MJSON::PP -e1 2>/dev/null; then printf '%s"jsonpp":"1"' "$sep"; fi
printf '},"helper":%s}\\n' "$(js "$(cat "$HOME/.lineclear/helper/version" 2>/dev/null)")"
`

/** the machine says who runs its tasks, so its own task list and doctor can tell; the probe's one call carries it */
const tellRunBy = () => {
  const me = (process.env.LINECLEAR_MACHINE ?? hostname()).split('.')[0] ?? ''
  return `mkdir -p "$HOME/.lineclear" && printf '"%s"' ${quote(me)} > "$HOME/.lineclear/${RUN_BY}" 2>/dev/null`
}

export async function probe(target: string): Promise<Probe> {
  const r = await onMachine(target, `${tellRunBy()}\n${PROBE}`, { timeoutMs: 30_000 })
  if (r.code !== 0) throw new Error(r.err.split('\n').pop() || `ssh ${target} failed`)
  const found = JSON.parse(r.out.trim().split('\n').pop() ?? '') as Omit<Probe, 'herdr' | 'tools'> & { tools: Record<string, string> }
  return {
    ...found,
    herdr: found.tools.herdr ?? 'herdr',
    tools: Object.fromEntries(Object.entries(found.tools).map(([k, v]) => [k, !!v])),
  }
}

/** herdr's own record of where herdr is on that machine, when it has one */
function herdrPath(id: string, fallback: string) {
  try {
    const f = join(process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? '', '.local', 'state'), 'herdr', 'client', 'ssh-metadata', `${id}.json`)
    return (JSON.parse(readFileSync(f, 'utf8')) as { metadata?: { executable?: string } }).metadata?.executable || fallback
  } catch {
    return fallback
  }
}

/* ---------- the helper's files ---------- */

/** every file of the helper: where it goes in the helper's folder, and where it comes from here */
export function helperFiles(): [string, string][] {
  const files: [string, string][] = [
    ['bin/lineclear', join(ROOT, 'helper', 'lineclear')],
    ['route.pl', join(ROOT, 'helper', 'route.pl')],
  ]
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const f = join(dir, n)
      if (lstatSync(f).isSymbolicLink()) continue
      if (statSync(f).isDirectory()) walk(f)
      else files.push([join('skill', relative(join(ROOT, 'skill'), f)), f])
    }
  }
  walk(join(ROOT, 'skill'))
  return files
}

/** what this Lineclear's helper is: its files' contents, so any change means an update */
let version: string | undefined
export function helperVersion() {
  if (version !== undefined) return version
  const h = createHash('sha256')
  for (const [to, from] of helperFiles().sort((a, b) => a[0].localeCompare(b[0]))) {
    h.update(to)
    h.update(readFileSync(from))
  }
  version = h.digest('hex').slice(0, 16)
  return version
}

/** a tar of the helper (plain ustar, read by every tar there is) */
function tarOf(files: [string, string][], version: string) {
  const blocks: Buffer[] = []
  const header = (name: string, size: number, mode: number) => {
    const b = Buffer.alloc(512)
    b.write(name, 0, 100)
    b.write(`${mode.toString(8).padStart(7, '0')}\0`, 100)
    b.write('0000000\0', 108)
    b.write('0000000\0', 116)
    b.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
    b.write(
      `${Math.floor(Date.now() / 1000)
        .toString(8)
        .padStart(11, '0')}\0`,
      136,
    )
    b.write('        ', 148)
    b.write('0', 156)
    b.write('ustar\0', 257)
    b.write('00', 263)
    let sum = 0
    for (const x of b) sum += x
    b.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
    return b
  }
  const add = (name: string, data: Buffer, mode: number) => {
    blocks.push(header(name, data.length, mode), data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  for (const [to, from] of files) add(to, readFileSync(from), to.startsWith('bin/') || to.endsWith('.pl') ? 0o755 : 0o644)
  add('version', Buffer.from(`${version}\n`), 0o644)
  blocks.push(Buffer.alloc(1024))
  return Buffer.concat(blocks)
}

/** the script that puts a helper tar (on stdin) in `dir`: a folder per version, and one symlink (current) that switches
 * to it in one rename, so a `lineclear` starting at any moment finds a whole helper. The two newest versions stay, for
 * agents already running from the older one. Hooks, inbox and prompts stay. */
export const installScript = (dir: string, version: string) => `
set -e; d=${quote(dir)}; ver=${quote(version)}
mkdir -p "$d/v" "$d/hooks" "$d/inbox" "$d/prompts"
if [ ! -d "$d/v/$ver" ]; then
  t=$(mktemp -d "$d/v/.new.XXXXXX"); tar xf - -C "$t"; chmod 755 "$t"; mv "$t" "$d/v/$ver"
fi
prev=$(readlink "$d/current" 2>/dev/null || true)
ln -s "v/$ver" "$d/.current.$$"
perl -e 'rename($ARGV[0], $ARGV[1]) or die "rename: $!"' "$d/.current.$$" "$d/current"
for n in bin skill route.pl version; do
  [ -L "$d/$n" ] || { rm -rf "$d/$n"; ln -s "current/$n" "$d/$n"; }
done
if [ "$prev" != "v/$ver" ]; then
  for old in "$d"/v/*; do
    case "$old" in "$d/v/$ver"|"$d/$prev") ;; *) rm -rf "$old" ;; esac
  done
fi
`

/** put the helper there (again): a new version folder is switched in, the old one stays beside it */
export async function installHelper(target: string, p: Probe) {
  const version = helperVersion()
  const tar = tarOf(helperFiles(), version)
  const r = await onMachine(target, installScript(helperDir(p.home), version), { stdin: tar, timeoutMs: 180_000 })
  if (r.code !== 0) throw new Error(`Could not put the helper on the machine: ${r.err || `exit ${r.code}`}`)
  return version
}

/** the machine's facts a worker needs (box.ts) */
export function boxInfo(m: Saved, p: Probe): BoxInfo {
  const bin = join(helperDir(p.home), 'bin')
  return { label: m.label, target: m.target, session: m.session, herdr: herdrPath(m.id, p.herdr), home: p.home, path: `${bin}:${p.path}`, os: p.os }
}

/** what a machine lacks for Lineclear, in words: nothing when all is there */
export function lacks(p: Probe): string[] {
  const out: string[] = []
  if (!p.tools.herdr) out.push('herdr')
  if (!p.tools.git) out.push('git')
  if (!p.tools.perl || !p.tools.jsonpp) out.push('perl (with JSON::PP)')
  if (!p.tools.tar) out.push('tar')
  if (!p.tools.pi) out.push('pi')
  return out
}
