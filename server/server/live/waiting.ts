import { join } from 'node:path'
import type { Action } from '../../shared/types.ts'
import { readJson, writeJson } from '../store.ts'
import { dirOf } from './machines-helpers.ts'

/** an action for a machine out of reach: kept with an id until the machine has taken it */
export interface Queued {
  id: string
  action: Action
}

const file = (label: string) => join('machines', dirOf(label), 'waiting.json')

export const loadWaiting = (label: string) => readJson<Queued[]>(file(label), [])

export const saveWaiting = (label: string, queue: Queued[]) => writeJson(file(label), queue)
