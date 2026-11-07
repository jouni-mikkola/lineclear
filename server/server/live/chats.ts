import type { Agents } from './agents.ts'
import { ChatsReplies } from './chats-replies.ts'
export type {} from './chats-helpers.ts'
export { menuId, menuKeys, parseMenu, rememberReply } from './chats-helpers.ts'

export class Chats extends ChatsReplies {
  constructor(agents: Agents, nameOf: (key: string) => string, user: () => string) {
    super(agents, nameOf, user)
  }
}
