import type { Agents } from './agents.ts'
import { ChatsReplies } from './chats-replies.ts'
export { menuId, menuKeys, parseMenu } from './chat-menu.ts'
export { rememberReply, sawReply } from './chats-helpers.ts'

export class Chats extends ChatsReplies {
  constructor(agents: Agents, nameOf: (key: string) => string, user: () => string) {
    super(agents, nameOf, user)
  }
}
