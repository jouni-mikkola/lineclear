// Starts Lineclear: the live source on herdr.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startApp } from './app.ts'
import { holderPort, lockStore } from './lock.ts'
import { Push } from './push.ts'
import { DEFAULT_PORT, db, HOME, StoreError, writeJson } from './store.ts'

interface Mounted {
  fetch: (req: Request) => Promise<Response | undefined>
  /** ends the web pages and the loop, which finishes its tick first */
  stop: () => Promise<void>
}

const port = Number(process.env.LINECLEAR_PORT ?? DEFAULT_PORT)

const holder = lockStore(HOME)
if (holder !== undefined) {
  const at = holderPort(HOME, holder)
  console.error(
    `lineclear: another server (process ${holder}${at ? `, port ${at}` : ''}) already runs on ${HOME}. Stop it first, or use another LINECLEAR_HOME.`,
  )
  process.exit(1)
}
// a store that cannot open stops the board here, with the file's path in the line
try {
  db.query('select 1').get()
} catch (e) {
  console.error(e instanceof StoreError ? e.message : String(e))
  process.exit(1)
}
const { LiveSource } = await import('./live/source.ts')
const source = new LiveSource()
const push = !process.env.LINECLEAR_BOX ? new Push() : undefined
if (push && 'devices' in source && 'pushWarnings' in source) {
  ;(source as { devices: () => string[] }).devices = () => push.devices.map(deviceName)
  ;(source as { pushWarnings: () => string[] }).pushWarnings = () => push.warnings(deviceName)
}
// a worker for another machine (machines.ts) serves only its main machine, which pushes alerts itself
const worker = !!process.env.LINECLEAR_BOX
// the web pages and the rule loop of Lineclear's CLI (src/serve.ts) run in this process, on this port; a worker has none
const mounted =
  !worker && process.env.LINECLEAR_MOUNT ? await ((await import(process.env.LINECLEAR_MOUNT)) as { mount: () => Promise<Mounted> }).mount() : undefined
const server = startApp({ source, push: worker ? undefined : push, port, mounted: mounted?.fetch })
// a worker says which code it runs: the main server keeps it across its own restart while that is the same
writeJson('server.json', {
  port: server.port,
  pid: process.pid,
  code: worker ? (await import('./live/machines.ts')).codeVersion() : undefined,
  token: process.env.LINECLEAR_TOKEN,
})
let tunnel: { stop(): void } | undefined
if (worker) {
  // the agents there reach this worker's lineclear command through an SSH tunnel to it
  tunnel = (await import('./live/tunnel.ts')).keepTunnel(server.port!)
  orphaned()
}
console.log(`lineclear on http://127.0.0.1:${server.port}, ready ${Math.round(performance.now())} ms after start`)

/** A worker outlives a restart of its main server, which takes it back; one whose main server stays gone stops. */
function orphaned() {
  let gone = 0
  setInterval(() => {
    try {
      process.kill((JSON.parse(readFileSync(join(process.env.LINECLEAR_MAIN_HOME ?? '', 'server.json'), 'utf8')) as { pid: number }).pid, 0)
      gone = 0
    } catch {
      if (++gone >= 10) {
        tunnel?.stop()
        source.stop?.()
        process.exit(0)
      }
    }
  }, 60_000)
}

// an update restarts it, as one right after a merge into Lineclear's own repo does: a merge on its way finishes and
// its answer goes out first, so none is cut halfway with its agent waiting on an answer that never comes
let stopping = false
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    // asked again: at once
    if (stopping) process.exit(0)
    stopping = true
    if (await source.drain?.()) await Bun.sleep(500)
    tunnel?.stop()
    await mounted?.stop()
    source.stop?.()
    server.stop()
    process.exit(0)
  })

/** "this phone", "this Mac": what the browser says it is */
function deviceName(ua: string) {
  if (/iPhone|Android.*Mobile/.test(ua)) return 'a phone'
  if (/iPad|Android/.test(ua)) return 'a tablet'
  if (/Mac OS X/.test(ua)) return 'a Mac'
  if (/Windows/.test(ua)) return 'a PC'
  return 'a computer'
}
