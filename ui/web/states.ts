// The sample states a page draws on `?state=`. Their data lives in ui/test/.

export const STATES = [
  "filled",
  "empty",
  "loading",
  "error",
  "long",
  "many",
  "idle",
  "clear",
  "offline",
  "thirty",
  "one",
  "title",
  "tasks200",
  "real",
] as const;
export type PageState = (typeof STATES)[number];

/** The Chat view has states more than the others: sending, streaming, offline, none, request (a sentence to a plan to approve) and task. */
export const CHAT_STATES = [...STATES, "sending", "streaming", "offline", "none", "request", "task"] as const;
export type ChatState = (typeof CHAT_STATES)[number];

export const QUESTIONS = ["What waits for me?", "How far is web-shop?", "Move Gift cards after Search that forgives typos"];
