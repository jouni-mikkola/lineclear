// How Lineclear talks to Shepherdr's server on this machine: where it answers, its snapshot, its WebSocket, its actions,
// and the per-task links the chat and the terminal keep to it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./paths.ts";

type Env = Record<string, string | undefined>;

/** Where Shepherdr's server answers on this machine, from its `server.json`, or undefined when it is not running. */
export function shepherdrServer(env: Env = process.env): string | undefined {
  if (env.LINECLEAR_SHEPHERDR_URL) return env.LINECLEAR_SHEPHERDR_URL.replace(/\/+$/, "");
  try {
    const port = JSON.parse(readFileSync(join(dataDir(env), "server.json"), "utf8")).port;
    return typeof port === "number" ? `http://127.0.0.1:${port}` : undefined;
  } catch {
    return undefined;
  }
}

/** The key of a task's chat with its agent in Shepherdr's snapshot, or undefined for a task it has none of. */
export const taskChatKey = (snap: { tasks?: { id?: string; agent?: { chat?: string } }[] } | undefined, id: string): string | undefined =>
  (Array.isArray(snap?.tasks) ? snap.tasks : []).find((t) => t?.id === id)?.agent?.chat;

/** Shepherdr's snapshot, or undefined when it is not running or does not answer. */
export async function readSnapshot(base: string): Promise<unknown> {
  try {
    const r = await fetch(`${base}/api/snapshot`, { signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : undefined;
  } catch {
    return undefined;
  }
}

/** One WebSocket to Shepherdr that asks to watch what `watch` names and hands each message on parsed. */
export function watchSocket(base: string, watch: Record<string, unknown>, onMessage: (m: any) => void, onClose: (sock: WebSocket) => void): WebSocket {
  const sock = new WebSocket(`${base.replace(/^http/, "ws")}/api/ws`);
  sock.onopen = () => sock.send(JSON.stringify({ type: "watch", ...watch }));
  sock.onmessage = (e) => {
    try {
      onMessage(JSON.parse(String(e.data)));
    } catch {
      // a broken event: the next one has everything again
    }
  };
  sock.onclose = () => onClose(sock);
  return sock;
}

/** Posts one action to Shepherdr. Gives the reason when it is refused, slow or away. */
export async function postAction(
  base: string,
  action: Record<string, unknown>,
  ms: number,
  offline: string,
  slow: string,
): Promise<{ error: string; status: number } | undefined> {
  try {
    const r = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
      signal: AbortSignal.timeout(ms),
    });
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return !r.ok || body.ok === false ? { error: body.error ?? `The board server answered ${r.status}.`, status: 502 } : undefined;
  } catch (e) {
    return (e as Error)?.name === "TimeoutError" ? { error: slow, status: 504 } : { error: offline, status: 503 };
  }
}

/** Links by task, made on the first ask. A few are kept; the oldest is closed for a new one, so its socket to Shepherdr does not stay. */
export function keepLinks<T extends { close(): void }>(make: (id: string) => T, keep = 8) {
  const links = new Map<string, T>();
  return (id: string) => {
    let c = links.get(id);
    if (!c) {
      const old = links.size >= keep ? links.keys().next().value : undefined;
      if (old !== undefined) {
        links.get(old)?.close();
        links.delete(old);
      }
      c = make(id);
      links.set(id, c);
    }
    return c;
  };
}
