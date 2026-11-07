import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { HOME } from '../store.ts'
import { machineStatus, savedMachines, type Saved } from './install.ts'
import { MachinesActions } from './machines-actions.ts'
import { kept } from './kept.ts'
export type { MachineRec } from './machines-helpers.ts'
export { machineHome } from './machines-helpers.ts'
export { codeVersion } from './worker-process.ts'

export class Machines extends MachinesActions {
  /** saved: herdr's list of machines; none (tests) runs only the workers adopt() names */
  constructor(saved: (() => Promise<Saved[]>) | null = savedMachines, status: typeof machineStatus = machineStatus) {
    super(saved, status)
    // from the time Lineclear was installed on every machine: the machines that announced themselves
    rmSync(join(HOME, 'peers.json'), { force: true })
    if (saved) {
      // what each machine showed before a restart, at once; its worker is taken back or started again
      for (const k of kept()) {
        const l = this.links.get(k.saved.label) ?? this.link(k.saved)
        l.probe = k.probe
        for (const c of k.chats ?? []) l.chats.set(c.key, c)
        this.pendingResume.set(k.saved.label, k)
      }
      void this.sync()
      this.timers.push(setInterval(() => void this.sync(), 15_000))
    }
  }
}
