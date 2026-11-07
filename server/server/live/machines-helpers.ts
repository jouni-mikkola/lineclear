import { join } from 'node:path'
import type { Alert, Chat, Snapshot, TermScreen } from '../../shared/types.ts'
import type { Overview } from '../source.ts'
import { HOME } from '../store.ts'
import { boxInfo, helperVersion, lacks, type Probe, type Saved } from './install.ts'
import type { Queued } from './waiting.ts'
import type { Worker } from './worker-process.ts'

export interface MachineRec {
  machine: string
  /** its worker's address on this machine, once it runs */
  url: string
  lastSeen: number
}

export type Events = {
  snapshot: []
  chat: [key: string, chat: Chat]
  terminal: [key: string, screen: TermScreen]
  alert: [alert: Alert]
  news: [machine: string, news: Overview]
}

export interface Link {
  rec: MachineRec
  saved: Saved
  snap?: Snapshot
  chats: Map<string, Chat>
  ws?: WebSocket
  watching: { chats: string[]; term: string | null }
  reachable: boolean
  down?: number
  /** what you sent while it was out of reach: kept on disk until the machine has taken it */
  waiting: Queued[]
  /** why the first waiting action was not delivered, shown in the machine's state until it is */
  failed?: string
  flushing?: boolean
  /** its worker: started here, or one from before a restart taken back */
  worker?: Worker
  /** how it is going, in a few words: Ready, Putting the helper there…, Can't reach it: … */
  state: string
  /** what it lacks, from the last check */
  lacks: string[]
  probe?: Probe
  busy?: boolean
  /** not reached yet since this server started: shown as connecting, not as out of reach, for a while */
  connecting: boolean
  retryTimer?: ReturnType<typeof setTimeout>
  polling?: boolean
}

/** a machine not reached within this long of the start is out of reach, no longer connecting */
export const CONNECTING_FOR = 60_000

/** the folder of a machine's own worker and its store: tasks.json, server.json, worker.log. Nothing in it is a copy
 *  of that machine's tasks kept by this server (machines/ holds nothing) */
export const workerHome = (label: string) => join(HOME, 'workers', dirOf(label))

/** a machine's folder name under machines/ */
export const dirOf = (label: string) => label.replace(/[^\w.-]+/g, '_')

/** the machine as last looked at is ready for a worker: nothing missing, and the helper there is this one's */
export const fits = (p: Probe) => !lacks(p).length && p.helper === helperVersion()

/** a worker started from one look runs the same as from the other */
export const sameBox = (m: Saved, a: Probe, b: Probe) => JSON.stringify(boxInfo(m, a)) === JSON.stringify(boxInfo(m, b))
