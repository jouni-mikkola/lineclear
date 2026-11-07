import { CLI_NAME, kindOf, REVIEWERS } from './settings-catalog.ts'
import { numOf, ROWS } from './settings-sections.ts'
import type { Num } from './settings-types.ts'

function validZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** a number as it is kept ("7 days", "1.5× cores", "off"), or nothing where it is no number in range */
export function numValue(n: Num, value: string): string | undefined {
  const v = value.trim().toLowerCase()
  if (v === 'off') return n.off || n.zero ? 'off' : undefined
  // its unit (or any word of it) may follow: "13", "13 tasks", "1.5x cores", "80 %"
  const m = v.match(/^(\d+(?:[.,]\d+)?)\s*(?:[×x%]|[a-z][a-z ]*)?\s*(?:cores?)?$/)
  if (!m) return undefined
  const x = Number(m[1].replace(',', '.'))
  if (n.zero && x === 0) return 'off'
  const step = n.step ?? 1
  if (x < n.min || x > n.max || Math.abs(Math.round(x / step) * step - x) > 1e-9) return undefined
  const unit = x === 1 && n.one ? n.one : n.unit
  return unit ? `${x}${unit.startsWith('×') || unit === '%' ? '' : ' '}${unit}` : String(x)
}

/** why a value can't be set, or nothing */
export function refuse(key: string, value: string): string | undefined {
  if (key.endsWith('.instructions') && (value.length > 16000 || value.includes('\0')))
    return 'Use at most 16,000 characters, without null characters. Keep secrets in Secrets.'
  const cli = key === 'task.agent' || key === 'coordinator.agent' || (key === 'task.fallback' && value.trim().toLowerCase() !== 'off')
  if (cli && !kindOf(value)) return `${value} is not an agent Lineclear runs: pi is the only one.`
  if (key === 'reviewer.agent' && !REVIEWERS.includes(CLI_NAME[kindOf(value) ?? ''] ?? '')) return `Pick one of: ${REVIEWERS.join(' · ')}.`
  if (key.endsWith('.model') && !/^[\w.:/@[\] -]+$/.test(value.trim())) return 'Write a model id like vendor/model-top-5-5, or default.'
  const num = numOf(key)
  if (key === 'time.zone' && !validZone(value.trim())) return `${value} is no time zone: write one like Europe/Stockholm.`
  if (num && numValue(num, value) === undefined)
    return `Write a number from ${num.min} to ${num.max}${num.step ? '' : ' (whole)'}${num.unit ? `, in ${num.unit}` : ''}${num.off ? ', or off' : num.zero ? ' (0 is off)' : ''}.`
  const options = ROWS.find((r) => r.key === key)?.options
  if (options && !cli && key !== 'reviewer.agent' && key !== 'alerts' && key !== 'task.fallback' && !options.includes(value))
    return `Pick one of: ${options.join(' · ')}.`
  return undefined
}
