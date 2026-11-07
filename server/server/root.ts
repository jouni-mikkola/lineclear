// The checkout the server runs from; what agents use (the lineclear command, the skill) points here.
import { join } from 'node:path'

export const ROOT = process.env.LINECLEAR_ROOT ?? join(import.meta.dir, '..')
