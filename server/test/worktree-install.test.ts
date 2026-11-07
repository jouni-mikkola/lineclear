// A fresh task worktree gets its install step before the agent starts: Bun repos by default, a project's own command
// when set, and a failure says what failed.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { repo, until, world } from './engine-world.ts'
import { install, installDirs, storeKey, storePath } from '../server/live/engine/install.ts'
const { Worktrees } = await import('../server/live/engine/worktrees.ts')

/** a folder with a Bun project whose one dependency is a local package (no network) and a lockfile made by bun */
async function bunProject(dir: string) {
  mkdirSync(join(dir, 'dep'), { recursive: true })
  writeFileSync(join(dir, 'dep/package.json'), JSON.stringify({ name: 'dep', version: '1.0.0' }))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: { dep: 'file:./dep' } }))
  const p = Bun.spawn(['bun', 'install'], { cwd: dir, stdout: 'ignore', stderr: 'ignore' })
  await p.exited
  rmSync(join(dir, 'node_modules'), { recursive: true, force: true })
}

describe('install step of a new worktree', () => {
  test('default: bun install --frozen-lockfile in the root and in a folder under it with a lockfile', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'shep-inst-'))
    await bunProject(wt)
    await bunProject(join(wt, 'server'))
    mkdirSync(join(wt, 'docs'))
    expect(await installDirs(wt)).toEqual([wt, join(wt, 'server')])
    await install(wt)
    expect(existsSync(join(wt, 'node_modules/dep/package.json'))).toBe(true)
    expect(existsSync(join(wt, 'server/node_modules/dep/package.json'))).toBe(true)
    rmSync(wt, { recursive: true, force: true })
  })

  test('a repo with no Bun lockfile runs nothing; off runs nothing', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'shep-inst-'))
    writeFileSync(join(wt, 'package.json'), '{}')
    await install(wt)
    await install(wt, 'off')
    expect(await installDirs(wt)).toEqual([])
    rmSync(wt, { recursive: true, force: true })
  })

  test("the project's own command replaces the default", async () => {
    const wt = mkdtempSync(join(tmpdir(), 'shep-inst-'))
    await install(wt, 'touch ran')
    expect(existsSync(join(wt, 'ran'))).toBe(true)
    rmSync(wt, { recursive: true, force: true })
  })

  test('a failure throws, saying which step and why', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'shep-inst-'))
    await expect(install(wt, 'echo boom >&2; exit 3')).rejects.toThrow('Install failed (echo boom >&2; exit 3): boom')
    writeFileSync(join(wt, 'package.json'), JSON.stringify({ dependencies: { dep: 'file:./nope' } }))
    writeFileSync(join(wt, 'bun.lock'), '{}')
    await expect(install(wt)).rejects.toThrow('Install failed (bun install --frozen-lockfile)')
    rmSync(wt, { recursive: true, force: true })
  })
})

function copyProject(from: string, to: string) {
  mkdirSync(join(to, 'dep'))
  writeFileSync(join(to, 'package.json'), readFileSync(join(from, 'package.json')))
  writeFileSync(join(to, 'bun.lock'), readFileSync(join(from, 'bun.lock')))
  writeFileSync(join(to, 'dep/package.json'), readFileSync(join(from, 'dep/package.json')))
}

describe('one install per lock file', () => {
  test('the key is the lock file hash: the same lock gives the same key, a changed one a new key', () => {
    expect(storeKey('a')).toBe(storeKey(Buffer.from('a')))
    expect(storeKey('a')).not.toBe(storeKey('b'))
    expect(storeKey('a')).toMatch(/^[0-9a-f]{16}$/)
  })

  test('the first worktree installs into the store and links it, the next links without installing, a changed lock gets its own entry', async () => {
    const a = mkdtempSync(join(tmpdir(), 'shep-inst-'))
    const b = mkdtempSync(join(tmpdir(), 'shep-inst-'))
    const c = mkdtempSync(join(tmpdir(), 'shep-inst-'))
    await bunProject(a)
    copyProject(a, b)
    copyProject(a, c)
    writeFileSync(join(c, 'bun.lock'), `${readFileSync(join(c, 'bun.lock'), 'utf8')}\n`)
    await install(a)
    expect(lstatSync(join(a, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(a, 'node_modules'))).toBe(await storePath(a, a))
    // b has the same lock file: it links the store entry
    await install(b)
    expect(readlinkSync(join(b, 'node_modules'))).toBe(await storePath(a, a))
    expect(existsSync(join(b, 'node_modules/dep/package.json'))).toBe(true)
    expect(await storePath(c, c)).not.toBe(await storePath(a, a))
    for (const d of [a, b, c]) rmSync(d, { recursive: true, force: true })
  })
})

describe('a task worktree made for a project', () => {
  test('has its node_modules in root and server/ when it is made, so check finds tsc', async () => {
    const dir = repo()
    await bunProject(dir)
    await bunProject(join(dir, 'server'))
    execSync('git add -A && git commit -qm deps', { cwd: dir })
    const wt = new Worktrees()
    const made = await wt.create({ repo: dir }, 'work/1-x', 'main')
    expect(existsSync(join(made.path, 'node_modules/dep/package.json'))).toBe(true)
    expect(existsSync(join(made.path, 'server/node_modules/dep/package.json'))).toBe(true)
    expect(execSync('git status --short', { cwd: made.path }).toString()).toBe('')
  })

  test('a failed install step fails the start, saying so', async () => {
    const dir = repo()
    const wt = new Worktrees()
    await expect(wt.create({ repo: dir, install: 'exit 1' }, 'work/2-x', 'main')).rejects.toThrow('Install failed')
  })
})

describe('a failed install is a stall, not a question', () => {
  test('the task shows as working and stuck, its coordinator hears, and its agent is not started; a message starts it again', async () => {
    const w = world()
    const p = await w.places.add(repo(), 'proj')
    w.places.setInstall(p.name, 'echo no network >&2; exit 1')
    const t = w.engine.add({ project: p.name, title: 'T', desc: 'Do it.', by: 'test' })
    await until(() => !!w.engine.task(t.id)?.stuck)
    expect(w.engine.statusOf(t)).toBe('work')
    expect(w.engine.task(t.id)?.trouble).toBeUndefined()
    expect(w.news.some((n) => n.includes(`${t.id} is stuck`) && n.includes('no network'))).toBe(true)
    expect(w.started.length).toBe(0)
    w.places.setInstall(p.name, 'true')
    await w.engine.resume(t.id)
    await until(() => w.started.some((s) => s.key === `${t.id}/Agent`))
    expect(w.engine.task(t.id)?.stuck).toBeUndefined()
  })
})
