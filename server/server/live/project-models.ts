import { readSettings, type Role } from '../../../src/project.ts'

/** A project's model per role is the head of its list in the project's settings, the one place Settings writes it. */
const LIST: Record<string, Role> = { task: 'worker', reviewer: 'reviewer' }

/** The model a role of a space starts on; nothing when the space has no project or the role has no list. */
export function projectModel(space: string, role: string): string | undefined {
  const list = LIST[role]
  const project = list ? readSettings(space) : undefined
  return project && typeof project !== 'string' ? project.models[list!][0] : undefined
}

/** The ordered model lists a space's tasks and reviews really run on; nothing when it has no project. */
export function projectLists(space: string): { worker: string[]; reviewer: string[] } | undefined {
  const project = readSettings(space)
  return typeof project === 'string' ? undefined : project.models
}
