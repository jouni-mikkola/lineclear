import type { Agents } from './agents.ts'
import { ChatsReplies } from './chats-replies.ts'
export { rememberReply } from './chats-helpers.ts'
export { menuId, menuKeys, parseMenu } from './chats-menu.ts'
export class Chats extends ChatsReplies {
  constructor(agents: Agents, nameOf: (key: string) => string, user: () => string) {
    super(agents, nameOf, user)
  }
}
