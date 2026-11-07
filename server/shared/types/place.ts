/** Status marks: red needs you, green ready, green ring merging, amber working, grey idle, queued, to do or done, dashed unreachable. */
export type Status = 'need' | 'ready' | 'merging' | 'work' | 'idle' | 'queued' | 'todo' | 'done' | 'off'

/** the longest name a space can be given, as Slack's channels */
export const NAME_MAX = 80

/** a space's name as Slack's channel rules have it: lowercase letters, numbers, hyphens and underscores, no spaces.
 *  What was typed, turned into one ("My Project" → "my-project"); '' when nothing of it is left */
export function slugify(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_MAX)
    .replace(/-+$/, '')
}

/** why a space's name can't be (it breaks a rule, or another space on its machine has it), or undefined */
export function nameProblem(name: string, taken: string[] = []): string | undefined {
  if (!name) return 'Give it a name.'
  if (name.length > NAME_MAX) return `At most ${NAME_MAX} characters.`
  if (/[A-Z]/.test(name)) return 'Lowercase only.'
  if (/\s/.test(name)) return 'No spaces: use - or _.'
  if (!/^[a-z0-9_-]+$/.test(name)) return 'Only letters, numbers, - and _.'
  if (taken.includes(name)) return 'Another space on this machine has that name.'
  return undefined
}

/** A space: a folder on a machine with a name and its own coordinator, as herdr's spaces. Every machine has its home
 *  space (its home folder, ~), always first under it and never removed: its coordinator also keeps an eye on the
 *  machine, and the main machine's on every machine. Spaces are the only places with a chat. */
export interface Place {
  id: string
  /** its name, Slack-channel style ("my-project"), unique on its machine: the slug its links and commands use */
  name: string
  /** the machine it is on (its key: herdr's label for it) */
  machine: string
  /** the machine's home space */
  home?: boolean
  /** what its Tasks list: 2 its own; 1 its machine's (a home space); 0 every machine's (the main
   *  machine's home space, where there are more machines) */
  level: 0 | 1 | 2
  status: Status
  /** chat key of this space's coordinator */
  chat: string
  /** its machine can't be reached: when it went quiet, as shown ("14:02") */
  unreachableSince?: string
  /** its machine hasn't been reached yet since Lineclear started (an update): what it showed last, while it connects */
  connecting?: boolean
  /** does its repo have a GitHub remote */
  githubRemote?: boolean
  /** herdr on its machine isn't answering, since then ("14:02"): its agents can't hear anything */
  herdrDown?: string
}
