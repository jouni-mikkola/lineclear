// Machine news never wakes an AI. A line of load, memory, disk, quota, account or task-status news would be a model turn for nothing: rules handle those and the status line and Usage show them. The one place that
// puts text into an agent (Agents.send) asks here first, so no caller can add a path around it.
// The list of everything that does write to an agent is in docs/design.md.

/** the tags of Lineclear's own lines that are machine news */
export const MACHINE_NEWS = ['news', 'health'] as const

/** which kind of machine news a line is, or none: `<lineclear><health ...>…</health></lineclear>` */
export function machineNews(text: string): (typeof MACHINE_NEWS)[number] | undefined {
  const m = /^\s*<lineclear>\s*<([a-z][\w-]*)[\s>/]/.exec(text)
  return MACHINE_NEWS.find((k) => k === m?.[1])
}

/** what was held back since the server started, for the tests */
export const held: { kind: string; key: string; at: number }[] = []

export function holdBack(kind: string, key: string): void {
  held.push({ kind, key, at: Date.now() })
  if (held.length > 200) held.shift()
}
