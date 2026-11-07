import { expect } from "bun:test";
import { PAGE_TOKEN } from "../src/web.ts";

/** One message of the chat. */
export interface ChatMessage {
  text: string;
  question: { id: string; sent: number };
}

/** What the chat view says: its state, whether the Dispatcher is writing, and the messages so far. */
export interface ChatView {
  state: string;
  writing: boolean;
  messages: ChatMessage[];
}

/** A roadmap step with a title and one done-when line. */
export const step = (id: string, after = "none") =>
  `### ${id} Title ${id}\n- why: because ${id}\n- done when:\n  - first ${id}\n- locks: none\n- after: ${after}\n`;

/** The web chat as a client: requests with the page token, a wait for the chat view to reach a state, and a message sent. */
export function chatClient(handle: (req: Request) => Promise<Response>) {
  const req = (path: string, body?: unknown) => {
    const json = JSON.stringify(body);
    return new Request(
      `http://127.0.0.1:7420${path}`,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN, "content-length": String(Buffer.byteLength(json)) },
            body: json,
          },
    );
  };
  const view = async (ok: (v: ChatView) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const v = (await (await handle(req("/api/chat"))).json()) as ChatView;
      if (ok(v)) return v;
      await Bun.sleep(30);
    }
    throw new Error("the chat never got there");
  };
  const send = async (text: string) => expect((await handle(req("/api/chat", { text }))).status).toBe(202);
  return { req, view, send };
}
