import { useSyncExternalStore } from "react";
import type { Trouble } from "../kit/index.ts";

// How the reads are doing, for the frame. Every read of `get` reports here: what failed, what is slow, and when one
// last worked. The views never see it: they keep the last data and the frame says why it is old.

/** An answer after this long is slow. */
const SLOW_MS = 5000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: "lost" | "stopped" | "broken" | "stale",
    readonly file?: string,
    readonly lines?: string[],
  ) {
    super(message);
  }
}

const failed = new Map<string, { error: ApiError; since?: number }>();
const slow = new Set<symbol>();
const lastOk = new Map<string, number>();
let seen: Trouble | undefined;
const listeners = new Set<() => void>();

function compute(): Trouble | undefined {
  const errors = [...failed.values()];
  const pick = (k: ApiError["kind"]) => errors.find((e) => e.error.kind === k);
  const broken = pick("broken");
  if (broken) return { kind: "broken", file: broken.error.file, lines: broken.error.lines, since: broken.since };
  for (const kind of ["stopped", "lost", "stale"] as const) {
    const f = pick(kind);
    if (f) return { kind, since: f.since };
  }
  // a slow read still shows what an earlier one gave
  return slow.size ? { kind: "slow", since: Math.max(0, ...lastOk.values()) || undefined } : undefined;
}

function publish() {
  const next = compute();
  if (next?.kind === seen?.kind && next?.since === seen?.since && next?.lines?.join() === seen?.lines?.join()) return;
  seen = next;
  for (const l of listeners) l();
}

/** Marks a read begun; the returned functions mark it answered or failed. */
export function startRead(path: string) {
  const id = Symbol(path);
  const timer = setTimeout(() => {
    slow.add(id);
    publish();
  }, SLOW_MS);
  const end = () => {
    clearTimeout(timer);
    slow.delete(id);
  };
  return {
    ok() {
      end();
      failed.delete(path);
      lastOk.set(path, Date.now());
      publish();
    },
    fail(error: ApiError) {
      end();
      failed.set(path, { error, since: lastOk.get(path) });
      publish();
    },
  };
}

/** A read that is no longer asked for leaves nothing behind in the frame. */
export function forget(path: string) {
  if (failed.delete(path)) publish();
}

export function useTrouble(sample?: Trouble): Trouble | undefined {
  const live = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => seen,
  );
  return sample ?? live;
}
