import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { HOME } from '../store.ts'
import { machineStatus, savedMachines, type Saved } from './install.ts'
import { MachinesActions } from './machines-actions.ts'
export type { MachineRec } from './machines-helpers.ts'
export { codeVersion } from './worker-process.ts'

export class Machines extends MachinesActions {
  /** saved: herdr's list of machines; none (tests) runs only the workers adopt() names */
  constructor(saved: (() => Promise<Saved[]>) | null = savedMachines, status: typeof machineStatus = machineStatus) {
    super(saved, status)
    // from the time Lineclear was installed on every machine: the machines that announced themselves
    rmSync(join(HOME, 'peers.json'), { force: true })
    if (saved) {
      // older versions kept a copy of each machine here; what a machine shows is read from its worker. Only the
      // actions waiting for a machine (waiting.json) stay.
      const dir = join(HOME, 'machines')
      for (const d of existsSync(dir) ? readdirSync(dir) : []) {
        for (const f of readdirSync(join(dir, d))) if (f !== 'waiting.json') rmSync(join(dir, d, f), { recursive: true, force: true })
        if (!readdirSync(join(dir, d)).length) rmSync(join(dir, d), { recursive: true })
      }
      if (existsSync(dir) && !readdirSync(dir).length) rmSync(dir, { recursive: true })
      void this.sync()
      this.timers.push(setInterval(() => void this.sync(), 15_000))
    }
  }
}
