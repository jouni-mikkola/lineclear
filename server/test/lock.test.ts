import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lockStore, unlockStore } from '../server/lock.ts'

const folder = () => mkdtempSync(join(tmpdir(), 'lock-'))

test('a second server on the same store is refused with the holder', () => {
  const dir = folder()
  expect(lockStore(dir, process.pid)).toBeUndefined()
  expect(lockStore(dir, 999_999_999)).toBe(process.pid)
})

test('a lock left by a dead process is taken over', () => {
  const dir = folder()
  writeFileSync(join(dir, 'server.lock'), '999999999')
  expect(lockStore(dir, process.pid)).toBeUndefined()
  expect(readFileSync(join(dir, 'server.lock'), 'utf8')).toBe(String(process.pid))
})

test('only the holder gives the lock back', () => {
  const dir = folder()
  lockStore(dir, process.pid)
  unlockStore(dir, 1)
  expect(lockStore(dir, 999_999_999)).toBe(process.pid)
  unlockStore(dir, process.pid)
  expect(lockStore(dir, 999_999_999)).toBeUndefined()
})
