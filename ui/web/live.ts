import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { apply, type Op } from "../../src/live-diff.ts";

// The server sends each change of an answer as it happens (`/api/live`, src/live.ts). A page holds the revision of
// each answer it read; a change one revision after it is applied to what the page shows, any other is read again.
// While the stream is open the views do not poll.

const revs = new Map<string, number>();
const keys = new Map<string, { key: QueryKey; users: number }>();
const listeners = new Set<() => void>();
let source: EventSource | undefined;
/** The paths the open stream carries. */
let streamed = new Set<string>();
let up = false;
let tick = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
let queue: ReturnType<typeof setTimeout> | undefined;
let client: QueryClient;

const changed = () => {
  tick++;
  for (const l of listeners) l();
};

/** Notes the revision an answer came with. An answer behind what the stream gave is not shown: the newer one stays. */
export function noteRevision<T>(path: string, header: string | null, data: T): T {
  const rev = Number(header);
  if (!Number.isInteger(rev) || rev <= 0) return data;
  const held = revs.get(path);
  if (held !== undefined && rev < held) {
    const key = keys.get(path)?.key;
    const newer = key && client?.getQueryData<T>(key);
    if (newer !== undefined && newer !== false) return newer;
  }
  revs.set(path, rev);
  schedule();
  return data;
}

/** A view asks for the changes of an answer while it shows it; the returned function says it no longer does. */
export function watch(queries: QueryClient, path: string, key: QueryKey): () => void {
  client = queries;
  const held = keys.get(path) ?? { key, users: 0 };
  held.users++;
  keys.set(path, held);
  schedule();
  return () => {
    if (--held.users > 0) return;
    keys.delete(path);
    // no change reached it while nobody watched: it is read again when it is shown again
    void queries.invalidateQueries({ queryKey: key, refetchType: "none" });
    schedule();
  };
}

/** Whether the changes of `path` come over the stream, so the view need not poll. */
export function useStreamed(path: string, on: boolean): boolean {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tick,
  );
  return on && up && streamed.has(path);
}

function schedule() {
  clearTimeout(queue);
  queue = setTimeout(connect, 30);
}

function connect() {
  clearTimeout(retry);
  const paths = [...keys.keys()].filter((p) => revs.has(p));
  if (paths.length === streamed.size && paths.every((p) => streamed.has(p)) && source && source.readyState !== EventSource.CLOSED) return;
  source?.close();
  up = false;
  streamed = new Set(paths);
  if (paths.length === 0) {
    source = undefined;
    changed();
    return;
  }
  const query = new URLSearchParams();
  for (const p of paths) {
    query.append("v", p);
    query.append("r", String(revs.get(p)));
  }
  const es = new EventSource(`/api/live?${query}`);
  source = es;
  es.onopen = () => {
    up = true;
    changed();
  };
  es.onerror = () => {
    es.close();
    up = false;
    changed();
    retry = setTimeout(connect, 3000);
  };
  es.addEventListener("full", (e) => {
    const m = JSON.parse((e as MessageEvent<string>).data) as { path: string; rev: number; value: unknown };
    const held = keys.get(m.path);
    if (!held) return;
    revs.set(m.path, m.rev);
    client.setQueryData(held.key, m.value);
  });
  es.addEventListener("patch", (e) => {
    const m = JSON.parse((e as MessageEvent<string>).data) as { path: string; rev: number; ops: Op[] };
    const held = keys.get(m.path);
    if (!held) return;
    if (m.rev !== (revs.get(m.path) ?? 0) + 1) {
      // a change was missed: read the answer whole
      void client.invalidateQueries({ queryKey: held.key });
      return;
    }
    revs.set(m.path, m.rev);
    client.setQueryData(held.key, (old: unknown) => (old === undefined ? old : apply(old, m.ops)));
  });
}
