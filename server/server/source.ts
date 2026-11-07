// A source fills the view model and carries out actions. The live source reads herdr and the CLIs' logs.
import type { Action, Alert, Chat, Snapshot, TermScreen } from '../shared/types.ts'

export type SourceEvents = {
  snapshot: []
  chat: [key: string]
  alert: [alert: Alert]
  terminal: [key: string, screen: TermScreen]
  /** a worker's news for the main machine's home space, which keeps every machine's overview */
  news: [n: Overview]
}

/** one piece of another machine's news, as the main machine's home space hears it: its place and one line */
export interface Overview {
  place: string
  line: string
  kind: 'added' | 'ready' | 'need' | 'done' | 'red' | 'stalled' | 'health'
  about?: Record<string, string>
}

export class Emitter<E extends Record<string, unknown[]>> {
  private fns: { [K in keyof E]?: ((...a: E[K]) => void)[] } = {}
  on<K extends keyof E>(ev: K, fn: (...a: E[K]) => void) {
    ;(this.fns[ev] ??= []).push(fn)
    return () => {
      this.fns[ev] = this.fns[ev]!.filter((f) => f !== fn)
    }
  }
  emit<K extends keyof E>(ev: K, ...a: E[K]) {
    for (const f of this.fns[ev] ?? []) f(...a)
  }
}

export interface Source extends Emitter<SourceEvents> {
  snapshot(): Snapshot
  /** Owning agent status, for the chat view. */
  chatStatus?(key: string): string
  chat(key: string): Chat | undefined
  act(a: Action): Promise<unknown>
  /** which chats and terminal are on someone's screen: read them while they are */
  watch(chats: string[], terms: string[]): void
  upload(chat: string, name: string, data: Uint8Array): Promise<string>
  /** a file attached in a chat, by the path its chat line gives; only those, never anything else on the machine */
  attachment(chat: string, path: string): Promise<Blob | null>
  /** before it stops: what must not be cut halfway (a merge) finishes; true when it waited for something */
  drain?(): Promise<boolean>
  stop?(): void
}
