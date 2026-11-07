import { execSync } from 'node:child_process'
import { readJson } from '../store.ts'

/** The owner's first name: config.json's user, else git's name, else $USER. */
export function userName(): string {
  const set = readJson<{ user?: string }>('config.json', {}).user
  if (set) return set
  try {
    const n = execSync('git config --global user.name', { encoding: 'utf8' }).trim().split(/\s+/)[0]
    if (n) return n
  } catch {
    /* no git name */
  }
  const u = process.env.USER ?? 'You'
  return u[0].toUpperCase() + u.slice(1)
}
