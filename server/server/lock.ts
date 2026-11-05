// One server per store: a second server on the same folder would run every step twice and flip server.json.
import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { join } from 'node:path'

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Takes `server.lock` in a store folder for this process. Returns the pid that holds it when another live server does. A lock left by a dead process is taken over. */
export function lockStore(dir: string, pid = process.pid): number | undefined {
  const file = join(dir, 'server.lock')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(file, 'wx')
      writeSync(fd, String(pid))
      closeSync(fd)
      process.on('exit', () => unlockStore(dir, pid))
      return undefined
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    const holder = Number(readFileSync(file, 'utf8').trim())
    if (holder !== pid && Number.isInteger(holder) && holder > 0 && alive(holder)) return holder
    rmSync(file, { force: true })
  }
  throw new Error(`cannot take ${file}`)
}

/** Gives the lock back, only when it is this process's. */
export function unlockStore(dir: string, pid = process.pid) {
  const file = join(dir, 'server.lock')
  try {
    if (Number(readFileSync(file, 'utf8').trim()) === pid) rmSync(file, { force: true })
  } catch {
    // no lock: nothing to give back
  }
}

/** The port a live server reported in `server.json`, when that file is its own (the pid matches). */
export function holderPort(dir: string, pid: number): number | undefined {
  try {
    const info = JSON.parse(readFileSync(join(dir, 'server.json'), 'utf8')) as { port?: number; pid?: number }
    return info.pid === pid ? info.port : undefined
  } catch {
    return undefined
  }
}
