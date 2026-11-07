import { join } from 'node:path'
import type { Action } from '../../shared/types/action.ts'
import type { Alert } from '../../shared/types/alert.ts'
import type { Chat } from '../../shared/types/chat.ts'
import type { Snapshot } from '../../shared/types/snapshot.ts'
import type { TermScreen } from '../../shared/types/event.ts'
import type { Overview } from '../source.ts'
import { HOME } from '../store.ts'
import { boxInfo, helperVersion, lacks, type Probe, type Saved } from './install.ts'
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
  /** what you sent while it was out of reach */
  waiting: Action[]
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

/** a machine's own folder of records on this machine */
export const machineHome = (label: string) => join(HOME, 'machines', dirOf(label))

/** the folder of a machine's own worker and its store: tasks.json, server.json, worker.log. Nothing in it is a copy
 *  of that machine's tasks kept by this server (machines/<label> holds only last.json) */
export const workerHome = (label: string) => join(HOME, 'workers', dirOf(label))

/** a machine's folder name under machines/ */
export const dirOf = (label: string) => label.replace(/[^\w.-]+/g, '_')

/** the machine as last looked at is ready for a worker: nothing missing, and the helper there is this one's */
export const fits = (p: Probe) => !lacks(p).length && p.helper === helperVersion()

/** a worker started from one look runs the same as from the other */
export const sameBox = (m: Saved, a: Probe, b: Probe) => JSON.stringify(boxInfo(m, a)) === JSON.stringify(boxInfo(m, b))
