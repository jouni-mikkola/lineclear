// The file calls that read a machine's own files (repos, worktrees, an agent's page, its inbox, its hooks), named as
// node:fs names them. On the main machine they are node:fs itself. In a worker for another machine (box.ts) a path
// under the worker's own store on the main machine (HOME: its records, its mirror of the logs) stays here, and every
// other path is the other machine's, read over SSH.
import * as fs from 'node:fs'
import { HOME } from '../store.ts'
import { remoteBox, helperDir, q, runSync } from './box.ts'

const local = (p: string) => !remoteBox() || p === HOME || p.startsWith(`${HOME}/`)

const sh = (script: string, stdin?: string | Uint8Array) => runSync(['/bin/sh', '-c', script], { stdin })

function fail(p: string, err: string): never {
  const e = new Error(`${err.trim() || 'failed'}: ${p}`) as Error & { code: string }
  e.code = /no such file|not found|cannot stat|ENOENT/i.test(err) || !err.trim() ? 'ENOENT' : 'EIO'
  throw e
}

export function existsSync(p: string) {
  return local(p) ? fs.existsSync(p) : sh(`test -e ${q(p)}`).code === 0
}

export const statSync = fs.statSync

export function readFileSync(p: string): Buffer
export function readFileSync(p: string, enc: 'utf8'): string
export function readFileSync(p: string, enc?: 'utf8'): Buffer | string {
  if (local(p)) return enc ? fs.readFileSync(p, enc) : fs.readFileSync(p)
  const r = sh(`cat ${q(p)}`)
  if (r.code) fail(p, r.err)
  return enc ? r.out.toString('utf8') : r.out
}

export function writeFileSync(p: string, data: string | Uint8Array, o?: { mode?: number }) {
  if (local(p)) return fs.writeFileSync(p, data, o)
  const r = sh(`cat > ${q(p)}${o?.mode ? ` && chmod ${o.mode.toString(8)} ${q(p)}` : ''}`, data)
  if (r.code) fail(p, r.err)
}

export function mkdirSync(p: string, o?: { recursive?: boolean; mode?: number }) {
  if (local(p)) return void fs.mkdirSync(p, o)
  const r = sh(`mkdir ${o?.recursive ? '-p ' : ''}${q(p)}`)
  if (r.code && !o?.recursive) fail(p, r.err)
}

export function rmSync(p: string, o?: { recursive?: boolean; force?: boolean }) {
  if (local(p)) return fs.rmSync(p, o)
  const r = sh(`rm ${o?.recursive ? '-r ' : ''}${o?.force ? '-f ' : ''}${q(p)}`)
  if (r.code && !o?.force) fail(p, r.err)
}

export function renameSync(from: string, to: string) {
  if (local(from) && local(to)) return fs.renameSync(from, to)
  const r = sh(`mv -f ${q(from)} ${q(to)}`)
  if (r.code) fail(from, r.err)
}

export function readdirSync(p: string): string[] {
  if (local(p)) return fs.readdirSync(p)
  const r = sh(`cd ${q(p)} && ls -A1`)
  if (r.code) fail(p, r.err)
  return r.out.toString().split('\n').filter(Boolean)
}

export const realpathSync = fs.realpathSync

/** cp -R, links kept as links */
export function cpSync(from: string, to: string) {
  if (local(from) && local(to)) return fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true })
  const r = sh(`mkdir -p "$(dirname ${q(to)})" && cp -RP ${q(from)} ${q(to)}`)
  if (r.code) fail(from, r.err)
}

/** the folder of what an agent there reads or runs from Lineclear (hooks, its instructions, files sent to it): the
 *  helper's folder on another machine, Lineclear's own folder here */
export const boxDir = () => (remoteBox() ? helperDir(remoteBox()!.home) : HOME)

/** where the main machine keeps its copy of another machine's file as it grows (mirror.ts); a file here is itself */
export const mirrored = (p: string) => (remoteBox() && !local(p) ? `${HOME}/mirror${p}` : p)
