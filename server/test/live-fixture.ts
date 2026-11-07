import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LINECLEAR_HOME = mkdtempSync(join(tmpdir(), 'shep-test-'))

export const { excerpt, line, parseUserLine } = await import('../server/live/chatlines.ts')
export const { agentLines } = await import('../server/live/agentlines.ts')
export const { findQuoted, matches, parseReply, userLines } = await import('../server/live/chatquotes.ts')
export const { parseMenu } = await import('../server/live/chats.ts')
export const { CATALOG, Settings, effortFor, setForTask } = await import('../server/live/settings.ts')
export const { coordinatorPrompt, readSection, settingsBlock, splitBrief, taskPrompt } = await import('../server/live/prompts.ts')
export const { pastTimes, span } = await import('../server/live/estimates.ts')
export const { readJson, writeJson } = await import('../server/store.ts')
export const { HOST, keyFor, machineName, placeId } = await import('../server/live/places.ts')
export const { stripHidden, hidden } = await import('../server/live/agents.ts')
export const { ROOT } = await import('../server/root.ts')
