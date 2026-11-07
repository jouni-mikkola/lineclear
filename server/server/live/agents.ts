import { AgentsSending } from './agents-sending.ts'
export type { OutItem, Spec } from './agents-helpers.ts'
export { ROUTING_FAILURE, hidden, stripHidden } from './agents-helpers.ts'

export class Agents extends AgentsSending {}
