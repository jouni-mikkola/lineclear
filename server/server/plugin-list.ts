import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Lineclear's data folder, where the human's own plugins and their list live */
export const userHome = () => process.env.LINECLEAR_HOME || join(homedir(), '.lineclear')

/** the plugins the human turned off (~/.lineclear/plugins.json) */
export function readOff(home = userHome()): string[] {
  try {
    const off = (JSON.parse(readFileSync(join(home, 'plugins.json'), 'utf8')) as { off?: unknown }).off
    return Array.isArray(off) ? off.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

export interface PluginEntry {
  name: string
  /** base: the repo's; user: the human's own */
  from: 'base' | 'user'
  /** the human's own, in place of the base plugin of its name */
  overrides?: boolean
  /** in this build */
  on: boolean
  /** why the human's own didn't build; kept: its last good version runs */
  broken?: string
  kept?: boolean
}
