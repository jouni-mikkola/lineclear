// How late the server's event loop runs, and which work held it. A timer that fires late means something ran too long;
// the named jobs (`held`) that overlap the gap say what.
import inspector from 'node:inspector'

const TICK_MS = 20
/** A lag over this is logged. */
const SLOW_MS = 200
const KEEP_MS = 10 * 60_000

interface Job {
  name: string
  from: number
  to: number
}
interface Sample {
  at: number
  lag: number
}

export interface LoopFigures {
  windowMs: number
  samples: number
  p50: number
  p95: number
  max: number
  /** CPU time of the main thread (user and system) as a share of the window */
  cpu: number
}

let jobs: Job[] = []
let samples: Sample[] = []
let timer: ReturnType<typeof setInterval> | undefined

/** Runs `fn` and notes its name and time. An async `fn` counts only up to its first await: the rest does not hold the loop. */
export function held<T>(name: string, fn: () => T): T {
  const from = performance.now()
  try {
    return fn()
  } finally {
    const to = performance.now()
    if (to - from >= TICK_MS) jobs.push({ name, from, to })
  }
}

const cutoff = (now: number) => now - KEEP_MS

/** The name of the job that overlapped [from, to] the most; undefined when none did. */
function holder(from: number, to: number): string | undefined {
  let best: Job | undefined
  let bestOverlap = 0
  for (const j of jobs) {
    const overlap = Math.min(j.to, to) - Math.max(j.from, from)
    if (overlap > bestOverlap) {
      best = j
      bestOverlap = overlap
    }
  }
  return best?.name
}

/** Starts measuring (again). `log` gets one line for each lag over SLOW_MS. */
export function startLoopLag(log: (line: string) => void = console.warn): void {
  stopLoopLag()
  let last = performance.now()
  timer = setInterval(() => {
    const now = performance.now()
    const lag = Math.max(0, now - last - TICK_MS)
    if (lag > SLOW_MS) log(`loop lag ${Math.round(lag)} ms, held by ${holder(last, now) ?? 'unnamed work'}`)
    samples.push({ at: now, lag })
    last = now
    const old = cutoff(now)
    jobs = jobs.filter((j) => j.to >= old)
    if (samples.length > 0 && (samples[0] as Sample).at < old) samples = samples.filter((s) => s.at >= old)
  }, TICK_MS)
  timer.unref?.()
}

export function stopLoopLag(): void {
  if (timer) clearInterval(timer)
  timer = undefined
  samples = []
  jobs = []
}

const pick = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0

/** Watches the loop for `windowMs` and gives the lag figures of that time. */
export async function measureLoop(windowMs: number): Promise<LoopFigures> {
  const from = performance.now()
  const cpu0 = process.threadCpuUsage()
  await Bun.sleep(windowMs)
  const wall = performance.now() - from
  const cpu = process.threadCpuUsage(cpu0)
  const lags = samples
    .filter((s) => s.at >= from)
    .map((s) => s.lag)
    .sort((a, b) => a - b)
  return {
    windowMs: Math.round(wall),
    samples: lags.length,
    p50: pick(lags, 0.5),
    p95: pick(lags, 0.95),
    max: lags.at(-1) ?? 0,
    cpu: (cpu.user + cpu.system) / 1000 / wall,
  }
}

/** A CPU profile (.cpuprofile JSON) of this process over `windowMs`. */
export async function profileLoop(windowMs: number): Promise<unknown> {
  const session = new inspector.Session()
  session.connect()
  const post = (method: string) =>
    new Promise<{ profile?: unknown }>((resolve, reject) => session.post(method, (e: Error | null, r: { profile?: unknown }) => (e ? reject(e) : resolve(r))))
  try {
    await post('Profiler.enable')
    await post('Profiler.start')
    await Bun.sleep(windowMs)
    return (await post('Profiler.stop')).profile
  } finally {
    session.disconnect()
  }
}
