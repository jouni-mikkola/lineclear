import type { Agents } from './agents.ts'
import { ChatsReplies } from './chats-replies.ts'
export { menuId, menuKeys, parseMenu } from './screen-menu.ts'
export { rememberReply } from './chats-helpers.ts'
export { sawReply } from './chat-turns.ts'

export class Chats extends ChatsReplies {
  constructor(agents: Agents, nameOf: (key: string) => string, user: () => string) {
    super(agents, nameOf, user)
  }
}
