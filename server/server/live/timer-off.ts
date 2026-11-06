import { execSync } from 'node:child_process'
import { readJson } from '../store.ts'
import { timerAllowed } from './timer-rule.ts'

/** Why a coordinator cannot be put on a timer */
export const TIMER_OFF =
  "A coordinator on a timer stays off: Lineclear's rules start the next steps of each Running project. Pause or run a project on its track."

/**
 * Lineclear's rules start each Running project's steps: the coordinator's timer stays off. Only the
 * fork's own tests turn it on, to test the code it keeps. The error for a switch to `mode`, or undefined.
 */
export function timerRefused(mode: string, env = process.env): string | undefined {
  return mode === 'autopilot' && !timerAllowed(env) ? TIMER_OFF : undefined
}

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
