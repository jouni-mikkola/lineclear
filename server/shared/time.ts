// The one way the server and its screen word a time: how long ago, and a clock time.

/** how long ago, short: "now", "5m", "3h", "2d" */
export function age(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export const ago = (t: number) => (age(t) === 'now' ? 'just now' : `${age(t)} ago`)

// made once: building a formatter on each call is slow, and every snapshot words several times
const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/** the time of day, "14:05" */
export function clock(t: number) {
  return CLOCK.format(t)
}

/** a time with its day: "today 14:05", or "3 Nov 14:05" */
export function clockWithDay(t: number) {
  const d = new Date(t)
  const today = new Date().toDateString() === d.toDateString()
  const hm = clock(t)
  return today ? `today ${hm}` : `${DAY.format(d)} ${hm}`
}
