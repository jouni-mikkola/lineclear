// The file calls that read a machine's own files (repos, worktrees, an agent's page, its inbox, its hooks), named as
// node:fs names them. On the main machine they are node:fs itself. In a worker for another machine (box.ts) a path
// under the worker's own store on the main machine (HOME: its records, its mirror of the logs) stays here, and every
// other path is the other machine's, read over SSH.
import * as fs from 'node:fs'
import { HOME } from '../store.ts'
import { quote } from '../../../src/ssh.ts'
import { remoteBox, helperDir, run } from './box.ts'

const local = (p: string) => !remoteBox() || p === HOME || p.startsWith(`${HOME}/`)

const sh = (script: string, stdin?: string | Uint8Array) => run(['/bin/sh', '-c', script], { stdin, timeoutMs: 30_000 })

function fail(p: string, err: string): never {
  const e = new Error(`${err.trim() || 'failed'}: ${p}`) as Error & { code: string }
  e.code = /no such file|not found|cannot stat|ENOENT/i.test(err) || !err.trim() ? 'ENOENT' : 'EIO'
  throw e
}

export async function exists(p: string) {
  return local(p) ? fs.existsSync(p) : (await sh(`test -e ${quote(p)}`)).code === 0
}

export const statSync = fs.statSync

export async function readFile(p: string): Promise<Buffer>
export async function readFile(p: string, enc: 'utf8'): Promise<string>
export async function readFile(p: string, enc?: 'utf8'): Promise<Buffer | string> {
  if (local(p)) return enc ? fs.promises.readFile(p, enc) : fs.promises.readFile(p)
  // bytes cross the process pipe as text, so a binary file travels as base64
  const r = await sh(enc ? `cat ${quote(p)}` : `base64 < ${quote(p)}`)
  if (r.code) fail(p, r.err)
  return enc ? r.out : Buffer.from(r.out, 'base64')
}

export async function writeFile(p: string, data: string | Uint8Array, o?: { mode?: number }) {
  if (local(p)) return fs.promises.writeFile(p, data, o)
  const r = await sh(`cat > ${quote(p)}${o?.mode ? ` && chmod ${o.mode.toString(8)} ${quote(p)}` : ''}`, data)
  if (r.code) fail(p, r.err)
}

export async function mkdir(p: string, o?: { recursive?: boolean; mode?: number }) {
  if (local(p)) return void (await fs.promises.mkdir(p, o))
  const r = await sh(`mkdir ${o?.recursive ? '-p ' : ''}${quote(p)}`)
  if (r.code && !o?.recursive) fail(p, r.err)
}

export async function readdir(p: string): Promise<string[]> {
  if (local(p)) return fs.promises.readdir(p)
  const r = await sh(`cd ${quote(p)} && ls -A1`)
  if (r.code) fail(p, r.err)
  return r.out.split('\n').filter(Boolean)
}

export const realpathSync = fs.realpathSync

/** cp -R, links kept as links */
export async function cp(from: string, to: string) {
  if (local(from) && local(to)) return fs.promises.cp(from, to, { recursive: true, verbatimSymlinks: true })
  const r = await sh(`mkdir -p "$(dirname ${quote(to)})" && cp -RP ${quote(from)} ${quote(to)}`)
  if (r.code) fail(from, r.err)
}

/** the folder of what an agent there reads or runs from Lineclear (hooks, its instructions, files sent to it): the
 *  helper's folder on another machine, Lineclear's own folder here */
export const boxDir = () => (remoteBox() ? helperDir(remoteBox()!.home) : HOME)

/** where the main machine keeps its copy of another machine's file as it grows (mirror.ts); a file here is itself */
export const mirrored = (p: string) => (remoteBox() && !local(p) ? `${HOME}/mirror${p}` : p)
