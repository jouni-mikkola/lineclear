// A step's claim on this machine is one insert into a table with the step as its key, so two loops that race for a step
// get one win and one refusal. The claim is a lease: its owner renews it while it lives, and it ends by itself when the
// owner goes quiet. A worker whose socket closed keeps its claims only a short grace, not a day.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** How long a claim lives without a renewal. */
export const LEASE_MS = 120_000;
/** How long a claim lives after its owner's socket closed. */
export const GRACE_MS = 10_000;

export interface StepLeases {
  /** Takes the claim of `step` for `owner`: true when it is ours now, false when a live claim holds it. */
  claim(step: string, owner: string, now?: number): boolean;
  /** Extends every claim of `owner`. */
  renew(owner: string, now?: number): void;
  /** The owner's socket closed: its claims end after the grace unless it renews. */
  closeOwner(owner: string, now?: number): void;
  release(step: string): void;
  /** The steps with a live claim. */
  live(now?: number): string[];
  close(): void;
}

/** The lease table in `dir`; each call opens its own connection, as each process does. */
export function openLeases(dir: string): StepLeases {
  const file = join(dir, "step-claims.sqlite");
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.run("pragma journal_mode = wal");
  db.run("pragma busy_timeout = 5000");
  db.run("create table if not exists step_claims (step text primary key, owner text not null, until integer not null)");
  const dropEnded = db.query("delete from step_claims where step = ? and until <= ?");
  const insert = db.query("insert or ignore into step_claims (step, owner, until) values (?, ?, ?)");
  const claimOnce = db.transaction((step: string, owner: string, now: number) => {
    dropEnded.run(step, now);
    return insert.run(step, owner, now + LEASE_MS).changes === 1;
  });
  return {
    claim: (step, owner, now = Date.now()) => claimOnce.immediate(step, owner, now),
    renew: (owner, now = Date.now()) => void db.query("update step_claims set until = ? where owner = ? and until > ?").run(now + LEASE_MS, owner, now),
    closeOwner: (owner, now = Date.now()) => void db.query("update step_claims set until = min(until, ?) where owner = ?").run(now + GRACE_MS, owner),
    release: (step) => void db.query("delete from step_claims where step = ?").run(step),
    live: (now = Date.now()) => (db.query("select step from step_claims where until > ?").all(now) as { step: string }[]).map((r) => r.step),
    close: () => db.close(),
  };
}
