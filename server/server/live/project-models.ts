import { changeSettings, readSettings, type Role } from '../../../src/project.ts'

/** A project's model per role is the head of its list in the project's settings, the one place Settings writes it. */
const LIST: Record<string, Role> = { task: 'worker', reviewer: 'reviewer' }

/** The model a role of a space starts on; nothing when the space has no project or the role has no list. */
export function projectModel(space: string, role: string): string | undefined {
  const list = LIST[role]
  const project = list ? readSettings(space) : undefined
  return project && typeof project !== 'string' ? project.models[list!][0] : undefined
}

/** Moves a model stored apart from the project to the head of its list. False when the space has no project. */
export function adoptModel(space: string, role: string, model: string): boolean {
  const list = LIST[role]
  const project = list ? readSettings(space) : undefined
  if (!list || !project || typeof project === 'string') return false
  return typeof changeSettings(space, { models: { [list]: [model, ...project.models[list].filter((m) => m !== model)] } }) !== 'string'
}
