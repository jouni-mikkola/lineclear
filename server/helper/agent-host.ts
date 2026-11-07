// The agent host: one process per machine that runs pi RPC children and carries their JSONL frames, tagged by key,
// over its one stdio. One ssh to the host replaces one ssh per agent (sshd allows 10 sessions by default).
// In, one JSON frame per line:  {type:"spawn",key,cmd,args?,cwd?,env?}  {type:"send",key,line}  {type:"stop",key}
// Out, one JSON frame per line: {type:"event",key,line}  {type:"exit",key,code,signal}  {type:"room",cores,load,memAvailable,running}
import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { createInterface } from 'node:readline'

const ROOM_EVERY_MS = 10_000

const children = new Map<string, ChildProcess>()

const out = (frame: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(frame)}\n`)
}

const memAvailableKb = (): number => {
  try {
    const hit = /^MemAvailable:\s+(\d+)/m.exec(readFileSync('/proc/meminfo', 'utf8'))
    return hit ? Number(hit[1]) : 0
  } catch {
    return 0
  }
}

const room = (): void => out({ type: 'room', cores: cpus().length, load: loadavg()[0], memAvailable: memAvailableKb(), running: children.size })

const start = (key: string, cmd: string, args: string[], cwd?: string, env?: Record<string, string>): void => {
  if (children.has(key)) return
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
  children.set(key, child)
  createInterface({ input: child.stdout }).on('line', (line) => out({ type: 'event', key, line }))
  child.stdin.on('error', () => {})
  let ended = false
  const end = (code: number | null, signal: string | null): void => {
    if (ended) return
    ended = true
    children.delete(key)
    out({ type: 'exit', key, code, signal })
  }
  child.on('error', () => end(null, null))
  child.on('close', end)
}

const handle = (frame: Record<string, unknown>): void => {
  const key = String(frame.key ?? '')
  if (frame.type === 'spawn' && key && typeof frame.cmd === 'string') {
    start(key, frame.cmd, (frame.args as string[] | undefined) ?? [], frame.cwd as string | undefined, frame.env as Record<string, string> | undefined)
  } else if (frame.type === 'send') {
    children.get(key)?.stdin?.write(`${String(frame.line ?? '')}\n`)
  } else if (frame.type === 'stop') {
    children.get(key)?.kill('SIGTERM')
  }
}

const input = createInterface({ input: process.stdin })
input.on('line', (text) => {
  try {
    handle(JSON.parse(text))
  } catch {
    // a malformed line is dropped: the host must outlive one bad frame
  }
})
// The server closing stdin (its ssh died) ends the host and every child with it
input.on('close', () => {
  for (const child of children.values()) child.kill('SIGTERM')
  clearInterval(timer)
})
const timer = setInterval(room, ROOM_EVERY_MS)
room()
